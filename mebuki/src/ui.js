// ---------------------------------------------------------------------------
// Mebuki UI: builds the four strips from specs, talks to the DSP engine
// (AudioWorklet, or ScriptProcessor fallback), draws waveforms with live
// grains, the spectrum and meters, and handles scenes, files and recording.
// ---------------------------------------------------------------------------
const DSP=MEBUKI_DSP();
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(x,a,b)=>x<a?a:(x>b?b:x);
const pct=v=>Math.round(v*100)+'%';
const hz=f=>f>=1000?(f/1000).toFixed(f>=10000?0:1)+'k':Math.round(f)+'';
const db=v=>v<0.001?'-∞':(20*Math.log10(v)).toFixed(1)+' dB';

// ---------- control specs ----------
const GRAIN=[
  {k:'position',l:'位置',min:0,max:1,f:v=>v.toFixed(2)},
  {k:'scan',l:'時間の流れ',min:-1,max:1,f:v=>Math.abs(v)<0.002?'静止':(v>0?'+':'')+v.toFixed(2)+'×'},
  {k:'spray',l:'散り',min:0,max:1,f:pct},
  {k:'density',l:'密度',min:0.5,max:120,log:1,f:v=>(v<10?v.toFixed(1):Math.round(v))+'/秒'},
  {k:'size',l:'粒の長さ',min:10,max:1500,log:1,f:v=>Math.round(v)+' ms'},
  {k:'pitch',l:'音高',min:-24,max:24,f:v=>(v>0?'+':'')+v.toFixed(1)+' 半音'},
  {k:'pspray',l:'音高の散り',min:0,max:12,f:v=>'±'+v.toFixed(1)},
  {k:'rev',l:'逆再生',min:0,max:1,f:pct},
  {k:'width',l:'広がり',min:0,max:1,f:pct},
  {k:'shape',l:'粒の形',min:0,max:1,f:v=>v<0.04?'なめらか':(v>0.96?'打撃':pct(v))},
];
const FX=[
  {k:'tone',l:'フィルター',min:-1,max:1,bi:1,f:v=>Math.abs(v)<0.02?'off':(v<0?'LP '+hz(20000*Math.pow(2,v*7.4)):'HP '+hz(20*Math.pow(2,v*8.2)))},
  {k:'res',l:'共鳴',min:0,max:1,f:pct},
  {k:'drive',l:'歪み',min:0,max:1,f:pct},
  {k:'crush',l:'劣化',min:0,max:1,f:pct},
  {k:'wow',l:'揺れ',min:0,max:1,f:pct},
  {k:'dsend',l:'ディレイ送り',min:0,max:1,f:pct},
  {k:'rsend',l:'残響送り',min:0,max:1,f:pct},
];
const LEVEL={k:'level',l:'音量',min:0,max:1.5,f:db};
const PAN={k:'pan',l:'定位',min:-1,max:1,f:v=>Math.abs(v)<0.02?'中央':(v<0?'L ':'R ')+Math.round(Math.abs(v)*100)};
const MORPH_F=[
  {k:'bloom',l:'揺らぎ',min:0,max:1,f:pct},
  {k:'brate',l:'揺らぎの速さ',min:0,max:1,f:pct},
  {k:'smear',l:'にじみ',min:0,max:0.98,f:pct},
  {k:'shift',l:'ずらし',min:-1,max:1,bi:1,f:v=>{const b=Math.round(v*40);return b?(b>0?'+':'')+Math.round(b*47)+' Hz':'off'}},
];
const MASTER_TONE=[
  {k:'tone',l:'フィルター',min:-1,max:1,bi:1,f:FX[0].f},{k:'res',l:'共鳴',min:0,max:1,f:pct},
  {k:'drive',l:'歪み',min:0,max:1,f:pct},{k:'crush',l:'劣化',min:0,max:1,f:pct},
];
const MASTER_DELAY=[
  {k:'dtime',l:'時間',min:0.02,max:2.5,log:1,f:v=>Math.round(v*1000)+' ms'},{k:'dfb',l:'繰り返し',min:0,max:0.97,f:pct},
  {k:'ddamp',l:'暗さ',min:0,max:0.98,f:pct},{k:'dret',l:'量',min:0,max:1,f:pct},
];
const MASTER_REV=[
  {k:'rsize',l:'大きさ',min:0,max:1,f:pct},{k:'rdamp',l:'暗さ',min:0,max:0.95,f:pct},{k:'rret',l:'量',min:0,max:1,f:pct},
];
const WIDTH={k:'width',l:'ステレオ幅',min:0,max:2,f:v=>pct(v)};
const MLEVEL={k:'level',l:'全体の音量',min:0,max:1.2,f:db};
const MODES=[
  ['配分','grains','粒の出どころの比率。左端は A の粒だけ、右端は B の粒だけ。間では両方の粒がまばらに混ざり、A の中に B が芽を出す。'],
  ['混合','blend','A と B をそのまま等パワーで混ぜる。粒はどちらも全開。'],
  ['音色','spectral','スペクトルを幾何平均で混ぜる。真ん中では A でも B でもない音色になる。'],
  ['交差','cross','B の細かい構造（音程やざらつき）を、A のスペクトルの形でかたどる。左端で A の形、右端で B のまま。'],
  ['掛合','ring','A と B を掛け算する（リング変調）。右へ行くほど掛け算だけになり、どちらにもない音程が生まれる。'],
];

// ---------- state ----------
const DEF={a:Object.assign({},DSP.TRACK_DEF),b:Object.assign({},DSP.TRACK_DEF,{position:0.5,scan:-0.02}),m:Object.assign({},DSP.MORPH_DEF),x:Object.assign({},DSP.MASTER_DEF)};
const ST=JSON.parse(JSON.stringify(DEF));
try{const s=JSON.parse(localStorage.getItem('mebuki.state')||'null');if(s)for(const g in ST)for(const k in ST[g])if(s[g]&&typeof s[g][k]==='number')ST[g][k]=s[g][k]}catch(e){}
const CTL=new Map();
let saveT=0;
function setParam(g,k,v,silent){
  ST[g][k]=v;send({t:'p',k:`${g}.${k}`,v});
  const u=CTL.get(`${g}.${k}`);if(u)u.forEach(f=>f(v));
  if(g==='m'&&k==='mode')updateModeDesc();
  if(!silent){clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem('mebuki.state',JSON.stringify(ST))}catch(e){}},400)}
}
function reg(key,f){if(!CTL.has(key))CTL.set(key,[]);CTL.get(key).push(f)}
const toN=(s,v)=>s.log?Math.log(v/s.min)/Math.log(s.max/s.min):(v-s.min)/(s.max-s.min);
const fromN=(s,n)=>s.log?s.min*Math.pow(s.max/s.min,n):s.min+(s.max-s.min)*n;

// ---------- components ----------
function fader(g,s,opt={}){
  const w=document.createElement('div');w.className='fd';
  w.innerHTML=`<div class="ft${opt.tall?' tall':''}" role="slider" tabindex="0" aria-label="${esc(s.l)}"><div class="rail"></div>${s.bi?'<div class="zero"></div>':''}<div class="fill"></div><div class="knob"></div></div><span class="fl">${esc(s.l)}</span><output class="fv"></output>`;
  const ft=w.querySelector('.ft'),fill=w.querySelector('.fill'),knob=w.querySelector('.knob'),zero=w.querySelector('.zero'),out=w.querySelector('output');
  const KH=14,z=s.bi?toN(s,0):0;
  if(zero)zero.style.top=`calc(${(1-z)*100}% - ${(1-z)*KH}px + ${KH/2}px)`;
  const draw=v=>{
    const n=clamp(toN(s,v),0,1);
    knob.style.top=`calc(${(1-n)*100}% - ${(1-n)*KH}px)`;
    const hi=Math.max(n,z),lo=Math.min(n,z);
    fill.style.top=`calc(${(1-hi)*100}% - ${(1-hi)*KH}px + ${KH/2}px)`;
    fill.style.height=`calc(${(hi-lo)*100}% - ${(hi-lo)*KH}px)`;
    out.textContent=s.f(v);ft.setAttribute('aria-valuenow',String(+v.toFixed(3)));ft.setAttribute('aria-valuetext',s.f(v));
  };
  const at=e=>{const r=ft.getBoundingClientRect();return clamp(1-(e.clientY-r.top-KH/2)/(r.height-KH),0,1)};
  ft.addEventListener('pointerdown',e=>{ft.setPointerCapture(e.pointerId);setParam(g,s.k,fromN(s,at(e)));e.preventDefault()});
  ft.addEventListener('pointermove',e=>{if(ft.hasPointerCapture(e.pointerId))setParam(g,s.k,fromN(s,at(e)))});
  ft.addEventListener('dblclick',()=>setParam(g,s.k,DEF[g][s.k]));
  ft.addEventListener('keydown',e=>{
    const st=e.shiftKey?0.1:0.01;let n=toN(s,ST[g][s.k]);
    if(e.key==='ArrowUp'||e.key==='ArrowRight')n+=st;else if(e.key==='ArrowDown'||e.key==='ArrowLeft')n-=st;
    else if(e.key==='Home')n=0;else if(e.key==='End')n=1;else return;
    e.preventDefault();setParam(g,s.k,fromN(s,clamp(n,0,1)));
  });
  reg(`${g}.${s.k}`,draw);draw(ST[g][s.k]);
  return w;
}
function slider(g,s){
  const w=document.createElement('div');w.className='hs';const id=`s-${g}-${s.k}`;
  w.innerHTML=`<label for="${id}">${esc(s.l)}</label><output></output><input type="range" id="${id}" min="0" max="1000" step="1">`;
  const inp=w.querySelector('input'),out=w.querySelector('output');
  const draw=v=>{inp.value=Math.round(clamp(toN(s,v),0,1)*1000);out.textContent=s.f(v)};
  inp.addEventListener('input',()=>setParam(g,s.k,fromN(s,+inp.value/1000)));
  inp.addEventListener('dblclick',()=>setParam(g,s.k,DEF[g][s.k]));
  reg(`${g}.${s.k}`,draw);draw(ST[g][s.k]);
  return w;
}
function toggle(g,k,label){
  const b=document.createElement('button');b.className='tgl';b.type='button';b.textContent=label;
  const draw=v=>b.setAttribute('aria-pressed',v>0.5);
  b.onclick=()=>setParam(g,k,ST[g][k]>0.5?0:1);
  reg(`${g}.${k}`,draw);draw(ST[g][k]);return b;
}

// ---------- strips ----------
function buildTrack(g){
  const el=$(g==='a'?'trkA':'trkB'),N=g==='a'?['A','地','ground']:['B','芽','sprout'];
  el.innerHTML=`<div class="sh"><span class="badge">${N[0]}</span><h2><small>track ${N[0]} · ${N[2]}</small>${N[1]}</h2>
      <div class="acts"><button class="ibtn" data-act="dice">ダイス</button><button class="ibtn" data-act="reset">初期化</button></div></div>
    <div class="sec"><h3>音源</h3><div class="wave" id="wave-${g}"><canvas id="cv-${g}" aria-label="トラック ${N[0]} の波形と粒"></canvas><div class="drop" hidden>ここにドロップ</div></div><div class="srcrow" id="src-${g}"></div></div>
    <div class="sec"><h3>粒</h3><div class="sliders" id="gr-${g}"></div><div class="btnrow" id="tg-${g}"></div></div>
    <div class="sec"><h3>効果</h3><div class="bank" id="fx-${g}"></div></div>
    <div class="sec"><h3>出力</h3><div class="outrow"><div id="lv-${g}"></div><div class="meter"><i id="mt-${g}"></i></div><div class="side"><div id="pan-${g}"></div><div class="btnrow" id="ms-${g}"></div></div></div></div>`;
  GRAIN.forEach(s=>$(`gr-${g}`).append(slider(g,s)));
  $(`tg-${g}`).append(toggle(g,'toy','五音に丸める'));
  FX.forEach(s=>$(`fx-${g}`).append(fader(g,s)));
  $(`lv-${g}`).append(fader(g,LEVEL,{tall:1}));
  $(`pan-${g}`).append(slider(g,PAN));
  $(`ms-${g}`).append(toggle(g,'mute','ミュート'),toggle(g,'solo','ソロ'));
  el.querySelector('[data-act="dice"]').onclick=()=>dice(g);
  el.querySelector('[data-act="reset"]').onclick=()=>{for(const k in DEF[g])setParam(g,k,DEF[g][k])};
  const wave=$(`wave-${g}`),drop=wave.querySelector('.drop');
  ['dragenter','dragover'].forEach(ev=>el.addEventListener(ev,e=>{e.preventDefault();drop.hidden=false}));
  ['dragleave','drop'].forEach(ev=>el.addEventListener(ev,e=>{if(ev==='dragleave'&&el.contains(e.relatedTarget))return;e.preventDefault();drop.hidden=true}));
  el.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files[0];if(f)loadFile(f,g)});
  wave.addEventListener('click',()=>{if(!SRC[g])pickFile(g)});
  renderSrc(g);
}
function buildMorph(){
  const el=$('morph');
  el.innerHTML=`<div class="sh"><span class="badge">合</span><h2><small>morph · A × B</small>合体</h2></div>
    <div class="sec"><h3>混ぜ方</h3><div class="modes" id="modes"></div><p class="modedesc" id="modedesc"></p></div>
    <div class="sec"><h3>モーフ</h3><div class="xf" id="xf" role="slider" tabindex="0" aria-label="A と B のモーフ"><div class="ends"><b>A</b><b>B</b></div><div class="cap" id="xfcap"></div><div class="live" id="xflive"></div></div>
      <div class="xfv"><span id="xfset"></span><span id="xfnow"></span></div></div>
    <div class="sec"><h3>揺らぎとスペクトル</h3><div class="bank" id="mfx"></div><button class="freeze" id="freeze" aria-pressed="false">❄ 凍結 <span class="mono" style="color:inherit">freeze</span></button></div>
    <div class="sec"><h3>スペクトル</h3><div class="spec"><canvas id="spec" aria-label="出力のスペクトル"></canvas></div></div>
    <p class="help"><b>にじみ</b>は時間方向にスペクトルを溶かし、<b>ずらし</b>は全部の周波数を同じ Hz だけ動かして金属的にする。<b>凍結</b>はいまの響きをつかまえて鳴らし続ける（両トラックをミュートしても残る）。</p>`;
  $('modes').innerHTML=MODES.map((m,i)=>`<button type="button" data-mode="${i}" aria-pressed="false"><b>${m[0]}</b><span>${m[1]}</span></button>`).join('');
  $('modes').querySelectorAll('button').forEach(b=>b.onclick=()=>setParam('m','mode',+b.dataset.mode));
  reg('m.mode',v=>$('modes').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.mode===Math.round(v))));
  MORPH_F.forEach(s=>$('mfx').append(fader('m',s)));
  const fb=$('freeze');fb.onclick=()=>setParam('m','freeze',ST.m.freeze>0.5?0:1);
  reg('m.freeze',v=>fb.setAttribute('aria-pressed',v>0.5));
  // crossfader
  const xf=$('xf'),cap=$('xfcap');
  const draw=v=>{cap.style.left=`calc(13px + ${v}*(100% - 26px))`;$('xfset').textContent=`設定 A ${Math.round((1-v)*100)} : B ${Math.round(v*100)}`;xf.setAttribute('aria-valuenow',v.toFixed(2))};
  const at=e=>{const r=xf.getBoundingClientRect();return clamp((e.clientX-r.left-13)/(r.width-26),0,1)};
  xf.addEventListener('pointerdown',e=>{xf.setPointerCapture(e.pointerId);setParam('m','amount',at(e));e.preventDefault()});
  xf.addEventListener('pointermove',e=>{if(xf.hasPointerCapture(e.pointerId))setParam('m','amount',at(e))});
  xf.addEventListener('dblclick',()=>setParam('m','amount',0.5));
  xf.addEventListener('keydown',e=>{const st=e.shiftKey?0.1:0.01;let v=ST.m.amount;if(e.key==='ArrowRight'||e.key==='ArrowUp')v+=st;else if(e.key==='ArrowLeft'||e.key==='ArrowDown')v-=st;else return;e.preventDefault();setParam('m','amount',clamp(v,0,1))});
  reg('m.amount',draw);draw(ST.m.amount);
  $('xflive').style.left=`calc(13px + ${ST.m.amount}*(100% - 26px))`;STATUS.m=ST.m.amount;
  CTL.get('m.mode').forEach(f=>f(ST.m.mode));CTL.get('m.freeze').forEach(f=>f(ST.m.freeze));
  updateModeDesc();
}
function updateModeDesc(){const d=$('modedesc');if(d)d.textContent=MODES[Math.round(ST.m.mode)][2]}
function buildMaster(){
  const el=$('master');
  el.innerHTML=`<div class="sh"><span class="badge">全</span><h2><small>master · the whole</small>全体</h2>
      <div class="acts"><button class="ibtn" id="mreset">初期化</button></div></div>
    <div class="sec"><h3>色</h3><div class="bank" id="x-tone"></div></div>
    <div class="sec"><h3>ディレイ（ピンポン）</h3><div class="bank" id="x-delay"></div></div>
    <div class="sec"><h3>残響</h3><div class="bank" id="x-rev"></div></div>
    <div class="sec"><h3>出力</h3><div class="outrow"><div id="x-lv"></div><div class="meter"><i id="mt-x"></i></div><div class="side"><div id="x-w"></div><p class="help">各トラックの「送り」で、ディレイと残響にどれだけ入るかを決める。ここは戻りの量と質感。</p></div></div></div>`;
  MASTER_TONE.forEach(s=>$('x-tone').append(fader('x',s)));
  MASTER_DELAY.forEach(s=>$('x-delay').append(fader('x',s)));
  MASTER_REV.forEach(s=>$('x-rev').append(fader('x',s)));
  $('x-lv').append(fader('x',MLEVEL,{tall:1}));
  $('x-w').append(slider('x',WIDTH));
  $('mreset').onclick=()=>{for(const k in DEF.x)setParam('x',k,DEF.x[k])};
}

// ---------- scenes & dice ----------
const SCENES=[
  {n:'霧の中の芽',d:'A の霧に、B の高い粒がまばらに芽を出す',v:{m:{mode:0,amount:0.3,bloom:0.45,brate:0.15},a:{density:22,size:320,scan:0.02,spray:0.12,rsend:0.3,tone:-0.2},b:{density:9,size:160,pitch:12,toy:1,pspray:7,rev:0.3,rsend:0.45,dsend:0.25},x:{rret:0.5,dret:0.3}}},
  {n:'どちらでもない色',d:'スペクトルを混ぜて、にじませる',v:{m:{mode:2,amount:0.5,bloom:0.5,smear:0.55},a:{density:28,size:420},b:{density:28,size:300},x:{rret:0.45}}},
  {n:'A の形で鳴る B',d:'交差合成。B の質感を A の響きでかたどる',v:{m:{mode:3,amount:0.15,bloom:0.25},a:{density:30,size:220},b:{density:30,size:260,pspray:2}}},
  {n:'金属の芽',d:'スペクトルをずらし、少し劣化させる',v:{m:{mode:2,amount:0.45,shift:0.35,smear:0.3},a:{crush:0.15,size:200},b:{wow:0.4},x:{drive:0.25,dret:0.4}}},
  {n:'掛け算',d:'リング変調で A と B を掛け合わせる',v:{m:{mode:4,amount:0.65,bloom:0.3},a:{pitch:-12,density:18,size:260},b:{pitch:7,density:18,size:180,toy:1},x:{rret:0.35}}},
  {n:'長い庭',d:'ゆっくりした時間と大きな残響',v:{m:{mode:1,amount:0.5,bloom:0.6,brate:0.05},a:{scan:0.005,size:900,density:10,wow:0.3,rsend:0.6},b:{scan:-0.005,size:1200,density:8,rsend:0.6,tone:-0.35},x:{rsize:0.95,rdamp:0.6,rret:0.8,dret:0.2}}},
];
function applyScene(sc){
  for(const g in DEF)for(const k in DEF[g])setParam(g,k,(sc.v[g]&&k in sc.v[g])?sc.v[g][k]:DEF[g][k]);
  msg(`場面「${sc.n}」: ${sc.d}`);
}
function dice(g){
  const r=Math.random,pick=a=>a[Math.floor(r()*a.length)],lg=(a,b)=>a*Math.pow(b/a,r());
  const v={position:r(),scan:r()<0.3?0:(r()*2-1)*0.12,spray:r()*0.4,density:lg(3,50),size:lg(40,800),pitch:pick([-12,-5,0,0,0,7,12]),pspray:r()<0.5?0:r()*7,
    rev:r()*0.5,width:0.3+r()*0.7,shape:r()<0.6?0:r()*0.7,toy:r()<0.3?1:0,tone:r()<0.5?0:(r()*2-1)*0.6,res:r()*0.5,drive:r()<0.4?r()*0.4:0,crush:r()<0.25?r()*0.3:0,
    wow:r()<0.4?r()*0.5:0,dsend:r()*0.5,rsend:r()*0.6};
  for(const k in v)setParam(g,k,v[k]);
  msg(`トラック ${g.toUpperCase()} をダイスで振り直しました。`);
}

// ---------- sources ----------
const SRC={a:null,b:null};let pendingTrack='a';
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
const mtof=m=>440*Math.pow(2,(m-69)/12);
function normalise(chs,peak){let mx=0;for(const c of chs)for(let i=0;i<c.length;i++){const v=Math.abs(c[i]);if(v>mx)mx=v}const g=mx>0?peak/mx:1;for(const c of chs)for(let i=0;i<c.length;i++)c[i]*=g;return chs}
const TESTS={
  rain:{n:'雨',f(sr){const sec=10,n=Math.floor(sr*sec),L=new Float32Array(n),R=new Float32Array(n),r=rng(23);let a=0,b=0;for(let i=0;i<n;i++){a+=((r()*2-1)-a)*0.05;b+=((r()*2-1)-b)*0.05;L[i]=a*0.35;R[i]=b*0.35}
    for(let k=0;k<90;k++){const t=r()*sec,f=1800+r()*2600,p=r()*2-1,s=Math.floor(t*sr);for(let i=0;i<sr*0.06&&s+i<n;i++){const x=i/sr,v=Math.sin(2*Math.PI*f*x*(1-x*4))*Math.exp(-x*70)*0.25;L[s+i]+=v*(1-p);R[s+i]+=v*(1+p)}}
    return normalise([L,R],0.8)}},
  pad:{n:'和音',f(sr){const sec=10,n=Math.floor(sr*sec),L=new Float32Array(n),R=new Float32Array(n),fs=[146.83,220,277.18,329.63,440,554.37];
    for(let i=0;i<n;i++){const t=i/sr;let v=0,w=0;fs.forEach((f,k)=>{const a=(0.6+0.4*Math.sin(2*Math.PI*(0.07+k*0.031)*t+k))/(1+k*0.4);v+=Math.sin(2*Math.PI*f*t)*a;w+=Math.sin(2*Math.PI*f*1.003*t+k)*a});const e=Math.min(1,t/1.5,(sec-t)/1.5);L[i]=v*e;R[i]=w*e}
    return normalise([L,R],0.8)}},
  piano:{n:'ピアノ',f(sr){const sec=10,n=Math.floor(sr*sec),L=new Float32Array(n),R=new Float32Array(n),r=rng(11);
    const note=(t0,m,vel,pan,len)=>{const f=mtof(m),s=Math.floor(t0*sr),e=Math.min(n,s+Math.floor(len*sr)),hs=[1,2,3,4].map(h=>2*Math.PI*f*h*Math.sqrt(1+0.0004*h*h)/sr);
      for(let i=s;i<e;i++){const k=i-s,x=k/sr;let v=0;for(let h=0;h<4;h++)v+=Math.sin(hs[h]*k)*Math.exp(-x*(1.1+h*1.1))/(h+1);v*=Math.min(1,x*300)*vel;L[i]+=v*(1-pan);R[i]+=v*(1+pan)}};
    [[50,57,62,64,69],[46,53,57,62,65],[43,50,57,58,62],[45,52,57,61,64]].forEach((c,k)=>c.forEach((m,j)=>note(k*2.5+j*0.035+r()*0.01,m,0.32-j*0.03,(j/(c.length-1)-0.5)*0.6,2.6)));
    [[0.6,74],[1.4,76],[3.1,77],[3.9,74],[5.6,72],[6.3,69],[8.1,73],[8.8,76]].forEach(([t,m],k)=>note(t+r()*0.04,m,0.26,k%2?0.4:-0.4,2.2));
    return normalise([L,R],0.8)}},
};
function renderSrc(g){
  const s=SRC[g];
  $(`src-${g}`).innerHTML=`<button class="chipb" data-a="file">ファイルを選ぶ…</button>`+Object.entries(TESTS).map(([k,t])=>`<button class="chipb" data-a="test" data-k="${k}" aria-pressed="${!!s&&s.test===k}">試し音: ${t.n}</button>`).join('')+
    (s?`<button class="chipb" data-a="clear">外す</button><span class="fname">${esc(s.name)}・${(s.frames/(ctx?ctx.sampleRate:48000)).toFixed(1)} 秒</span>`:'');
  $(`src-${g}`).querySelectorAll('button').forEach(b=>b.onclick=()=>{
    if(b.dataset.a==='file')pickFile(g);else if(b.dataset.a==='clear')setSource(g,null);else loadTest(g,b.dataset.k);
  });
}
function pickFile(g){pendingTrack=g;$('file').value='';$('file').click()}
function setSource(g,s){
  SRC[g]=s;peaksCache.delete(g);renderSrc(g);
  send({t:'buf',track:g==='a'?0:1,frames:s?s.frames:0,data:s?s.data:[]});
  drawWaves(true);
}
async function loadTest(g,k){await ensureAudio(false);const t=TESTS[k];setSource(g,{name:'試し音: '+t.n,test:k,frames:Math.floor(ctx.sampleRate*10),data:t.f(ctx.sampleRate)})}
async function loadFile(file,g){
  try{
    await ensureAudio(false);
    const ab=await file.arrayBuffer();
    const audio=await new Promise((res,rej)=>{const p=ctx.decodeAudioData(ab,res,rej);if(p&&p.then)p.then(res,rej)});
    const data=[];for(let c=0;c<Math.min(2,audio.numberOfChannels);c++)data.push(audio.getChannelData(c).slice(0));
    setSource(g,{name:file.name,frames:audio.length,data});
    msg(`トラック ${g.toUpperCase()} に「${file.name}」を入れました。`);
  }catch(e){msg(`「${file.name}」を読み込めませんでした。WAV / AIFF / MP3 など、ブラウザが再生できる形式を選んでください。`)}
}

// ---------- audio ----------
let ctx=null,node=null,eng=null,outGain=null,analyser=null,playing=false;
const WSRC=`const MEBUKI_DSP=${MEBUKI_DSP.toString()};
const DSP=MEBUKI_DSP();
class MebukiProc extends AudioWorkletProcessor{
  constructor(){super();this.e=new DSP.Engine(sampleRate);this.n=0;this.port.onmessage=ev=>this.e.handle(ev.data)}
  process(ins,outs){const o=outs[0];this.e.render(o[0],o[1]||o[0],o[0].length);if(++this.n%6===0)this.port.postMessage(this.e.status());return true}
}
registerProcessor('mebuki',MebukiProc);`;
const STATUS={ga:[],gb:[],sa:0,sb:0,m:0,pa:0,pb:0,pm:0};
function send(m){if(node)node.port.postMessage(m);else if(eng)eng.handle(m)}
async function ensureAudio(){
  if(ctx)return;
  const AC=window.AudioContext||window.webkitAudioContext;ctx=new AC();
  outGain=ctx.createGain();outGain.connect(ctx.destination);
  analyser=ctx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0.75;outGain.connect(analyser);
  try{
    if(!ctx.audioWorklet||!window.AudioWorkletNode)throw new Error('no worklet');
    const url=URL.createObjectURL(new Blob([WSRC],{type:'application/javascript'}));
    await Promise.race([ctx.audioWorklet.addModule(url),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000))]);
    node=new AudioWorkletNode(ctx,'mebuki',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    node.port.onmessage=e=>Object.assign(STATUS,e.data);node.connect(outGain);
  }catch(err){
    node=null;eng=new DSP.Engine(ctx.sampleRate);let k=0;
    const sp=ctx.createScriptProcessor(1024,0,2);
    sp.onaudioprocess=e=>{const ob=e.outputBuffer;eng.render(ob.getChannelData(0),ob.getChannelData(1),ob.length);if(++k%2===0)Object.assign(STATUS,eng.status())};
    sp.connect(outGain);
  }
  for(const g in ST)for(const k in ST[g])send({t:'p',k:`${g}.${k}`,v:ST[g][k]});
  for(const g of ['a','b'])if(SRC[g])send({t:'buf',track:g==='a'?0:1,frames:SRC[g].frames,data:SRC[g].data});
}
async function togglePlay(){
  await ensureAudio();if(ctx.state==='suspended')await ctx.resume();
  playing=!playing;send({t:'run',v:playing});
  $('play').setAttribute('aria-pressed',playing);$('playlabel').textContent=playing?'■ 停止':'▶ 再生';
  if(playing&&!SRC.a&&!SRC.b)msg('音源が空です。A か B にファイルを入れるか、試し音を選んでください。');
  if(playing)loop();
}

// ---------- recording ----------
let rec=null,recDest=null,recChunks=[],recStart=0,recTick=0;
let DL=null,DLP=null;
if(window.claude&&typeof window.claude.use==='function'){DLP=window.claude.use('downloads').then(x=>{DL=x;return x}).catch(()=>null)}
async function saveBlob(blob,name){
  const dl=DL||(DLP?await DLP:null);
  if(dl){try{await dl.save({filename:name,data:blob});msg(`「${name}」を保存しました。`)}catch(e){const c=e&&e.code;msg(c==='declined'?'保存を取りやめました。':c==='rate_limited'?'保存の確認が開いています。少し待ってからもう一度。':'この表示ではファイルを保存できません。')}return}
  if(DLP){msg('この表示ではファイルを保存できません。');return}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  msg(`「${name}」を書き出しました。`);
}
async function toggleRec(){
  await ensureAudio();
  if(rec){rec.stop();return}
  if(!window.MediaRecorder||!ctx.createMediaStreamDestination){msg('このブラウザは録音に対応していません。');return}
  const t=[['audio/webm;codecs=opus','webm'],['audio/webm','webm'],['audio/mp4','mp4']].find(([m])=>MediaRecorder.isTypeSupported(m));
  if(!t){msg('このブラウザで使える録音形式がありません。');return}
  if(!recDest){recDest=ctx.createMediaStreamDestination();outGain.connect(recDest)}
  rec=new MediaRecorder(recDest.stream,{mimeType:t[0]});recChunks=[];
  rec.ondataavailable=e=>{if(e.data&&e.data.size)recChunks.push(e.data)};
  rec.onstop=()=>{
    const blob=new Blob(recChunks,{type:t[0]});rec=null;clearInterval(recTick);
    $('rec').setAttribute('aria-pressed','false');$('reclabel').textContent='録音';$('rectime').textContent='';
    const d=new Date(),p=n=>String(n).padStart(2,'0');
    if(blob.size)saveBlob(blob,`mebuki-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${t[1]}`);
  };
  rec.start(1000);recStart=Date.now();
  $('rec').setAttribute('aria-pressed','true');$('reclabel').textContent='録音を止めて保存';
  recTick=setInterval(()=>{const s=Math.floor((Date.now()-recStart)/1000);$('rectime').textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`},500);
  if(!playing)togglePlay();
}

// ---------- drawing ----------
const peaksCache=new Map();
function css(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function fit(cv,h){const d=window.devicePixelRatio||1,W=Math.max(10,Math.round(cv.clientWidth*d)),H=Math.round(h*d);if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}return d}
function peaksOf(g,cols){
  const s=SRC[g];if(!s)return null;let p=peaksCache.get(g);if(p&&p.cols===cols)return p;
  const d=s.data[0],n=s.frames,mn=new Float32Array(cols),mx=new Float32Array(cols);
  for(let j=0;j<cols;j++){let a=1,b=-1;const st=Math.floor(j*n/cols),en=Math.max(st+1,Math.floor((j+1)*n/cols)),step=Math.max(1,Math.floor((en-st)/160));for(let i=st;i<en;i+=step){const v=d[i];if(v<a)a=v;if(v>b)b=v}mn[j]=a;mx[j]=b}
  p={cols,mn,mx};peaksCache.set(g,p);return p;
}
function drawWave(g){
  const cv=$(`cv-${g}`);if(!cv)return;const d=fit(cv,110),W=cv.width,H=cv.height,x=cv.getContext('2d');
  const col=css(g==='a'?'--a':'--b'),faint=css('--faint'),ink=css('--ink');
  x.clearRect(0,0,W,H);
  const p=peaksOf(g,W);
  if(!p){x.fillStyle=faint;x.font=`${13*d}px ${css('--f-body')}`;x.textAlign='center';x.textBaseline='middle';x.fillText('ここに音声ファイルをドロップ／押して選ぶ',W/2,H/2);return}
  x.globalAlpha=0.55;x.fillStyle=ink;
  for(let j=0;j<W;j++){const a=H/2-p.mx[j]*H*0.44,b=H/2-p.mn[j]*H*0.44;x.fillRect(j,a,1,Math.max(1,b-a))}
  x.globalAlpha=1;
  const q=ST[g],sc=g==='a'?STATUS.sa:STATUS.sb,center=((q.position+sc)%1+1)%1;
  x.fillStyle=col;x.globalAlpha=0.16;const sw=Math.max(2*d,q.spray*W);x.fillRect(center*W-sw/2,0,sw,H);if(center*W+sw/2>W)x.fillRect(center*W-sw/2-W,0,sw,H);if(center*W-sw/2<0)x.fillRect(center*W-sw/2+W,0,sw,H);
  x.globalAlpha=1;x.fillRect(center*W-d,0,2*d,H);
  const gr=g==='a'?STATUS.ga:STATUS.gb;
  for(let i=0;i<gr.length;i+=2){const px=gr[i]*W,age=gr[i+1],e=Math.sin(Math.PI*Math.min(1,age));x.globalAlpha=0.25+0.75*e;x.beginPath();x.arc(px,H*(0.12+0.76*age),(2.5+3*e)*d,0,Math.PI*2);x.fill()}
  x.globalAlpha=1;
}
function drawSpec(){
  const cv=$('spec');if(!cv)return;const d=fit(cv,96),W=cv.width,H=cv.height,x=cv.getContext('2d');x.clearRect(0,0,W,H);
  if(!analyser)return;const bins=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(bins);
  const a=css('--a'),b=css('--b'),n=64,sr=ctx.sampleRate,m=STATUS.m;
  const grad=x.createLinearGradient(0,0,W,0);grad.addColorStop(0,a);grad.addColorStop(1,b);x.fillStyle=grad;
  for(let i=0;i<n;i++){
    const f0=40*Math.pow(18000/40,i/n),f1=40*Math.pow(18000/40,(i+1)/n),k0=Math.floor(f0/(sr/2)*bins.length),k1=Math.max(k0+1,Math.floor(f1/(sr/2)*bins.length));
    let v=0;for(let k=k0;k<k1&&k<bins.length;k++)v=Math.max(v,bins[k]);
    const h=v/255*H,w=W/n;x.globalAlpha=0.35+0.65*(m*i/n+(1-m)*(1-i/n));x.fillRect(i*w+1,H-h,w-2,h);
  }
  x.globalAlpha=1;
}
function drawWaves(){drawWave('a');drawWave('b')}
let raf=0;
function loop(){
  cancelAnimationFrame(raf);
  const step=()=>{
    drawWaves();drawSpec();
    const m=v=>clamp(Math.sqrt(v)*100,0,100)+'%';
    $('mt-a').style.height=m(STATUS.pa);$('mt-b').style.height=m(STATUS.pb);$('mt-x').style.height=m(STATUS.pm);
    $('xflive').style.left=`calc(13px + ${STATUS.m}*(100% - 26px))`;$('xfnow').textContent=`いま A ${Math.round((1-STATUS.m)*100)} : B ${Math.round(STATUS.m*100)}`;
    if(playing||STATUS.pm>0.001)raf=requestAnimationFrame(step);
  };
  raf=requestAnimationFrame(step);
}
function msg(t){$('msg').textContent=t}

// ---------- boot ----------
buildTrack('a');buildTrack('b');buildMorph();buildMaster();
$('scenes').insertAdjacentHTML('beforeend',SCENES.map((s,i)=>`<button class="chipb" data-i="${i}" title="${esc(s.d)}">${esc(s.n)}</button>`).join(''));
$('scenes').querySelectorAll('button').forEach(b=>b.onclick=()=>applyScene(SCENES[+b.dataset.i]));
$('play').onclick=togglePlay;$('rec').onclick=toggleRec;
$('file').onchange=()=>{const f=$('file').files[0];if(f)loadFile(f,pendingTrack)};
window.addEventListener('resize',()=>{drawWaves();drawSpec()});
drawWaves();
