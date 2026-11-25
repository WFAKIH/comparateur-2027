// Archivage des preuves : capture d'écran (avec passage surligné), page complète, texte et métadonnées.
// Rangement : preuves/<candidat>/<clé>/<AAAA-MM-JJ>_<domaine>/
//   clé = ID de promesse (P0042) une fois intégrée, sinon ID de proposition (2026-11-25-003).
// Index : preuves/index.json  { "<clé>": [ {dossier, url, date, citation_trouvee, statut} ] }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RACINE } = require('./donnees');

const PREUVES = path.join(RACINE, 'preuves');
const INDEX = path.join(PREUVES, 'index.json');
const EDGE = 'msedge';
const DELAI_MAX_MS = 120000; // durée maximale d'une capture

const slug = s => String(s || 'inconnu').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inconnu';
const jour = () => new Date().toLocaleDateString('sv-SE');

function lireIndex() { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return {}; } }
function ecrireIndex(idx) {
  fs.mkdirSync(PREUVES, { recursive: true });
  const trie = Object.fromEntries(Object.keys(idx).sort().map(k => [k, idx[k]]));
  fs.writeFileSync(INDEX, JSON.stringify(trie, null, 2) + '\n', 'utf8');
}

// Recherche, dans la page, de l'élément qui contient le mieux la citation, puis surlignage.
// Exécuté dans le navigateur.
function surlignerDansPage(cible) {
  const norm = s => (s || '').replace(/(\d)\s+(?=\d)/g, '$1').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ')
    .replace(/[^a-z0-9€% ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const vides = new Set('les des une pour par sur dans avec aux est sont qui que plus pas son ses leur leurs cette ces tout tous'.split(' '));
  const n = norm(cible);
  if (!n) return { niveau: 'non', score: 0 };
  const mots = [...new Set(n.split(' ').filter(m => m.length > 2 && !vides.has(m)))];
  let meilleur = null;
  for (const el of document.querySelectorAll('p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,span,div,section,article')) {
    const t = el.innerText;
    if (!t || t.length < 15 || t.length > 3000) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const nt = norm(t);
    const exacte = nt.includes(n);
    const score = exacte ? 1 : mots.filter(m => nt.includes(m)).length / Math.max(1, mots.length);
    if (!meilleur || score > meilleur.score + 1e-9 || (Math.abs(score - meilleur.score) < 1e-9 && t.length < meilleur.len)) {
      meilleur = { el, score, len: t.length, exacte };
    }
  }
  if (!meilleur || meilleur.score < 0.35) return { niveau: 'non', score: meilleur ? meilleur.score : 0 };
  const el = meilleur.el;
  el.style.outline = '4px solid #e8590c';
  el.style.outlineOffset = '3px';
  el.style.backgroundColor = 'rgba(255, 230, 0, 0.45)';
  el.scrollIntoView({ block: 'center' });
  return {
    niveau: meilleur.exacte ? 'exacte' : meilleur.score >= 0.6 ? 'partielle' : 'approchante',
    score: Math.round(meilleur.score * 100) / 100,
    extrait: el.innerText.slice(0, 400),
  };
}

// Refus des bandeaux cookies (option la plus protectrice) : on ne clique que sur des boutons de refus.
async function refuserCookies(page) {
  const textes = [/tout refuser/i, /refuser tout/i, /^\W*refuser\W*$/i, /continuer sans accepter/i, /reject all/i, /^\W*decline\W*$/i];
  for (const cadre of page.frames()) {
    for (const re of textes) {
      try {
        const b = cadre.locator('button, a, [role=button], input[type=button], div, span').filter({ hasText: re }).last();
        if (await b.isVisible({ timeout: 200 })) { await b.click({ timeout: 1500 }); await page.waitForTimeout(700); return true; }
      } catch { /* bouton absent */ }
    }
  }
  return false;
}

function dossierLibre(base) {
  let d = base, i = 2;
  while (fs.existsSync(d)) d = `${base}-${i++}`;
  return d;
}

/**
 * Capture une source.
 * @param {import('playwright-core').BrowserContext} contexte
 * @param {{url:string, candidat:string, cle:string, citation?:string, texteRecherche?:string}} o
 */
async function capturer(contexte, o) {
  const url = String(o.url || '').trim();
  let domaine = 'source';
  try { domaine = new URL(url).hostname.replace(/^www\./, ''); } catch { /* url invalide */ }
  const dossier = dossierLibre(path.join(PREUVES, slug(o.candidat), o.cle, `${jour()}_${slug(domaine)}`));
  fs.mkdirSync(dossier, { recursive: true });
  const meta = {
    cle: o.cle, candidat: o.candidat, url, url_finale: null, statut_http: null, titre: null,
    capture_le: new Date().toISOString(), citation: o.citation || null,
    recherche: o.citation ? 'citation' : (o.texteRecherche ? 'texte de la promesse' : null),
    citation_trouvee: 'non', score: 0, extrait_surligne: null, type: 'page', fichiers: [], erreur: null,
  };
  const page = await contexte.newPage();
  const delai = (ms, quoi) => new Promise((_, ko) => setTimeout(() => ko(new Error(`délai dépassé (${quoi})`)), ms));
  try {
    await Promise.race([delai(DELAI_MAX_MS, `${DELAI_MAX_MS / 1000} s`), (async () => {
    if (!/^https?:\/\//.test(url)) throw new Error('URL invalide');
    let reponse = null;
    const telechargement = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    try {
      reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    } catch (e) {
      if (!/download/i.test(String(e.message))) throw e;
    }
    const ct = reponse ? (reponse.headers()['content-type'] || '') : '';
    if (!reponse || /application\/pdf/i.test(ct)) {
      // Document PDF : on archive le fichier original.
      meta.type = 'pdf';
      const r = await contexte.request.get(url, { timeout: 60000 });
      meta.statut_http = r.status();
      if (r.ok()) {
        // Un même PDF sert souvent à plusieurs promesses : stocké une seule fois, par empreinte.
        const corps = await r.body();
        const empreinte = crypto.createHash('sha256').update(corps).digest('hex');
        const rel = `_documents/${empreinte.slice(0, 16)}.pdf`;
        fs.mkdirSync(path.join(PREUVES, '_documents'), { recursive: true });
        if (!fs.existsSync(path.join(PREUVES, rel))) fs.writeFileSync(path.join(PREUVES, rel), corps);
        meta.document = rel; meta.sha256_document = empreinte; meta.fichiers.push(rel);
      }
      else throw new Error(`HTTP ${r.status()}`);
      void telechargement;
    } else {
      meta.statut_http = reponse.status();
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await refuserCookies(page);
      meta.url_finale = page.url();
      meta.titre = await page.title();
      const texte = await page.evaluate(() => document.body ? document.body.innerText : '');
      fs.writeFileSync(path.join(dossier, 'texte.txt'), `${url}\n${meta.titre}\nCapturé le ${meta.capture_le}\n\n${texte}`, 'utf8');
      meta.fichiers.push('texte.txt');
      meta.sha256_texte = crypto.createHash('sha256').update(texte).digest('hex');
      const cible = o.citation || o.texteRecherche;
      if (cible) {
        const r = await page.evaluate(surlignerDansPage, cible);
        meta.citation_trouvee = r.niveau; meta.score = r.score; meta.extrait_surligne = r.extrait || null;
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: path.join(dossier, 'capture.png'), timeout: 30000 });
      meta.fichiers.push('capture.png');
      // Pages dont le défilement est interne : on libère la hauteur pour la capture complète.
      const hauteur = await page.evaluate(() => {
        for (const el of [document.documentElement, document.body]) { el.style.height = 'auto'; el.style.overflow = 'visible'; }
        const s = document.scrollingElement || document.documentElement;
        let h = s.scrollHeight;
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 300) {
            el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible';
          }
        }
        h = Math.max(h, s.scrollHeight, document.body.scrollHeight);
        return Math.min(h, 12000);
      });
      await page.screenshot({ path: path.join(dossier, 'page-complete.jpg'), type: 'jpeg', quality: 60, fullPage: true, timeout: 45000, clip: hauteur >= 12000 ? { x: 0, y: 0, width: 1280, height: 12000 } : undefined });
      meta.fichiers.push('page-complete.jpg');
    }
    })()]);
  } catch (e) {
    meta.erreur = String(e.message || e).split('\n')[0];
  } finally {
    await Promise.race([page.close({ runBeforeUnload: false }).catch(() => {}), new Promise(ok => setTimeout(ok, 5000))]);
  }
  fs.writeFileSync(path.join(dossier, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  const statut = meta.erreur ? 'echec' : (meta.statut_http >= 400 ? 'lien_mort' : 'ok');
  const idx = lireIndex();
  (idx[o.cle] = idx[o.cle] || []).push({
    dossier: path.relative(PREUVES, dossier).replace(/\\/g, '/'), url, date: jour(),
    citation_trouvee: meta.citation_trouvee, statut,
  });
  ecrireIndex(idx);
  return { dossier, meta, statut };
}

async function ouvrirNavigateur() {
  const { chromium } = require('playwright-core');
  const navigateur = await chromium.launch({ channel: EDGE, headless: true });
  const contexte = await navigateur.newContext({
    viewport: { width: 1280, height: 900 }, locale: 'fr-FR', acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  });
  return { navigateur, contexte };
}

// Rattache les preuves d'une proposition à l'ID définitif de la promesse (après intégration).
function rattacher(clePropo, cleFinale, candidat) {
  const idx = lireIndex();
  const entrees = idx[clePropo];
  if (!entrees || !entrees.length) return 0;
  const src = path.join(PREUVES, slug(candidat), clePropo);
  const dst = path.join(PREUVES, slug(candidat), cleFinale);
  fs.mkdirSync(dst, { recursive: true });
  const nouvelles = [];
  for (const e of entrees) {
    const ancien = path.join(PREUVES, e.dossier);
    const cible = dossierLibre(path.join(dst, path.basename(ancien)));
    if (fs.existsSync(ancien)) fs.renameSync(ancien, cible);
    nouvelles.push({ ...e, dossier: path.relative(PREUVES, cible).replace(/\\/g, '/'), proposition: clePropo });
  }
  try { fs.rmdirSync(src); } catch { /* non vide ou absent */ }
  idx[cleFinale] = [...(idx[cleFinale] || []), ...nouvelles];
  delete idx[clePropo];
  ecrireIndex(idx);
  return nouvelles.length;
}

module.exports = { PREUVES, INDEX, slug, lireIndex, ecrireIndex, capturer, ouvrirNavigateur, rattacher };
