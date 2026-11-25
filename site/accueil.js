// Page d'accueil : tuiles des personnalités et graphiques « En chiffres ».
// Règles de chiffrage (equipe/REGLES_COMMUNES.md) : seuls les montants annuels sont additionnés,
// jamais des montants de périodes différentes ; les totaux, objectifs et sous-enveloppes ne sont pas
// recomptés (pas de double compte). Aucun classement ni jugement : les graphiques décrivent le relevé.
(() => {
  'use strict';
  const D = window.DATA_2027;
  if (!D) return;
  const PHOTOS = window.PHOTOS_2027 || {};
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n.toLocaleString('fr-FR', { maximumFractionDigits: n < 100 ? 2 : 1 });
  const dateFr = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : (d || 'date non renseignée');
  const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Palette catégorielle validée (contrôle daltonisme et contraste) ; ordre fixe, jamais recyclé.
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
  const AUTRES = '#9aa3a1';
  const COUT = SERIES[0], FINANCEMENT = SERIES[1];

  const nbProps = {};
  for (const p of D.promesses) nbProps[p['Candidat']] = (nbProps[p['Candidat']] || 0) + 1;

  // ---------- Tooltip commun ----------
  const tip = document.createElement('div');
  tip.className = 'chart-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  const montrerTip = (html, x, y) => { tip.innerHTML = html; tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px'; tip.style.top = Math.max(8, y - r.height - 10) + 'px'; };
  const cacherTip = () => { tip.hidden = true; };

  // ---------- Tuiles des personnalités ----------
  const groupe = i => {
    const s = `${i['Situation'] || ''} ${i['Investiture / validation'] || ''}`;
    // « Rallié(e) à X », « a rejoint X », « soutient la candidature de X » ; pas « pas de consigne de ralliement ».
    if (/(^|[^a-zà-ÿ])ralli(é|ée|e)s?(?![a-zà-ÿ])|rejoint|apporte son soutien|soutient la candidature/i.test(s) && !/(pas de|sans) (consigne de )?ralli/i.test(s)) return 'rallie';
    if (/retir/i.test(i['Situation'] || '')) return 'retire';
    if (/déclar|investi|candidate/i.test(i['Situation'] || '')) return 'declare';
    return 'pressenti';
  };
  const LIB = { tous: 'Toutes', declare: 'Candidatures déclarées', pressenti: 'Pressenties', retire: 'Retirées', rallie: 'Ralliées à un autre candidat' };
  let filtre = 'tous';

  function initiales(nom) { return nom.split(/\s+/).filter(Boolean).map(m => m[0]).slice(0, 2).join('').toUpperCase(); }
  function tuile(i) {
    const nom = i['Personnalité'];
    const g = groupe(i);
    const photo = PHOTOS[nom];
    const visuel = photo && photo.fichier
      ? `<img src="photos/${esc(photo.fichier)}" alt="Portrait de ${esc(nom)}" loading="lazy">`
      : `<span class="tile-initials" aria-hidden="true">${esc(initiales(nom))}</span>`;
    const lienPhoto = photo && /^https:\/\/commons\.wikimedia\.org\//.test(photo.source || '') ? photo.source : null;
    const credit = photo && photo.auteur ? `<span class="tile-credit">Photo : ${lienPhoto ? `<a href="${esc(lienPhoto)}" target="_blank" rel="noopener noreferrer">${esc(photo.auteur)}</a>` : esc(photo.auteur)}${photo.licence ? ', ' + esc(photo.licence) : ''}, Wikimedia Commons</span>` : '';
    const dateDecl = i['Date de déclaration'];
    const n = nbProps[nom] || 0;
    const source = /^https?:/.test(i['Source datée / URL'] || '') ? `<a href="${esc(i['Source datée / URL'])}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : '';
    return `<article class="candidate-tile tile-${g}">
      <div class="tile-photo">${visuel}</div>
      <div class="tile-body">
        <span class="tile-status status-${g}">${esc(i['Situation'] || 'Situation non renseignée')}</span>
        <h3>${esc(nom)}</h3>
        <p class="tile-party">${esc(i['Organisation'] || 'Sans parti indiqué')}</p>
        <p class="tile-date">${dateDecl ? `Candidature déclarée le ${esc(dateFr(dateDecl))}` : `Situation au ${esc(dateFr(i['Date de situation']))}`}</p>
        <p class="tile-meta">${n ? `${n} proposition${n > 1 ? 's' : ''} relevée${n > 1 ? 's' : ''}` : 'Aucune proposition relevée pour l’instant'} ${source}</p>
        ${credit}
      </div>
    </article>`;
  }
  function rendreTuiles() {
    const tri = $('candidats-tri').value;
    let liste = D.inventaire.filter(i => filtre === 'tous' || groupe(i) === filtre);
    liste.sort((a, b) => tri === 'date' ? String(b['Date de situation']).localeCompare(String(a['Date de situation']))
      : tri === 'propositions' ? (nbProps[b['Personnalité']] || 0) - (nbProps[a['Personnalité']] || 0)
        : a['Personnalité'].split(' ').pop().localeCompare(b['Personnalité'].split(' ').pop(), 'fr'));
    $('candidats-tuiles').innerHTML = liste.map(tuile).join('') || '<p class="no-data">Aucune personnalité dans cette catégorie pour l’instant.</p>';
  }
  function initTuiles() {
    const compte = { tous: D.inventaire.length };
    for (const i of D.inventaire) compte[groupe(i)] = (compte[groupe(i)] || 0) + 1;
    $('candidats-filtres').innerHTML = Object.keys(LIB).map(k =>
      `<button type="button" class="chip" data-filtre="${k}" aria-pressed="${k === filtre}">${LIB[k]} <span>${compte[k] || 0}</span></button>`).join('');
    $('candidats-filtres').addEventListener('click', e => {
      const b = e.target.closest('[data-filtre]'); if (!b) return;
      filtre = b.dataset.filtre;
      for (const x of $('candidats-filtres').children) x.setAttribute('aria-pressed', x === b);
      rendreTuiles();
    });
    $('candidats-tri').addEventListener('change', rendreTuiles);
    rendreTuiles();
  }

  // ---------- Montants : sélection sans double compte ni mélange de périodes ----------
  const NON_ANNUEL = /unique|une seule|5 ans|non annualis|niveau|initial|périodicité ND/i;
  const ANNUEL = /\/an|par an|PLF 20\d\d/i;
  const AGREGAT = /agrég|agrégat|solde|objectif|induite|conditionnel/i;
  function sens(nature) {
    const n = nature || '';
    if (/économi/i.test(n)) return 'financement';
    if (/recette/i.test(n) && /(baisse|perte|moindre)/i.test(n)) return 'cout';
    if (/recette/i.test(n)) return 'financement';
    if (/dépense|coût|allègement|subvention/i.test(n)) return 'cout';
    return null;
  }
  function classer(p) {
    const v = p['Valeur Md€'], per = p['Période / unité'] || '', nat = p['Nature du chiffrage'] || '';
    if (typeof v !== 'number') return null;
    const s = sens(nat);
    let exclusion = null;
    if (AGREGAT.test(nat)) exclusion = 'total ou objectif annoncé (non recompté avec ses mesures)';
    else if (!ANNUEL.test(per) || NON_ANNUEL.test(per)) exclusion = `montant non annuel (${per || 'période non précisée'})`;
    else if (!s) exclusion = 'nature du montant non déterminée';
    return { p, v, per, nat, s, exclusion };
  }
  const montants = D.promesses.map(classer).filter(Boolean);
  // Une barre = une personnalité, une période annuelle, un sens (coûts / financements).
  const groupes = {};
  for (const m of montants) {
    const c = m.p['Candidat'];
    groupes[c] = groupes[c] || { candidat: c, periodes: {}, exclus: [] };
    if (m.exclusion) { groupes[c].exclus.push(m); continue; }
    const g = groupes[c].periodes[m.per] = groupes[c].periodes[m.per] || { cout: [], financement: [] };
    g[m.s].push(m);
  }
  const somme = l => l.reduce((a, m) => a + m.v, 0);

  // ---------- Graphique 1 : coûts / financements par personnalité ----------
  function svgEl(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function barresHorizontales(cible, lignes, { series, unite, onClick, largeurLabel = 190 }) {
    // lignes : [{ label, sous, valeurs: [{ v, serie, cle }] }]
    const H_BAR = 16, GAP = 2, H_LIGNE = series.length * (H_BAR + GAP) + 14, W = 720, PAD_R = 70;
    const max = Math.max(1, ...lignes.flatMap(l => l.valeurs.map(x => x.v)));
    const H = lignes.length * H_LIGNE + 28;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': cible.getAttribute('aria-label') || '' });
    const x0 = largeurLabel, larg = W - x0 - PAD_R;
    // graduations
    const pas = [1, 2, 5, 10, 20, 25, 50, 100, 200].find(s => max / s <= 5) || 500;
    for (let t = 0; t <= max; t += pas) {
      const x = x0 + (t / max) * larg;
      svgEl('line', { x1: x, x2: x, y1: 0, y2: H - 22, class: 'grid' }, svg);
      svgEl('text', { x, y: H - 6, class: 'axis', 'text-anchor': 'middle' }, svg).textContent = fmt(t);
    }
    lignes.forEach((l, i) => {
      const y = i * H_LIGNE + 6;
      const t = svgEl('text', { x: x0 - 10, y: y + 13, class: 'label', 'text-anchor': 'end' }, svg); t.textContent = l.label;
      if (l.sous) { const s = svgEl('text', { x: x0 - 10, y: y + 27, class: 'sublabel', 'text-anchor': 'end' }, svg); s.textContent = l.sous; }
      l.valeurs.forEach((val, k) => {
        const yy = y + k * (H_BAR + GAP);
        const w = Math.max(val.v > 0 ? 3 : 0, (val.v / max) * larg);
        const g = svgEl('g', { class: 'bar' + (onClick ? ' clickable' : ''), tabindex: onClick ? 0 : -1, role: onClick ? 'button' : 'presentation' }, svg);
        svgEl('rect', { x: x0, y: yy - 2, width: larg + PAD_R, height: H_BAR + 4, class: 'hit' }, g);
        const r = Math.min(4, w / 2);
        svgEl('path', { d: `M${x0},${yy}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${H_BAR - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`, fill: series[val.serie].couleur }, g);
        const vide = val.v === 0 && val.cle === null;
        const lab = svgEl('text', { x: x0 + w + 6, y: yy + 12, class: vide ? 'sublabel' : 'value' }, g); lab.textContent = vide ? 'aucun montant annuel annoncé' : `${fmt(val.v)}${unite}`;
        if (vide) { g.setAttribute('tabindex', -1); g.classList.remove('clickable'); }
        const texte = `<strong>${esc(l.label)}</strong><br>${esc(series[val.serie].nom)} : ${fmt(val.v)}${esc(unite)}${l.sous ? `<br><span>${esc(l.sous)}</span>` : ''}`;
        g.setAttribute('aria-label', `${l.label}, ${series[val.serie].nom} : ${fmt(val.v)}${unite}`);
        g.addEventListener('mousemove', e => montrerTip(texte, e.clientX, e.clientY));
        g.addEventListener('mouseleave', cacherTip);
        if (onClick) {
          g.addEventListener('click', () => onClick(val.cle));
          g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(val.cle); } });
        }
      });
    });
    cible.innerHTML = '';
    if (series.length > 1) cible.insertAdjacentHTML('beforeend', `<div class="chart-legend">${series.map(s => `<span><i style="background:${s.couleur}"></i>${esc(s.nom)}</span>`).join('')}</div>`);
    const defil = document.createElement('div'); defil.className = 'chart-scroll'; defil.appendChild(svg); cible.appendChild(defil);
  }

  function ligneMesure(m) {
    const p = m.p;
    const url = /^https?:/.test(p['URL primaire'] || '') ? ` · <a href="${esc(p['URL primaire'])}" target="_blank" rel="noopener noreferrer">source ↗</a>` : '';
    return `<li><span class="detail-amount">${fmt(m.v)} Md€</span> <span>${esc(p['Promesse (reformulation fidèle)'])}</span> <small>${esc(p['Thème'])} · ${esc(m.nat)} · ${esc(m.per)} · ${esc(p.ID)}${url}</small></li>`;
  }
  function detailBudget(cle) {
    const [c, per, s] = cle.split('||');
    const g = groupes[c];
    const liste = g.periodes[per][s].slice().sort((a, b) => b.v - a.v);
    const libS = s === 'cout' ? 'Coûts annoncés (dépenses nouvelles et baisses d’impôts)' : 'Financements annoncés (recettes nouvelles et économies)';
    $('g-budget-detail').innerHTML = `<h4>${esc(c)} — ${libS}</h4>
      <p class="chart-sub">${esc(per)} · total ${fmt(somme(liste))} Md€ sur ${liste.length} mesure${liste.length > 1 ? 's' : ''}.</p>
      <ul class="detail-list">${liste.map(ligneMesure).join('')}</ul>
      ${g.exclus.length ? `<details><summary>${g.exclus.length} montant(s) de ${esc(c)} non additionné(s)</summary><ul class="detail-list">${g.exclus.map(m => ligneMesure(m).replace('</small></li>', ` · <em>${esc(m.exclusion)}</em></small></li>`)).join('')}</ul></details>` : ''}`;
    $('g-budget-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function initBudget() {
    const lignes = [];
    for (const g of Object.values(groupes)) {
      for (const [per, v] of Object.entries(g.periodes)) {
        const vals = [];
        if (v.cout.length) vals.push({ v: somme(v.cout), serie: 0, cle: `${g.candidat}||${per}||cout` });
        else vals.push({ v: 0, serie: 0, cle: null });
        if (v.financement.length) vals.push({ v: somme(v.financement), serie: 1, cle: `${g.candidat}||${per}||financement` });
        else vals.push({ v: 0, serie: 1, cle: null });
        lignes.push({ label: g.candidat, sous: per, valeurs: vals });
      }
    }
    lignes.sort((a, b) => a.label.split(' ').pop().localeCompare(b.label.split(' ').pop(), 'fr'));
    $('g-budget').setAttribute('aria-label', 'Coûts et financements annoncés par personnalité, en milliards d’euros par an');
    barresHorizontales($('g-budget'), lignes, {
      series: [{ nom: 'Coûts annoncés', couleur: COUT }, { nom: 'Financements annoncés', couleur: FINANCEMENT }],
      unite: ' Md€', onClick: cle => cle && detailBudget(cle),
    });
    const sans = D.inventaire.map(i => i['Personnalité']).filter(n => nbProps[n] && !(groupes[n] && Object.keys(groupes[n].periodes).length));
    const partiels = Object.values(groupes).filter(g => !Object.keys(g.periodes).length);
    $('g-budget').insertAdjacentHTML('beforeend', `<p class="chart-note">Années de référence différentes selon les programmes (indiquées sous chaque nom) : à lire programme par programme. ` +
      (sans.length ? `Pas de montant annuel comparable relevé pour : ${esc(sans.join(', '))}.` : '') +
      (partiels.length ? ` <button type="button" class="text-button" id="g-budget-exclus">Voir leurs montants non annuels</button>` : '') + `</p>` +
      tableau(['Personnalité', 'Période', 'Coûts (Md€)', 'Financements (Md€)'], lignes.map(l => [l.label, l.sous, fmt(l.valeurs[0].v), fmt(l.valeurs[1].v)])));
    const b = $('g-budget-exclus');
    if (b) b.addEventListener('click', () => {
      $('g-budget-detail').innerHTML = `<h4>Montants annoncés mais non additionnés</h4><p class="chart-sub">Versements uniques, montants pluriannuels ou objectifs globaux : ils ne se cumulent pas avec des montants annuels.</p>` +
        partiels.map(g => `<h5>${esc(g.candidat)}</h5><ul class="detail-list">${g.exclus.map(m => ligneMesure(m).replace('</small></li>', ` · <em>${esc(m.exclusion)}</em></small></li>`)).join('')}</ul>`).join('');
    });
  }

  function tableau(entetes, lignes) {
    return `<details class="chart-table"><summary>Voir les données en tableau</summary><table><thead><tr>${entetes.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${lignes.map(l => `<tr>${l.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  }

  // ---------- Graphique 2 : camembert des coûts par thème ----------
  function initCamembert() {
    const candidats = Object.values(groupes).filter(g => Object.values(g.periodes).some(v => v.cout.length)).map(g => g.candidat)
      .sort((a, b) => a.split(' ').pop().localeCompare(b.split(' ').pop(), 'fr'));
    const sel = $('g-camembert-candidat');
    if (!candidats.length) { $('g-camembert').innerHTML = '<p class="no-data">Aucun coût annuel relevé.</p>'; sel.disabled = true; return; }
    sel.innerHTML = candidats.map(c => `<option>${esc(c)}</option>`).join('');
    const rendre = () => {
      const g = groupes[sel.value];
      const [per, v] = Object.entries(g.periodes).find(([, x]) => x.cout.length);
      const parTheme = {};
      for (const m of v.cout) parTheme[m.p['Thème']] = (parTheme[m.p['Thème']] || 0) + m.v;
      let parts = Object.entries(parTheme).sort((a, b) => b[1] - a[1]);
      if (parts.length > SERIES.length) { const reste = parts.slice(SERIES.length - 1); parts = parts.slice(0, SERIES.length - 1).concat([['Autres thèmes', somme(reste.map(([, x]) => ({ v: x })))]]); }
      const total = parts.reduce((a, [, x]) => a + x, 0);
      const R = 90, r0 = 52, C = 110;
      const svg = svgEl('svg', { viewBox: '0 0 220 220', class: 'chart-svg donut', role: 'img', 'aria-label': `Coûts annoncés de ${sel.value} par thème` });
      let a0 = -Math.PI / 2;
      parts.forEach(([theme, x], i) => {
        const a1 = a0 + (x / total) * Math.PI * 2;
        const couleur = theme === 'Autres thèmes' ? AUTRES : SERIES[i];
        const grand = a1 - a0 > Math.PI ? 1 : 0;
        const pt = (rr, a) => `${C + rr * Math.cos(a)},${C + rr * Math.sin(a)}`;
        const d = parts.length === 1 ? `M${C - R},${C}a${R},${R} 0 1 0 ${2 * R},0a${R},${R} 0 1 0 -${2 * R},0zM${C - r0},${C}a${r0},${r0} 0 1 1 ${2 * r0},0a${r0},${r0} 0 1 1 -${2 * r0},0z`
          : `M${pt(R, a0)}A${R},${R} 0 ${grand} 1 ${pt(R, a1)}L${pt(r0, a1)}A${r0},${r0} 0 ${grand} 0 ${pt(r0, a0)}z`;
        const path = svgEl('path', { d, fill: couleur, class: 'slice', 'fill-rule': 'evenodd' }, svg);
        const texte = `<strong>${esc(theme)}</strong><br>${fmt(x)} Md€ · ${Math.round((x / total) * 100)} %`;
        path.addEventListener('mousemove', e => montrerTip(texte, e.clientX, e.clientY));
        path.addEventListener('mouseleave', cacherTip);
        a0 = a1;
      });
      svgEl('text', { x: C, y: C - 2, class: 'donut-total', 'text-anchor': 'middle' }, svg).textContent = `${fmt(total)} Md€`;
      svgEl('text', { x: C, y: C + 16, class: 'axis', 'text-anchor': 'middle' }, svg).textContent = 'par an';
      $('g-camembert').innerHTML = '';
      const box = document.createElement('div'); box.className = 'donut-box'; box.appendChild(svg);
      box.insertAdjacentHTML('beforeend', `<ul class="donut-legend">${parts.map(([theme, x], i) => `<li><i style="background:${theme === 'Autres thèmes' ? AUTRES : SERIES[i]}"></i><span>${esc(theme)}</span><strong>${fmt(x)} Md€</strong><small>${Math.round((x / total) * 100)} %</small></li>`).join('')}</ul>`);
      $('g-camembert').appendChild(box);
      $('g-camembert').insertAdjacentHTML('beforeend', `<p class="chart-note">${esc(per)} · ${v.cout.length} mesure(s) chiffrée(s). Les mesures sans montant ne figurent pas ici.</p>` +
        tableau(['Thème', 'Md€ par an', 'Part'], parts.map(([t, x]) => [t, fmt(x), Math.round((x / total) * 100) + ' %'])));
    };
    sel.addEventListener('change', rendre);
    rendre();
  }

  // ---------- Graphiques 3 et 4 : nombre de propositions ----------
  function initPropositions() {
    const lignes = Object.entries(nbProps).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ label: c, valeurs: [{ v: n, serie: 0 }] }));
    $('g-propositions').setAttribute('aria-label', 'Nombre de propositions relevées par personnalité');
    barresHorizontales($('g-propositions'), lignes, { series: [{ nom: 'Propositions relevées', couleur: COUT }], unite: '', largeurLabel: 170 });
    $('g-propositions').insertAdjacentHTML('beforeend', tableau(['Personnalité', 'Propositions relevées'], lignes.map(l => [l.label, l.valeurs[0].v])));
  }
  function initThemes() {
    const sel = $('g-themes-candidat');
    sel.insertAdjacentHTML('beforeend', Object.keys(nbProps).sort((a, b) => a.split(' ').pop().localeCompare(b.split(' ').pop(), 'fr')).map(c => `<option>${esc(c)}</option>`).join(''));
    const rendre = () => {
      const parTheme = {};
      for (const p of D.promesses) if (!sel.value || p['Candidat'] === sel.value) parTheme[p['Thème']] = (parTheme[p['Thème']] || 0) + 1;
      const lignes = Object.entries(parTheme).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: t, valeurs: [{ v: n, serie: 0 }] }));
      $('g-themes').setAttribute('aria-label', 'Nombre de propositions par thème');
      barresHorizontales($('g-themes'), lignes, { series: [{ nom: 'Propositions', couleur: COUT }], unite: '', largeurLabel: 170 });
      $('g-themes').insertAdjacentHTML('beforeend', tableau(['Thème', 'Propositions'], lignes.map(l => [l.label, l.valeurs[0].v])));
    };
    sel.addEventListener('change', rendre);
    rendre();
  }

  document.addEventListener('DOMContentLoaded', () => {
    try { initTuiles(); } catch (e) { console.error('Tuiles', e); }
    try { initBudget(); } catch (e) { console.error('Budget', e); }
    try { initCamembert(); } catch (e) { console.error('Camembert', e); }
    try { initPropositions(); } catch (e) { console.error('Propositions', e); }
    try { initThemes(); } catch (e) { console.error('Thèmes', e); }
  });
})();
