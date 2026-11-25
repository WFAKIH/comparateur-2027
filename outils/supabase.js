// Synchronisation avec Supabase (API REST, sans dépendance).
// Configuration : fichier .env à la racine du projet (voir .env.exemple).
// Usage :
//   node outils/supabase.js verifier                          teste la connexion et les tables
//   node outils/supabase.js envoyer  <propositions.json>      envoie le lot (+ captures) pour validation
//   node outils/supabase.js recuperer <propositions.json>     rapatrie les décisions prises dans Supabase
//   node outils/supabase.js marquer  <propositions.json>      signale à Supabase les propositions intégrées
//   node outils/supabase.js signalements [--tous]             liste les signalements des visiteurs
'use strict';
const fs = require('fs');
const path = require('path');
const { RACINE, charger } = require('./donnees');
const { PREUVES } = require('./preuves');

function lireEnv() {
  const f = path.join(RACINE, '.env');
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
}
const env = { ...lireEnv(), ...process.env };
const URL_SB = (env.SUPABASE_URL || '').replace(/\/$/, '');
const CLE = env.SUPABASE_SERVICE_ROLE_KEY;

function configure() { return Boolean(URL_SB && CLE); }
async function api(chemin, { method = 'GET', corps, entetes = {}, brut } = {}) {
  if (!configure()) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env');
  const r = await fetch(URL_SB + chemin, {
    method,
    headers: { apikey: CLE, ...(CLE.startsWith('sb_') ? {} : { Authorization: `Bearer ${CLE}` }), ...(brut ? {} : { 'Content-Type': 'application/json' }), ...entetes },
    body: brut ?? (corps === undefined ? undefined : JSON.stringify(corps)),
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`${method} ${chemin} → HTTP ${r.status} ${texte.slice(0, 300)}`);
  try { return texte ? JSON.parse(texte) : null; } catch { return texte; }
}

function candidatDe(p, db) {
  return p.valeur_proposee?.['Candidat'] || db.promesses.find(x => x.ID === p.id_existant)?.['Candidat']
    || (p.table === 'inventaire' ? (p.id_existant || p.valeur_proposee?.['Personnalité']) : null) || null;
}
function resume(p) {
  const v = p.valeur_proposee;
  switch (p.type) {
    case 'ajout_promesse': return `Ajout · ${v?.['Thème'] || ''} · ${v?.['Promesse (reformulation fidèle)'] || ''}`;
    case 'correction_promesse': return `Correction ${p.id_existant} · ${p.champ} : « ${p.valeur_actuelle ?? ''} » → « ${typeof v === 'object' ? JSON.stringify(v) : v} »`;
    case 'lien_mort': return `Lien mort ${p.id_existant}${v ? ' → ' + v : ''}`;
    case 'maj_inventaire': return `Inventaire ${p.id_existant || v?.['Personnalité'] || ''} · ${p.champ || 'ajout'} → ${typeof v === 'object' ? JSON.stringify(v) : v}`;
    case 'controle_promesse': return `Contrôle ${p.id_existant} · ${p.valeur_actuelle || ''} — accepte = garder · refuse = retirer du site`;
    default: return `${p.type} · ${p.table || ''} · ${Array.isArray(v) ? v.length + ' ligne(s)' : ''}`;
  }
}

async function envoyerCapture(p) {
  const preuve = [...(p.preuves || [])].reverse().find(x => x.dossier && fs.existsSync(path.join(x.dossier, 'capture.png')));
  if (!preuve) return null;
  const objet = `${p.id.slice(0, 10)}/${p.id}.png`;
  await api(`/storage/v1/object/preuves/${objet}`, {
    method: 'POST', brut: fs.readFileSync(path.join(preuve.dossier, 'capture.png')),
    entetes: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
  });
  const s = await api(`/storage/v1/object/sign/preuves/${objet}`, { method: 'POST', corps: { expiresIn: 60 * 24 * 3600 } });
  return URL_SB + '/storage/v1' + (s.signedURL || s.signedUrl);
}

async function envoyer(fichier) {
  const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const db = charger();
  const lignes = [];
  for (const p of lot.propositions || []) {
    let capture = null;
    try { capture = await envoyerCapture(p); } catch (e) { console.warn(`Capture non envoyée pour ${p.id} : ${e.message}`); }
    const derniere = [...(p.preuves || [])].reverse()[0];
    lignes.push({
      id: p.id, lot: lot.date || p.id.slice(0, 10), agent: p.agent || null, type: p.type, table_cible: p.table || null,
      id_existant: p.id_existant || null, champ: p.champ || null, candidat: candidatDe(p, db), resume: resume(p),
      valeur_actuelle: p.valeur_actuelle ?? null, valeur_proposee: p.valeur_proposee ?? null,
      source_url: p.source_url || null, citation: p.citation || null, date_source: p.date_source || null, confiance: p.confiance || null,
      verification: p.verification?.statut || null, verification_detail: p.verification || null,
      revue_neutralite: p.revue_neutralite || null, revue_budget: p.revue_budget || null, controle_auto: p.controle_auto || null,
      passage_trouve: derniere?.citation_trouvee || null, capture_url: capture,
      // « decision » n'est pas envoyée : une décision déjà prise dans Supabase n'est jamais écrasée.
    });
  }
  if (lignes.length) {
    await api('/rest/v1/propositions?on_conflict=id', {
      method: 'POST', corps: lignes, entetes: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
  console.log(`${lignes.length} proposition(s) envoyée(s) dans Supabase (${lignes.filter(l => l.capture_url).length} avec capture).`);
}

async function recuperer(fichier) {
  const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const ids = (lot.propositions || []).map(p => p.id);
  if (!ids.length) return console.log('Lot vide.');
  const filtre = encodeURIComponent(`(${ids.map(i => `"${i}"`).join(',')})`);
  const rows = await api(`/rest/v1/propositions?select=id,decision,note_humaine,decide_le&id=in.${filtre}`);
  const parId = Object.fromEntries(rows.map(r => [r.id, r]));
  const bilan = { accepte: 0, refuse: 0, a_valider: 0 };
  for (const p of lot.propositions) {
    const r = parId[p.id];
    if (!r) continue;
    if (!p.integre_le) { p.decision = r.decision; p.note_humaine = r.note_humaine || p.note_humaine || null; }
    bilan[p.decision] = (bilan[p.decision] || 0) + 1;
  }
  fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`Décisions rapatriées : ${bilan.accepte} acceptée(s), ${bilan.refuse} refusée(s), ${bilan.a_valider} en attente.`);
}

async function marquer(fichier) {
  const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const faites = (lot.propositions || []).filter(p => p.integre_le);
  for (const p of faites) {
    await api(`/rest/v1/propositions?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH', corps: { integre_le: p.integre_le, id_cree: p.id_cree || null }, entetes: { Prefer: 'return=minimal' },
    });
  }
  console.log(`${faites.length} proposition(s) marquée(s) comme intégrée(s) dans Supabase.`);
}

async function signalements(tous) {
  const rows = await api(`/rest/v1/signalements?select=*&order=cree_le.desc${tous ? '' : '&statut=eq.nouveau'}`);
  if (!rows.length) return console.log('Aucun signalement' + (tous ? '.' : ' nouveau.'));
  for (const s of rows) {
    console.log(`#${s.id} · ${s.cree_le.slice(0, 16).replace('T', ' ')} · ${s.statut} · réf. ${s.reference || '—'}`);
    console.log(`   ${s.message.replace(/\s+/g, ' ')}`);
    if (s.source_url) console.log(`   Source proposée : ${s.source_url}`);
    if (s.contact) console.log(`   Contact : ${s.contact}`);
  }
}

async function verifier() {
  console.log(`Projet : ${URL_SB || '(non configuré)'}`);
  await api('/rest/v1/propositions?select=id&limit=1');
  console.log('✓ table propositions accessible');
  await api('/rest/v1/signalements?select=id&limit=1');
  console.log('✓ table signalements accessible');
  const b = await api('/storage/v1/bucket/preuves');
  console.log(`✓ bucket « ${b.name} » (${b.public ? 'PUBLIC — à corriger' : 'privé'})`);
  if (!env.SUPABASE_ANON_KEY) console.log('! SUPABASE_ANON_KEY absente : le formulaire de signalement du site ne fonctionnera pas.');
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const actions = { verifier, envoyer: () => envoyer(arg), recuperer: () => recuperer(arg), marquer: () => marquer(arg), signalements: () => signalements(process.argv.includes('--tous')) };
  if (!actions[cmd] || (['envoyer', 'recuperer', 'marquer'].includes(cmd) && !arg)) {
    console.error('Usage : node outils/supabase.js verifier | envoyer <lot> | recuperer <lot> | marquer <lot> | signalements [--tous]');
    process.exit(2);
  }
  actions[cmd]().catch(e => { console.error('Erreur : ' + e.message); process.exit(1); });
}
module.exports = { configure, env };
