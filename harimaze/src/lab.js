// ---------------------------------------------------------------------------
// Lab: runs the translated GenExpr machines. ENGINE is self-contained so it
// can be stringified into the AudioWorklet; the same class runs in a
// ScriptProcessor when worklets are unavailable.
// ---------------------------------------------------------------------------
function ENGINE(MACHINES){
  return class Engine{
    constructor(sr){this.sr=sr;this.m=null;this.name='';this.run=false;this.g=0;this.vol=0.7;this.trig=0;this.k=0}
    handle(d){
      if(d.t==='machine'){
        this.name=d.name;this.m=MACHINES[d.name](this.sr);
        const al={tsuioku:['tape',32],kodama:['dl',8]}[d.name];
        if(al){const n=Math.round(this.sr*al[1]);this.m.B[al[0]]={frames:n,channels:2,data:[new Float32Array(n),new Float32Array(n)]}}
      }else if(d.t==='param'){if(this.m&&(d.k in this.m.P))this.m.P[d.k]=d.v}
      else if(d.t==='buf'){if(this.m)this.m.B[d.k]={frames:d.frames,channels:d.data.length,data:d.data}}
      else if(d.t==='trig'){this.trig=32}
      else if(d.t==='run'){this.run=!!d.v}
      else if(d.t==='vol'){this.vol=d.v}
    }
    render(L,R,n){
      const m=this.m,target=this.run?this.vol:0;
      if(!m||(!this.run&&this.g<1e-4)){L.fill(0);R.fill(0);if(!this.run)this.g=0;return}
      const live=this.name==='tsuioku'||this.name==='hibiki'||this.name==='kodama',O=m.O;
      for(let i=0;i<n;i++){
        let a=0;if(!live&&this.trig>0){a=1;this.trig--}
        m.tick(a,0);
        this.g+=(target-this.g)*0.0015;
        let l=O[0],r=O[1];if(!(l>-4&&l<4))l=0;if(!(r>-4&&r<4))r=0;
        L[i]=l*this.g;R[i]=r*this.g;
      }
    }
    status(){
      const m=this.m;if(!m)return null;this.k++;
      const s={o3:m.O[2],o4:m.O[3]};
      if(this.name==='kiri'&&this.k%6===0){const p=m.B.pat.data;s.pat=[0,1,2,3,4].map(c=>Array.from(p[c]))}
      if(this.name==='tsuioku'&&this.k%25===0){
        const d=m.B.tape.data[0],n=d.length,c=240,e=new Array(c);
        for(let j=0;j<c;j++){let mx=0;const a=Math.floor(j*n/c),b=Math.floor((j+1)*n/c);for(let i=a;i<b;i+=8){const v=Math.abs(d[i]);if(v>mx)mx=v}e[j]=mx}
        s.tape=e;
      }
      return s;
    }
  };
}
const WSRC=MACHINES_SRC+`
const Engine=(${ENGINE.toString()})(MACHINES);
class HZProc extends AudioWorkletProcessor{
  constructor(){super();this.e=new Engine(sampleRate);this.n=0;this.port.onmessage=ev=>this.e.handle(ev.data)}
  process(ins,outs){const o=outs[0];this.e.render(o[0],o[1]||o[0],o[0].length);if(++this.n%4===0){const s=this.e.status();if(s)this.port.postMessage(s)}return true}
}
registerProcessor('harimaze',HZProc);`;

// ---------- demo sounds (synthesised, so the lab works without files) ----------
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
const mtof=m=>440*Math.pow(2,(m-69)/12);
function normalise(chs,peak){let mx=0;for(const c of chs)for(let i=0;i<c.length;i++){const v=Math.abs(c[i]);if(v>mx)mx=v}const g=mx>0?peak/mx:1;for(const c of chs)for(let i=0;i<c.length;i++)c[i]*=g;return chs}
function demoPiano(sr){
  // drumless: slow piano-like chords with a sparse melody over a quiet room tone
  const sec=10,n=Math.floor(sr*sec),L=new Float32Array(n),R=new Float32Array(n),r=rng(11);
  const note=(t0,m,vel,pan,len)=>{const f=mtof(m),s=Math.floor(t0*sr),e=Math.min(n,s+Math.floor(len*sr)),hs=[1,2,3,4].map(h=>2*Math.PI*f*h*Math.sqrt(1+0.0004*h*h)/sr);
    for(let i=s;i<e;i++){const k=i-s,x=k/sr;let v=0;for(let h=0;h<4;h++)v+=Math.sin(hs[h]*k)*Math.exp(-x*(1.1+h*1.1))/(h+1);v*=Math.min(1,x*300)*vel;L[i]+=v*(1-pan);R[i]+=v*(1+pan)}};
  const chords=[[50,57,62,64,69],[46,53,57,62,65],[43,50,57,58,62],[45,52,57,61,64]];
  chords.forEach((c,k)=>c.forEach((m,j)=>note(k*2.5+j*0.035+r()*0.01,m,0.32-j*0.03,(j/(c.length-1)-0.5)*0.6,2.6)));
  const mel=[[0.6,74],[1.4,76],[3.1,77],[3.9,74],[5.6,72],[6.3,69],[8.1,73],[8.8,76]];
  mel.forEach(([t,m],k)=>note(t+r()*0.04,m,0.26,k%2?0.4:-0.4,2.2));
  let a=0;for(let i=0;i<n;i++){a+=((r()*2-1)-a)*0.02;L[i]+=a*0.05;R[i]+=a*0.05}
  return{name:'ピアノの断片',frames:n,data:normalise([L,R],0.8)};
}
function demoRain(sr){
  const sec=10,n=Math.floor(sr*sec),L=new Float32Array(n),R=new Float32Array(n),r=rng(23);
  let a=0,b=0;for(let i=0;i<n;i++){a+=((r()*2-1)-a)*0.05;b+=((r()*2-1)-b)*0.05;L[i]=a*0.35;R[i]=b*0.35}
  for(let k=0;k<70;k++){const t=r()*sec,f=1800+r()*2600,p=r()*2-1,s=Math.floor(t*sr);for(let i=0;i<sr*0.06&&s+i<n;i++){const x=i/sr,v=Math.sin(2*Math.PI*f*x*(1-x*4))*Math.exp(-x*70)*0.25;L[s+i]+=v*(1-p);R[s+i]+=v*(1+p)}}
  const pent=[62,64,66,69,71,74,76,78];
  for(let k=0;k<9;k++){const t=0.3+k*1.1+r()*0.3,f=mtof(pent[Math.floor(r()*pent.length)]),p=r()*1.2-0.6,s=Math.floor(t*sr);for(let i=0;i<sr*2.6&&s+i<n;i++){const x=i/sr,v=(Math.sin(2*Math.PI*f*x)+0.25*Math.sin(2*Math.PI*f*3.01*x)*Math.exp(-x*3))*Math.exp(-x*1.6)*0.5;L[s+i]+=v*(1-p);R[s+i]+=v*(1+p)}}
  return{name:'鈴と雨',frames:n,data:normalise([L,R],0.8)};
}
function demoPad(sr){
  const sec=10,n=Math.floor(sr*sec),M=new Float32Array(n),fs=[146.83,220,277.18,329.63,440,554.37];
  for(let i=0;i<n;i++){const t=i/sr;let v=0;fs.forEach((f,k)=>{v+=(Math.sin(2*Math.PI*f*t)+Math.sin(2*Math.PI*f*1.003*t+k))*(0.6+0.4*Math.sin(2*Math.PI*(0.07+k*0.031)*t+k))/(1+k*0.4)});M[i]=v*Math.min(1,t/1.5,(sec-t)/1.5)}
  return{name:'和音',frames:n,data:normalise([M],0.8)};
}
const DEMOS={piano:demoPiano,rain:demoRain,pad:demoPad};
const SLOTS={tenki:[['src','音源','']],kizu:[['src','音源（CD 役）','']],mebuki:[['srca','音源 A（地）',''],['srcb','音源 B（芽）','']],tsuioku:[['feed','入力','']],kiri:[['src','音源','']],
  bake:[['src','音源','']],wa:[['src','音源','']],hibiki:[['feed','入力','']],kosuri:[['src','音源（レコード役）','']],ni:[['src','音源','']],kodama:[['feed','入力','']]};
const LIVE=new Set(['tsuioku','hibiki','kodama']);
const POSITIONAL=new Set(['tenki','kizu','kiri','bake','wa','kosuri','ni']);
const EMPTY={name:'',frames:0,channels:1,data:[new Float32Array(0)]};
const STATES={tenki:['晴れ','テープ停止','巻き戻し','凍結','跳躍'],kizu:['再生','引っかかり','欠落','ジッ','飛び'],kosuri:['モーター','ベビー','チャープ','トランスフォーマー','スピンバック','ドラッグ','手']};

// ---------- lab state ----------
const LAB={played:false,ctx:null,node:null,eng:null,machine:'tenki',playing:false,vol:0.7,st:{o3:0,o4:0},pat:null,tape:null,trail:[],
  vals:{},sel:{},files:{},demo:{},demoRate:0,peaks:new Map(),raf:0,fileSlot:null};
const DEF=Object.fromEntries(MACHINE_DEFS.map(d=>[d.key,d]));

function ensureDemos(sr){
  if(LAB.demoRate===sr)return;
  for(const k in DEMOS)LAB.demo[k]=DEMOS[k](sr);
  LAB.demoRate=sr;LAB.peaks.clear();
}
function bufFor(key,slot){
  const s=(LAB.sel[key]||{})[slot]||SLOTS[key].find(x=>x[0]===slot)[2];
  if(!s)return EMPTY;
  if(s.startsWith('file:'))return LAB.files[s.slice(5)]||EMPTY;
  return LAB.demo[s]||EMPTY;
}
function send(m,tr){if(LAB.node)LAB.node.port.postMessage(m,tr||[]);else if(LAB.eng)LAB.eng.handle(m)}
function sendMachine(){
  const key=LAB.machine;
  send({t:'machine',name:key});
  for(const [slot] of SLOTS[key]){const b=bufFor(key,slot);send({t:'buf',k:slot,frames:b.frames,data:b.data})}
  const v=LAB.vals[key];for(const k in v)send({t:'param',k,v:v[k]});
  if(LIVE.has(key))send({t:'param',k:'source',v:1});
  send({t:'vol',v:LAB.vol});send({t:'run',v:LAB.playing});
  LAB.trail=[];LAB.pat=null;LAB.tape=null;
}
async function ensureAudio(){
  if(LAB.ctx)return;
  const AC=window.AudioContext||window.webkitAudioContext;
  LAB.ctx=new AC();
  ensureDemos(LAB.ctx.sampleRate);
  try{
    if(!LAB.ctx.audioWorklet||!window.AudioWorkletNode)throw new Error('no worklet');
    const url=URL.createObjectURL(new Blob([WSRC],{type:'application/javascript'}));
    await Promise.race([LAB.ctx.audioWorklet.addModule(url),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000))]);
    LAB.node=new AudioWorkletNode(LAB.ctx,'harimaze',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    LAB.node.port.onmessage=e=>onStatus(e.data);
    LAB.node.connect(LAB.ctx.destination);
  }catch(err){
    LAB.node=null;const Engine=ENGINE(MACHINES);LAB.eng=new Engine(LAB.ctx.sampleRate);
    const sp=LAB.ctx.createScriptProcessor(1024,0,2);
    sp.onaudioprocess=e=>{const ob=e.outputBuffer;LAB.eng.render(ob.getChannelData(0),ob.getChannelData(1),ob.length);const s=LAB.eng.status();if(s)onStatus(s)};
    sp.connect(LAB.ctx.destination);LAB.sp=sp;
  }
  sendMachine();
}
function onStatus(s){LAB.st.o3=s.o3;LAB.st.o4=s.o4;if(s.pat)LAB.pat=s.pat;if(s.tape)LAB.tape=s.tape}

async function togglePlay(){
  await ensureAudio();
  if(LAB.ctx.state==='suspended')await LAB.ctx.resume();
  LAB.playing=!LAB.playing;if(LAB.playing)LAB.played=true;send({t:'run',v:LAB.playing});
  updateTransport();
  if(LAB.playing)loop();
}
function updateTransport(){
  const b=$('play');b.setAttribute('aria-pressed',LAB.playing);
  $('playlabel').textContent=LAB.playing?'停止':'再生';
  $('playicon').setAttribute('d',LAB.playing?'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z':'M4 2.5v11l9-5.5z');
  if(!LAB.playing){$('state').textContent='停止中';$('state').classList.remove('live')}
}

// ---------- files ----------
async function loadFile(file,slot){
  try{
    await ensureAudioContextOnly();
    const ab=await file.arrayBuffer();
    const audio=await new Promise((res,rej)=>{const p=LAB.ctx.decodeAudioData(ab,res,rej);if(p&&p.then)p.then(res,rej)});
    const id=String(Date.now())+Math.random().toString(36).slice(2,6);
    const data=[];for(let c=0;c<Math.min(2,audio.numberOfChannels);c++)data.push(audio.getChannelData(c).slice(0));
    LAB.files[id]={name:file.name,frames:audio.length,data};
    (LAB.sel[LAB.machine]=LAB.sel[LAB.machine]||{})[slot]='file:'+id;
    renderSources();
    if(LAB.ctx&&(LAB.node||LAB.eng)){const b=LAB.files[id];send({t:'buf',k:slot,frames:b.frames,data:b.data})}
    drawScope();
  }catch(e){
    $('m-note').textContent=`「${file.name}」を読み込めませんでした。WAV / AIFF / MP3 など、ブラウザが再生できる形式を選んでください。`;
  }
}
async function ensureAudioContextOnly(){
  if(LAB.ctx)return;
  await ensureAudio();
}

// ---------- UI ----------
const isLog=p=>p.min>0&&p.max/p.min>=50&&p.kind!=='toggle'&&p.kind!=='bang';
const toSlider=(p,v)=>isLog(p)?Math.round(1000*Math.log(v/p.min)/Math.log(p.max/p.min)):Math.round(1000*(v-p.min)/(p.max-p.min));
const fromSlider=(p,x)=>isLog(p)?p.min*Math.pow(p.max/p.min,x/1000):p.min+(p.max-p.min)*x/1000;
const fmtv=(p,v)=>p.dp===0?String(Math.round(v)):(Math.abs(v)>=100?v.toFixed(0):v.toFixed(Math.min(p.dp,2)));

function initVals(key){
  if(LAB.vals[key])return;
  const v={};const d=DEF[key];
  for(const p of d.params){if(p.kind==='bang')continue;v[p.name]=p.kind==='toggle'?0:(p.min+p.max)/2}
  for(const [n,x] of d.presets[0].values)v[n]=x;
  LAB.vals[key]=v;
}
function setParam(key,name,v){LAB.vals[key][name]=v;if(LAB.machine===key)send({t:'param',k:name,v})}
function applyPreset(key,pr){
  for(const [n,x] of pr.values)setParam(key,n,x);
  if(pr.extra&&pr.extra.includes('reroll'))send({t:'param',k:'reroll',v:Math.random()});
  renderParams();
}
function renderMachineTabs(){
  $('mtabs').innerHTML=MACHINE_DEFS.map(d=>{const [, ja, en]=d.title.match(/^\S+\s+(\S+)\s+—\s+(.+)$/)||[null,d.key,''];
    return `<button data-m="${d.key}" aria-pressed="${d.key===LAB.machine}"><b>${ja}</b><span>${d.key} · ${en}</span></button>`}).join('');
  $('mtabs').querySelectorAll('button').forEach(b=>b.onclick=()=>selectMachine(b.dataset.m));
}
function selectMachine(key){
  LAB.machine=key;initVals(key);
  try{localStorage.setItem('harimaze.machine',key)}catch(e){}
  renderMachineTabs();renderLab();
  if(LAB.ctx)sendMachine();
}
function renderLab(){
  const d=DEF[LAB.machine];
  $('m-title').textContent=d.title;
  $('m-concept').textContent=d.concept.replace(/\n/g,'');
  $('m-context').textContent=d.context;
  $('trig').hidden=d.live_input;
  $('m-note').textContent=d.live_input?'ブラウザ版の入力はファイルのみです（Max 版はマイク・ライン入力も使えます）。':d.trigger_note.replace(/^●\s*/,'「● 今すぐ」: ');
  $('presets').innerHTML=d.presets.map((p,i)=>`<button data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span></button>`).join('');
  $('presets').querySelectorAll('button').forEach(b=>b.onclick=()=>applyPreset(LAB.machine,d.presets[+b.dataset.i]));
  renderParams();renderSources();
  $('code').innerHTML=highlight(GENEXPR[LAB.machine]);
  LAB.trail=[];drawScope();
}
function renderParams(){
  const key=LAB.machine,d=DEF[key],v=LAB.vals[key];
  const ps=d.params.filter(p=>!(LIVE.has(key)&&p.name==='source'));
  $('params').innerHTML=ps.map(p=>{
    const id=`p-${key}-${p.name}`;
    if(p.kind==='toggle')return `<div class="prm"><label>${esc(p.ja)}<code>${p.name}</code></label><output></output><button class="tg" id="${id}" data-n="${p.name}" aria-pressed="${v[p.name]>0.5}">${v[p.name]>0.5?'on':'off'}</button></div>`;
    if(p.kind==='bang')return `<div class="prm"><label>${esc(p.ja)}<code>${p.name}</code></label><output></output><button class="tg" id="${id}" data-n="${p.name}">● 書き直す</button></div>`;
    return `<div class="prm"><label for="${id}">${esc(p.ja)}<code>${p.name}</code></label><output id="${id}-o">${fmtv(p,v[p.name])}</output><input type="range" id="${id}" data-n="${p.name}" min="0" max="1000" step="1" value="${toSlider(p,v[p.name])}"></div>`;
  }).join('');
  for(const p of ps){
    const el=$(`p-${key}-${p.name}`);if(!el)continue;
    if(p.kind==='toggle')el.onclick=()=>{const nv=v[p.name]>0.5?0:1;setParam(key,p.name,nv);el.setAttribute('aria-pressed',nv>0.5);el.textContent=nv>0.5?'on':'off'};
    else if(p.kind==='bang')el.onclick=()=>send({t:'param',k:p.name,v:Math.random()});
    else el.oninput=()=>{let x=fromSlider(p,+el.value);if(p.dp===0)x=Math.round(x);setParam(key,p.name,x);$(`p-${key}-${p.name}-o`).textContent=fmtv(p,x)};
  }
}
function renderSources(){
  const key=LAB.machine;
  $('srcs').innerHTML=SLOTS[key].map(([slot,label,def])=>{
    const cur=(LAB.sel[key]||{})[slot]||def;
    const demos=Object.entries({piano:'試し音: ピアノ',rain:'試し音: 鈴と雨',pad:'試し音: 和音'}).map(([k,n])=>`<button data-s="${slot}" data-v="${k}" aria-pressed="${cur===k}">${n}</button>`).join('');
    const f=cur.startsWith('file:')?LAB.files[cur.slice(5)]:null;
    return `<div class="srcrow"><span class="lab">${label}</span><button data-s="${slot}" data-v="file" aria-pressed="${!!f}">ファイルを選ぶ…</button>${demos}${f?`<span class="fname">${esc(f.name)}</span>`:''}</div>`;
  }).join('')+`<p class="small">起動時は音源が空です。波形の欄にファイルをドロップしても入れられます（${SLOTS[key].length>1?'上半分は A、下半分は B':'WAV / AIFF / MP3 など'}）。試し音はこのページで合成した音です。</p>`;
  $('srcs').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    const slot=b.dataset.s,val=b.dataset.v;
    if(val==='file'){LAB.fileSlot=slot;$('file').value='';$('file').click();return}
    (LAB.sel[key]=LAB.sel[key]||{})[slot]=val;renderSources();
    if(LAB.ctx){const bf=bufFor(key,slot);send({t:'buf',k:slot,frames:bf.frames,data:bf.data})}
    drawScope();
  });
}

// ---------- scope ----------
function css(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function peaks(buf,cols){
  let p=LAB.peaks.get(buf);if(p&&p.cols===cols)return p;
  const d=buf.data[0],n=buf.frames,mn=new Float32Array(cols),mx=new Float32Array(cols);
  for(let j=0;j<cols;j++){let a=1,b=-1;const s=Math.floor(j*n/cols),e=Math.max(s+1,Math.floor((j+1)*n/cols)),st=Math.max(1,Math.floor((e-s)/200));for(let i=s;i<e;i+=st){const v=d[i];if(v<a)a=v;if(v>b)b=v}mn[j]=a;mx[j]=b}
  p={cols,mn,mx};LAB.peaks.set(buf,p);return p;
}
function drawWave(g,buf,x,y,w,h,color){
  if(!buf.frames){g.fillStyle=color;g.fillRect(x,y+h/2,w,Math.max(1,(window.devicePixelRatio||1)*0.6));g.font=`${12*(window.devicePixelRatio||1)}px ${css('--f-body')}`;g.fillText('音源なし — ファイルを選ぶか、ここにドロップ',x+12*(window.devicePixelRatio||1),y+h/2-22*(window.devicePixelRatio||1));return}
  const cols=Math.max(1,Math.floor(w));const p=peaks(buf,cols);g.fillStyle=color;
  for(let j=0;j<cols;j++){const a=y+h/2-p.mx[j]*h*0.46,b=y+h/2-p.mn[j]*h*0.46;g.fillRect(x+j,a,1,Math.max(1,b-a))}
}
function drawTrail(g,x,y,w,h,color){
  const t=LAB.trail,N=140;if(t.length<2)return;g.strokeStyle=color;g.lineWidth=1.6*(window.devicePixelRatio||1);g.beginPath();
  for(let k=t.length-1,age=0;k>=0;k--,age++){const px=x+t[k]*w,py=y+age/N*h;if(age===0||Math.abs(t[k]-t[k+1])>0.3)g.moveTo(px,py);else g.lineTo(px,py)}
  g.stroke();
}
function drawScope(){
  const cv=$('scope');if(!cv||$('v-lab').hidden)return;
  const dpr=window.devicePixelRatio||1,W=Math.max(10,cv.clientWidth*dpr),H=230*dpr;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  if(!LAB.demoRate)ensureDemos(48000);
  const g=cv.getContext('2d'),key=LAB.machine,wave=css('--wave'),gun=css('--gun'),shu=css('--shu'),faint=css('--faint'),trail=css('--trail');
  g.clearRect(0,0,W,H);g.font=`${11*dpr}px ${css('--f-mono')}`;g.textBaseline='top';
  const pad=8*dpr,o3=LAB.st.o3||0,o4=LAB.st.o4||0;
  if(key==='mebuki'){
    const h=(H-pad*3-14*dpr)/2;
    drawWave(g,bufFor(key,'srca'),0,pad,W,h,wave);drawWave(g,bufFor(key,'srcb'),0,pad*2+h,W,h,faint);
    g.fillStyle=faint;g.fillText('A',pad,pad);g.fillText('B',pad,pad*2+h);
    drawTrail(g,0,pad,W,h*2+pad,trail);
    if(LAB.played){g.fillStyle=gun;g.fillRect(o3*W-dpr,pad,2*dpr,h*2+pad)}
    const by=H-12*dpr;g.fillStyle=faint;g.fillRect(pad*4,by+4*dpr,W-pad*8,2*dpr);g.fillStyle=shu;g.fillRect(pad*4+o4*(W-pad*8)-4*dpr,by,8*dpr,10*dpr);
    g.fillStyle=faint;g.fillText('A',pad,by-1*dpr);g.fillText('B',W-pad*2.6,by-1*dpr);
  }else if(key==='tsuioku'){
    const h=(H-pad*3)/2;
    drawWave(g,bufFor(key,'feed'),0,pad,W,h,faint);g.fillStyle=faint;g.fillText('入力',pad,pad);
    const ty=pad*2+h;g.fillStyle=wave;
    if(LAB.tape){const c=LAB.tape.length;for(let j=0;j<c;j++){const v=Math.min(1,LAB.tape[j]*1.3)*h*0.46;g.fillRect(j*W/c,ty+h/2-v,Math.ceil(W/c),Math.max(1,v*2))}}
    else{g.fillStyle=faint;g.fillRect(0,ty+h/2,W,dpr)}
    g.fillStyle=faint;g.fillText('記憶のテープ 32 秒',pad,ty);
    drawTrail(g,0,ty,W,h,trail);
    if(LAB.played){g.fillStyle=shu;g.fillRect(o3*W-dpr,ty,2*dpr,h);g.fillStyle=gun;g.fillRect(o4*W-dpr,ty,2*dpr,h)}
  }else{
    const strip=key==='kiri'?30*dpr:0,h=H-pad*2-strip;
    const b=bufFor(key,SLOTS[key][0][0]);drawWave(g,b,0,pad,W,h,wave);
    if(!POSITIONAL.has(key)&&LAB.played){
      const bw=W-pad*2,by=H-pad-10*dpr;g.fillStyle=faint;g.fillRect(pad,by+4*dpr,bw,2*dpr);
      const v=key==='kodama'?o4:o3;g.fillStyle=shu;g.fillRect(pad,by,bw*Math.min(1,Math.max(0,v)),10*dpr);
      if(key==='kodama'){g.fillStyle=gun;g.fillRect(pad,pad,bw*Math.min(1,o3),4*dpr)}
    }
    if(key==='kiri'){
      const ns=Math.max(1,Math.round(LAB.vals.kiri.slices||16)),cs=Math.floor(o4*ns+0.001);
      g.fillStyle=css('--gun-soft');g.fillRect(cs*W/ns,pad,W/ns,h);
      g.fillStyle=faint;for(let k=1;k<ns;k++)g.fillRect(k*W/ns,pad,Math.max(1,dpr*0.6),h);
      const nst=Math.max(1,Math.round(LAB.vals.kiri.steps||16)),step=Math.round(o3*16),cw=(W-pad*2)/16,sy=H-strip+4*dpr;
      for(let k=0;k<16;k++){
        const x=pad+k*cw,on=LAB.pat?LAB.pat[4][k]>0.5:true,rev=LAB.pat?LAB.pat[1][k]<0:false,semi=LAB.pat?LAB.pat[2][k]:0,rat=LAB.pat?LAB.pat[3][k]:1;
        g.globalAlpha=k<nst?1:0.3;
        g.strokeStyle=faint;g.lineWidth=dpr;g.strokeRect(x+1*dpr,sy,cw-2*dpr,strip-10*dpr);
        if(on){g.fillStyle=k===step?shu:gun;g.fillRect(x+2*dpr,sy+1*dpr,cw-4*dpr,strip-12*dpr)}
        if(on){g.fillStyle=css('--gun-ink');g.fillText((rev?'←':'')+(rat>1?'×'+rat:'')+(semi?(semi>0?'+':'')+semi:''),x+4*dpr,sy+4*dpr)}
        g.globalAlpha=1;
      }
    }
    if(POSITIONAL.has(key)){drawTrail(g,0,pad,W,h,trail);if(LAB.played){g.fillStyle=gun;g.fillRect(o3*W-dpr,pad,2*dpr,h)}}
  }
}
function loop(){
  cancelAnimationFrame(LAB.raf);
  const step=()=>{
    if(!LAB.playing&&LAB.trail.length===0){drawScope();return}
    const key=LAB.machine,p=key==='tsuioku'?LAB.st.o4:LAB.st.o3;
    if(LAB.playing){LAB.trail.push(p||0);if(LAB.trail.length>140)LAB.trail.shift()}else LAB.trail.shift();
    drawScope();updateState();
    LAB.raf=requestAnimationFrame(step);
  };
  LAB.raf=requestAnimationFrame(step);
}
function updateState(){
  if(!LAB.playing)return;const key=LAB.machine,s=LAB.st,el=$('state');el.classList.add('live');
  if(STATES[key])el.textContent=STATES[key][Math.round(s.o4)]||'';
  else if(key==='mebuki')el.textContent=`morph ${s.o4.toFixed(2)}`;
  else if(key==='tsuioku')el.textContent=`書込 ${(s.o3*32).toFixed(1)}s ／ 想起 ${(s.o4*32).toFixed(1)}s`;
  else if(key==='kiri')el.textContent=`step ${Math.round(s.o3*16)+1} ／ slice ${Math.floor(s.o4*Math.round(LAB.vals.kiri.slices||16)+0.001)+1}`;
  else if(key==='bake')el.textContent=`故障 ${Math.round(s.o4)} 種`;
  else if(key==='wa'){const n=Math.round(LAB.vals.wa.voices||6);el.textContent=`鳴っているループ ${Math.round(s.o4*n)} ／ ${n}`}
  else if(key==='hibiki')el.textContent=`根音 ${s.o4>0?'+':''}${Math.round(s.o4)} 半音 ／ 入力 ${s.o3.toFixed(2)}`;
  else if(key==='ni')el.textContent=`目標の特徴 ${s.o4.toFixed(2)}`;
  else if(key==='kodama')el.textContent=`遅延 ${(s.o4*8).toFixed(2)} 秒 ／ 送り ${s.o3>0.5?'開':'閉'}`;
}
function highlight(src){
  return esc(src).split('\n').map(line=>{
    const i=line.indexOf('//');let code=i>=0?line.slice(0,i):line;const com=i>=0?`<span class="c">${line.slice(i)}</span>`:'';
    code=code.replace(/\b(Buffer|Data|History|Param)\b/g,'<span class="d">$1</span>').replace(/\b(if|else|for)\b/g,'<span class="k">$1</span>');
    return code+com;
  }).join('\n');
}
function initLab(){
  let m='tenki';try{const s=localStorage.getItem('harimaze.machine');if(s&&DEF[s])m=s}catch(e){}
  LAB.machine=m;initVals(m);ensureDemos(48000);
  renderMachineTabs();renderLab();
  $('play').onclick=togglePlay;
  $('trig').onclick=async()=>{if(!LAB.playing)await togglePlay();send({t:'trig'})};
  $('vol').oninput=()=>{LAB.vol=+$('vol').value;send({t:'vol',v:LAB.vol})};
  $('file').onchange=()=>{const f=$('file').files[0];if(f)loadFile(f,LAB.fileSlot||SLOTS[LAB.machine][0][0])};
  const box=$('scopebox');
  ['dragenter','dragover'].forEach(ev=>box.addEventListener(ev,e=>{e.preventDefault();$('dropmsg').hidden=false}));
  ['dragleave','drop'].forEach(ev=>box.addEventListener(ev,e=>{e.preventDefault();$('dropmsg').hidden=true}));
  box.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files[0];if(!f)return;const sl=SLOTS[LAB.machine];const r=box.getBoundingClientRect();const slot=sl.length>1&&e.clientY>r.top+r.height/2?sl[1][0]:sl[0][0];loadFile(f,slot)});
  window.addEventListener('resize',()=>drawScope());
}
