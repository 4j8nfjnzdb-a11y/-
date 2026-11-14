// Offline tests for the parts of Kasane that need no browser: the document model, keyframe easing,
// expressions, the reading of sound into components, and relations. Usage: node tools/test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('..', import.meta.url).pathname;
for (const f of ['util', 'model', 'expr', 'sound']) vm.runInThisContext(readFileSync(ROOT + 'src/' + f + '.js', 'utf8'), { filename: f + '.js' });
const { U, M, X, Frame, Sound: SD, Rel: RL, Seq } = globalThis.KS;
let failed = 0, passed = 0;
const ok = (label, cond, info = '') => { if (cond) passed++; else failed++; console.log(cond ? 'ok  ' : 'FAIL', label, info); };

// ---------------------------------------------------------------- model and expressions
{
  const proj=M.newProject(), comp=M.newComp(); proj.comps.push(comp);
  const A=M.newLayer('solid',comp,{name:'A'}), B=M.newLayer('text',comp,{name:'B'}); comp.layers.push(A,B);
  // keys
  M.setKey(A.tr.p,0,[0,0],{e:null}); M.setKey(A.tr.p,2,[100,200],{e:null});
  let f=new Frame(proj,comp,1);
  ok('linear midpoint',U.veq(f.val(A,'tr.p'),[50,100]),JSON.stringify(f.val(A,'tr.p')));
  A.tr.p.k[0].e=U.EASE.ease.slice(); f=new Frame(proj,comp,0.5);
  ok('ease slower at start',f.val(A,'tr.p')[0]<25,f.val(A,'tr.p')[0].toFixed(2));
  f=new Frame(proj,comp,1); ok('ease symmetric at mid',Math.abs(f.val(A,'tr.p')[0]-50)<0.01);
  A.tr.p.k[0].h=1; f=new Frame(proj,comp,1.9); ok('hold',f.val(A,'tr.p')[0]===0); delete A.tr.p.k[0].h;
  // world with parent
  B.parent=A.id; B.tr.p.v=[10,0]; A.tr.r.v=90; A.tr.a.v=[0,0]; A.tr.p={v:[100,100]};
  f=new Frame(proj,comp,0); const w=f.world(B); const pt=U.mApply(w,0,0);
  ok('parent rotates child',Math.abs(pt[0]-100)<1e-6&&Math.abs(pt[1]-110)<1e-6,pt.map(x=>x.toFixed(2)).join(','));
  // expressions
  const run=(src,layer=B,path='tr.r',t=1)=>{M.getProp(layer,path).x=src;const fr=new Frame(proj,comp,t);const v=fr.val(layer,path);const e=X.errors.get(layer.id+'|'+path);delete M.getProp(layer,path).x;return e?('ERR '+e):v;};
  ok('time*90',run('time*90')===90);
  ok('vars',run('var a = 3; let b = a * 2\n a + b')===9);
  ok('ternary',run('time > 0.5 ? 10 : 20')===10);
  ok('vector math',JSON.stringify(run('value + [10, 5] * 2',B,'tr.p'))==='[30,10]',JSON.stringify(run('value + [10, 5] * 2',B,'tr.p')));
  ok('other layer',JSON.stringify(run('thisComp.layer("A").position',B,'tr.p'))==='[100,100]');
  ok('linear()',run('linear(time, 0, 2, 0, 100)')===50);
  ok('Math',Math.abs(run('Math.sin(Math.PI/2)*5')-5)<1e-9);
  ok('if/else',run('if (time < 0.5) { 1 } else { 2 }')===2);
  const w1=run('wiggle(2, 30)'),w2=run('wiggle(2, 30)'),w3=run('wiggle(2,30)',B,'tr.r',1.2);
  ok('wiggle deterministic and varying',w1===w2&&w1!==w3&&Math.abs(w1)<=30,`${w1.toFixed(2)} ${w3.toFixed(2)}`);
  B.tr.r.k=[{id:'a',t:0,v:0},{id:'b',t:1,v:100}];
  ok('loopOut cycle',Math.abs(run('loopOut()',B,'tr.r',2.5)-50)<1e-6,run('loopOut()',B,'tr.r',2.5));
  ok('loopOut pingpong',Math.abs(run('loopOut("pingpong")',B,'tr.r',1.25)-75)<1e-6);
  ok('loopOut offset',Math.abs(run('loopOut("offset")',B,'tr.r',2.5)-250)<1e-6);
  ok('loopOut continue',Math.abs(run('loopOut("continue")',B,'tr.r',2)-200)<1e-3,run('loopOut("continue")',B,'tr.r',2));
  delete B.tr.r.k;
  ok('syntax error reported',String(run('1 +')).startsWith('ERR'),run('1 +'));
  ok('no prototype access',String(run('value.constructor')).startsWith('ERR')&&String(run('thisComp.constructor')).startsWith('ERR')&&String(run('Math.constructor("return 1")()')).startsWith('ERR'),run('thisComp.constructor'));
  ok('unknown name',String(run('window')).startsWith('ERR')&&String(run('globalThis')).startsWith('ERR'));
  ok('random stable per frame',run('random(10)')===run('random(10)'));
  ok('seedRandom timeless',run('seedRandom(3,true); random(100)',B,'tr.r',1)===run('seedRandom(3,true); random(100)',B,'tr.r',2));
  ok('posterizeTime',run('posterizeTime(2); time',B,'tr.r',0.9)===0.5);
  // rdp
  const pts=[];for(let i=0;i<=100;i++)pts.push([i,i<50?0:(i-50)*2]);
  ok('rdp keeps corner',JSON.stringify(U.rdp(pts,0.5))==='[0,50,100]',JSON.stringify(U.rdp(pts,0.5)));
  ok('bez endpoints',U.bez([.3,0,.7,1],0)===0&&U.bez([.3,0,.7,1],1)===1&&Math.abs(U.bez([.3,0,.7,1],.5)-.5)<1e-4);
  ok('fmtTime',U.fmtTime(61.5,30)==='1:01:15',U.fmtTime(61.5,30));
  // clone / split / precompose
  M.setKey(A.tr.p,0,[0,0]);M.setKey(A.tr.p,2,[5,5]);const c2=M.cloneLayer(A); ok("clone has new ids",c2.id!==A.id&&c2.tr.p.k[0].id!==A.tr.p.k[0].id);
  const sp=M.splitLayer(comp,A,3); ok('split',A.out===3&&sp.in===3&&comp.layers.length===3);
  const pc=M.precompose(proj,comp,[A.id,sp.id],'P'); ok('precompose',proj.comps.length===2&&comp.layers.length===2&&pc.type==='comp'&&comp.layers.find(l=>l.id===B.id).parent===null);
  ok('self-containing comp is detected',M.compUsesComp(proj,comp,proj.comps[1].id)&&!M.compUsesComp(proj,proj.comps[1],comp.id));
}

// ---------------------------------------------------------------- sound and relations
// a click track: 120 BPM for 20 s, beat 12 missing, one click off the grid, two seconds of silence, then a held tone
{
  // a click track: 120 BPM for 20 s, with beat 12 missing, one off-grid click at 9.13 s, silence from 14 s to 16 s, then a long tone
  const sr=44100, L=sr*20, x=new Float32Array(L); let seed=7; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const click=(t,amp=0.9,f=180)=>{const a=Math.round(t*sr);for(let i=0;i<sr*0.09&&a+i<L;i++){const e=Math.exp(-i/(sr*0.018));x[a+i]+=amp*e*(Math.sin(2*Math.PI*f*i/sr)+0.5*(rnd()*2-1)*Math.exp(-i/(sr*0.004)));}};
  for(let b=0;b<40;b++){const t=0.25+b*0.5; if(b===12) continue; if(t>=14&&t<16) continue; click(t);}
  click(9.13,0.8,2400);
  for(let i=Math.round(16.2*sr);i<Math.round(18.8*sr);i++){const tt=(i-16.2*sr)/sr; x[i]+=0.5*Math.min(1,tt*20)*Math.min(1,(2.6-tt)*6)*Math.sin(2*Math.PI*440*i/sr);}
  const t0=Date.now(); const an=await SD.analyzeMono(x,sr); const ms=Date.now()-t0;
  ok('analysis ran',an.n===2000,`${an.n} frames in ${ms} ms`);
  const per=an.period[500]; ok('period ≈ 0.5 s',Math.abs(per-50)<=2,`period ${per} frames, sub ${an.sub}`);
  const bt=an.beats.filter(b=>b>100&&b<1300).map(b=>((b-25)%50+50)%50).map(d=>Math.min(d,50-d)); ok('beats sit on the clicks',Math.max(...bt)<=3,`max offset ${Math.max(...bt)} frames, ${an.beats.length} beats`);
  const idx=(a,lo,hi)=>{const o=[];for(let n=lo;n<hi;n++)if(a[n]>0)o.push(n);return o;};
  ok('the missing beat is an omission',idx(an.sig.omission,600,650).length>=1,'omissions 5.8–6.6s at '+idx(an.sig.omission,580,660).join(','));
  ok('no omissions where every beat arrives',idx(an.sig.omission,100,560).filter(n=>an.sig.expected[n]>=0.5).length===0,'on-beat omissions 1–5.6s: '+idx(an.sig.omission,100,560).filter(n=>an.sig.expected[n]>=0.5).length);
  ok('the off-grid click is the only surprise',idx(an.sig.surprise,0,an.n).length===1&&idx(an.sig.surprise,905,925).length===1,'surprises at '+idx(an.sig.surprise,0,an.n).join(','));
  let sil=0;for(let n=1420;n<1590;n++)sil+=an.sig.silence[n]; ok('silence found 14–16 s',sil>140,`${sil} of 170 frames`); ok('the gap between two clicks is not silence',an.sig.silence[500]===0&&an.sig.silence[650]===1,`${an.sig.silence[500]} / missing beat ${an.sig.silence[650]}`);
  ok('quiet grows during silence',an.sig.quiet[1580]>an.sig.quiet[1450]&&an.sig.quiet[1450]>0);
  let lg=0;for(let n=1630;n<1870;n++)lg+=an.sig.long[n]; ok('the held tone is a long sound',lg>120,`${lg} frames long`);
  let sh=0;for(let n=100;n<600;n++)if(an.sig.short[n]>0)sh++; ok('clicks are not long',idx(an.sig.long,100,600).length<20,`short events ${sh}`);
  ok('tone: A on the circle of fifths',Math.abs(an.sig.tone[1750]-((9*7)%12)/12)<1e-6,`tone ${an.sig.tone[1750]}`);
  ok('velocity higher during clicks than in the silence',an.sig.velocity[400]>an.sig.velocity[1500]+0.2,`${an.sig.velocity[400].toFixed(2)} vs ${an.sig.velocity[1500].toFixed(2)}`);
  ok('pulseness high on the click track',an.sig.pulseness[500]>0.5,an.sig.pulseness[500].toFixed(2));
  // sequences
  ok('thue-morse',[0,1,2,3,4,5,6,7].map(Seq.thue).join('')==='01101001');
  ok('fibonacci word',[0,1,2,3,4,5,6,7].map(Seq.fib).join('')==='10110101',[0,1,2,3,4,5,6,7].map(Seq.fib).join(''));
  ok('euclid 3 in 8',[0,1,2,3,4,5,6,7].map(k=>Seq.euclid(k,3,8)).reduce((a,b)=>a+b)===3);
  ok('sieve 3@0|4@1',[0,1,2,3,4,5,6,7,8,9].map(k=>Seq.sieve(k,'3@0|4@1')).join('')==='1101011001');
  // relations on a fake project
  const proj=M.newProject(), comp=M.newComp({dur:20}); proj.comps.push(comp);
  const A=M.newLayer('audio',comp,{src:'a1',out:20}); const B=M.newLayer('solid',comp,{}); comp.layers.push(B,A);
  SD.an.set('a1',an); KS.Media={audio:(id)=>id==='a1'?{}:null};
  const mk=(o)=>{B.tr.r.r=[RL.create(M.desc(B,'tr.r'),'tr.r',{k:'snd',layer:null,sig:'beat'},Object.assign({amt:10,rel:0.05},o))];return RL.baked(comp,B,B.tr.r.r[0]);};
  let c=mk({mode:'follow'}); const peaksOf=(y,lo,hi,sgn=1)=>{const o=[];for(let n=lo+1;n<hi-1;n++)if(sgn*y[n]>0.2&&sgn*y[n]>sgn*y[n-1]&&sgn*y[n]>=sgn*y[n+1])o.push(n);return o;};
  const fp=peaksOf(c.y,100,560); ok('follow: one peak per beat',fp.length===9||fp.length===10,fp.length+' peaks');
  c=mk({mode:'betray',obey:3,obeySeq:'fixed',how:'opp'}); const pos=peaksOf(c.y,0,1300), neg=peaksOf(c.y,0,1300,-1);
  ok('betray: every 4th event answers the other way',neg.length>=5&&Math.abs(pos.length/neg.length-3)<0.6,`${pos.length} with, ${neg.length} against`);
  c=mk({mode:'betray',obey:3,obeySeq:'fixed',how:'skip'}); const sk=peaksOf(c.y,0,1300); ok('betray by silence leaves gaps',sk.length<pos.length+neg.length-4,`${sk.length} of ${pos.length+neg.length}`);
  c=mk({mode:'step',steps:5,stepPat:'up',atk:0.001,rel:0.001}); const lv=new Set(Array.from(c.y.slice(100,1300)).map(v=>Math.round(v*4))); ok('step: five levels held',lv.size===5,[...lv].join(','));
  c=mk({mode:'deaf',ratio:1.618}); const dp=peaksOf(c.y,100,1300); const gaps=dp.slice(1).map((v,i)=>v-dp[i]); ok('deaf: own period = beat × φ',Math.abs(gaps.reduce((a,b)=>a+b)/gaps.length-50*1.618)<2,(gaps.reduce((a,b)=>a+b)/gaps.length).toFixed(1));
  c=mk({mode:'follow',pre:0.2,rel:0.01}); ok('looking ahead: already rising 80 ms before the beat',c.y[an.beats[10]-8]>0.3&&c.y[an.beats[10]+6]<0.15,`${c.y[an.beats[10]-8].toFixed(2)} before, ${c.y[an.beats[10]+6].toFixed(2)} after`);
  c=mk({mode:'store',fill:4}); const st=peaksOf(c.y,0,1300); ok('store: fires about once per 4 beats-worth',st.length>=3&&st.length<=9,st.length+' releases');
  B.tr.r.r=[RL.create(M.desc(B,'tr.r'),'tr.r',{k:'snd',layer:null,sig:'silence'},{amt:90,atk:0.01,rel:0.01})];
  let f=new Frame(proj,comp,15); ok('frame value picks up the relation',Math.abs(f.val(B,'tr.r')-90)<1,f.val(B,'tr.r').toFixed(1));
  f=new Frame(proj,comp,5); ok('and is still when there is sound',Math.abs(f.val(B,'tr.r'))<1,f.val(B,'tr.r').toFixed(2));
  B.p.color.r=[RL.create(M.desc(B,'p.color'),'p.color',{k:'snd',layer:null,sig:'tone'},{cm:'hue',amt:360,atk:0.001,rel:0.001})]; B.p.color.v=[1,0,0,1];
  f=new Frame(proj,comp,17.5); const col=f.val(B,'p.color'); ok('hue follows pitch class',Math.abs(col[0]-col[2])>0.3||Math.abs(col[1]-col[0])>0.3,col.map(v=>v.toFixed(2)).join(','));
  B.tr.s.r=[RL.create(M.desc(B,'tr.s'),'tr.s',{k:'math',gen:'thue',rate:4},{amt:[10,10],rel:0.02})]; c=RL.baked(comp,B,B.tr.s.r[0]);
  const tp=peaksOf(c.y,0,400).map(n=>Math.round(n/25)); ok('thue-morse as a rhythm',tp.join(',')==='1,2,4,7,8,11,13,14',tp.join(','));
  B.tr.o.r=[RL.create(M.desc(B,'tr.o'),'tr.o',{k:'math',gen:'logistic',rate:8,a:3.2},{amt:10,atk:0.001,rel:0.001})]; c=RL.baked(comp,B,B.tr.o.r[0]);
  const vals=new Set(Array.from(c.y.slice(800,1600)).map(v=>v.toFixed(2))); ok('logistic r=3.2 settles into two values',vals.size<=4,[...vals].join(' '));
  B.tr.o.r[0].src.a=3.9; c=RL.baked(comp,B,B.tr.o.r[0]); const v2=new Set(Array.from(c.y.slice(800,1600)).map(v=>v.toFixed(2))); ok('logistic r=3.9 never settles',v2.size>25,v2.size+' distinct values');
  // rules: rotate sources between two relations
  B.tr.r.r=[RL.create(M.desc(B,'tr.r'),'tr.r',{k:'snd',layer:null,sig:'beat'},{amt:10,rel:0.03})]; B.tr.o.r=[RL.create(M.desc(B,'tr.o'),'tr.o',{k:'snd',layer:null,sig:'silence'},{amt:10,atk:0.01,rel:0.01})]; B.tr.s.r=[]; B.p.color.r=[];
  const before=RL.baked(comp,B,B.tr.r.r[0]).y.slice();
  comp.rules=[{id:'x',on:true,src:{k:'snd',layer:null,sig:'beat'},every:8,act:'rotate',target:null}];
  const after=RL.baked(comp,B,B.tr.r.r[0]).y; let diff=0; for(let n=0;n<before.length;n++) diff+=Math.abs(before[n]-after[n]);
  ok('a rule re-wires the relation part-way through',diff>20&&Math.abs(before[100]-after[100])<1e-6,`total difference ${diff.toFixed(0)}`);
  ok('a tied property counts as animated',M.isAnimated(B.tr.r));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
