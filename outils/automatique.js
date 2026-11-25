// Validation, intégration et publication automatiques selon equipe/POLITIQUE_VALIDATION.md.
// Usage : node outils/automatique.js <lot.json> [<lot.json> …] [--essai] [--sans-publication]
//   --essai            : montre les décisions qui seraient prises ; n'écrit rien (ni lot, ni Supabase, ni site).
//   --sans-publication : décide et intègre, mais ne commite ni ne pousse.
// Interrupteurs dans mises_a_jour/etat.json : "automatique" (décider + intégrer), "publication_automatique" (commit + push).
// L'automate n'accepte que selon les règles A1–A3 ; il ne refuse jamais. Le reste reste « a_valider » pour l'humain.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { RACINE, MAJ, charger, aujourdhui } = require('./donnees');
const { decisionAuto } = require('./politique');
const sb = require('./supabase');

const MAX_PAR_PASSAGE = 150;
const args = process.argv.slice(2);
const essai = args.includes('--essai');
const lots = args.filter(a => !a.startsWith('--'));
const journal = [];
const log = s => { console.log(s); journal.push(s); };
const node = (...a) => spawnSync(process.execPath, a, { cwd: RACINE, encoding: 'utf8' });
const git = (...a) => spawnSync('git', a, { cwd: RACINE, encoding: 'utf8' });

function etat() { try { return JSON.parse(fs.readFileSync(path.join(MAJ, 'etat.json'), 'utf8')); } catch { return {}; } }
function arret(motif) { log(`\nARRÊT : ${motif}. Rien n'est publié.`); ecrireJournaux(); process.exit(1); }
const fichiersJournal = [];
function ecrireJournaux() {
  for (const f of fichiersJournal) {
    fs.writeFileSync(f, `# Décisions automatiques — ${aujourdhui()}\n\nPolitique : equipe/POLITIQUE_VALIDATION.md\n\n\`\`\`\n${journal.join('\n')}\n\`\`\`\n`, 'utf8');
  }
}

async function main() {
  if (!lots.length) { console.error('Usage : node outils/automatique.js <lot.json> … [--essai] [--sans-publication]'); process.exit(2); }
  const e = etat();
  if (!essai && e.automatique === false) { console.log('Validation automatique désactivée (etat.json : "automatique": false).'); return; }

  const db = charger();
  const avant = { promesses: db.promesses.length, sondages: (db.sondages || []).length, inventaire: db.inventaire.length };
  let totalDecides = 0;
  const parLot = [];

  // 1. Décisions
  for (const fichier of lots) {
    const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    fichiersJournal.push(path.join(path.dirname(fichier), 'decisions-auto.md'));
    // Contrôle automatique à jour avant de décider
    if (!essai) node(path.join('outils', 'valider.js'), fichier, '--ecrire');
    const lotFrais = essai ? lot : JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const acceptes = [], humains = {};
    for (const p of lotFrais.propositions || []) {
      if (p.decision !== 'a_valider' || p.integre_le) continue;
      const d = decisionAuto(p, { db });
      if (d.decision === 'accepte') acceptes.push([p, d]);
      else humains[d.motif] = (humains[d.motif] || 0) + 1;
    }
    log(`\n== ${path.relative(RACINE, fichier)} : ${acceptes.length} acceptée(s) automatiquement`);
    const parRegle = acceptes.reduce((c, [, d]) => (c[d.regle] = (c[d.regle] || 0) + 1, c), {});
    if (acceptes.length) log('   par règle : ' + Object.entries(parRegle).map(([k, v]) => `${k} ${v}`).join(' · '));
    for (const [p, d] of acceptes) log(`   ✓ ${p.id} ${d.regle} · ${p.type}${p.id_existant ? ' · ' + p.id_existant : ''} — ${d.motif}`);
    const nH = Object.values(humains).reduce((a, b) => a + b, 0);
    if (nH) log(`   Laissées à la décision humaine : ${nH} (` + Object.entries(humains).map(([k, v]) => `${v} ${k}`).join(' ; ') + ')');
    totalDecides += acceptes.length;
    parLot.push({ fichier, lot: lotFrais, acceptes });
  }
  if (essai) { log(`\n[essai] ${totalDecides} décision(s) automatique(s) seraient prises. Rien n'a été écrit.`); return; }
  if (totalDecides > MAX_PAR_PASSAGE) arret(`${totalDecides} décisions dans un seul passage (plafond ${MAX_PAR_PASSAGE}) : volume inhabituel, contrôle humain requis`);

  for (const { fichier, lot, acceptes } of parLot) {
    if (!acceptes.length) continue;
    const jour = aujourdhui();
    for (const [p, d] of acceptes) { p.decision = 'accepte'; p.note_humaine = `Décision automatique (règle ${d.regle}) : ${d.motif}`; p.decision_auto = jour; }
    fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
    if (sb.configure()) {
      try {
        // Lot absent de Supabase : on l'envoie d'abord.
        await sb.envoyer(fichier, acceptes.map(([p]) => p.id));
        for (const regle of ['A1', 'A2', 'A3']) {
          const ids = acceptes.filter(([, d]) => d.regle === regle).map(([p]) => p.id);
          if (!ids.length) continue;
          await sb.api(`/rest/v1/propositions?id=in.${encodeURIComponent(`(${ids.map(i => `"${i}"`).join(',')})`)}&integre_le=is.null`, {
            method: 'PATCH', corps: { decision: 'accepte', note_humaine: `Décision automatique (règle ${regle})` }, entetes: { Prefer: 'return=minimal' },
          });
        }
      } catch (err) { log(`   Supabase : ${err.message} (décisions gardées dans le fichier)`); }
    }
  }
  if (!totalDecides) { log('\nAucune décision automatique : rien à intégrer.'); ecrireJournaux(); return; }

  // 2. Intégration : essai puis réelle, lot par lot
  let integrees = 0;
  for (const { fichier } of parLot) {
    const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const attendues = lot.propositions.filter(p => p.decision === 'accepte' && !p.integre_le).length;
    if (!attendues) continue;
    const es = node(path.join('outils', 'integrer.js'), fichier, '--essai');
    const n = Number((es.stdout.match(/\[essai\] (\d+) proposition/) || [])[1] || -1);
    const ignorees = (es.stdout.match(/^IGNORÉE .*$/gm) || []);
    if (ignorees.length) log(`   ${path.basename(path.dirname(fichier))} : ${ignorees.length} ignorée(s) à l'intégration :\n   ` + ignorees.join('\n   '));
    if (n !== attendues - ignorees.length || n < 0) arret(`essai d'intégration incohérent pour ${fichier} (${n} au lieu de ${attendues})`);
    const r = node(path.join('outils', 'integrer.js'), fichier);
    if (r.status !== 0) arret(`échec de l'intégration de ${fichier} : ${r.stderr.slice(0, 300)}`);
    log(`   intégré : ${path.relative(RACINE, fichier)} (${n})`);
    integrees += n;
    if (sb.configure()) { const m = node(path.join('outils', 'supabase.js'), 'marquer', fichier); if (m.status !== 0) log(`   Supabase (marquer) : ${m.stderr.slice(0, 200)}`); }
  }

  // 3. Contrôles de cohérence
  let apres;
  try { apres = charger(); } catch (err) { arret(`les données du site ne se chargent plus : ${err.message}`); }
  if (apres.promesses.length < avant.promesses) arret(`le nombre de promesses a diminué (${avant.promesses} → ${apres.promesses.length})`);
  if (apres.inventaire.length < avant.inventaire) arret('l\'inventaire a diminué');
  const ids = apres.promesses.map(p => p.ID);
  if (new Set(ids).size !== ids.length) arret('identifiants de promesses en double');
  const app = node('--check', path.join('site', 'app.js'));
  if (app.status !== 0) arret('site/app.js invalide');
  log(`\nDonnées : ${avant.promesses} → ${apres.promesses.length} promesses, ${avant.sondages} → ${(apres.sondages || []).length} lignes de sondage. ${integrees} proposition(s) intégrée(s).`);
  ecrireJournaux();

  // 4. Publication
  if (args.includes('--sans-publication') || e.publication_automatique === false) { log('Publication non faite (option ou interrupteur) : commit et push à faire à la main.'); ecrireJournaux(); return; }
  if (git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() !== 'main') arret('la branche courante n\'est pas main');
  // Seulement ce que l'automate produit : données du site, lots, preuves. Le code et les règles restent humains.
  git('reset', '-q');
  git('add', '--', 'site/data.js', 'site/data.json', 'mises_a_jour', 'preuves');
  const statut = git('diff', '--cached', '--name-only').stdout;
  if (/(^|\/)\.env/m.test(statut)) arret('.env serait commité');
  if (statut.split('\n').filter(Boolean).some(f => !/^(site\/data\.js|site\/data\.json|mises_a_jour\/|preuves\/)/.test(f))) arret('un fichier hors données, lots et preuves serait commité');
  const msg = `Intégration automatique du ${aujourdhui()} : ${integrees} proposition(s) (politique de validation)\n\n` +
    journal.filter(l => /^== |par règle|Laissées/.test(l.trim())).map(l => l.trim()).join('\n') +
    '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
  const c = git('commit', '-q', '-m', msg);
  if (c.status !== 0) arret(`commit impossible : ${(c.stderr || c.stdout).slice(0, 300)}`);
  const pu = git('push', 'origin', 'main');
  if (pu.status !== 0) arret(`push impossible : ${pu.stderr.slice(0, 300)} (le commit local est fait)`);
  log(`Publié : commit ${git('rev-parse', '--short', 'HEAD').stdout.trim()} poussé ; export public et Netlify suivent automatiquement.`);
  ecrireJournaux();
  // Le journal mis à jour après le commit est inclus au passage suivant.
}

main().catch(err => { console.error('Erreur : ' + err.message); process.exit(1); });
