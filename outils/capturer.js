// Capture une ou plusieurs sources et les range dans preuves/.
// Usage :
//   node outils/capturer.js --url <URL> --candidat "Nom" --cle <P0042|2026-11-25-003> [--citation "extrait exact"]
//   node outils/capturer.js --lot mises_a_jour/AAAA-MM-JJ/propositions.json   (toutes les propositions du lot)
//   node outils/capturer.js --existant [--candidat "Nom"] [--limite N] [--refaire]  (URL primaires du registre)
'use strict';
const fs = require('fs');
const { charger } = require('./donnees');
const { capturer, ouvrirNavigateur, lireIndex } = require('./preuves');

const a = process.argv.slice(2);
const opt = k => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);

async function enParallele(taches, n, f) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < taches.length) { const t = taches[i++]; await f(t); } }));
}

(async () => {
  let taches = [];
  let lot = null, fichierLot = null;
  if (opt('--url')) {
    taches = [{ url: opt('--url'), candidat: opt('--candidat'), cle: opt('--cle'), citation: opt('--citation') }];
    if (!taches[0].candidat || !taches[0].cle) { console.error('--candidat et --cle sont obligatoires'); process.exit(2); }
  } else if (opt('--lot')) {
    fichierLot = opt('--lot');
    lot = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
    const db = charger();
    for (const p of lot.propositions || []) {
      const candidat = p.valeur_proposee?.['Candidat'] || db.promesses.find(x => x.ID === p.id_existant)?.['Candidat']
        || (p.table === 'inventaire' ? p.id_existant || p.valeur_proposee?.['Personnalité'] : null) || 'transversal';
      const urls = [p.source_url];
      if (p.type === 'lien_mort' && /^https?:/.test(p.valeur_proposee || '')) urls.push(p.valeur_proposee);
      for (const url of urls) if (url) taches.push({ url, candidat, cle: p.id, citation: p.citation, propo: p });
    }
  } else if (a.includes('--existant')) {
    const db = charger(), idx = lireIndex();
    const filtre = opt('--candidat');
    taches = db.promesses
      .filter(p => !filtre || p['Candidat'] === filtre)
      .filter(p => a.includes('--refaire') || !(idx[p.ID] || []).some(e => e.url === p['URL primaire'] && e.statut !== 'echec'))
      .map(p => ({ url: p['URL primaire'], candidat: p['Candidat'], cle: p.ID, texteRecherche: p['Promesse (reformulation fidèle)'] }));
    if (opt('--limite')) taches = taches.slice(0, Number(opt('--limite')));
  } else {
    console.error('Préciser --url, --lot ou --existant'); process.exit(2);
  }

  console.log(`${taches.length} capture(s) à faire`);
  const { navigateur, contexte } = await ouvrirNavigateur();
  const bilan = { ok: 0, lien_mort: 0, echec: 0, trouvee: 0 };
  let fait = 0;
  await enParallele(taches, a.includes('--existant') ? 3 : 2, async t => {
    const r = await capturer(contexte, t);
    bilan[r.statut]++;
    if (['exacte', 'partielle'].includes(r.meta.citation_trouvee)) bilan.trouvee++;
    if (t.propo) {
      t.propo.preuves = [...(t.propo.preuves || []), { dossier: r.dossier, statut: r.statut, citation_trouvee: r.meta.citation_trouvee }];
    }
    fait++;
    console.log(`[${fait}/${taches.length}] ${r.statut.padEnd(9)} ${String(r.meta.citation_trouvee).padEnd(11)} ${t.cle} ${t.url}${r.meta.erreur ? ' — ' + r.meta.erreur : ''}`);
  });
  await navigateur.close();
  if (lot) fs.writeFileSync(fichierLot, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`\nBilan : ${bilan.ok} ok · ${bilan.lien_mort} liens morts · ${bilan.echec} échecs · passage retrouvé (exact/partiel) sur ${bilan.trouvee}`);
})().catch(e => { console.error(e); process.exit(1); });
