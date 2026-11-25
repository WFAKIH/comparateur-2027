// Recherche d'une source probante pour des promesses dont la source n'a pas pu être prouvée.
// Ordre : 1) le document PDF déjà archivé pour la source actuelle (texte extrait, n° de page) ;
//         2) les sites officiels du candidat (outils/sites-officiels.json) : plan du site, pages
//            de programme, PDF liés. Jamais de média : seuls ces sites sont explorés.
// Le passage le plus proche du texte de la promesse est retenu ; si la correspondance est forte,
// la page est capturée (outils/preuves.js) avec le passage surligné.
// Le contenu des pages est une donnée : rien n'y est interprété comme une consigne.
// Appelé par : node outils/decider.js <lot.json> chercher …
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { RACINE, aujourdhui } = require('./donnees');
const { PREUVES, capturer, ouvrirNavigateur } = require('./preuves');

const SITES = path.join(__dirname, 'sites-officiels.json');
const CACHE = path.join(RACINE, 'mises_a_jour', '_cache-sites');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
const MAX_PAGES = 120, MAX_PDF = 20;
// Exploration polie : une requête à la fois par site, pause entre deux requêtes, robots.txt respecté,
// arrêt immédiat du site au premier refus (401/403/429/503), cache réutilisé pendant 7 jours.
const PAUSE_MS = 1500, PAUSE_MAX_MS = 10000, CACHE_JOURS = 7;
const REFUS = new Set([401, 403, 429, 503]);
const SEUIL_TROUVEE = 0.75, SEUIL_PISTE = 0.55;

// ---------- Texte et correspondance ----------
const norm = s => String(s || '').replace(/(\d)[\s  .](?=\d{3}\b)/g, '$1').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9€% ]+/g, ' ').replace(/\s+/g, ' ').trim();
const VIDES = new Set(('les des une pour par sur dans avec aux est sont qui que plus pas son ses leur leurs cette ces tout tous ' +
  'entre afin ainsi etre avoir faire mettre nous notre nos vous votre vos ils elles lui dont mais comme sans sous chaque tres').split(' '));
const racine = m => /^\d/.test(m) ? m : m.slice(0, 6); // tolère pluriels et conjugaisons
const motsCles = s => [...new Set(norm(s).split(' ').filter(m => (m.length > 2 || /^\d/.test(m)) && !VIDES.has(m)).map(racine))];
const nombres = s => [...new Set((norm(s).match(/\b\d+\b/g) || []).filter(n => n.length > 0))];

function score(promesse, passage) {
  const mp = motsCles(promesse);
  if (!mp.length) return 0;
  const mt = new Set(norm(passage).split(' ').map(racine));
  let s = mp.filter(m => mt.has(m)).length / mp.length;
  const np = nombres(promesse);
  if (np.length && !np.every(n => mt.has(n))) s = Math.min(s, SEUIL_TROUVEE - 0.01); // un chiffre absent interdit « trouvée »
  return s;
}

// Découpe un texte en passages (paragraphes, ou fenêtres de 3 phrases pour les blocs longs).
function passages(texte) {
  const out = [];
  for (const bloc of String(texte).split(/\n\s*\n|\r\n\s*\r\n/)) {
    const b = bloc.replace(/\s+/g, ' ').trim();
    if (b.length < 20) continue;
    if (b.length <= 700) { out.push(b); continue; }
    const phrases = b.split(/(?<=[.!?;:])\s+/);
    for (let i = 0; i < phrases.length; i += 2) out.push(phrases.slice(i, i + 3).join(' '));
  }
  return out;
}

// Phrase la plus probante du passage (citation exacte de moins de 25 mots).
function citation(promesse, passage) {
  const phrases = passage.split(/(?<=[.!?;])\s+|\s+[•–]\s+/).map(s => s.trim()).filter(s => s.length > 10);
  let best = phrases[0] || passage;
  let bs = -1;
  for (const ph of phrases) { const s = score(promesse, ph); if (s > bs) { bs = s; best = ph; } }
  const mots = best.split(/\s+/);
  return mots.length > 24 ? mots.slice(0, 24).join(' ') : best;
}

function meilleur(promesse, texte) {
  let m = null;
  for (const p of passages(texte)) {
    const s = score(promesse, p);
    if (!m || s > m.score + 1e-9 || (Math.abs(s - m.score) < 1e-9 && p.length < m.passage.length)) m = { score: s, passage: p };
  }
  return m;
}

// ---------- PDF ----------
function pdftotext() {
  for (const c of ['pdftotext', 'C:/Program Files/Git/ucrt64/bin/pdftotext.exe', 'C:/Program Files/Git/mingw64/bin/pdftotext.exe']) {
    try { execFileSync(c, ['-v'], { stdio: 'ignore' }); return c; } catch (e) { if (e.code !== 'ENOENT') return c; }
  }
  return null;
}
const PDFTOTEXT = pdftotext();
function textePdf(fichier) {
  if (!PDFTOTEXT) return null;
  try { return execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', fichier, '-'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); }
  catch { return null; }
}
// Recherche page par page (pdftotext sépare les pages par \f).
function chercherDansPdf(promesse, texte) {
  let m = null;
  texte.split('\f').forEach((pg, i) => {
    const r = meilleur(promesse, pg);
    if (r && (!m || r.score > m.score)) m = { ...r, page: i + 1 };
  });
  return m;
}

// ---------- Accès poli aux sites ----------
const dormir = ms => new Promise(ok => setTimeout(ok, ms));
const hoteDe = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
// Hôtes officiels d'un candidat (« doc:<url> » = hébergeur de documents du site officiel : source fiable, mais non exploré).
const hotesDe = liste => (liste || []).map(s => hoteDe(s.replace(/^doc:/, '')));
const etats = {}; // hôte → { suite, prochain, refus, robots, pause }
const etat = h => (etats[h] = etats[h] || { suite: Promise.resolve(), prochain: 0, refus: null, robots: undefined, pause: PAUSE_MS });

async function brut(url, { binaire = false, delai = 20000 } = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), delai);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr' }, redirect: 'follow', signal: c.signal });
    if (!r.ok) return { statut: r.status };
    const type = r.headers.get('content-type') || '';
    return { statut: r.status, type, url: r.url, corps: binaire || /pdf/i.test(type) ? Buffer.from(await r.arrayBuffer()) : await r.text() };
  } catch (e) { return { statut: 0, erreur: e.name === 'AbortError' ? 'délai dépassé' : e.message }; }
  finally { clearTimeout(t); }
}

function analyserRobots(txt) {
  const groupes = [];
  let cur = null, apresUA = false;
  for (const ligne of String(txt).split(/\r?\n/)) {
    const m = ligne.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !apresUA) { cur = { ua: [], regles: [], delai: null }; groupes.push(cur); }
      cur.ua.push(v.toLowerCase()); apresUA = true;
    } else {
      apresUA = false;
      if (k === 'sitemap') { (groupes.plans = groupes.plans || []).push(v); continue; }
      if (!cur) continue;
      if ((k === 'disallow' || k === 'allow') && v) cur.regles.push({ permis: k === 'allow', motif: v });
      else if (k === 'crawl-delay' && Number(v) > 0) cur.delai = Number(v);
    }
  }
  const g = groupes.find(x => x.ua.includes('*'));
  return { regles: g ? g.regles : [], delai: g ? g.delai : null, plans: groupes.plans || [] };
}
function autorise(robots, url) {
  if (!robots) return true;
  const u = new URL(url), chemin = u.pathname + u.search;
  let retenue = null;
  for (const r of robots.regles) {
    const re = new RegExp('^' + r.motif.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(chemin) && (!retenue || r.motif.length > retenue.motif.length)) retenue = r;
  }
  return !retenue || retenue.permis;
}

// Charge robots.txt une fois par site (dans la file du site).
async function preparer(e, url) {
  if (e.robots !== undefined) return;
  const r = await brut(new URL('/robots.txt', url).href, { delai: 15000 });
  e.prochain = Date.now() + e.pause;
  if (REFUS.has(r.statut)) { e.refus = r.statut; e.robots = null; return; }
  e.robots = typeof r.corps === 'string' ? analyserRobots(r.corps) : null;
  if (e.robots?.delai) e.pause = Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MS, e.robots.delai * 1000));
}

// Téléchargement poli : file d'attente par site, pause, robots.txt, arrêt au premier refus.
function telecharger(url, opts = {}) {
  const e = etat(hoteDe(url));
  const tache = e.suite.then(async () => {
    await preparer(e, url);
    if (e.refus) return { statut: e.refus, refuse: true };
    if (!autorise(e.robots, url)) return { statut: 0, erreur: 'interdit par robots.txt' };
    const attente = e.prochain - Date.now();
    if (attente > 0) await dormir(attente);
    const r = await brut(url, opts);
    e.prochain = Date.now() + e.pause;
    if (REFUS.has(r.statut)) e.refus = r.statut;
    return r;
  });
  e.suite = tache.catch(() => {});
  return tache;
}

const texteHtml = html => String(html)
  .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|li|h[1-6]|div|section|article|tr|blockquote|dd|dt)>|<br\s*\/?>/gi, '\n\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;|&ndash;/g, '–')
  .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&[a-z]+;/g, ' ')
  .replace(/[ \t]+/g, ' ');
const liens = (html, base) => [...String(html).matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
  .map(m => { try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return null; } }).filter(Boolean);

const PRIORITE = /programme|projet|proposition|mesure|engagement|theme|thematique|plan|livret|pdf|priorit|idees|contre-budget|budget/i;
const EXCLUS = /\.(jpe?g|png|gif|webp|svg|ico|css|js|mp4|mp3|zip|docx?|xlsx?)(\?|$)|\/(wp-json|feed|tag|author|wp-admin|login|panier|cart|don|adherer|boutique|shop)\b|mailto:|tel:|javascript:/i;

async function urlsDuSite(accueil, journal) {
  const hote = new URL(accueil).hostname.replace(/^www\./, '');
  const memeSite = u => { try { return new URL(u).hostname.replace(/^www\./, '') === hote; } catch { return false; } };
  const vues = new Set();
  // Plans du site
  const e = etat(hote);
  await (e.suite = e.suite.then(() => preparer(e, accueil)).catch(() => {}));
  if (e.refus) { journal.push(`${hote} : accès refusé (HTTP ${e.refus}) dès robots.txt — site ignoré, rien d'autre n'est demandé`); return []; }
  const plans = [...new Set([...(e.robots?.plans || []), ...['sitemap.xml', 'sitemap_index.xml', 'wp-sitemap.xml'].map(f => new URL(f, accueil).href)])];
  const pagesPlan = [];
  for (let i = 0; i < plans.length && i < 15 && !e.refus; i++) {
    const r = await telecharger(plans[i], { delai: 15000 });
    if (!r.corps || typeof r.corps !== 'string' || !/<(urlset|sitemapindex)/i.test(r.corps)) continue;
    for (const m of r.corps.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const u = m[1].replace(/&amp;/g, '&');
      if (/sitemap[^/]*\.xml/i.test(u)) { if (!plans.includes(u)) plans.push(u); } else if (memeSite(u)) pagesPlan.push(u);
    }
  }
  // Accueil et pages de programme (un niveau de liens)
  const accueilHtml = await telecharger(accueil);
  const depuisAccueil = typeof accueilHtml.corps === 'string' ? liens(accueilHtml.corps, accueil).filter(memeSite) : [];
  const toutes = [...new Set([...pagesPlan, ...depuisAccueil].filter(u => !EXCLUS.test(u) || /\.pdf(\?|$)/i.test(u)))];
  toutes.sort((a, b) => (PRIORITE.test(b) ? 1 : 0) - (PRIORITE.test(a) ? 1 : 0));
  for (const u of toutes) if (autorise(e.robots, u)) vues.add(u);
  journal.push(`${hote} : ${pagesPlan.length} page(s) dans le plan du site, ${depuisAccueil.length} lien(s) depuis l'accueil, pause ${e.pause / 1000} s` +
    `${accueilHtml.statut && accueilHtml.statut < 400 ? '' : ` (accueil : ${accueilHtml.erreur || 'HTTP ' + accueilHtml.statut})`}`);
  return [...vues];
}

// Sites qui refusent les lectures simples : exploration avec le navigateur (Edge), limitée.
async function corpusNavigateur(accueil, journal) {
  const hote = new URL(accueil).hostname.replace(/^www\./, '');
  const memeSite = u => { try { return new URL(u).hostname.replace(/^www\./, '') === hote; } catch { return false; } };
  const e = etat(hote);
  const corpus = [];
  if (e.refus) { journal.push(`${hote} : accès refusé (HTTP ${e.refus}) — pas de nouvel essai avec le navigateur`); return corpus; }
  const { navigateur, contexte } = await ouvrirNavigateur();
  try {
    const lire = async u => {
      if (e.refus || !autorise(e.robots, u)) return null;
      const attente = e.prochain - Date.now();
      if (attente > 0) await dormir(attente);
      const page = await contexte.newPage();
      try {
        const rep = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (rep && REFUS.has(rep.status())) { e.refus = rep.status(); return null; }
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        return await page.evaluate(() => ({ texte: document.body ? document.body.innerText : '', liens: [...document.querySelectorAll('a[href]')].map(a => a.href) }));
      } catch { return null; } finally { e.prochain = Date.now() + e.pause; await page.close().catch(() => {}); }
    };
    const a = await lire(accueil);
    if (!a) { journal.push(`${hote} : inaccessible même avec le navigateur${e.refus ? ` (HTTP ${e.refus}, arrêt)` : ''}`); return corpus; }
    corpus.push({ url: accueil, type: 'page', texte: a.texte });
    let file = [...new Set(a.liens.filter(memeSite).filter(u => !EXCLUS.test(u)))];
    file.sort((x, y) => (PRIORITE.test(y) ? 1 : 0) - (PRIORITE.test(x) ? 1 : 0));
    const vues = new Set([accueil]);
    for (let i = 0; i < file.length && corpus.length < 60 && !e.refus; i++) {
      const u = file[i].split('#')[0];
      if (vues.has(u) || !autorise(e.robots, u)) continue;
      vues.add(u);
      if (/\.pdf(\?|$)/i.test(u)) {
        const attente = e.prochain - Date.now();
        if (attente > 0) await dormir(attente);
        const r = await contexte.request.get(u, { timeout: 60000 }).catch(() => null);
        e.prochain = Date.now() + e.pause;
        if (r && REFUS.has(r.status())) { e.refus = r.status(); break; }
        if (r && r.ok()) {
          const tmp = path.join(CACHE, `_tmp_${process.pid}_nav.pdf`);
          fs.writeFileSync(tmp, await r.body());
          const t = textePdf(tmp); fs.rmSync(tmp, { force: true });
          if (t) corpus.push({ url: u, type: 'pdf', texte: t });
        }
        continue;
      }
      const r = await lire(u);
      if (!r) continue;
      corpus.push({ url: u, type: 'page', texte: r.texte });
      if (PRIORITE.test(u)) for (const l of r.liens) if (memeSite(l) && !EXCLUS.test(l) && !file.includes(l)) file.push(l);
    }
  } finally { await navigateur.close(); }
  journal.push(`${hote} : ${corpus.length} document(s) lus avec le navigateur (${corpus.filter(c => c.type === 'pdf').length} PDF)` +
    (e.refus ? ` — arrêt : le site a refusé l'accès (HTTP ${e.refus})` : ''));
  return corpus;
}

// Cache : mises_a_jour/_cache-sites/<date>_<hôte>.json = { complet, docs:[{url,type,texte}] }.
// Un corpus complet est réutilisé pendant CACHE_JOURS jours ; un corpus interrompu, le jour même.
function lireCache(hote) {
  if (!fs.existsSync(CACHE)) return null;
  const limite = new Date(Date.now() - CACHE_JOURS * 864e5).toLocaleDateString('sv-SE');
  const fichiers = fs.readdirSync(CACHE).filter(f => f.endsWith(`_${hote}.json`) && /^\d{4}-\d{2}-\d{2}_/.test(f)).sort().reverse();
  for (const f of fichiers) {
    const date = f.slice(0, 10);
    if (date < limite) break;
    let c;
    try { c = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { continue; }
    if (Array.isArray(c)) c = { complet: date === aujourdhui(), docs: c }; // ancien format
    if (c.complet || date === aujourdhui()) return { ...c, date };
  }
  return null;
}

async function corpusDuSite(accueil, journal) {
  const hote = hoteDe(accueil);
  const cache = lireCache(hote);
  if (cache) { journal.push(`${hote} : cache du ${cache.date} (${cache.docs.length} document(s)${cache.complet ? '' : ', exploration interrompue'})`); return cache.docs; }
  fs.mkdirSync(CACHE, { recursive: true });
  const e = etat(hote);
  const enregistrer = docs => {
    fs.writeFileSync(path.join(CACHE, `${aujourdhui()}_${hote}.json`), JSON.stringify({ complet: !e.refus, docs }), 'utf8');
    return docs;
  };
  const urls = await urlsDuSite(accueil, journal);
  if (e.refus) return enregistrer([]);
  if (urls.length < 3) return enregistrer(await corpusNavigateur(accueil, journal));
  const pdfs = urls.filter(u => /\.pdf(\?|$)/i.test(u)).slice(0, MAX_PDF);
  const pages = urls.filter(u => !/\.pdf(\?|$)/i.test(u)).slice(0, MAX_PAGES);
  const corpus = [];
  const enPlus = new Set();
  const lirePdf = (u, corps) => {
    const tmp = path.join(CACHE, `_tmp_${process.pid}.pdf`);
    fs.writeFileSync(tmp, corps);
    const t = textePdf(tmp);
    fs.rmSync(tmp, { force: true });
    if (t) corpus.push({ url: u, type: 'pdf', texte: t });
  };
  // Une requête à la fois (file du site), dans l'ordre de priorité.
  for (const u of [...pages, ...pdfs]) {
    if (e.refus) break;
    const r = await telecharger(u, { binaire: /\.pdf(\?|$)/i.test(u) });
    if (!r.corps) continue;
    if (Buffer.isBuffer(r.corps)) lirePdf(u, r.corps);
    else {
      corpus.push({ url: r.url || u, type: 'page', texte: texteHtml(r.corps) });
      // PDF de programme liés depuis une page de programme
      // (uniquement ceux hébergés sur ce même site officiel : jamais un document tiers lié depuis le site)
      if (PRIORITE.test(u)) for (const l of liens(r.corps, u)) if (/\.pdf(\?|$)/i.test(l) && !pdfs.includes(l) && hoteDe(l) === hote) enPlus.add(l);
    }
  }
  for (const u of [...enPlus].slice(0, Math.max(0, MAX_PDF - pdfs.length))) {
    if (e.refus) break;
    const r = await telecharger(u, { binaire: true, delai: 60000 });
    if (Buffer.isBuffer(r.corps)) lirePdf(u, r.corps);
  }
  const pauvres = corpus.filter(c => c.type === 'page' && c.texte.replace(/\s+/g, ' ').length < 400).length;
  journal.push(`${hote} : ${corpus.length} document(s) lus (${corpus.filter(c => c.type === 'pdf').length} PDF)` +
    (e.refus ? ` — ARRÊT : le site a refusé l'accès (HTTP ${e.refus}), exploration interrompue` : '') +
    (pauvres > corpus.length / 2 ? ` — attention : ${pauvres} page(s) presque vides (site rendu en JavaScript ?)` : ''));
  return enregistrer(corpus);
}

// ---------- Recherche pour un lot ----------
function sitesOfficiels() {
  try { return JSON.parse(fs.readFileSync(SITES, 'utf8')); } catch { return {}; }
}
const candidatDe = p => String(p.valeur_actuelle || '').split(' · ')[0];
const promesseDe = p => (String(p.valeur_actuelle || '').match(/«\s*(.*)\s*»/) || [])[1] || '';

/**
 * @param {object[]} cibles propositions controle_promesse à traiter (modifiées sur place)
 * @param {{essai?:boolean, journal?:string[]}} o
 */
async function chercherSources(cibles, o = {}) {
  const journal = o.journal || [];
  const sites = sitesOfficiels();
  const corpus = {};
  const resultats = [];
  if (!PDFTOTEXT) journal.push('pdftotext introuvable : les PDF ne seront pas lus.');

  for (const p of cibles) {
    const candidat = candidatDe(p), promesse = promesseDe(p);
    let res = null;
    // 1) PDF déjà archivé pour la source actuelle
    for (const pr of p.preuves || []) {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(pr.dossier, 'meta.json'), 'utf8')); } catch { continue; }
      if (!meta.document) continue;
      if (!hotesDe(sites[candidat]).includes(hoteDe(meta.url))) continue; // PDF hors site officiel : ne vaut pas source fiable
      const t = textePdf(path.join(PREUVES, meta.document));
      const m = t && chercherDansPdf(promesse, t);
      if (m && (!res || m.score > res.score)) res = { ...m, url: meta.url, type: 'pdf', origine: 'source actuelle (PDF archivé)', document: meta.document };
    }
    // 2) Sites officiels du candidat
    if (!res || res.score < SEUIL_TROUVEE) {
      for (const accueil of (sites[candidat] || []).filter(s => !s.startsWith('doc:'))) {
        if (!corpus[accueil]) corpus[accueil] = await corpusDuSite(accueil, journal).catch(e => { journal.push(`${accueil} : ${e.message}`); return []; });
        const hotesOfficiels = hotesDe(sites[candidat]);
        for (const doc of corpus[accueil]) {
          if (!hotesOfficiels.includes(hoteDe(doc.url))) continue; // document hors site officiel (ex. rapport public lié) : ignoré
          const m = doc.type === 'pdf' ? chercherDansPdf(promesse, doc.texte) : meilleur(promesse, doc.texte);
          if (m && (!res || m.score > res.score + 1e-9)) res = { ...m, url: doc.url, type: doc.type, origine: 'site officiel' };
        }
      }
      if (!(sites[candidat] || []).length) journal.push(`${p.id} : aucun site officiel connu pour ${candidat} (outils/sites-officiels.json)`);
    }
    // « trouvée » exige que la phrase citée, à elle seule, porte l'engagement (évite les listes
    // ou menus qui juxtaposent les mots de plusieurs mesures).
    const phrase = res ? score(promesse, citation(promesse, res.passage)) : 0;
    const niveau = !res ? 'non' : (res.score >= SEUIL_TROUVEE && phrase >= SEUIL_TROUVEE) ? 'trouvee' : res.score >= SEUIL_PISTE ? 'piste' : 'non';
    const r = { p, candidat, promesse, niveau, res };
    resultats.push(r);
    if (o.essai || niveau === 'non') continue;
    p.source_trouvee = {
      niveau, url: res.url, type: res.type, page: res.page || null, origine: res.origine,
      score: Math.round(res.score * 100) / 100, citation: citation(promesse, res.passage),
      passage: res.passage.slice(0, 600), cherche_le: aujourdhui(),
    };
  }

  // Captures des sources trouvées (passage surligné)
  const aCapturer = resultats.filter(r => !o.essai && r.niveau === 'trouvee');
  if (aCapturer.length) {
    const { navigateur, contexte } = await ouvrirNavigateur();
    for (const r of aCapturer) {
      const s = r.p.source_trouvee;
      const memeSource = s.type === 'pdf' && s.origine.startsWith('source actuelle');
      if (!memeSource) {
        const c = await capturer(contexte, { url: s.url, candidat: r.candidat, cle: r.p.id_existant, citation: s.citation });
        r.p.preuves = [...(r.p.preuves || []), { dossier: c.dossier, statut: c.statut, citation_trouvee: c.meta.citation_trouvee }];
        s.capture = { statut: c.statut, passage: c.meta.citation_trouvee };
        if (c.statut !== 'ok') { s.niveau = 'piste'; r.niveau = 'piste'; continue; }
      }
      const ancien = r.p.verification;
      r.p.verification = {
        statut: 'confirme', par: 'chercher-sources',
        commentaire: `Passage retrouvé (${Math.round(s.score * 100)} % des mots de la promesse) sur ${s.origine}` +
          (s.page ? `, page ${s.page}` : '') + ` : ${s.url}` + (s.url !== r.p.source_url ? ' — nouvelle URL primaire proposée' : ''),
        precedent: ancien && ancien.par !== 'chercher-sources' ? ancien : ancien?.precedent || null,
      };
    }
    await navigateur.close();
  }
  for (const r of resultats) if (!o.essai && r.niveau === 'piste' && r.p.verification?.statut !== 'confirme') {
    const c = String(r.p.verification?.commentaire || '').replace(/ — piste : .*$/, '');
    r.p.verification = { ...(r.p.verification || {}), commentaire: `${c} — piste : ${r.p.source_trouvee.url}` };
  }
  return { resultats, journal };
}

module.exports = { chercherSources, score, SEUIL_TROUVEE, SEUIL_PISTE, _interne: { analyserRobots, autorise, telecharger, corpusDuSite } };
