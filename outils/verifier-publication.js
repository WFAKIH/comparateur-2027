// Vérifie qu'une publication est bien arrivée en ligne, et publie en secours si besoin.
// Usage : node outils/verifier-publication.js [--edition AAAA-MM-JJ] [--attente 600] [--sans-secours]
// Étapes :
//   1. export public : le dépôt public (WFAKIH/comparateur-2027) a reçu un commit après le push ;
//   2. site en ligne : SITE_URL (.env) sert un data.js dont meta.edition = l'édition attendue ;
//   3. secours : si le site en ligne n'est pas à jour à la fin de l'attente, publication directe
//      par Netlify CLI (node outils/publier.js), si NETLIFY_AUTH_TOKEN et NETLIFY_SITE_ID sont valides.
// Code de sortie 0 = en ligne et à jour ; 1 = non vérifié ou en échec (le motif est affiché).
'use strict';
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { RACINE, charger } = require('./donnees');
const { env } = require('./supabase');

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const edition = opt('--edition') || charger().meta.edition;
const attenteMs = Number(opt('--attente') || 600) * 1000;
const DEPOT_PUBLIC = env.DEPOT_PUBLIC || 'WFAKIH/comparateur-2027';
const SITE_URL = (env.SITE_URL || '').replace(/\/$/, '');
const dormir = ms => new Promise(ok => setTimeout(ok, ms));
const UA = { 'User-Agent': 'comparateur-2027-verification' };

async function editionEnLigne() {
  const r = await fetch(`${SITE_URL}/data.js?v=${Date.now()}`, { headers: { ...UA, 'Cache-Control': 'no-cache' } });
  if (!r.ok) return { erreur: `HTTP ${r.status}` };
  const ctx = { window: {} };
  try { vm.runInNewContext(await r.text(), ctx); } catch (e) { return { erreur: 'data.js illisible' }; }
  return { edition: ctx.window.DATA_2027?.meta?.edition, promesses: ctx.window.DATA_2027?.promesses?.length };
}

async function netlifyValide() {
  if (!env.NETLIFY_AUTH_TOKEN || !env.NETLIFY_SITE_ID) return false;
  const r = await fetch(`https://api.netlify.com/api/v1/sites/${env.NETLIFY_SITE_ID}`, { headers: { Authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}` } }).catch(() => null);
  return Boolean(r && r.ok);
}

async function main() {
  const debut = Date.now();
  const depuis = new Date(debut - 10 * 60 * 1000).toISOString();
  // 1. Export public
  let exporte = false;
  while (Date.now() - debut < Math.min(attenteMs, 5 * 60 * 1000)) {
    const r = await fetch(`https://api.github.com/repos/${DEPOT_PUBLIC}/commits?per_page=1&since=${depuis}`, { headers: UA }).catch(() => null);
    if (r && r.ok && (await r.json()).length) { exporte = true; break; }
    await dormir(20000);
  }
  console.log(exporte ? `Export public : reçu sur ${DEPOT_PUBLIC}.` : `Export public : aucun commit récent sur ${DEPOT_PUBLIC} (Action GitHub en échec ou en retard ?).`);

  // 2. Site en ligne
  if (!SITE_URL) {
    console.log('SITE_URL absent de .env : impossible de vérifier le site en ligne (ajouter SITE_URL=https://… dans .env).');
    process.exit(exporte ? 0 : 1);
  }
  let etat = null;
  while (Date.now() - debut < attenteMs) {
    etat = await editionEnLigne().catch(e => ({ erreur: e.message }));
    if (etat.edition === edition) {
      console.log(`Site en ligne à jour : ${SITE_URL} (édition ${etat.edition}, ${etat.promesses} promesses).`);
      return;
    }
    await dormir(30000);
  }
  console.log(`Site en ligne PAS à jour après ${Math.round(attenteMs / 60000)} min : ${etat?.erreur || `édition ${etat?.edition} au lieu de ${edition}`}.`);

  // 3. Secours : publication directe
  if (args.includes('--sans-secours')) process.exit(1);
  if (!(await netlifyValide())) {
    console.log('Secours impossible : jeton Netlify absent ou refusé (renouveler NETLIFY_AUTH_TOKEN dans .env).');
    process.exit(1);
  }
  console.log('Secours : publication directe par Netlify CLI…');
  const p = spawnSync(process.execPath, [path.join('outils', 'publier.js')], { cwd: RACINE, encoding: 'utf8' });
  if (p.status !== 0) { console.log(`Secours en échec : ${(p.stderr || p.stdout).slice(-300)}`); process.exit(1); }
  await dormir(20000);
  etat = await editionEnLigne().catch(e => ({ erreur: e.message }));
  console.log(etat.edition === edition ? `Site en ligne à jour après secours (édition ${edition}).` : `Toujours pas à jour après secours : ${etat.erreur || etat.edition}.`);
  process.exit(etat.edition === edition ? 0 : 1);
}

main().catch(e => { console.error('Erreur : ' + e.message); process.exit(1); });
