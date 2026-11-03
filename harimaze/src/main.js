// ---------------------------------------------------------------------------
// Views: routing, atlas rendering, Max downloads.
// ---------------------------------------------------------------------------
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const VIEWS=['map','artists','ideas','techniques','gear','lab','max','sources'];
const A=Object.fromEntries(ARTISTS.map(a=>[a.id,a]));

function show(view){
  if(!VIEWS.includes(view))view='map';
  document.querySelectorAll('.view').forEach(v=>v.hidden=v.dataset.view!==view);
  document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.view===view));
  if(view==='lab')requestAnimationFrame(()=>drawScope());
  try{localStorage.setItem('harimaze.view',view)}catch(e){}
}
function go(view){if(location.hash!=='#'+view)location.hash=view;else show(view);window.scrollTo({top:0})}
function openArtist(id){
  go('artists');filt.group='all';filt.tag='all';renderFilters();applyFilter();
  const el=$('a-'+id);if(!el)return;el.open=true;requestAnimationFrame(()=>el.scrollIntoView({block:'start',behavior:'smooth'}));
}
function openMachine(key){go('lab');selectMachine(key)}
const artistChip=id=>`<span class="chip m" role="button" tabindex="0" data-artist="${id}">${esc(A[id].name)}</span>`;
const machineChip=k=>`<span class="chip m" role="button" tabindex="0" data-machine="${k}">▶ ${MACH[k]} ${k}</span>`;
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-artist]');if(a){e.preventDefault();openArtist(a.dataset.artist);return}
  const m=e.target.closest('[data-machine]');if(m){e.preventDefault();e.stopPropagation();openMachine(m.dataset.machine)}
});
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const t=e.target.closest('[data-artist],[data-machine]');if(t){e.preventDefault();t.click()}});

// ---------- map ----------
function renderLineage(){
  const cols={pre:['tone','oval','otomo','jeck','jelinek','takemura','fennesz','rabelais'],now:['huerco','ulla','pontiac','sgdj','bondy','perila'],edge:['rousay','lambkin','spaceafrika','klein','muir','sugai','kmru']};
  const X={pre:16,now:350,edge:684},NW=228,NH=40,GAP=54,TOP=46,pos={};
  const label={pre:'先行世代',now:'3XL・West Mineral 周辺',edge:'周縁：日記・声・場所'};
  for(const c in cols){const off=(8-cols[c].length)*GAP/2;cols[c].forEach((id,i)=>pos[id]={x:X[c],y:TOP+off+i*GAP,col:c})}
  const H=TOP+8*GAP+6;
  let edges='',nums='';
  LINKS.forEach(([a,b,kind],i)=>{
    const p=pos[a],q=pos[b];let d,mx,my;
    if(p.col===q.col){const x=p.x+NW,y1=p.y+NH/2,y2=q.y+NH/2,bx=x+30+Math.abs(y2-y1)*0.06;d=`M${x} ${y1} C${bx} ${y1} ${bx} ${y2} ${x} ${y2}`;mx=x+(bx-x)*0.75;my=(y1+y2)/2}
    else{const L=p.x<q.x?p:q,R=p.x<q.x?q:p,x1=L.x+NW,y1=L.y+NH/2,x2=R.x,y2=R.y+NH/2,c=(x2-x1)*0.5;d=`M${x1} ${y1} C${x1+c} ${y1} ${x2-c} ${y2} ${x2} ${y2}`;mx=(x1+x2)/2;my=(y1+y2)/2}
    edges+=`<path class="edge ${kind}" data-e="${i}" d="${d}"/>`;
    nums+=`<g data-e="${i}"><circle class="numbg ${kind}" cx="${mx}" cy="${my}" r="8"/><text class="num" x="${mx}" y="${my+3.5}" text-anchor="middle">${i+1}</text></g>`;
  });
  let nodes='';
  for(const id in pos){const p=pos[id],a=A[id];nodes+=`<g class="node" tabindex="0" role="button" data-artist="${id}" aria-label="${esc(a.name)}のカードを開く"><rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="4"/><text x="${p.x+12}" y="${p.y+17}">${esc(a.name)}</text><text class="k" x="${p.x+12}" y="${p.y+32}">${esc(a.kana.length>26?a.kana.slice(0,25)+'…':a.kana)}</text></g>`}
  const heads=Object.entries(X).map(([c,x])=>`<text class="col" x="${x}" y="22">${label[c]}</text>`).join('');
  $('lineage').innerHTML=`<svg viewBox="0 0 960 ${H}" role="img" aria-label="作家の系譜図">${heads}${edges}${nodes}${nums}</svg>`;
  $('links').innerHTML=LINKS.map(([a,b,kind,t],i)=>`<li class="${kind}" data-e="${i}"><i>${i+1}</i><span>${esc(t)}</span></li>`).join('');
  const hot=(i,on)=>document.querySelectorAll(`#lineage path[data-e="${i}"]`).forEach(p=>p.classList.toggle('hot',on));
  document.querySelectorAll('#links li,#lineage g[data-e]').forEach(el=>{el.addEventListener('mouseenter',()=>hot(el.dataset.e,true));el.addEventListener('mouseleave',()=>hot(el.dataset.e,false))});
}

// ---------- artists ----------
const filt={group:'all',tag:'all'};
function renderFilters(){
  const g=[['all','すべて'],...Object.entries(GROUPS)],t=[['all','すべて'],...Object.entries(TAGS)];
  $('f-group').innerHTML='<span class="lab">系譜</span>'+g.map(([k,n])=>`<button class="fbtn" data-g="${k}" aria-pressed="${filt.group===k}">${n}</button>`).join('');
  $('f-tag').innerHTML='<span class="lab">手法</span>'+t.map(([k,n])=>`<button class="fbtn" data-t="${k}" aria-pressed="${filt.tag===k}">${n}</button>`).join('');
  $('f-group').querySelectorAll('button').forEach(b=>b.onclick=()=>{filt.group=b.dataset.g;renderFilters();applyFilter()});
  $('f-tag').querySelectorAll('button').forEach(b=>b.onclick=()=>{filt.tag=b.dataset.t;renderFilters();applyFilter()});
}
function applyFilter(){
  let n=0;document.querySelectorAll('#cards .card').forEach(c=>{const a=A[c.dataset.id];const ok=(filt.group==='all'||a.group===filt.group)&&(filt.tag==='all'||a.tags.includes(filt.tag));c.hidden=!ok;if(ok)n++});
  let e=$('cards-empty');if(!n){if(!e){e=document.createElement('p');e.id='cards-empty';e.className='empty';$('cards').after(e)}e.textContent='この組み合わせに当てはまる作家はいません。手法か系譜を「すべて」に戻してください。';e.hidden=false}else if(e)e.hidden=true;
}
function ideasHTML(list){return list.map(x=>typeof x==='string'?`<li>${esc(x)}</li>`:`<blockquote lang="en">“${esc(x.q)}”</blockquote>`).join('')}
function renderCards(){
  $('cards').innerHTML=ARTISTS.map(a=>`<details class="card" id="a-${a.id}" data-id="${a.id}">
    <summary><div><h3>${esc(a.name)}</h3><div class="kana">${esc(a.kana)}</div></div><span class="grp">${esc(GROUPS[a.group])}</span>
      <div class="meta">${esc(a.meta)}</div><p class="sum">${esc(a.sum)}</p>
      <div class="chips">${a.tags.map(t=>`<span class="chip">${TAGS[t]}</span>`).join('')}</div><span class="more">開く ↓</span></summary>
    <div class="body">
      <div><h4>手法</h4><ul>${a.method.map(m=>`<li>${esc(m)}</li>`).join('')}</ul></div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div><h4>主な作品</h4><ul class="works">${a.works.map(([w,y])=>`<li>${esc(w)}${y?` <em>${esc(y)}</em>`:''}</li>`).join('')}</ul></div>
        <div><h4>道具</h4><ul><li>${esc(a.tools)}</li></ul></div>
        <div><h4>考え方</h4><ul style="list-style:none;padding:0">${ideasHTML(a.ideas)}</ul></div>
        <div><h4>近いマシン</h4><div class="chips">${a.machines.map(machineChip).join('')}</div></div>
      </div>
      <div style="grid-column:1 / -1"><h4>出典</h4><ul class="src">${a.src.map(([t,u])=>`<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul></div>
      <button class="close" type="button">閉じる</button>
    </div></details>`).join('');
  $('cards').querySelectorAll('.close').forEach(b=>b.onclick=()=>{const d=b.closest('details');d.open=false;d.scrollIntoView({block:'nearest'})});
}

// ---------- ideas / techniques / gear ----------
function renderIdeas(){
  $('ideas').innerHTML=IDEAS.map(x=>`<article class="sheet idea"><h3><small>${esc(x.en)}</small>${esc(x.t)}</h3><p>${esc(x.p)}</p>
    <div class="foot">${x.a.map(artistChip).join('')}${x.m.map(machineChip).join('')}</div></article>`).join('');
  $('techs').innerHTML=TECHS.map(x=>`<article class="sheet idea tech"><h3><small>${esc(x.en)}</small>${esc(x.t)}</h3><p>${esc(x.w)}</p>
    <ol>${x.s.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><div class="who">参照：${esc(x.who)}</div><div class="foot">${x.m.map(machineChip).join('')}</div></article>`).join('');
  let last='';
  $('gear').querySelector('tbody').innerHTML=GEAR.map(([c,t,w,u,s])=>{const cc=c===last?'':c;last=c;return `<tr><td class="cat">${esc(cc)}</td><td>${esc(t)}</td><td>${esc(w)}</td><td>${esc(u)}</td><td>${s?`<a href="${esc(s)}" target="_blank" rel="noopener">${esc(new URL(s).hostname.replace(/^www\./,''))}</a>`:'—'}</td></tr>`}).join('');
}

// ---------- max ----------
function renderPatches(){
  $('patches').innerHTML=MACHINE_DEFS.map(d=>`<article class="sheet patch"><h3>${esc(d.title)}</h3><div class="file">${esc(d.file)}</div>
    <p>${esc(d.concept.replace(/\n/g,''))}</p><p class="small">${esc(d.context)}</p>
    <div class="pl">params: ${d.params.map(p=>p.name).join(' · ')}</div>
    <div class="pl">presets: ${d.presets.map(p=>esc(p.name)).join(' · ')}</div>
    <div class="acts"><button class="btn" data-machine="${d.key}">▶ 実験室で鳴らす</button></div></article>`).join('');
}
let DL=null,DLP=null;
if(window.claude&&typeof window.claude.use==='function'){DLP=window.claude.use('downloads').then(x=>{DL=x;return x}).catch(()=>null)}
async function downloadZip(){
  const msg=$('dlmsg');
  const bytes=Uint8Array.from(atob(ZIP_B64),c=>c.charCodeAt(0));
  const blob=new Blob([bytes],{type:'application/zip'});
  const dl=DL||(DLP?await DLP:null);
  if(dl){
    try{await dl.save({filename:'harimaze-max.zip',data:blob});msg.textContent='保存しました。zip を展開して .maxpat を Max で開いてください。'}
    catch(e){const c=e&&e.code;msg.textContent=c==='declined'?'保存を取りやめました。':c==='rate_limited'?'保存の確認が開いています。少し待ってからもう一度押してください。':'この表示ではファイルを保存できません。チャットに添付したパッチを使ってください。'}
    return;
  }
  if(DLP){msg.textContent='この表示ではファイルを保存できません。チャットに添付したパッチを使ってください。';return}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='harimaze-max.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  msg.textContent='ダウンロードを始めました。';
}

// ---------- sources ----------
function renderSourceList(){
  $('srclist').innerHTML=ARTISTS.map(a=>`<div class="srcgrp"><h3>${esc(a.name)}</h3><ul>${a.src.map(([t,u])=>`<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul></div>`).join('');
}

// ---------- boot ----------
renderLineage();renderFilters();renderCards();applyFilter();renderIdeas();renderPatches();renderSourceList();
initLab();
$('dlzip').onclick=downloadZip;
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>go(b.dataset.view));
document.querySelectorAll('a.go').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();go(a.getAttribute('href').slice(1))}));
window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
show(location.hash.slice(1)||'map');
