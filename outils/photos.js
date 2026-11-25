// Photos des personnalités depuis Wikimedia Commons (licences libres uniquement).
// Usage : node outils/photos.js --chercher            → mises_a_jour/_photos-candidates.json (à relire)
//         node outils/photos.js --telecharger         → site/photos/<slug>.jpg + site/photos/photos.js
// Méthode : article Wikipédia (fr) au nom exact → élément Wikidata → image P18 (hébergée sur Commons)
// → licence et auteur lus dans les métadonnées Commons. Refus si la licence n'est pas libre
// (CC0, domaine public, CC BY, CC BY-SA) ou si l'élément n'est pas un être humain.
'use strict';
const fs = require('fs');
const path = require('path');
const { RACINE, MAJ, charger } = require('./donnees');

const UA = { 'User-Agent': 'comparateur-2027-photos/1.0 (outil documentaire)' };
const LISTE = path.join(MAJ, '_photos-candidates.json');
const DOSSIER = path.join(RACINE, 'site', 'photos');
const dormir = ms => new Promise(ok => setTimeout(ok, ms));
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const texte = html => String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
const LIBRE = /^(cc0|public domain|domaine public|pd|fal|licence art libre|cc[ -]by(-sa)?[ -]?\d(\.\d)?( [a-z]{2})?|cc by(-sa)? \d\.\d)/i;

async function json(url) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r.json();
    await dormir(5000 * (i + 1)); // limitation de débit Wikimedia : on ralentit
  }
  throw new Error(`HTTP en échec : ${url}`);
}

async function chercher() {
  const db = charger();
  const res = [];
  const avant = fs.existsSync(LISTE) && process.argv.includes("--reprendre") ? JSON.parse(fs.readFileSync(LISTE, "utf8")) : [];
  for (const i of db.inventaire) {
    const deja = avant.find(x => x.nom === i["Personnalité"] && !/^erreur/.test(x.statut));
    if (deja) { res.push(deja); continue; }
    const nom = i['Personnalité'];
    const e = { nom, statut: 'non trouvé' };
    try {
      const w = await json(`https://fr.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops|description&titles=${encodeURIComponent(nom)}`);
      const page = Object.values(w.query.pages)[0];
      const qid = page?.pageprops?.wikibase_item;
      if (!qid || page.missing !== undefined || page.pageprops.disambiguation !== undefined) { e.statut = page?.pageprops?.disambiguation !== undefined ? 'homonymie' : 'pas d’article'; res.push(e); continue; }
      e.article = page.title; e.description = page.description || ''; e.wikidata = qid;
      const wd = await json(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${qid}`);
      const humain = (wd.claims.P31 || []).some(c => c.mainsnak.datavalue?.value?.id === 'Q5');
      const p18 = wd.claims.P18?.[0]?.mainsnak?.datavalue?.value;
      if (!humain) { e.statut = 'pas un être humain'; res.push(e); continue; }
      if (!p18) { e.statut = 'pas de photo'; res.push(e); continue; }
      const c = await json(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=320&titles=${encodeURIComponent('File:' + p18)}`);
      const info = Object.values(c.query.pages)[0]?.imageinfo?.[0];
      const m = info?.extmetadata || {};
      const licence = texte(m.LicenseShortName?.value);
      e.fichier_commons = p18;
      e.page = info?.descriptionurl;
      e.vignette = info?.thumburl;
      e.mime = info?.mime;
      e.auteur = texte(m.Artist?.value).slice(0, 120) || 'auteur non indiqué';
      e.licence = licence;
      e.statut = LIBRE.test(licence) && /image\/(jpeg|png)/.test(info?.mime || '') ? 'à valider' : `licence ou format refusé (${licence || '?'} / ${info?.mime || '?'})`;
    } catch (err) { e.statut = 'erreur : ' + err.message; }
    res.push(e);
    await dormir(1500);
  }
  fs.writeFileSync(LISTE, JSON.stringify(res, null, 2) + '\n', 'utf8');
  for (const e of res) console.log(`${e.statut.padEnd(22)} ${e.nom} ${e.description ? '— ' + e.description : ''} ${e.licence ? '[' + e.licence + ']' : ''}`);
  console.log(`\n${res.filter(e => e.statut === 'à valider').length} photo(s) trouvée(s) → ${path.relative(RACINE, LISTE)} (passer « statut » à « ok » après relecture)`);
}

async function telecharger() {
  const liste = JSON.parse(fs.readFileSync(LISTE, 'utf8'));
  fs.mkdirSync(DOSSIER, { recursive: true });
  const photos = {};
  for (const e of liste.filter(x => x.statut === 'ok')) {
    const r = await fetch(e.vignette, { headers: UA });
    if (!r.ok) { console.log(`échec ${e.nom} : HTTP ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG';
    if (!jpeg && !png) { console.log(`refusé ${e.nom} : le fichier reçu n'est pas une image JPEG/PNG`); continue; }
    if (buf.length > 400 * 1024) { console.log(`refusé ${e.nom} : fichier trop lourd (${Math.round(buf.length / 1024)} Ko)`); continue; }
    const fichier = `${slug(e.nom)}.${jpeg ? 'jpg' : 'png'}`;
    fs.writeFileSync(path.join(DOSSIER, fichier), buf);
    photos[e.nom] = { fichier, auteur: e.auteur, licence: e.licence, source: e.page };
    console.log(`ok ${e.nom} → ${fichier} (${Math.round(buf.length / 1024)} Ko, ${e.licence})`);
    await dormir(400);
  }
  fs.writeFileSync(path.join(DOSSIER, 'photos.js'),
    '// Fichier généré par outils/photos.js — photos sous licence libre (Wikimedia Commons), auteur et licence affichés sous chaque photo.\n' +
    'window.PHOTOS_2027 = ' + JSON.stringify(photos, null, 2) + ';\n', 'utf8');
  console.log(`\n${Object.keys(photos).length} photo(s) enregistrée(s) dans site/photos/.`);
}

const a = process.argv.slice(2);
(a.includes('--telecharger') ? telecharger() : a.includes('--chercher') ? chercher() : Promise.resolve(console.error('Préciser --chercher ou --telecharger')))
  .catch(e => { console.error('Erreur : ' + e.message); process.exit(1); });
