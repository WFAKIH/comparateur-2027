// Intègre dans site/data.js et site/data.json les propositions marquées "decision": "accepte".
// Usage : node outils/integrer.js mises_a_jour/AAAA-MM-JJ/propositions.json [--essai] [--forcer]
//   --essai  : affiche ce qui serait fait sans rien écrire.
//   --forcer : accepte aussi les propositions dont la vérification indépendante n'est pas « confirme ».
// Les propositions avec erreur de contrôle automatique ne sont jamais intégrées.
'use strict';
const fs = require('fs');
const { charger, enregistrer, aujourdhui, prochainId } = require('./donnees');
const { valider } = require('./valider');
const { rattacher } = require('./preuves');
const aRattacher = []; // [cléProposition, ID définitif, candidat]

const fichier = process.argv[2];
if (!fichier) { console.error('Usage : node outils/integrer.js <propositions.json> [--essai] [--forcer]'); process.exit(2); }
const essai = process.argv.includes('--essai'), forcer = process.argv.includes('--forcer');
const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
const db = charger();
const jour = aujourdhui();
const journal = [];

for (const p of lot.propositions || []) {
  if (p.integre_le) continue;
  // Contrôle d'une promesse existante : « accepte » = confirmée, « refuse » = retirée du site (conservée dans promesses_retirees).
  if (p.type === 'controle_promesse' && ['accepte', 'refuse'].includes(p.decision)) {
    const i = db.promesses.findIndex(y => y.ID === p.id_existant);
    if (i < 0) { journal.push(`IGNORÉE ${p.id} : ${p.id_existant} introuvable`); continue; }
    if (p.decision === 'accepte') {
      db.promesses[i]['Date contrôle'] = jour;
      journal.push(`CONFIRMÉE ${p.id_existant} · ${db.promesses[i]['Candidat']}`);
      // Source probante trouvée ailleurs (outils/chercher-sources.js) : elle devient l'URL primaire.
      const s = p.source_trouvee;
      // Pour un PDF, le lien ouvre directement la bonne page (#page=N).
      const url = s?.type === 'pdf' && s.page ? `${s.url}#page=${s.page}` : s?.url;
      if (s?.niveau === 'trouvee' && /^https?:\/\//.test(s.url || '') && s.url !== db.promesses[i]['URL primaire'].split('#')[0]) {
        journal.push(`LIEN ${p.id_existant} : ${db.promesses[i]['URL primaire']} → ${url}`);
        db.promesses[i]['URL primaire'] = url;
      }
    } else {
      const [x] = db.promesses.splice(i, 1);
      (db.promesses_retirees = db.promesses_retirees || []).push({ ...x, 'Retirée le': jour, 'Motif du retrait': p.note_humaine || 'Source introuvable ou non probante au contrôle' });
      journal.push(`RETIRÉE ${x.ID} · ${x['Candidat']} · ${x['Promesse (reformulation fidèle)']}`);
    }
    p.integre_le = jour;
    continue;
  }
  if (p.decision !== 'accepte') continue;
  const r = valider(p, db, lot.propositions);
  if (!r.ok) { journal.push(`IGNORÉE ${p.id} : ${r.erreurs.join(' ; ')}`); continue; }
  if (!forcer && p.verification?.statut !== 'confirme') { journal.push(`IGNORÉE ${p.id} : vérification « ${p.verification?.statut || 'absente'} » (utiliser --forcer)`); continue; }
  const val = p.revue_neutralite?.statut === 'a_reformuler' && p.revue_neutralite.reformulation && p.type === 'ajout_promesse'
    ? { ...p.valeur_proposee, 'Promesse (reformulation fidèle)': p.revue_neutralite.reformulation } : p.valeur_proposee;
  switch (p.type) {
    case 'ajout_promesse': {
      const id = prochainId(db);
      const modele = Object.fromEntries(Object.keys(db.promesses[0]).map(k => [k, '']));
      const ligne = { ...modele, ...val, ID: id, 'Date contrôle': jour };
      if (ligne['Valeur Md€'] === '' || ligne['Valeur Md€'] === null) delete ligne['Valeur Md€'];
      if (!ligne['Parti']) ligne['Parti'] = db.promesses.find(x => x['Candidat'] === ligne['Candidat'])?.['Parti'] || '';
      db.promesses.push(ligne);
      journal.push(`AJOUT ${id} · ${ligne['Candidat']} · ${ligne['Promesse (reformulation fidèle)']}`);
      p.id_cree = id; aRattacher.push([p.id, id, ligne['Candidat']]); break;
    }
    case 'correction_promesse': {
      const x = db.promesses.find(y => y.ID === p.id_existant);
      journal.push(`CORRECTION ${x.ID} · ${p.champ} : « ${x[p.champ] ?? ''} » → « ${val} »`);
      x[p.champ] = val; x['Date contrôle'] = jour; aRattacher.push([p.id, x.ID, x['Candidat']]); break;
    }
    case 'lien_mort': {
      const cle = p.table === 'sources' ? 'URL complète' : 'URL primaire';
      const x = p.table === 'sources' ? db.sources.find(y => y['URL complète'] === p.id_existant) : db.promesses.find(y => y.ID === p.id_existant);
      if (!x || !/^https?:\/\//.test(val || '')) { journal.push(`IGNORÉE ${p.id} : pas d'URL de remplacement`); continue; }
      journal.push(`LIEN ${p.id_existant} : ${x[cle]} → ${val}`);
      x[cle] = val; if (p.table === 'promesses') { x['Date contrôle'] = jour; aRattacher.push([p.id, x.ID, x['Candidat']]); } break;
    }
    case 'maj_inventaire': {
      if (p.id_existant) {
        const x = db.inventaire.find(y => y['Personnalité'] === p.id_existant);
        journal.push(`INVENTAIRE ${p.id_existant} · ${p.champ} : « ${x[p.champ] ?? ''} » → « ${val} »`);
        x[p.champ] = val; x['Date de situation'] = p.date_source || jour;
        if (p.source_url) x['Source datée / URL'] = p.source_url;
      } else { db.inventaire.push(val); journal.push(`INVENTAIRE ajout · ${val['Personnalité']}`); }
      break;
    }
    case 'ajout_sondage': case 'ajout_vote': case 'ajout_recoupement': {
      const lignes = [].concat(val);
      db[p.table].push(...lignes);
      journal.push(`AJOUT ${lignes.length} ligne(s) dans ${p.table}`); break;
    }
    default: journal.push(`IGNORÉE ${p.id} : type « ${p.type} » à traiter à la main`); continue;
  }
  p.integre_le = jour;
}

const integrees = (lot.propositions || []).filter(p => p.integre_le === jour).length;
console.log(journal.join('\n') || 'Aucune proposition acceptée à intégrer.');
if (essai) { console.log(`\n[essai] ${integrees} proposition(s) seraient intégrées. Rien n'a été écrit.`); process.exit(0); }
if (integrees) {
  db.meta.edition = jour;
  enregistrer(db);
  let nbPreuves = 0;
  for (const [cle, id, candidat] of aRattacher) nbPreuves += rattacher(cle, id, candidat);
  if (nbPreuves) console.log(`${nbPreuves} capture(s) de source rattachée(s) aux promesses dans preuves/.`);
  fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`\n${integrees} proposition(s) intégrée(s). Édition des données : ${jour}.`);
}
