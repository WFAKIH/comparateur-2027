// Exporte la partie publique du projet vers le dépôt public (dossier voisin « comparateur-2027-public »).
// Seuls les chemins de la LISTE_BLANCHE sont copiés : jamais preuves/, mises_a_jour/, .env, node_modules/.
// Usage : node outils/exporter-public.js [--commit] [--push]
//   --commit : committe l'export dans le dépôt public (message = commit privé d'origine)
//   --push   : pousse ensuite vers le dépôt GitHub public (remote « origin »)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RACINE } = require('./donnees');

const PUBLIC = path.resolve(RACINE, '..', 'comparateur-2027-public');
const LISTE_BLANCHE = [
  'site', 'outils', 'equipe', '.claude/agents', 'supabase',
  'netlify.toml', 'package.json', 'package-lock.json', 'README.txt', 'CLAUDE.md', '.env.exemple',
];
const INTERDITS = [/(^|\/)\.env$/, /^preuves\//, /^mises_a_jour\//, /node_modules/, /service_role/i];
const GITIGNORE_PUBLIC = 'node_modules/\n.env\npreuves/\nmises_a_jour/\n*.tmp\n';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function copier(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) copier(path.join(src, n), path.join(dst, n));
  } else if (/\.(md|js|json|txt|toml|sql|exemple)$/.test(src)) {
    // Les chemins locaux (qui contiennent le nom du compte Windows) sont remplacés par <PROJET>.
    // Valable aussi hors du PC (GitHub Actions) : tout chemin Windows « <PROJET> » est masqué.
    const t = fs.readFileSync(src, 'utf8')
      .split(RACINE).join('<PROJET>').split(RACINE.split(path.sep).join('/')).join('<PROJET>')
      .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+[\\/]+(?:[^\\/\s"'`]+[\\/]+)*?comparateur-2027(?![\w-])/g, '<PROJET>')
      .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+[\\/]+AppData[^\s"'`]*/g, '<DOSSIER_LOCAL>');
    fs.writeFileSync(dst, t, 'utf8');
  } else fs.copyFileSync(src, dst);
}

// Contrôle de sécurité : aucune clé secrète dans les fichiers exportés.
function verifierSecrets(dossier) {
  const alertes = [];
  const parcourir = d => {
    for (const n of fs.readdirSync(d)) {
      if (n === '.git') continue;
      const f = path.join(d, n), rel = path.relative(PUBLIC, f).replace(/\\/g, '/');
      if (fs.statSync(f).isDirectory()) { parcourir(f); continue; }
      if (INTERDITS.some(re => re.test(rel))) alertes.push(`chemin interdit : ${rel}`);
      if (/\.(js|json|md|txt|toml|html|sql|exemple)$/.test(n) || n.startsWith('_')) {
        const t = fs.readFileSync(f, 'utf8');
        if (/eyJhbGciOi[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/.test(t) && !rel.startsWith('site/config.js')) alertes.push(`jeton JWT dans ${rel}`);
        if (/nfp_[A-Za-z0-9]{20,}/.test(t)) alertes.push(`jeton Netlify dans ${rel}`);
        if (/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(t)) alertes.push(`jeton GitHub dans ${rel}`);
        if (/[A-Za-z]:[\\/]+Users[\\/]+(?!<)/.test(t)) alertes.push(`chemin local (nom de compte) dans ${rel}`);
      }
    }
  };
  parcourir(dossier);
  return alertes;
}

if (require.main === module) {
  fs.mkdirSync(PUBLIC, { recursive: true });
  if (!fs.existsSync(path.join(PUBLIC, '.git'))) git(PUBLIC, 'init', '-q', '-b', 'main');
  // Vide le dépôt public (sauf .git) puis recopie la liste blanche : les fichiers supprimés côté privé disparaissent aussi.
  for (const n of fs.readdirSync(PUBLIC)) if (n !== '.git') fs.rmSync(path.join(PUBLIC, n), { recursive: true, force: true });
  for (const p of LISTE_BLANCHE) {
    const src = path.join(RACINE, p);
    if (fs.existsSync(src)) copier(src, path.join(PUBLIC, p));
  }
  fs.writeFileSync(path.join(PUBLIC, '.gitignore'), GITIGNORE_PUBLIC, 'utf8');
  const alertes = verifierSecrets(PUBLIC);
  if (alertes.length) {
    console.error('EXPORT BLOQUÉ :\n  ' + alertes.join('\n  '));
    process.exit(1);
  }
  console.log(`Export public prêt dans ${PUBLIC}`);
  if (process.argv.includes('--commit')) {
    git(PUBLIC, 'add', '-A');
    const changements = git(PUBLIC, 'status', '--porcelain');
    if (!changements) { console.log('Aucun changement à committer.'); }
    else {
      let origine = '';
      try { origine = git(RACINE, 'log', '-1', '--format=%s'); } catch { /* pas encore de commit privé */ }
      git(PUBLIC, 'commit', '-q', '-m', origine || 'Mise à jour du comparateur');
      console.log('Commit public : ' + git(PUBLIC, 'log', '-1', '--format=%h %s'));
    }
    if (process.argv.includes('--push')) {
      execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: PUBLIC, stdio: 'inherit' });
    }
  }
}
