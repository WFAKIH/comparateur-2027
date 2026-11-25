/* Le comparateur 2027 — site statique, données locales, aucune collecte de données. */
(() => {
  'use strict';
  const DB = window.DATA_2027;
  if (!DB) { document.body.innerHTML = '<p>Données introuvables : vérifiez que data.js est dans le même dossier que index.html.</p>'; return; }
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safe = value => { try { const u = new URL(String(value)); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const link = (url, label='Voir la source ↗') => safe(url) ? `<a href="${esc(safe(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '<span>Source indisponible</span>';
  const fmt = n => Number(n).toLocaleString('fr-FR', {maximumFractionDigits:2});
  const euro = n => Number(n).toLocaleString('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
  const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a,b) => a.localeCompare(b,'fr'));
  const names = unique(DB.promesses.map(p=>p['Candidat']));
  const themes = unique(DB.promesses.map(p=>p['Thème']));
  const fiche = Object.fromEntries(DB.fiches.map(f=>[f['Candidat'],f]));
  const inventory = Object.fromEntries(DB.inventaire.map(i=>[i['Personnalité'],i]));
  let compareA='Jean-Luc Mélenchon', compareB='Marine Le Pen', theme='Pouvoir d’achat';
  let moreA=false, moreB=false, promisesVisible=10, voteVisible=6;

  const option = (v, lbl=v) => `<option value="${esc(v)}">${esc(lbl)}</option>`;
  const setupSelect = (id, options, selected) => { const el=$(id); el.innerHTML=options.map(x=>Array.isArray(x)?option(x[0],x[1]):option(x)).join(''); if (selected!==undefined) el.value=selected; };
  const $profile = (p) => {const inv=inventory[p]||{}, f=fiche[p]||{}; return {party:inv['Organisation']||DB.promesses.find(x=>x['Candidat']===p)?.['Parti']||'',state:inv['Situation']||'',document:inv['Statut du programme']||'',count:DB.promesses.filter(x=>x['Candidat']===p).length, f};};
  const getSourceBadge=(p)=>p['Statut documentaire']||'Origine non précisée';
  const hasValue=p=>typeof p['Valeur Md€']==='number'&&Number.isFinite(p['Valeur Md€']);
  const valueText=p=>hasValue(p) ? `${fmt(p['Valeur Md€'])} Md€${p['Période / unité'] && p['Période / unité']!=='ND' ? ' · '+p['Période / unité'] : ''}` : 'Montant non chiffré ici';

  function init(){
    $('hero-count').textContent=fmt(DB.promesses.length);
    $('hero-candidates').textContent=names.length;
    $('hero-themes').textContent=themes.length;
    const ed=DB.meta?.edition; if(ed){const d=new Date(ed+'T12:00:00'),long=d.toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});$('edition-long').textContent='ÉDITION DU '+long.toUpperCase();$('edition-court').textContent='ÉDITION : '+d.toLocaleDateString('fr-FR').replaceAll('/','.');$('edition-methode').textContent=long;}
    const params=new URLSearchParams(location.search);
    if(names.includes(params.get('a')))compareA=params.get('a');
    if(names.includes(params.get('b')))compareB=params.get('b');
    if(themes.includes(params.get('t')))theme=params.get('t');
    setupSelect('candidate-a',names,compareA);setupSelect('candidate-b',names,compareB);
    setupSelect('compare-theme',themes,theme);
    for (const id of ['candidate-a','candidate-b','compare-theme']) $(id).addEventListener('change', () => {
      compareA=$('candidate-a').value;compareB=$('candidate-b').value;theme=$('compare-theme').value;
      moreA=false;moreB=false;renderCompare();
    });
    $('share-link').addEventListener('click',async()=>{
      const u=new URL(location.href);u.searchParams.set('a',compareA);u.searchParams.set('b',compareB);u.searchParams.set('t',theme);u.hash='comparer';
      try{await navigator.clipboard.writeText(u.href);$('share-link').textContent='Lien copié ✓';}catch{prompt('Copiez ce lien :',u.href);}
      setTimeout(()=>$('share-link').textContent='Copier le lien de cette comparaison ↗',2000);
    });
    renderCompare();
    setupSelect('promise-person',[['Tous','Toutes les personnalités'],...names.map(n=>[n,n])],'Tous');
    setupSelect('promise-theme',[['Tous','Tous les thèmes'],...themes.map(t=>[t,t])],'Tous');
    ['promise-person','promise-theme'].forEach(id=>$(id).addEventListener('change',()=>{promisesVisible=10;renderPromises();}));
    $('promise-search').addEventListener('input',()=>{promisesVisible=10;renderPromises();});
    $('load-promises').addEventListener('click',()=>{promisesVisible+=12;renderPromises();});
    renderPromises();
    $('fraud-slider').addEventListener('input',renderCalculations);$('smic-slider').addEventListener('input',renderCalculations);renderCalculations();
    setupSelect('vote-person',[['Tous','Toutes les personnalités'],...names.map(n=>[n,n])],'Tous');
    $('vote-person').addEventListener('change',()=>{voteVisible=6;renderVotes();});
    renderVotes();initScrutins();initPolls();
  }

  function compareCard(p,i){
    const financing=p['Financement revendiqué']||'Financement non affecté dans le registre';
    const conditions=[p['Voie juridique'],p['Conditions de réalisation']].filter(Boolean).join(' · ');
    return `<article class="proposal">
      <div class="proposal-index">ENGAGEMENT ${String(i+1).padStart(2,'0')} · ${esc(p['ID'])}</div>
      <div class="proposal-title">${esc(p['Promesse (reformulation fidèle)'])}</div>
      <dl class="proposal-info"><dt>Public concerné</dt><dd>${esc(p['Public concerné']||'À déterminer')}</dd></dl>
      <dl class="proposal-info cost"><dt>Chiffrage</dt><dd><b>${esc(valueText(p))}</b><br>${esc(p['Nature du chiffrage']||'')} ${esc(p['Fiabilité du montant']||'')}</dd></dl>
      <dl class="proposal-info"><dt>Financement</dt><dd>${esc(financing)}</dd></dl>
      <dl class="proposal-info"><dt>Faisabilité</dt><dd>${esc(conditions||'Voie de réalisation non documentée')}</dd></dl>
      <dl class="proposal-info"><dt>À vérifier</dt><dd>${esc(p['Information manquante']||'Détails à compléter')}</dd></dl>
      <div class="proposal-source"><span>${esc(p['Date publication']||'Date ND')} · ${esc(getSourceBadge(p))}</span>${link(p['URL primaire'])}</div>
    </article>`;
  }
  function compareColumn(name, which, expanded){
    const data=DB.promesses.filter(p=>p['Candidat']===name&&p['Thème']===theme);
    const profile=$profile(name);const initials=name.split(' ').map(x=>x[0]).slice(0,2).join('');
    const display=expanded?data:data.slice(0,3);
    return `<div class="compare-column column-${which}"><div class="column-head"><div class="avatar" aria-hidden="true">${esc(initials)}</div><div><strong>${esc(name)}</strong><span>${esc(profile.party)} · ${esc(profile.document||'Documentation partielle')}</span></div><span class="column-count">${data.length} relevée${data.length>1?'s':''}</span></div>
     ${data.length?display.map(compareCard).join(''):`<div class="no-data"><strong>Aucune proposition extraite sur ce thème.</strong><p>Cela ne signifie pas que ${esc(name)} ne s'est pas exprimé sur le sujet. Le dépouillement de cette édition est partiel.</p>${link(inventory[name]?.['Source datée / URL'],'État du dossier ↗')}</div>`}
     ${data.length>3?`<button class="more-button" type="button" data-expand="${which}">${expanded?'Réduire la liste ↑':`Voir les ${data.length-3} autres propositions ↓`}</button>`:''}
    </div>`;
  }
  function renderCompare(){
    $('compare-title').textContent=`${theme} : ce que disent les documents`;
    $('compare-summary').textContent=`${compareA} · ${compareB} · ${theme}`;
    $('compare-results').innerHTML=compareColumn(compareA,'a',moreA)+compareColumn(compareB,'b',moreB);
    $('compare-results').querySelectorAll('[data-expand]').forEach(btn=>btn.addEventListener('click',()=>{if(btn.dataset.expand==='a')moreA=!moreA;else moreB=!moreB;renderCompare();}));
    renderCoverage();
  }
  function renderCoverage(){
    const tally=n=>Object.fromEntries(themes.map(t=>[t,DB.promesses.filter(p=>p['Candidat']===n&&p['Thème']===t).length]));
    const a=tally(compareA),b=tally(compareB);
    const selected=themes.filter(t=>(a[t]+b[t])>0).sort((x,y)=>(a[y]+b[y])-(a[x]+b[x])).slice(0,9);
    const max=Math.max(1,...selected.map(t=>Math.max(a[t],b[t])));
    $('coverage-bars').innerHTML=selected.map(t=>`<div class="coverage-row"><div class="coverage-name">${esc(t)}</div><div style="display:flex;align-items:center"><div class="smallbar" style="flex:1"><i style="width:${100*a[t]/max}%"></i></div><span class="coverage-count">${a[t]}</span></div><div style="display:flex;align-items:center"><div class="smallbar alt" style="flex:1"><i style="width:${100*b[t]/max}%"></i></div><span class="coverage-count">${b[t]}</span></div></div>`).join('')+`<div class="cover-legend"><span><i style="background:#1d8380"></i>${esc(compareA)}</span><span><i style="background:#d6ac8d"></i>${esc(compareB)}</span></div>`;
  }
  function renderPromises(){
    const p=$('promise-person').value,t=$('promise-theme').value,q=$('promise-search').value.trim().toLocaleLowerCase('fr');
    const data=DB.promesses.filter(x=>(p==='Tous'||x['Candidat']===p)&&(t==='Tous'||x['Thème']===t)&&(!q||[x['Promesse (reformulation fidèle)'],x['Candidat'],x['Thème'],x['Public concerné'],x['Financement revendiqué']].join(' ').toLocaleLowerCase('fr').includes(q)));
    $('promise-count').textContent=`${data.length} résultat${data.length>1?'s':''} dans le registre`;
    $('promise-results').innerHTML=data.slice(0,promisesVisible).map(x=>`<article class="promise-card"><div class="promise-labels"><span class="tag">${esc(x['Thème'])}</span><span class="tag neutral">${esc(x['Candidat'])}</span>${hasValue(x)?'<span class="tag warm">Montant mentionné</span>':''}</div><h3>${esc(x['Promesse (reformulation fidèle)'])}</h3><p class="micro"><strong>À qui ?</strong> ${esc(x['Public concerné']||'À préciser')}<br><strong>Coût / montant :</strong> ${esc(valueText(x))}${x['Nature du chiffrage']?' · '+esc(x['Nature du chiffrage']):''}<br><strong>Conditions :</strong> ${esc(x['Conditions de réalisation']||x['Voie juridique']||'Non documentées')}</p><div class="promise-metadata"><span><b>Origine :</b> ${esc(x['Statut documentaire']||'ND')}</span><span><b>Date :</b> ${esc(x['Date publication']||'ND')}</span></div><footer><span>Référence ${esc(x['ID'])}</span>${link(x['URL primaire'],'Document original ↗')}</footer></article>`).join('') || '<div class="no-data">Aucun résultat. Essayez un autre thème ou terme de recherche.</div>';
    $('load-promises').classList.toggle('hidden',promisesVisible>=data.length);
  }
  function renderCalculations(){
    const pct=Number($('fraud-slider').value),rec=3.5*pct/100,gap=Math.max(0,10.96-rec);
    $('fraud-value').textContent=`${fmt(pct)} %`;
    $('fraud-amount').textContent=`${fmt(rec)} Md€/an`;
    $('fraud-bar').style.width=`${Math.min(100,100*rec/10.96)}%`;
    $('fraud-gap').innerHTML=`${esc(fmt(gap))} <small>Md€/an</small>`;
    const current=Number($('smic-slider').value),dif=1700-current;
    $('smic-value').textContent=euro(current);$('smic-before').textContent=euro(current);
    $('smic-gap').innerHTML=`${esc((dif>=0?'+':'')+fmt(dif))} <small>€/mois</small>`;
  }
  function normalizeVotes(){
    const a=DB.recoupements.map(x=>({name:x['Candidat'],topic:x['Sujet'],headline:x['Engagement à analyser'],scrutin:x['Scrutin'],fact:x['Bulletins enregistrés'],relation:x['Relation factuelle au sujet'],reservation:x['Ce que le vote ne démontre pas'],url:x['URL du scrutin']}));
    const b=DB.recoupements_plus.map(x=>({name:x['Candidat'],topic:x['Sujet'],headline:x['Engagement ou sujet'],scrutin:x['Scrutin'],fact:x['Fait enregistré'],relation:'',reservation:x['Précaution'],url:x['Source nominat.']}));
    return [...a,...b];
  }
  const recoup=normalizeVotes();
  function renderVotes(){
    const person=$('vote-person').value;
    const rows=recoup.filter(x=>person==='Tous'||x.name===person);
    $('votes-count').textContent=`${rows.length} rapprochements documentés`;
    $('votes-results').innerHTML=rows.slice(0,voteVisible).map(x=>`<article class="vote-card"><div class="line1"><span>${esc(x.name)}</span><span>·</span><span>${esc(x.topic||'Scrutin')}</span><span>·</span><span>${esc(x.scrutin||'')}</span></div><h3>${esc(x.headline||'Sujet à étudier')}</h3><p><strong>Fait enregistré.</strong> ${esc(x.fact||'À préciser')}${x.relation?' · '+esc(x.relation):''}</p><p class="restraint"><strong>Limite de lecture.</strong> ${esc(x.reservation||'Contexte du scrutin à étudier')}</p>${link(x.url,'Lire le scrutin ↗')}</article>`).join('')||'<div class="vote-card">Aucun rapprochement extrait pour cette personne. Cela ne donne pas d’indication sur son comportement de vote.</div>';
    if(rows.length>voteVisible){const div=document.createElement('div');div.className='load-row';div.style.gridColumn='1 / -1';div.innerHTML='<button class="btn btn-light" type="button">Afficher d’autres scrutins ↓</button>';$('votes-results').appendChild(div);div.querySelector('button').addEventListener('click',()=>{voteVisible+=8;renderVotes();});}
  }
  const fr=DB.votes_fr.map(x=>({id:x['Scrutin'],date:x['Date'],subject:x['Objet / texte'],group:x['Groupe à la date'],for:Number(x['Pour']||0),against:Number(x['Contre']||0),abst:Number(x['Abst.']||0),person:x['Candidat siégeant / vote'],link:x['Lien registre'],precaution:x['Limite de lecture'],institution:x['Institution']}));
  const ue=DB.votes_ue.map(x=>({id:x['ID'],date:x['Date'],subject:x['Texte européen'],group:x['Groupe historique'],for:Number(x['Pour']||0),against:Number(x['Contre']||0),abst:Number(x['Abst.']||0),person:x['Vote personnel vérifié'],link:x['Registre Parlement UE'],precaution:x['Réserve analytique'],institution:'Parlement européen'}));
  const allVotes=[...fr,...ue];
  function initScrutins(){
    const ids=unique(allVotes.map(x=>x.id));
    setupSelect('scrutin-selector',ids.map(id=>{const v=allVotes.find(x=>x.id===id);return [id,`${v.institution==='Parlement européen'?'UE':'AN'} · ${v.date} · ${v.subject.slice(0,56)}`]}),ids.includes('AN3213')?'AN3213':ids[0]);
    $('scrutin-selector').addEventListener('change',renderScrutin);renderScrutin();
  }
  function renderScrutin(){
    const id=$('scrutin-selector').value,rows=allVotes.filter(x=>x.id===id),m=rows[0];if(!m)return;
    const source=safe(m.link);
    $('scrutin-details').innerHTML=`<p class="scrutin-text"><b>${esc(m.date)} · ${esc(m.institution)}</b> — ${esc(m.subject)}. ${link(source,'Consulter le relevé ↗')}</p><div class="scrutin-rows">${rows.map(x=>{const total=x.for+x.against+x.abst||1;return `<div class="scrutin-row"><div class="scrutin-name">${esc(x.group)}</div><div class="vote-track" aria-label="Pour ${x.for}, contre ${x.against}, abstentions ${x.abst}"><i class="for" style="width:${100*x.for/total}%"></i><i class="against" style="width:${100*x.against/total}%"></i><i class="abst" style="width:${100*x.abst/total}%"></i></div><div class="scrutin-count">${x.for} / ${x.against} / ${x.abst}</div></div>`}).join('')}</div>`;
  }
  function initPolls(){
    const groups=new Map();
    for(const x of DB.sondages){const k=x['Code scénario'];if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x);}
    window.POLL_GROUPS=groups;
    const labels=[...groups.entries()].map(([k,rows])=>{const x=rows[0];return [k,`${x['Terrain fin']} · ${x['Institut']} · ${x['Tour']} · ${x['Configuration exacte']} (${k})`];});
    labels.sort((a,b)=>b[1].localeCompare(a[1]));
    const defaultKey=labels.find(z=>z[1].includes('Ifop-Fiducial')&&z[1].includes('1er tour'))?.[0]||labels[0]?.[0];
    setupSelect('poll-selector',labels,defaultKey);
    $('poll-selector').addEventListener('change',renderPoll);renderPoll();
  }
  function renderPoll(){
    const rows=window.POLL_GROUPS?.get($('poll-selector').value)||[];if(!rows.length)return;const m=rows[0];
    const candidates=rows.filter(x=>typeof x['% exprimés']==='number'&&x['Candidat testé']).sort((a,b)=>b['% exprimés']-a['% exprimés']);
    const max=Math.max(1,...candidates.map(x=>x['% exprimés']));
    $('poll-title').textContent=m['Tour']==='2nd tour'?'Hypothèse de second tour':'Intentions de premier tour';
    $('poll-base').textContent='En % des intentions exprimées';
    $('poll-bars').innerHTML=candidates.map(x=>`<div class="poll-row"><span class="poll-name" title="${esc(x['Candidat testé'])}">${esc(x['Candidat testé'])}</span><div class="poll-bar"><i style="width:${Math.max(0,x['% exprimés']/max*100)}%"></i></div><span class="poll-number">${fmt(x['% exprimés'])} %</span></div>`).join('');
    const fields=[['INSTITUT',m['Institut']],['COMMANDITAIRE',m['Commanditaire']],['TERRAIN',`${m['Terrain début']} → ${m['Terrain fin']}`],['CONFIGURATION',m['Configuration exacte']],['ÉCHANTILLON',`${m['N adultes']||'ND'} adultes · ${m['N inscrits']||'ND'} inscrits · ${m['N utiles exprimés']||'ND'} répondants exprimés`],['MARGE PUBLIÉE',m['Marge publiée / remarque']||'À vérifier'],['SANS INTENTION',m['Sans intention (%)']===undefined?'ND':`${m['Sans intention (%)']} % (autre base)`]];
    $('poll-info').innerHTML=`<h3>Fiche de l’enquête</h3>${fields.map(x=>`<div class="poll-fact"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join('')}<div class="source-line">${link(m['Notice primaire / URL'],'Lire la notice originale ↗')}</div><p>Ne reliez pas deux scénarios qui n’ont pas la même liste de candidats et le même protocole. Il ne s’agit pas d’un pronostic.</p>`;
  }
  const CFG = window.CONFIG_2027 || {};
  // Loi du 19 juillet 1977 : pas de sondage publié la veille ni le jour d'un tour de scrutin (heure de Paris).
  function periodeReserve(){
    const jour=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Paris'});
    return (CFG.tours||[]).some(t=>{const d=new Date(t+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return jour===t||jour===d.toISOString().slice(0,10);});
  }
  function initSignalement(){
    const form=$('signalement'); if(!form) return;
    const etat=$('sig-etat');
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const fd=new FormData(form);
      if(fd.get('site_web')) return; // piège à robots
      const corps={message:String(fd.get('message')||'').trim(),reference:String(fd.get('reference')||'').trim()||null,source_url:String(fd.get('source_url')||'').trim()||null,contact:String(fd.get('contact')||'').trim()||null};
      if(corps.message.length<10){etat.textContent='Merci de décrire l’erreur en quelques mots (10 caractères minimum).';return;}
      if(corps.source_url&&!safe(corps.source_url)){etat.textContent='La source doit être une adresse commençant par http:// ou https://.';return;}
      if(!CFG.supabaseUrl||!CFG.supabaseAnonKey){etat.textContent='Le formulaire n’est pas encore actif sur cette version du site.';return;}
      const btn=form.querySelector('button[type=submit]');btn.disabled=true;etat.textContent='Envoi…';
      try{
        const r=await fetch(`${CFG.supabaseUrl}/rest/v1/signalements`,{method:'POST',headers:{'Content-Type':'application/json',apikey:CFG.supabaseAnonKey,...(CFG.supabaseAnonKey.startsWith('sb_')?{}:{Authorization:`Bearer ${CFG.supabaseAnonKey}`}),Prefer:'return=minimal'},body:JSON.stringify(corps)});
        if(!r.ok) throw new Error(r.status);
        form.reset();etat.textContent='Merci, votre signalement a bien été transmis. Il sera vérifié avant toute correction.';
      }catch{etat.textContent='L’envoi a échoué. Réessayez plus tard.';}
      finally{btn.disabled=false;}
    });
  }
  function initReserve(){
    if(!periodeReserve()) return;
    $('sondages-reserve').classList.remove('hidden');$('sondages-contenu').classList.add('hidden');
  }
  document.addEventListener('DOMContentLoaded',()=>{init();initSignalement();initReserve();});
})();
