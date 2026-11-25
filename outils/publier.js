// Génère site/config.js à partir de .env puis publie le dossier site/ sur Netlify.
// Usage : node outils/publier.js [--brouillon]   (--brouillon : URL de prévisualisation, sans toucher au site en ligne)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { RACINE } = require('./donnees');
const { env } = require('./supabase');

function ecrireConfig() {
  const config = {
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    // Clé « anon » : publique par conception, elle ne permet que de déposer un signalement (RLS).
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    // Dates des tours de scrutin (AAAA-MM-JJ) : la section sondages est masquée la veille et le jour même.
    tours: (env.DATES_SCRUTIN || '').split(',').map(s => s.trim()).filter(Boolean),
  };
  fs.writeFileSync(path.join(RACINE, 'site', 'config.js'),
    '// Fichier généré par outils/publier.js — ne pas modifier à la main.\nwindow.CONFIG_2027 = ' + JSON.stringify(config, null, 2) + ';\n', 'utf8');
  return config;
}

if (require.main === module) {
  const config = ecrireConfig();
  console.log(`config.js généré (signalements : ${config.supabaseAnonKey ? 'actifs' : 'inactifs'}, tours : ${config.tours.join(', ') || 'non renseignés'})`);
  if (!env.NETLIFY_AUTH_TOKEN || !env.NETLIFY_SITE_ID) {
    console.error('NETLIFY_AUTH_TOKEN ou NETLIFY_SITE_ID manquant dans .env : publication impossible.');
    process.exit(1);
  }
  const args = ['--yes', 'netlify-cli', 'deploy', '--dir', 'site', '--site', env.NETLIFY_SITE_ID, '--message', `publication-${new Date().toISOString().slice(0, 16).replace(':', 'h')}`];
  if (!process.argv.includes('--brouillon')) args.push('--prod');
  const r = spawnSync('npx', args, { cwd: RACINE, stdio: 'inherit', shell: true, env: { ...process.env, NETLIFY_AUTH_TOKEN: env.NETLIFY_AUTH_TOKEN } });
  process.exit(r.status ?? 1);
}
module.exports = { ecrireConfig };
