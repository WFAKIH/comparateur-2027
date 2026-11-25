// Validation en masse des propositions d'un lot (décision humaine).
// Met à jour « decision » dans le fichier du lot ET dans Supabase (si .env est configuré).
//
// Usage :
//   node outils/decider.js <lot.json> --liste                         affiche le lot et les recommandées
//   node outils/decider.js <lot.json> accepte --recommandees [--essai]
//   node outils/decider.js <lot.json> accepte 001 002 015 [--essai]
//   node outils/decider.js <lot.json> refuse 029 --note "motif" [--essai]
//   node outils/decider.js <lot.json> a_valider 004                    (annuler une décision)
//   node outils/decider.js <lot.json> chercher [C001 C002 …] [--limite N] [--essai]
//        cherche une source probante (PDF archivé, sites officiels du candidat) pour les
//        contrôles de promesses en attente ; si elle est trouvée : capture + vérification « confirme »
//        (la proposition devient recommandée). Puis règle « sourcée = validée » : les promesses dont
//        la source est retrouvée sont acceptées automatiquement (désactivable : --sans-auto).
//   node outils/decider.js <lot.json> auto [--essai]   applique seule la règle « sourcée = validée »
//
// Les numéros courts (« 001 ») sont complétés avec la date du lot. « --recommandees » =
// vérification « confirme », neutralité « ok », revue budget absente ou « conforme »,
// contrôle automatique sans erreur. Les propositions déjà intégrées ne sont jamais modifiées.
// « --essai » affiche ce qui serait fait sans rien écrire. « --local » n'écrit pas dans Supabase.
'use strict';
const fs = require('fs');
const sb = require('./supabase');

const DECISIONS = ['accepte', 'refuse', 'a_valider'];

function recommandee(p) {
  const verif = p.verification?.statut;
  if (p.type === 'controle_promesse') return verif === 'confirme';
  // Reclassement « Sans incidence budgétaire » : pas de revue de neutralité (aucun texte reformulé).
  if (p.type === 'correction_promesse' && p.champ === 'Nature du chiffrage' && p.valeur_proposee === 'Sans incidence budgétaire') return verif === 'confirme';
  const neutre = p.revue_neutralite?.statut;
  const budget = p.revue_budget?.statut;
  const erreurs = p.controle_auto?.erreurs || [];
  return verif === 'confirme' && neutre === 'ok' && (!budget || budget === 'conforme') && !erreurs.length;
}

function libelle(p) {
  const v = p.valeur_proposee;
  if (p.type === 'ajout_promesse') return `${v?.Candidat || ''} · ${v?.['Thème'] || ''} · ${v?.['Promesse (reformulation fidèle)'] || ''}`;
  if (p.type === 'ajout_sondage' && Array.isArray(v)) return `${v[0]?.['Code scénario'] || ''} (${v.length} lignes)`;
  if (p.type === 'controle_promesse') return `${p.id_existant} · ${p.valeur_actuelle}`;
  return `${p.id_existant || ''} · ${p.champ || ''} → ${typeof v === 'object' ? JSON.stringify(v) : v}`;
}
const court = s => String(s).length > 90 ? String(s).slice(0, 89) + '…' : String(s);

function lister(lot) {
  for (const p of lot.propositions) {
    const r = recommandee(p) ? '★' : ' ';
    const etats = [p.verification?.statut || '—', p.revue_neutralite?.statut || '—', p.revue_budget?.statut || ''].filter(Boolean).join('/');
    console.log(`${r} ${p.id.slice(-3)} ${p.decision.padEnd(9)} ${p.type.padEnd(19)} ${etats.padEnd(28)} ${court(libelle(p))}`);
  }
  const n = lot.propositions.filter(recommandee).length;
  console.log(`\n★ = recommandée (${n} sur ${lot.propositions.length}).`);
}

async function main() {
  const args = process.argv.slice(2);
  const fichier = args[0];
  if (!fichier || !fs.existsSync(fichier)) {
    console.error('Usage : node outils/decider.js <lot.json> (--liste | accepte|refuse|a_valider (--recommandees | 001 002 …)) [--note "…"] [--essai] [--local]');
    process.exit(2);
  }
  const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const date = lot.date || lot.propositions[0]?.id.slice(0, 10);
  if (args.includes('--liste')) return lister(lot);
  const completer = n => /^[A-Z]?\d{1,3}$/i.test(n) ? `${date}-${n.replace(/\d+/, d => d.padStart(3, '0')).toUpperCase()}` : n;
  if (args[1] === 'chercher') return chercher(fichier, lot, args, completer);
  if (args[1] === 'auto') return regleAuto(fichier, lot, { essai: args.includes('--essai'), local: args.includes('--local') });

  const decision = args[1];
  if (!DECISIONS.includes(decision)) { console.error(`Décision inconnue « ${decision} » (accepte, refuse ou a_valider).`); process.exit(2); }
  const essai = args.includes('--essai');
  const local = args.includes('--local');
  const iNote = args.indexOf('--note');
  const note = iNote > 0 ? args[iNote + 1] : undefined;
  const numeros = args.slice(2).filter((a, i, t) => !a.startsWith('--') && t[i - 1] !== '--note');

  let cibles;
  if (args.includes('--recommandees')) cibles = lot.propositions.filter(recommandee);
  else {
    if (!numeros.length) { console.error('Indiquer des numéros (ex. 001 015) ou --recommandees.'); process.exit(2); }
    const ids = numeros.map(completer);
    const inconnus = ids.filter(id => !lot.propositions.some(p => p.id === id));
    if (inconnus.length) { console.error('Numéros absents du lot : ' + inconnus.join(', ')); process.exit(1); }
    cibles = lot.propositions.filter(p => ids.includes(p.id));
  }

  const integrees = cibles.filter(p => p.integre_le);
  cibles = cibles.filter(p => !p.integre_le);
  if (integrees.length) console.log(`Ignorées (déjà intégrées) : ${integrees.map(p => p.id.slice(-3)).join(', ')}`);
  const nonReco = decision === 'accepte' ? cibles.filter(p => !recommandee(p)) : [];
  for (const p of cibles) console.log(`${essai ? '[essai] ' : ''}${p.id.slice(-3)} ${p.decision} → ${decision}  ${court(libelle(p))}`);
  if (nonReco.length) console.log(`\nAttention : ${nonReco.length} proposition(s) acceptée(s) hors recommandation (${nonReco.map(p => p.id.slice(-3)).join(', ')}) — voir le rapport du jour.`);
  if (!cibles.length) return console.log('Rien à faire.');
  if (essai) return console.log(`\nEssai : ${cibles.length} proposition(s) seraient passées à « ${decision} ». Rien n'a été écrit.`);

  for (const p of cibles) { p.decision = decision; if (note !== undefined) p.note_humaine = note; }
  fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`\n${cibles.length} décision(s) écrite(s) dans ${fichier}.`);

  if (local) return;
  await majSupabase(cibles, { decision, ...(note !== undefined ? { note_humaine: note } : {}) });
}

async function majSupabase(cibles, corps) {
  if (!sb.configure()) return console.log('Supabase non configuré (.env) : décisions enregistrées dans le fichier seulement.');
  const filtre = encodeURIComponent(`(${cibles.map(p => `"${p.id}"`).join(',')})`);
  const maj = await sb.api(`/rest/v1/propositions?id=in.${filtre}&integre_le=is.null`, {
    method: 'PATCH', corps, entetes: { Prefer: 'return=representation' },
  });
  console.log(`${maj.length} décision(s) mise(s) à jour dans Supabase.`);
  if (maj.length < cibles.length) console.log(`Attention : ${cibles.length - maj.length} proposition(s) absente(s) de Supabase (lot non envoyé ?).`);
}

// ---------- Règle « sourcée = validée » (choix de l'utilisateur, 2026-11-25) ----------
// Une promesse existante (controle_promesse) dont la source a été retrouvée par « chercher »
// est acceptée automatiquement. Garde-fous : source « trouvée » (≥ 75 % des mots et tous les chiffres
// dans une même phrase), vérification « confirme », et pour une page web, passage retrouvé
// par la capture (exact ou partiel). Les pistes et les autres types de propositions restent manuels.
const NOTE_AUTO = 'Validée automatiquement : source retrouvée (règle « sourcée = validée »)';
function sourcee(p) {
  if (p.type !== 'controle_promesse' || p.integre_le || p.decision !== 'a_valider') return false;
  const s = p.source_trouvee;
  if (!s || s.niveau !== 'trouvee' || p.verification?.statut !== 'confirme') return false;
  if (s.type === 'page') return ['exacte', 'partielle'].includes(s.capture?.passage);
  return true; // PDF : passage retrouvé dans le texte du document (n° de page)
}

async function regleAuto(fichier, lot, { essai = false, local = false } = {}) {
  const cibles = lot.propositions.filter(sourcee);
  const retenues = lot.propositions.filter(p => p.type === 'controle_promesse' && p.decision === 'a_valider' && !p.integre_le &&
    p.source_trouvee?.niveau === 'trouvee' && !sourcee(p));
  console.log(`\nRègle « sourcée = validée » : ${cibles.length} promesse(s) ${essai ? 'seraient acceptées' : 'acceptées'} automatiquement.`);
  for (const p of cibles) console.log(`  ✓ ${p.id.slice(-4)} ${court(libelle(p))}`);
  if (retenues.length) {
    console.log(`  Laissées à valider à la main (source trouvée mais passage non retrouvé sur la capture) : ${retenues.map(p => p.id.slice(-4)).join(', ')}`);
  }
  if (essai || !cibles.length) return;
  for (const p of cibles) { p.decision = 'accepte'; p.note_humaine = p.note_humaine || NOTE_AUTO; p.decision_auto = new Date().toLocaleDateString('sv-SE'); }
  fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  if (!local) await majSupabase(cibles, { decision: 'accepte', note_humaine: NOTE_AUTO });
}

async function chercher(fichier, lot, args, completer) {
  const { chercherSources } = require('./chercher-sources');
  const essai = args.includes('--essai');
  const iLim = args.indexOf('--limite');
  const numeros = args.slice(2).filter((a, i, t) => !a.startsWith('--') && t[i - 1] !== '--limite');
  let cibles = lot.propositions.filter(p => p.type === 'controle_promesse' && !p.integre_le);
  if (numeros.length) {
    const ids = numeros.map(completer);
    cibles = cibles.filter(p => ids.includes(p.id));
  } else {
    cibles = cibles.filter(p => p.decision === 'a_valider' && p.verification?.statut !== 'confirme');
  }
  if (iLim > 0) cibles = cibles.slice(0, Number(args[iLim + 1]));
  if (!cibles.length) return console.log('Aucun contrôle de promesse à traiter.');
  console.log(`Recherche de sources pour ${cibles.length} promesse(s)${essai ? ' (essai : ni capture ni écriture)' : ''}…`);
  const journal = [];
  const { resultats } = await chercherSources(cibles, { essai, journal });
  for (const l of journal) console.log('  · ' + l);
  console.log('');
  const marque = { trouvee: 'TROUVÉE', piste: 'piste  ', non: 'rien   ' };
  for (const r of resultats) {
    const s = r.res;
    console.log(`${r.p.id.slice(-4)} ${marque[r.niveau]} ${s ? String(Math.round(s.score * 100)).padStart(3) + ' %' : '     '}  ${court(r.candidat + ' · ' + r.promesse)}`);
    if (s && r.niveau !== 'non') console.log(`        ${s.url}${s.page ? ` (page ${s.page})` : ''}\n        « ${court(s.passage.replace(/\s+/g, ' ').slice(0, 200))} »`);
  }
  const n = k => resultats.filter(r => r.niveau === k).length;
  console.log(`\nBilan : ${n('trouvee')} source(s) trouvée(s) (vérification « confirme », recommandées), ${n('piste')} piste(s) à regarder, ${n('non')} sans résultat.`);
  if (essai) return console.log('Essai : rien n\'a été écrit.');
  fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`Lot mis à jour : ${fichier}`);
  const local = args.includes('--local') || !sb.configure();
  const ids = resultats.filter(r => r.niveau !== 'non').map(r => r.p.id);
  if (!local && ids.length) await sb.envoyer(fichier, ids);
  if (!args.includes('--sans-auto')) await regleAuto(fichier, lot, { local });
}

main().catch(e => { console.error('Erreur : ' + e.message); process.exit(1); });
