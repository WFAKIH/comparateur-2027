// Crée un lot de contrôle humain pour les promesses existantes dont la source n'est pas probante
// (capture en échec, lien mort, passage non retrouvé ou seulement approchant).
// Usage : node outils/controle-existant.js [--date AAAA-MM-JJ]
//   → mises_a_jour/<date>-controle/propositions.json  (puis : node outils/supabase.js envoyer <ce fichier>)
// Décision : « accepte » = promesse confirmée (Date contrôle mise à jour) ; « refuse » = promesse retirée du site.
'use strict';
const fs = require('fs');
const path = require('path');
const { charger, aujourdhui, MAJ } = require('./donnees');
const { PREUVES, lireIndex } = require('./preuves');

const a = process.argv.slice(2);
const date = a.includes('--date') ? a[a.indexOf('--date') + 1] : aujourdhui();
const db = charger(), idx = lireIndex();
const dossierLot = path.join(MAJ, `${date}-controle`);
const fichier = path.join(dossierLot, 'propositions.json');
if (fs.existsSync(fichier)) { console.error(`Le lot existe déjà : ${fichier}`); process.exit(1); }

const priorite = { echec: 0, lien_mort: 0, absent: 1, non: 2, approchante: 3 };
const lignes = [];
for (const p of db.promesses) {
  const e = (idx[p.ID] || []).at(-1);
  const statut = e ? e.statut : 'absent';
  const passage = e ? e.citation_trouvee : 'non';
  const motif = statut !== 'ok' ? statut : passage;
  if (statut === 'ok' && !['non', 'approchante'].includes(passage)) continue;
  let meta = {};
  if (e) { try { meta = JSON.parse(fs.readFileSync(path.join(PREUVES, e.dossier, 'meta.json'), 'utf8')); } catch { /* */ } }
  const libelleMotif = {
    echec: `capture impossible (${meta.erreur || 'erreur'})`, lien_mort: `lien mort (HTTP ${meta.statut_http})`, absent: 'aucune capture',
    non: meta.type === 'pdf' ? 'source PDF : passage à chercher dans le document' : 'passage introuvable dans la page',
    approchante: 'seul un passage approchant a été trouvé',
  }[motif] || motif;
  lignes.push({
    prio: priorite[motif] ?? 9,
    prop: {
      id: null, agent: 'controle-initial', type: 'controle_promesse', table: 'promesses', id_existant: p.ID, champ: null,
      valeur_actuelle: `${p['Candidat']} · « ${p['Promesse (reformulation fidèle)']} »`,
      valeur_proposee: null,
      source_url: p['URL primaire'] || null,
      citation: null,
      date_source: /^\d{4}-\d{2}-\d{2}$/.test(p['Date publication'] || '') ? p['Date publication'] : null,
      confiance: null,
      justification: `Contrôle de la base héritée : ${libelleMotif}.` + (meta.extrait_surligne ? ` Passage le plus proche : « ${meta.extrait_surligne.replace(/\s+/g, ' ').slice(0, 300)} »` : ''),
      verification: { statut: motif === 'echec' || motif === 'lien_mort' ? 'non_verifiable' : 'partiel', commentaire: libelleMotif, par: 'capturer.js' },
      preuves: e ? [{ dossier: path.join(PREUVES, e.dossier), statut, citation_trouvee: passage }] : [],
      decision: 'a_valider',
    },
  });
}
lignes.sort((x, y) => x.prio - y.prio || x.prop.id_existant.localeCompare(y.prop.id_existant));
const propositions = lignes.map((l, i) => ({ ...l.prop, id: `${date}-C${String(i + 1).padStart(3, '0')}` }));
fs.mkdirSync(dossierLot, { recursive: true });
fs.writeFileSync(fichier, JSON.stringify({ date, nature: 'controle de la base existante', propositions }, null, 2) + '\n', 'utf8');
const compte = propositions.reduce((c, p) => (c[p.verification.commentaire.split(' (')[0]] = (c[p.verification.commentaire.split(' (')[0]] || 0) + 1, c), {});
console.log(`${propositions.length} promesse(s) à contrôler → ${path.relative(process.cwd(), fichier)}`);
for (const [k, v] of Object.entries(compte)) console.log(`  ${String(v).padStart(3)} · ${k}`);
