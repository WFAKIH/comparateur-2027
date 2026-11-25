// Affiche la couverture du registre : promesses par personnalité, thèmes vides, liens, dates de contrôle.
// Usage : node outils/couverture.js [--json] [--candidat "Nom"]
'use strict';
const { charger } = require('./donnees');
const db = charger();
const args = process.argv.slice(2);
const filtre = args.includes('--candidat') ? args[args.indexOf('--candidat') + 1] : null;

const themes = [...new Set(db.promesses.map(p => p['Thème']))].sort((a, b) => a.localeCompare(b, 'fr'));
const candidats = [...new Set(db.promesses.map(p => p['Candidat']))].filter(c => !filtre || c === filtre);
const rapport = candidats.map(c => {
  const ps = db.promesses.filter(p => p['Candidat'] === c);
  const parTheme = Object.fromEntries(themes.map(t => [t, ps.filter(p => p['Thème'] === t).length]));
  const controles = ps.map(p => p['Date contrôle']).filter(Boolean).sort();
  return {
    candidat: c,
    promesses: ps.length,
    chiffrees: ps.filter(p => typeof p['Valeur Md€'] === 'number').length,
    sans_url: ps.filter(p => !/^https?:\/\//.test(p['URL primaire'] || '')).length,
    themes_vides: themes.filter(t => !parTheme[t]),
    controle_le_plus_ancien: controles[0] || null,
    inventaire: db.inventaire.find(i => i['Personnalité'] === c) || null,
  };
}).sort((a, b) => a.promesses - b.promesses);

if (args.includes('--json')) { console.log(JSON.stringify({ themes, rapport }, null, 2)); process.exit(0); }
console.log(`Édition ${db.meta.edition} · ${db.promesses.length} promesses · ${themes.length} thèmes · ${db.inventaire.length} personnalités en inventaire\n`);
for (const r of rapport) {
  console.log(`${r.candidat.padEnd(24)} ${String(r.promesses).padStart(3)} promesses · ${r.chiffrees} chiffrées · ${r.sans_url} sans URL · contrôle le plus ancien ${r.controle_le_plus_ancien || 'ND'}`);
  if (filtre) console.log('  Thèmes vides : ' + r.themes_vides.join(', '));
}
const horsRegistre = db.inventaire.filter(i => !candidats.includes(i['Personnalité'])).map(i => i['Personnalité']);
if (!filtre) console.log(`\nPersonnalités de l'inventaire sans aucune promesse (${horsRegistre.length}) : ${horsRegistre.join(', ')}`);
