// Retrouve la source et les captures d'une information.
// Usage : node outils/source.js <P0042 | 2026-11-25-003 | mots-clés> [--candidat "Nom"] [--json]
'use strict';
const fs = require('fs');
const path = require('path');
const { charger, normaliser } = require('./donnees');
const { PREUVES, lireIndex } = require('./preuves');

const a = process.argv.slice(2);
const opt = k => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const sansOptions = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1] === '--candidat'));
const requete = sansOptions.join(' ').trim();
if (!requete) { console.error('Usage : node outils/source.js <ID ou mots-clés> [--candidat "Nom"] [--json]'); process.exit(2); }

const db = charger(), idx = lireIndex();
let promesses;
if (/^P\d{3,}$/i.test(requete)) promesses = db.promesses.filter(p => p.ID.toUpperCase() === requete.toUpperCase());
else if (idx[requete]) promesses = [{ ID: requete, 'Promesse (reformulation fidèle)': '(proposition en attente de validation)', Candidat: '' }];
else {
  const mots = normaliser(requete).split(' ').filter(m => m.length > 2);
  promesses = db.promesses
    .filter(p => !opt('--candidat') || p['Candidat'] === opt('--candidat'))
    .map(p => { const t = normaliser([p['Promesse (reformulation fidèle)'], p['Candidat'], p['Thème']].join(' ')); return [p, mots.filter(m => t.includes(m)).length]; })
    .filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([p]) => p);
}

const resultats = promesses.map(p => ({
  id: p.ID, candidat: p['Candidat'], theme: p['Thème'], promesse: p['Promesse (reformulation fidèle)'],
  statut_documentaire: p['Statut documentaire'], date_publication: p['Date publication'], url_primaire: p['URL primaire'],
  preuves: (idx[p.ID] || []).slice().reverse().map(e => {
    const d = path.join(PREUVES, e.dossier);
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')); } catch { /* */ }
    const f = n => (fs.existsSync(path.join(d, n)) ? path.join(d, n) : null);
    return { date: e.date, url: e.url, statut: e.statut, citation_trouvee: e.citation_trouvee, titre: meta.titre,
      extrait_surligne: meta.extrait_surligne, erreur: meta.erreur,
      capture: f('capture.png'), page_complete: f('page-complete.jpg'), pdf: meta.document && fs.existsSync(path.join(PREUVES, meta.document)) ? path.join(PREUVES, meta.document) : f('document.pdf'), texte: f('texte.txt') };
  }),
}));

if (a.includes('--json')) { console.log(JSON.stringify(resultats, null, 2)); process.exit(0); }
if (!resultats.length) { console.log('Aucune information trouvée.'); process.exit(1); }
for (const r of resultats) {
  console.log(`\n${r.id} · ${r.candidat} · ${r.theme || ''}\n  « ${r.promesse} »`);
  console.log(`  Statut : ${r.statut_documentaire || 'ND'} · publié le ${r.date_publication || 'ND'}\n  Source : ${r.url_primaire || 'ND'}`);
  if (!r.preuves.length) console.log('  Aucune capture archivée (lancer : node outils/capturer.js --existant --candidat "…")');
  for (const p of r.preuves) {
    console.log(`  — Capture du ${p.date} · ${p.statut} · passage ${p.citation_trouvee}${p.erreur ? ' · ' + p.erreur : ''}`);
    if (p.extrait_surligne) console.log(`    Passage surligné : « ${p.extrait_surligne.replace(/\s+/g, ' ').slice(0, 220)} »`);
    for (const k of ['capture', 'page_complete', 'pdf', 'texte']) if (p[k]) console.log(`    ${k.padEnd(13)} ${p[k]}`);
  }
}
