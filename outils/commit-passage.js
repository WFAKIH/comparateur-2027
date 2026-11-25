// Commit (et push) du travail d'un passage, décidé par le coordinateur sans intervention humaine
// (autorisation de l'utilisateur du 2026-11-25 — equipe/POLITIQUE_VALIDATION.md, section D).
// Usage : node outils/commit-passage.js AAAA-MM-JJ [--essai] [--sans-push]
// Ne commite QUE le travail du passage : mises_a_jour/ et preuves/. Tout autre fichier modifié
// (site/, outils/, equipe/, .claude/…) est laissé de côté et signalé : le site ne change que par
// outils/automatique.js ; le code et les règles restent une décision humaine.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { RACINE, MAJ } = require('./donnees');

const args = process.argv.slice(2);
const jour = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const essai = args.includes('--essai');
const git = (...a) => spawnSync('git', a, { cwd: RACINE, encoding: 'utf8' });
const AUTORISES = /^(mises_a_jour|preuves)\//;
const INTERDITS = /(^|\/)\.env(\..*)?$|(^|\/)(credentials|secrets?)\b|\.pem$|\.key$/i;

function arret(motif) { console.log(`ARRÊT : ${motif}. Rien n'est commité.`); process.exit(1); }

if (!jour) { console.error('Usage : node outils/commit-passage.js AAAA-MM-JJ [--essai] [--sans-push]'); process.exit(2); }
let e = {};
try { e = JSON.parse(fs.readFileSync(path.join(MAJ, 'etat.json'), 'utf8')); } catch { /* */ }
if (e.commit_automatique === false) { console.log('Commit automatique désactivé (etat.json : "commit_automatique": false).'); process.exit(0); }
if (git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() !== 'main') arret('la branche courante n\'est pas main');

// Fichiers modifiés ou nouveaux (chemins complets, y compris dans les dossiers non suivis)
const lignes = git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').filter(Boolean);
const fichiers = lignes.map(l => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
const retenus = fichiers.filter(f => AUTORISES.test(f) && !INTERDITS.test(f));
const ecartes = fichiers.filter(f => !retenus.includes(f));
if (fichiers.some(f => INTERDITS.test(f) && AUTORISES.test(f))) console.log('Fichier sensible écarté : ' + fichiers.filter(f => INTERDITS.test(f)).join(', '));
if (ecartes.length) console.log(`Laissés de côté (hors travail du passage, décision humaine) : ${ecartes.length}\n  ` + ecartes.slice(0, 20).join('\n  '));
if (!retenus.length) { console.log('Rien à commiter pour ce passage.'); process.exit(0); }
console.log(`${retenus.length} fichier(s) du passage à commiter.`);
if (essai) { console.log('[essai] Rien n\'est commité.'); process.exit(0); }

// Indexation limitée aux fichiers retenus (l'index peut contenir d'autres fichiers : on le vide d'abord)
git('reset', '-q');
for (let i = 0; i < retenus.length; i += 100) {
  const r = git('add', '--', ...retenus.slice(i, i + 100));
  if (r.status !== 0) arret(`git add : ${r.stderr.slice(0, 200)}`);
}
const indexes = git('diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean);
if (indexes.some(f => !AUTORISES.test(f) || INTERDITS.test(f))) { git('reset', '-q'); arret('un fichier hors mises_a_jour/ ou preuves/ serait commité'); }
if (!indexes.length) { console.log('Rien à commiter (aucune différence).'); process.exit(0); }

let resume = '';
try {
  const h = (e.historique || []).filter(x => x.date === jour).pop();
  if (h) resume = `\n\nPersonnalités : ${(h.personnalites || []).join(', ')}\nPropositions : ${h.propositions ?? '?'} · confirmées : ${h.confirmees ?? '?'} · intégrées automatiquement : ${h.integrees_auto ?? 0}`;
} catch { /* */ }
const msg = `Passage du ${jour} : rapport, lots, preuves et état (commit du coordinateur)${resume}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
const c = git('commit', '-q', '-m', msg);
if (c.status !== 0) arret(`commit impossible : ${(c.stderr || c.stdout).slice(0, 300)}`);
console.log(`Commit ${git('rev-parse', '--short', 'HEAD').stdout.trim()} : ${indexes.length} fichier(s).`);
if (args.includes('--sans-push') || e.publication_automatique === false) { console.log('Push non fait (option ou interrupteur publication_automatique).'); process.exit(0); }
const p = git('push', '-q', 'origin', 'main');
if (p.status !== 0) { console.log(`Push impossible : ${p.stderr.slice(0, 300)} (le commit local est fait).`); process.exit(1); }
console.log('Poussé sur origin/main (mises_a_jour/ et preuves/ ne partent pas vers le dépôt public).');
