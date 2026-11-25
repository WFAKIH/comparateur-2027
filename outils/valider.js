// Contrôle automatique d'un fichier de propositions (schéma, cohérence, doublons).
// Usage : node outils/valider.js mises_a_jour/AAAA-MM-JJ/propositions.json [--ecrire]
//   --ecrire : inscrit le résultat dans le champ "controle_auto" de chaque proposition.
// Code de sortie 1 si au moins une proposition comporte une erreur bloquante.
'use strict';
const fs = require('fs');
const { charger, similarite } = require('./donnees');
let officiels = {};
try { officiels = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'sites-officiels.json'), 'utf8')); } catch { /* liste absente */ }
const hote = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
// Vrai si l'URL est sur un site officiel du candidat (null si le candidat n'a pas de site listé).
function surSiteOfficiel(candidat, url) {
  const sites = officiels[candidat];
  if (!Array.isArray(sites) || !sites.length) return null;
  return sites.map(s => hote(s.replace(/^doc:/, ''))).includes(hote(url));
}

const TYPES = ['ajout_promesse', 'correction_promesse', 'lien_mort', 'maj_inventaire', 'ajout_sondage', 'ajout_vote', 'ajout_recoupement', 'controle_promesse', 'autre'];
const TABLES_PAR_TYPE = {
  ajout_promesse: ['promesses'], correction_promesse: ['promesses'], controle_promesse: ['promesses'], lien_mort: ['promesses', 'sources'],
  maj_inventaire: ['inventaire'], ajout_sondage: ['sondages'], ajout_vote: ['votes_fr', 'votes_ue'],
  ajout_recoupement: ['recoupements', 'recoupements_plus'],
};
const CLE_ID = { promesses: 'ID', inventaire: 'Personnalité', sources: 'URL complète' };
const reDate = /^\d{4}-\d{2}-\d{2}$/;
const reUrl = /^https?:\/\/[^\s]+$/;

const estClassement = p => p.type === 'correction_promesse' && p.champ === 'Nature du chiffrage' && p.valeur_proposee === 'Sans incidence budgétaire';

function valider(prop, db, toutes) {
  const err = [], alerte = [];
  const champsTable = t => Object.keys((db[t] || [])[0] || {});
  if (!prop.id) err.push('id manquant');
  if (!TYPES.includes(prop.type)) err.push(`type inconnu : ${prop.type}`);
  if (TABLES_PAR_TYPE[prop.type] && !TABLES_PAR_TYPE[prop.type].includes(prop.table)) err.push(`table « ${prop.table} » incompatible avec ${prop.type}`);
  // Contrôle d'une promesse existante : c'est la décision humaine qui tranche ; pas de citation exigée.
  // Reclassement « Sans incidence budgétaire » (règle de chiffrage) : classement, pas un fait sourcé ; pas de citation exigée.
  const controle = prop.type === 'controle_promesse' || estClassement(prop);
  if (controle && !prop.id_existant) err.push('contrôle sans id_existant');
  if (!controle && !reUrl.test(prop.source_url || '')) err.push('source_url absente ou invalide');
  if (!controle && !String(prop.citation || '').trim()) err.push('citation absente');
  else if (String(prop.citation).split(/\s+/).length > 40) alerte.push('citation longue (> 40 mots)');
  if (prop.date_source && !reDate.test(prop.date_source)) err.push('date_source au mauvais format');
  if (!['haute', 'moyenne', 'faible'].includes(prop.confiance)) alerte.push('confiance non renseignée');
  const v = prop.verification || {};
  if (!controle && v.statut !== 'confirme') alerte.push(`vérification indépendante : ${v.statut || 'absente'}`);
  const n = prop.revue_neutralite || {};
  if (n.statut === 'a_reformuler') alerte.push('revue de neutralité : reformulation demandée');

  // Existence de l'élément visé
  if (prop.id_existant && CLE_ID[prop.table]) {
    const existe = (db[prop.table] || []).some(x => x[CLE_ID[prop.table]] === prop.id_existant);
    if (!existe) err.push(`id_existant introuvable dans ${prop.table} : ${prop.id_existant}`);
  }
  if (['correction_promesse', 'maj_inventaire'].includes(prop.type) && prop.id_existant) {
    if (!prop.champ) err.push('champ à corriger non précisé');
    else if (!champsTable(prop.table).includes(prop.champ)) alerte.push(`champ nouveau ou mal orthographié : « ${prop.champ} »`);
  }
  if (prop.type === 'correction_promesse' && !prop.id_existant) err.push('correction sans id_existant');

  if (prop.type === 'ajout_promesse') {
    const p = prop.valeur_proposee || {};
    for (const c of ['Candidat', 'Thème', 'Promesse (reformulation fidèle)', 'Statut documentaire', 'URL primaire']) if (!p[c]) err.push(`ajout : champ « ${c} » manquant`);
    const themes = new Set(db.promesses.map(x => x['Thème']));
    if (p['Thème'] && !themes.has(p['Thème'])) alerte.push(`thème nouveau : « ${p['Thème']} » (thèmes existants à privilégier)`);
    const connu = db.inventaire.some(i => i['Personnalité'] === p['Candidat']) || db.promesses.some(x => x['Candidat'] === p['Candidat']);
    if (p['Candidat'] && !connu) alerte.push(`personnalité absente de l'inventaire : ${p['Candidat']}`);
    if (typeof p['Valeur Md€'] === 'number' && (!p['Période / unité'] || p['Période / unité'] === 'ND')) err.push('montant chiffré sans période / unité');
    if (p['Valeur Md€'] !== undefined && p['Valeur Md€'] !== null && typeof p['Valeur Md€'] !== 'number') err.push('« Valeur Md€ » doit être un nombre ou absent');
    // Règle : seules les propositions qui entrent dans le calcul du budget sont chiffrées.
    if (p['Nature du chiffrage'] === 'Sans incidence budgétaire' && typeof p['Valeur Md€'] === 'number') err.push('« Sans incidence budgétaire » avec un montant : retirer le montant ou corriger la nature du chiffrage');
    if (!p['Nature du chiffrage']) alerte.push('« Nature du chiffrage » vide : « Sans incidence budgétaire » si la proposition n\'entre pas dans le budget, sinon chiffrage du site officiel ou « Non chiffré »');
    if (p['URL primaire'] && surSiteOfficiel(p['Candidat'], p['URL primaire']) === false) alerte.push('source hors du site officiel du candidat (outils/sites-officiels.json) : le justifier');
    const texte = p['Promesse (reformulation fidèle)'];
    const proches = db.promesses.filter(x => x['Candidat'] === p['Candidat'])
      .map(x => [x.ID, similarite(x['Promesse (reformulation fidèle)'], texte)]).filter(([, s]) => s >= 0.5)
      .sort((a, b) => b[1] - a[1]);
    if (proches.length) alerte.push(`doublon possible avec ${proches.slice(0, 3).map(([id, s]) => `${id} (${Math.round(s * 100)} %)`).join(', ')}`);
    const internes = toutes.filter(o => o !== prop && o.type === 'ajout_promesse' && o.valeur_proposee?.['Candidat'] === p['Candidat']
      && similarite(o.valeur_proposee?.['Promesse (reformulation fidèle)'], texte) >= 0.6);
    if (internes.length) alerte.push(`doublon dans le lot : ${internes.map(o => o.id).join(', ')}`);
  }
  if (['ajout_sondage', 'ajout_vote', 'ajout_recoupement'].includes(prop.type)) {
    const lignes = [].concat(prop.valeur_proposee || []);
    if (!lignes.length) err.push('aucune ligne proposée');
    const attendus = champsTable(prop.table);
    lignes.forEach((l, i) => { const manq = attendus.filter(c => !(c in l)); if (manq.length) alerte.push(`ligne ${i + 1} : champs absents ${manq.join(', ')}`); });
  }
  return { ok: err.length === 0, erreurs: err, alertes: alerte };
}

if (require.main === module) {
  const fichier = process.argv[2];
  if (!fichier) { console.error('Usage : node outils/valider.js <propositions.json> [--ecrire]'); process.exit(2); }
  const lot = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const db = charger();
  let bloquants = 0;
  for (const p of lot.propositions || []) {
    const r = valider(p, db, lot.propositions);
    if (!r.ok) bloquants++;
    if (process.argv.includes('--ecrire')) p.controle_auto = r;
    const etat = r.ok ? (r.alertes.length ? 'ALERTE' : 'OK') : 'ERREUR';
    console.log(`[${etat}] ${p.id} · ${p.type} · ${p.valeur_proposee?.['Candidat'] || p.id_existant || ''}`);
    for (const e of r.erreurs) console.log('   ✗ ' + e);
    for (const a of r.alertes) console.log('   ! ' + a);
  }
  if (process.argv.includes('--ecrire')) fs.writeFileSync(fichier, JSON.stringify(lot, null, 2) + '\n', 'utf8');
  console.log(`\n${(lot.propositions || []).length} propositions · ${bloquants} avec erreur bloquante`);
  process.exit(bloquants ? 1 : 0);
}
module.exports = { valider, TYPES };
