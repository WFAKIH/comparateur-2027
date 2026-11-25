// Lecture / écriture des données du site (site/data.js et site/data.json).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.resolve(__dirname, '..');
const DATA_JS = path.join(RACINE, 'site', 'data.js');
const DATA_JSON = path.join(RACINE, 'site', 'data.json');
const MAJ = path.join(RACINE, 'mises_a_jour');

function charger() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(DATA_JS, 'utf8'), ctx, { filename: DATA_JS });
  if (!ctx.window.DATA_2027) throw new Error('window.DATA_2027 absent de data.js');
  return ctx.window.DATA_2027;
}

function enregistrer(db) {
  fs.writeFileSync(DATA_JS, 'window.DATA_2027 = ' + JSON.stringify(db) + ';\n', 'utf8');
  fs.writeFileSync(DATA_JSON, JSON.stringify(db, null, 2) + '\n', 'utf8');
}

const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale

// Normalisation pour la détection de doublons.
const normaliser = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, ' ').replace(/[^a-z0-9€% ]+/g, ' ').replace(/\s+/g, ' ').trim();
const MOTS_VIDES = new Set('le la les de des du un une et en a au aux pour par sur dans d l est ou plus'.split(' '));
const mots = s => new Set(normaliser(s).split(' ').filter(m => m.length > 2 && !MOTS_VIDES.has(m)));
function similarite(a, b) {
  const A = mots(a), B = mots(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const m of A) if (B.has(m)) inter++;
  return inter / (A.size + B.size - inter); // Jaccard
}

function prochainId(db) {
  const max = Math.max(0, ...db.promesses.map(p => Number(String(p.ID).replace(/\D/g, '')) || 0));
  return 'P' + String(max + 1).padStart(4, '0');
}

module.exports = { RACINE, DATA_JS, DATA_JSON, MAJ, charger, enregistrer, aujourdhui, normaliser, similarite, prochainId };
