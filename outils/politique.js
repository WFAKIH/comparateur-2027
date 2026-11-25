// Politique de validation automatique (equipe/POLITIQUE_VALIDATION.md).
// decisionAuto(p, ctx) → { decision: 'accepte', regle: 'A1'|'A2'|'A3', motif } ou { decision: null, motif } (décision humaine).
// L'automate n'accepte que ; il ne refuse jamais (pas de retrait automatique).
'use strict';
const fs = require('fs');
const path = require('path');

let SITES = {};
try { SITES = JSON.parse(fs.readFileSync(path.join(__dirname, 'sites-officiels.json'), 'utf8')); } catch { /* absent */ }
const hote = u => { try { return new URL(String(u).replace(/^doc:/, '')).hostname.replace(/^www\./, ''); } catch { return null; } };
function surSiteOfficiel(candidat, url) {
  const liste = SITES[candidat];
  if (!Array.isArray(liste) || !url) return false;
  return liste.map(hote).includes(hote(url));
}

const TYPES_A1 = ['ajout_promesse', 'correction_promesse', 'lien_mort', 'maj_inventaire', 'ajout_sondage', 'ajout_vote', 'ajout_recoupement'];
const estClassement = p => p.type === 'correction_promesse' && p.champ === 'Nature du chiffrage' && p.valeur_proposee === 'Sans incidence budgétaire';

/** @param {object} p proposition  @param {{db:object}} ctx données du site */
function decisionAuto(p, { db }) {
  const non = motif => ({ decision: null, motif });
  if (p.integre_le) return non('déjà intégrée');
  if (p.decision !== 'a_valider') return non(`décision déjà prise (${p.decision})`);
  const verif = p.verification?.statut;
  const erreurs = p.controle_auto?.erreurs || [];
  const alertes = (p.controle_auto?.alertes || []).join(' | ');
  if (erreurs.length) return non('erreur au contrôle automatique');
  const promesse = id => db.promesses.find(x => x.ID === id);

  // A3 — reclassement « Sans incidence budgétaire »
  if (estClassement(p)) {
    const x = promesse(p.id_existant);
    if (!x) return non('promesse introuvable');
    if (typeof x['Valeur Md€'] === 'number') return non('la promesse porte un montant');
    if (verif !== 'confirme') return non(`classement non confirmé (${verif || 'absent'})`);
    return { decision: 'accepte', regle: 'A3', motif: 'sans incidence budgétaire' };
  }

  // A2 — contrôle d'une promesse existante : sourcée = validée
  if (p.type === 'controle_promesse') {
    const s = p.source_trouvee;
    if (!s || s.niveau !== 'trouvee') return non(s ? 'piste seulement' : 'source non retrouvée');
    if (verif !== 'confirme') return non('vérification non confirmée');
    if (s.type === 'page' && !['exacte', 'partielle'].includes(s.capture?.passage)) return non('passage non retrouvé sur la capture');
    const candidat = String(p.valeur_actuelle || '').split(' · ')[0];
    if (!surSiteOfficiel(candidat, s.url)) return non('source hors du site officiel du candidat');
    return { decision: 'accepte', regle: 'A2', motif: `source retrouvée : ${s.url}${s.page ? ` (page ${s.page})` : ''}` };
  }

  // A1 — proposition recommandée
  if (!TYPES_A1.includes(p.type)) return non(`type « ${p.type} » : décision humaine`);
  if (verif !== 'confirme') return non(`vérification « ${verif || 'absente'} »`);
  if (p.revue_neutralite?.statut !== 'ok') return non(`neutralité « ${p.revue_neutralite?.statut || 'absente'} »`);
  const budget = p.revue_budget?.statut;
  if (budget && budget !== 'conforme') return non(`revue budget « ${budget} »`);
  if (/doublon possible/.test(alertes)) return non('doublon possible');
  if (/personnalité absente de l'inventaire/.test(alertes)) return non('personnalité absente de l\'inventaire');
  if (p.type === 'ajout_promesse') {
    const v = p.valeur_proposee || {};
    if (!surSiteOfficiel(v['Candidat'], v['URL primaire'] || p.source_url)) return non('source hors du site officiel du candidat');
  }
  if (p.type === 'correction_promesse') {
    const x = promesse(p.id_existant);
    if (!x) return non('promesse introuvable');
    if (!surSiteOfficiel(x['Candidat'], p.source_url)) return non('source hors du site officiel du candidat');
  }
  if (p.type === 'lien_mort') {
    const x = promesse(p.id_existant);
    if (!/^https?:\/\//.test(p.valeur_proposee || '')) return non('pas d\'URL de remplacement');
    if (!x || !surSiteOfficiel(x['Candidat'], p.valeur_proposee)) return non('URL de remplacement hors du site officiel');
  }
  return { decision: 'accepte', regle: 'A1', motif: 'recommandée' };
}

module.exports = { decisionAuto, surSiteOfficiel };
