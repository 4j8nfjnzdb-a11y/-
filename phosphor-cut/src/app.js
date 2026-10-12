'use strict';
/* =========================================================
   Phosphor Cut — live CRT video-feedback collage desk
   pipeline per frame:  decks / timeline / pad → MIX (layers, wipe, key, entrance) → CORRECTOR → TIME (32-frame history)
                        → GLITCH + ECHO (beat / audio driven)
                        → FEEDBACK (camera-on-CRT loop) → PHOSPHOR persistence → TUBE (display) → canvas
   ========================================================= */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
let toastTimer = 0;
function toast(msg, ms = 4200, prog = null) {
  const t = $('#toast'); t.hidden = false; t.innerHTML = '';
  const p = document.createElement('div'); p.textContent = msg; t.append(p);
  if (prog != null) { const b = document.createElement('div'); b.className = 'prog'; b.innerHTML = `<i style="width:${Math.round(prog * 100)}%"></i>`; t.append(b); }
  clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function tcode(t, withF = true) {
  t = Math.max(0, t); const f = Math.floor((t % 1) * 30); const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = n => String(n).padStart(2, '0'); return `${p(h)}:${p(m)}:${p(s)}` + (withF ? `:${p(f)}` : '');
}
const fmtSec = t => (Math.round(t * 100) / 100).toFixed(2) + 's';


/* ---------------- parameters ---------------- */
const DEF = {
  amt: 0, fade: 0, mixMode: 1, wipe: 0, soft: .04, border: 0, borderHue: .1, keyThr: .45, bg: 0, fit: 0, fadeAudio: 1,
  appear: 2, appearT: 1.2, autoMix: 1,
  aScale: 1, aX: 0, aY: 0, aRot: 0, aDepth: 0, aFeather: 0, aShape: 0, aTiles: 0, aFloat: 0,
  bScale: 1, bX: 0, bY: 0, bRot: 0, bDepth: 0, bFeather: 0, bShape: 0, bTiles: 0, bFloat: 0,
  gSlip: .35, gRgb: .35, gBlock: .25, gPunch: .3, gWarp: .1, gStutter: 0, gDecay: .3, gEvery: 0, audioGain: .6,
  echoMix: 0, echoDiv: 2, echoFb: .55, verb: 0,
  wbX: 0, wbY: 0, bbX: 0, bbY: 0, wideW: 0, wideB: 0, hue: 0, sat: 1, gamma: 1, bright: 0, contrast: 1, cnr: 0, mosaic: 0, strobe: 0, post: 0, neg: 0, tint: 0, tintHue: .08,
  tmode: 0, tdepth: 16, tmix: 1,
  fbMode: 0, fbAmt: .5, fbZoom: 1.03, fbRot: .6, fbX: 0, fbY: 0, fbHue: .012, fbGain: .96, fbThr: .3, fbBlur: .3, fbTube: 0,
  maskType: 0, curv: .55, scan: .5, mask: .4, bloom: .45, conv: .3, chroma: .35, noise: .1, hum: .18, roll: 0, jitter: .12, persist: .45, vig: .5, tgain: 1.05, lines: 0,
  modSrc: 0, xAuto: 0, xDiv: 4, diceEvery: 0, glide: 1.5
};
const P = Object.assign({}, DEF);
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
{ const s = LS.get('phosphor-cut-fx2'); if (s) for (const k in s) if (k in DEF && typeof s[k] === 'number') P[k] = s[k]; }
let saveT = 0; function saveFx() { clearTimeout(saveT); saveT = setTimeout(() => { LS.set('phosphor-cut-fx2', P); LS.set('phosphor-cut-dice', { DICE, AUTO }); }, 400); }

const pct = v => Math.round(v * 100) + '';
const deg = v => Math.round(v * 360) + '°';
const dgr = v => v.toFixed(1) + '°';
// range control. r = the range the dice is allowed to roll (kept gentle on purpose)
const R = (id, label, min, max, step, fmt = pct, r = null) => ({ t: 'r', id, label, min, max, step, fmt, r });
// choice control (segmented buttons). r = indexes the dice may pick
const CH = (id, label, opts, r = null) => ({ t: 'ch', id, label, opts, r });
const MIX_MODES = ['ワイプ', 'ミックス', 'キー', '明るい方', '差分', '加算', 'スクリーン', '乗算'];
const APPEARS = ['カット', 'フェード', 'ぼやっと', '奥から', 'スライド', 'グリッチ', '電源オン'];
const T_MODES = ['オフ', 'ディレイ', '縦スリット', '横スリット', '輝度で時差', 'ブロック', 'エコー', 'RGB 時差'];
const FB_MODES = ['輝度キー', '明るい方', '加算', '重ね'];
const MASKS = ['アパーチャグリル', 'シャドウマスク', 'スロット'];
const BG_COLORS = [[0, 0, 0], [1, 1, 1], [.85, .1, .1], [.1, .75, .2], [.12, .2, .9], [.95, .85, .1], [.1, .85, .9], [.85, .15, .8]];
const layerDefs = k => [
  R(k + 'Scale', '大きさ', .2, 2, .01, v => '×' + v.toFixed(2), [.55, 1.15]), R(k + 'X', '横の位置', -.6, .6, .005, v => (v * 100 | 0) + '', [-.3, .3]), R(k + 'Y', '縦の位置', -.6, .6, .005, v => (v * 100 | 0) + '', [-.25, .25]),
  R(k + 'Rot', '傾き', -.6, .6, .005, v => Math.round(v * 57.3) + '°', [-.12, .12]), R(k + 'Depth', '奥行き', 0, 1, .01, pct, [0, .6]), R(k + 'Feather', '縁のぼかし', 0, 1, .01, pct, [0, .8]),
  R(k + 'Float', 'ゆらぎ', 0, 1, .01, pct, [0, .6]), CH(k + 'Shape', '形', ['四角', '楕円']), CH(k + 'Tiles', '並べる', ['1', '2', '3', '4'].map(x => x + ' 枚'))
];
const SECS = {
  mix: { h: 'Mix', jp: 'A と B の重ね方', defs: [CH('mixMode', '合成モード', MIX_MODES, [0, 1, 2, 3, 6]), 'wipes', CH('fit', '画角', ['フィル', '全体', '引き伸ばし']),
    R('soft', '境界のぼかし', 0, .3, .005, pct, [.01, .2]), R('border', '境界線', 0, .06, .002, v => (v * 1000 | 0) + '', [0, .02]), R('borderHue', '境界線の色', 0, 1, .01, deg), R('keyThr', 'キーのしきい値', 0, 1, .01, pct, [.25, .65]), 'bgs'] },
  appear: { h: 'Appear', jp: '素材の現れ方・消え方', defs: [CH('appear', '現れ方', APPEARS, [1, 2, 3, 4, 5, 6]), R('appearT', '現れる時間', .1, 4, .05, v => v.toFixed(2) + 's', [.5, 2.5]), 'automix'] },
  layer: { h: 'Layers', jp: 'A / B それぞれの位置・大きさ・奥行き', defs: ['layers'] },
  glitch: { h: 'Glitch', jp: '拍や音に合わせて画が崩れる', defs: [R('gSlip', '走査ずれ', 0, 1, .01, pct, [.1, .6]), R('gRgb', 'RGB ずれ', 0, 1, .01, pct, [.1, .6]), R('gBlock', 'ブロック時差', 0, 1, .01, pct, [0, .5]),
    R('gPunch', 'ズームの脈', 0, 1, .01, pct, [0, .6]), R('gWarp', '波うち', 0, 1, .01, pct, [0, .4]), R('gStutter', '拍スタッター', 0, 1, .01, pct, [0, .4]), R('gDecay', '余韻', .05, 1.2, .01, v => v.toFixed(2) + 's', [.15, .6]),
    R('audioGain', '音への感度', 0, 1.5, .01, pct), CH('gEvery', '崩れるタイミング', ['毎拍', '2 拍', '1 小節', '裏拍も'], [0, 1, 2])] },
  echo: { h: 'Echo', jp: 'ディレイとリバーブのような残像', defs: [R('echoMix', 'ディレイの量', 0, 1, .01, pct, [0, .6]), CH('echoDiv', 'ディレイの間隔', ['1/16 拍', '1/8 拍', '1/4 拍', '1/2 拍']), R('echoFb', 'くり返し', 0, .9, .01, pct, [.3, .75]), R('verb', 'リバーブ（残光の霧）', 0, 1, .01, pct, [0, .55])] },
  time: { h: 'Time', jp: '画面の場所ごとに違う時刻を見せる', defs: [CH('tmode', '時間モード', T_MODES, [0, 0, 1, 2, 3, 4, 6, 7]), R('tdepth', '時間の深さ（コマ）', 1, 31, 1, v => v + '', [4, 24]), R('tmix', '効き具合', 0, 1, .01, pct, [.4, 1]), 'timebtns'] },
  fb: { h: 'Feedback', jp: 'カメラでブラウン管を撮る帰還ループ', defs: [CH('fbMode', '帰還キー', FB_MODES, [0, 1, 3]), R('fbAmt', '帰還量', 0, 1, .01, pct, [.2, .75]), R('fbZoom', 'ズーム', .85, 1.2, .002, v => '×' + v.toFixed(3), [.96, 1.06]),
    R('fbRot', '回転（度/コマ）', -6, 6, .05, v => v.toFixed(2), [-1.5, 1.5]), R('fbX', '横ずれ', -.04, .04, .0005, v => (v * 1000).toFixed(1), [-.008, .008]), R('fbY', '縦ずれ', -.04, .04, .0005, v => (v * 1000).toFixed(1), [-.008, .008]),
    R('fbHue', '色の回り', -.08, .08, .001, v => (v * 360).toFixed(1) + '°', [-.025, .025]), R('fbGain', 'ゲイン', .7, 1.12, .002, v => v.toFixed(3), [.92, 1.0]), R('fbThr', 'キーのしきい値', 0, 1, .01, pct, [.15, .55]), R('fbBlur', 'にじみ', 0, 1, .01, pct, [0, .6]), 'fbbtns'] },
  cc: { h: 'Color', jp: 'XV-C900 ふうの色補正', defs: ['joys', R('hue', '色合い HUE', -.5, .5, .005, deg, [-.12, .12]), R('sat', '色の濃さ COLOR', 0, 2.5, .01, pct, [.6, 1.6]), R('gamma', 'ガンマ', .4, 2.5, .01, v => v.toFixed(2), [.8, 1.3]),
    R('bright', '明るさ', -.5, .5, .01, pct, [-.06, .08]), R('contrast', 'コントラスト', .3, 2.2, .01, pct, [.85, 1.3]), R('cnr', '色ノイズ低減 CNR', 0, 1, .01, pct, [0, .7]), R('mosaic', 'モザイク', 0, 1, .01, pct, [0, .35]),
    R('strobe', 'ストロボ（コマ）', 0, 12, 1, v => v ? v + '' : 'オフ', [0, 3]), R('post', 'ペイント（階調）', 0, 1, .01, pct, [0, .45]), R('neg', 'ネガ反転', 0, 1, .01, pct, [0, .15]), R('tint', 'セピア / 単色化', 0, 1, .01, pct, [0, .6]), R('tintHue', '単色化の色', 0, 1, .005, deg), 'ccreset'] },
  tube: { h: 'Tube', jp: 'ブラウン管そのもの', defs: [CH('maskType', 'マスク', MASKS), CH('lines', '走査線', ['240 本', '480 本']), R('curv', '管面の丸み', 0, 1, .01, pct, [.2, .8]), R('scan', '走査線の濃さ', 0, 1, .01, pct, [.2, .75]), R('mask', 'マスクの濃さ', 0, 1, .01, pct, [.15, .6]),
    R('bloom', 'にじむ光', 0, 1, .01, pct, [.2, .75]), R('conv', 'コンバーゼンスずれ', 0, 1, .01, pct, [0, .6]), R('chroma', '色にじみ', 0, 1, .01, pct, [.1, .7]), R('noise', 'スノーノイズ', 0, 1, .01, pct, [0, .25]), R('hum', 'ハムバー', 0, 1, .01, pct, [0, .4]),
    R('roll', '垂直同期（ロール）', -1, 1, .01, v => (v * 100 | 0) + '', [0, 0]), R('jitter', '横ゆれ', 0, 1, .01, pct, [0, .35]), R('persist', '残光', 0, .97, .01, pct, [.2, .8]), R('vig', '周辺減光', 0, 1, .01, pct, [.2, .7]), R('tgain', '輝度', .6, 1.6, .01, v => v.toFixed(2))] }
};
SECS.layer.defs = ['layers', ...layerDefs('a'), ...layerDefs('b')];
// which controls the dice moves (checkbox next to each) and which sections roll by themselves on the auto-dice beat
const DICE_ON = ['mixMode', 'appear', 'bScale', 'bX', 'bY', 'bDepth', 'bFeather', 'bFloat', 'aDepth', 'gSlip', 'gRgb', 'gBlock', 'gPunch', 'echoMix', 'verb', 'tmode', 'tdepth',
  'fbAmt', 'fbZoom', 'fbRot', 'fbHue', 'hue', 'sat', 'tint', 'tintHue', 'bloom', 'conv', 'chroma', 'persist'];
let DICE = {}, AUTO = { mix: 0, appear: 1, layer: 1, glitch: 1, echo: 1, time: 0, fb: 1, cc: 0, tube: 0 };
DICE_ON.forEach(k => DICE[k] = 1);
{ const s = LS.get('phosphor-cut-dice'); if (s) { if (s.DICE) DICE = s.DICE; if (s.AUTO) Object.assign(AUTO, s.AUTO); } }
const PRESETS = {
  '標準': {},
  'ふわっと重ねる': { mixMode: 6, appear: 2, appearT: 2, bScale: .75, bDepth: .35, bFeather: .7, bShape: 1, bFloat: .5, verb: .35, fbAmt: .35 },
  'DJ 交互カット': { mixMode: 1, xAuto: 2, xDiv: 2, gSlip: .5, gRgb: .45, gPunch: .45, gStutter: .25, echoMix: .25 },
  '無限トンネル': { fbMode: 0, fbAmt: .9, fbZoom: .95, fbRot: 2.2, fbHue: .02, fbGain: 1.0, fbThr: .42, fbBlur: .15 },
  '奥行きの窓': { bScale: .6, bDepth: .45, bX: .2, bY: .1, bFeather: .25, aDepth: .2, bFloat: .4, mixMode: 1, fbAmt: .4, fbZoom: 1.01 },
  'スリットスキャン': { tmode: 2, tdepth: 31, fbAmt: .2, fbZoom: 1, fbRot: 0, persist: .3 },
  'ディレイの残響': { echoMix: .6, echoDiv: 2, echoFb: .7, verb: .4, fbAmt: .25 },
  '家庭用ビデオ 3倍': { cnr: .9, chroma: .9, jitter: .55, noise: .38, hum: .45, sat: .78, bloom: .55, fbAmt: .1, scan: .65, bright: .04 },
  'モアレ育成': { fbTube: 1, fbAmt: .8, fbZoom: 1.012, fbRot: .25, fbMode: 3, mask: .8, scan: .8, curv: .7 },
  '補正だけ': { fbAmt: 0, tmode: 0, gSlip: 0, gRgb: 0, gBlock: 0, gPunch: 0, gWarp: 0, curv: .2, scan: .2, mask: .1, noise: 0, hum: 0, jitter: 0, persist: 0, bloom: .2, conv: 0, chroma: .1 }
};
/* ---------------- WebGL ---------------- */
const cv = $('#screen');
const gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
const PW = 640, PH = 480, HW = 480, HH = 360, HL = 32, OW = 960, OH = 720;
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2DArray; in vec2 uv; out vec4 o;
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec3 toYiq(vec3 c){return vec3(dot(c,vec3(.299,.587,.114)),dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312)));}
vec3 fromYiq(vec3 y){return vec3(y.x+.956*y.y+.621*y.z,y.x-.272*y.y-.647*y.z,y.x-1.106*y.y+1.703*y.z);}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
vec3 hue3(float h){return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.);}
vec3 hueRot(vec3 c,float a){vec3 y=toYiq(c);float s=sin(a),k=cos(a);y.yz=mat2(k,-s,s,k)*y.yz;return fromYiq(y);}
`;
const FS_MIX = HEAD + `
uniform sampler2D uA,uB; uniform int uHas[2],uSty[2],uShape[2],uTiles[2],uFit,uMode,uWipe,uBg;
uniform float uAsp[2],uDep[2],uFea[2],uP[2],uAmt,uSoft,uBorder,uKey,uFade,uTime,uSeed; uniform vec4 uXf[2]; uniform vec3 uBorderCol,uBgCol;
float ease(float x){x=clamp(x,0.,1.);return x*x*(3.-2.*x);}
vec2 fitUV(vec2 q,float asp){float r=asp/(4./3.);vec2 s=vec2(1.);if(uFit==2)return q;if(uFit==0){if(r>1.)s.x=1./r;else s.y=r;}else{if(r>1.)s.y=r;else s.x=1./r;}return (q-.5)*s+.5;}
vec3 bars(vec2 q){float y=1.-q.y;int i=clamp(int(floor(q.x*7.)),0,6);
 vec3 c[7]=vec3[7](vec3(.75),vec3(.75,.75,0.),vec3(0.,.75,.75),vec3(0.,.75,0.),vec3(.75,0.,.75),vec3(.75,0.,0.),vec3(0.,0.,.75));
 vec3 d[7]=vec3[7](vec3(0.,0.,.75),vec3(.07),vec3(.75,0.,.75),vec3(.07),vec3(0.,.75,.75),vec3(.07),vec3(.75));
 if(y<.67)return c[i];if(y<.75)return d[i];float x=q.x;if(x<.18)return vec3(0.,.13,.3);if(x<.36)return vec3(1.);if(x<.54)return vec3(.2,0.,.42);return vec3(.07);}
float wipeV(vec2 q){float x=q.x,y=q.y,cx=x-.5,cy=y-.5;
 if(uWipe==0)return x; if(uWipe==1)return 1.-y; if(uWipe==2)return (x+1.-y)*.5; if(uWipe==3)return max(abs(cx),abs(cy))*2.;
 if(uWipe==4)return length(vec2(cx*4./3.,cy))/.8334; if(uWipe==5)return abs(cx)+abs(cy); if(uWipe==6)return fract(atan(cx,cy)/6.28318+1.);
 if(uWipe==7)return fract(y*8.); if(uWipe==8)return fract(x*10.); if(uWipe==9)return mod(floor(x*8.)+floor(y*6.),2.)*.5+fract(x*8.)*.5;
 if(uWipe==10)return abs(cx)*2.; if(uWipe==11)return abs(cy)*2.; if(uWipe==12)return max(x,1.-y); if(uWipe==13)return min(abs(cx),abs(cy))*2.;
 return hash(floor(q*vec2(32.,24.)));}
// one picture layer: transform (position / size / rotation / depth), soft mask, mirrored tiles and its entrance animation
vec4 layer(sampler2D t,int i,vec2 q){
 if(uHas[i]==0)return vec4(0.);
 float p=clamp(uP[i],0.,1.),e=1.-p; int st=uSty[i]; vec4 xf=uXf[i];
 float dep=uDep[i]; float sc=xf.z/(1.+dep*1.4); vec2 off=xf.xy; float blur=dep*2.5; float a=1.; float gain=1.-dep*.4;
 if(st==1)a=ease(p);
 else if(st==2){a=ease(p);blur+=e*5.;}
 else if(st==3){sc*=mix(.08,1.,ease(p));a=ease(p);blur+=e*2.;}
 else if(st==4){off.x+=(1.-ease(p))*1.3;}
 else if(st==5){float r=hash(vec2(floor(q.y*36.),floor(uTime*24.)));a=step(r,p*1.15);off.x+=(hash(vec2(floor(q.y*18.),floor(uTime*30.)+1.))-.5)*e*.5;}
 else if(st==6){float h=mix(.006,1.,ease(clamp(p*1.7-.7,0.,1.)));float w=ease(clamp(p*2.4,0.,1.));if(abs(q.y-.5)>h*.5||abs(q.x-.5)>w*.5)a=0.;gain*=1.+e*2.;}
 vec2 r=(q-.5-off)*vec2(4./3.,1.); float s=sin(-xf.w),k=cos(-xf.w); r=mat2(k,-s,s,k)*r/max(sc,.01); vec2 u=r/vec2(4./3.,1.)+.5;
 int tl=uTiles[i];
 if(tl>1){u=u*float(tl);vec2 f=fract(u);vec2 c=floor(u);u=mix(f,1.-f,mod(c,2.));}
 else if(u.x<0.||u.y<0.||u.x>1.||u.y>1.)return vec4(0.);
 float m=1.; float fe=uFea[i];
 if(uShape[i]==1)m=1.-smoothstep(.5-max(fe,.004)*.5,.5,length(u-.5));
 else if(fe>0.){vec2 d=min(u,1.-u);m=smoothstep(0.,fe*.5,d.x)*smoothstep(0.,fe*.5,d.y);}
 vec2 tu=fitUV(u,uAsp[i]); vec3 col=vec3(0.);
 if(!(tu.x<0.||tu.y<0.||tu.x>1.||tu.y>1.))col=textureLod(t,tu,blur).rgb;
 return vec4(col*gain,a*m);}
void main(){
 vec4 la=layer(uA,0,uv),lb=layer(uB,1,uv);
 vec3 a=la.rgb*la.a,b=lb.rgb; float ab=lb.a,amt=uAmt*ab; vec3 c=a;
 if(uMode==0){float e=max(uSoft,.0008);float w=wipeV(uv);float t=uAmt*(1.+2.*e)-e;float m=1.-smoothstep(t-e,t+e,w);c=mix(a,b,m*ab);
   if(uBorder>0.&&uAmt>.001&&uAmt<.999){float bd=1.-smoothstep(uBorder*.5,uBorder*.5+.003,abs(w-t));c=mix(c,uBorderCol,bd*ab);}}
 else if(uMode==1)c=mix(a,b,amt);
 else if(uMode==2){float k=smoothstep(uKey-uSoft-.01,uKey+uSoft+.01,luma(b));c=mix(a,b,k*amt);}
 else if(uMode==3)c=mix(a,max(a,b),amt);
 else if(uMode==4)c=mix(a,abs(a-b),amt);
 else if(uMode==5)c=a+b*amt;
 else if(uMode==6)c=mix(a,1.-(1.-a)*(1.-b),amt);
 else c=mix(a,a*b,amt);
 if(uHas[0]==0&&uHas[1]==0)c=vec3(hash(uv*vec2(640.,480.)+fract(uSeed))*.55);
 vec3 bg=uBg==8?bars(uv):uBgCol; c=mix(c,bg,uFade);
 o=vec4(clamp(c,0.,1.),1.);}`;
const FS_CC = HEAD + `
uniform sampler2D uM; uniform vec2 uWB,uBB; uniform float uRW,uRB,uHue,uSat,uGamma,uBright,uContrast,uCnr,uMosaic,uPost,uNeg,uTint,uTintHue;
void main(){vec2 q=uv;if(uMosaic>0.){float n=mix(200.,7.,pow(uMosaic,.6));vec2 g=vec2(n*4./3.,n);q=(floor(q*g)+.5)/g;}
 vec3 c=texture(uM,q).rgb;
 if(uCnr>0.){vec3 s=vec3(0.);for(int i=-3;i<=3;i++)s+=texture(uM,q+vec2(float(i)*uCnr*.003,0.)).rgb;s/=7.;vec3 yc=toYiq(c),ys=toYiq(s);c=fromYiq(vec3(yc.x,ys.yz));}
 float L=luma(c);
 vec3 wg=vec3(1.+uWB.x*uRW-uWB.y*uRW*.5,1.+uWB.y*uRW,1.-uWB.x*uRW-uWB.y*uRW*.5);
 c*=mix(vec3(1.),wg,smoothstep(0.,.75,L));
 c+=vec3(uBB.x-uBB.y*.5,uBB.y,-uBB.x-uBB.y*.5)*uRB*(1.-smoothstep(0.,.6,L));
 c=(c-.5)*uContrast+.5+uBright;
 c=pow(max(c,0.),vec3(1./uGamma));
 vec3 y=toYiq(c);float s=sin(uHue*6.28318),k=cos(uHue*6.28318);y.yz=mat2(k,-s,s,k)*y.yz*uSat;c=fromYiq(y);
 L=luma(c);vec3 tc=L*hue3(uTintHue)*1.25+L*L*.25;c=mix(c,tc,uTint);
 c=mix(c,1.-c,uNeg);
 if(uPost>0.){float lv=mix(14.,2.,uPost);c=floor(clamp(c,0.,1.)*lv+.5)/lv;}
 o=vec4(clamp(c,0.,1.),1.);}`;
const FS_COPY = HEAD + `uniform sampler2D uS; void main(){o=vec4(texture(uS,uv).rgb,1.);}`;
const FS_TIME = HEAD + `
uniform sampler2D uC; uniform sampler2DArray uH; uniform int uMode,uHead,uN; uniform float uD,uSeed,uMix;
vec3 hl(float lag,vec2 q){lag=clamp(lag,0.,float(uN-1));float l0=floor(lag);float f=lag-l0;
 float a=mod(float(uHead)-l0+float(uN)*4.,float(uN)),b=mod(float(uHead)-l0-1.+float(uN)*4.,float(uN));
 return mix(texture(uH,vec3(q,a)).rgb,texture(uH,vec3(q,b)).rgb,f);}
void main(){vec3 cur=texture(uC,uv).rgb;vec3 c=cur;float D=uD;
 if(uMode==1)c=hl(D,uv);
 else if(uMode==2)c=hl((1.-uv.y)*D,uv);
 else if(uMode==3)c=hl(uv.x*D,uv);
 else if(uMode==4)c=hl(luma(cur)*D,uv);
 else if(uMode==5){vec2 cell=floor(uv*vec2(16.,12.));c=hl(floor(hash(cell+uSeed)*(D+1.)),uv);}
 else if(uMode==6){c=cur*.36+hl(D*.25,uv)*.25+hl(D*.5,uv)*.18+hl(D*.75,uv)*.12+hl(D,uv)*.09;}
 else if(uMode==7){c=vec3(cur.r,hl(D*.5,uv).g,hl(D,uv).b);}
 o=vec4(mix(cur,c,uMix),1.);}`;
const FS_GLITCH = HEAD + `
uniform sampler2D uT; uniform sampler2DArray uH; uniform int uHead,uN; uniform float uEnv,uSlip,uRgb,uBlock,uSeed,uEchoMix,uEchoD,uEchoFb,uVerb,uPunch,uWarp,uTime;
vec3 hl(float lag,vec2 q){lag=clamp(lag,0.,float(uN-1));float l0=floor(lag);float f=lag-l0;
 float a=mod(float(uHead)-l0+float(uN)*4.,float(uN)),b=mod(float(uHead)-l0-1.+float(uN)*4.,float(uN));
 return mix(texture(uH,vec3(q,a)).rgb,texture(uH,vec3(q,b)).rgb,f);}
void main(){vec2 q=uv;
 q=(q-.5)/(1.+uPunch*uEnv*.12)+.5;
 q.x+=sin(q.y*11.+uTime*1.3)*uWarp*.012; q.y+=sin(q.x*8.+uTime*.9)*uWarp*.009;
 float band=floor(q.y*26.); float on=step(1.-uSlip*uEnv*.75,hash(vec2(band*1.7,uSeed+3.))); q.x+=(hash(vec2(band,uSeed))-.5)*on*.16*uEnv;
 float rs=uRgb*(.0015+uEnv*.012);
 vec3 c=vec3(texture(uT,q+vec2(rs,0.)).r,texture(uT,q).g,texture(uT,q-vec2(rs,rs*.3)).b);
 vec2 cell=floor(q*vec2(12.,9.));
 if(hash(cell+uSeed)<uBlock*uEnv*.55)c=hl(3.+floor(hash(cell+uSeed+1.)*22.),q+(vec2(hash(cell),hash(cell+5.))-.5)*.06);
 if(uEchoMix>0.){vec3 e=vec3(0.);float w=uEchoFb;for(int k=1;k<=4;k++){e+=hl(uEchoD*float(k),q)*w;w*=uEchoFb;}c=1.-(1.-c)*(1.-clamp(e*uEchoMix,0.,1.));}
 if(uVerb>0.){vec3 v=vec3(0.);for(int k=1;k<=8;k++){float fk=float(k);v+=hl(fk*3.,(q-.5)*(1.+fk*.006)+.5+vec2(sin(fk*2.1),cos(fk*1.7))*fk*.0012);}v/=8.;c=mix(c,max(c,v*1.05),uVerb);}
 o=vec4(clamp(c,0.,1.),1.);}`;
const FS_FB = HEAD + `
uniform sampler2D uT,uF; uniform float uAmt,uZoom,uRot,uHue,uGain,uThr,uBlur; uniform vec2 uOff; uniform int uMode;
void main(){vec3 cur=texture(uT,uv).rgb;
 vec2 p=(uv-.5)*vec2(4./3.,1.);float s=sin(uRot),k=cos(uRot);p=mat2(k,-s,s,k)*p/uZoom;vec2 q=p/vec2(4./3.,1.)+.5-uOff;
 vec3 fb=vec3(0.);
 if(q.x>=0.&&q.y>=0.&&q.x<=1.&&q.y<=1.){float r=uBlur*.004;fb=(texture(uF,q).rgb*2.+texture(uF,q+vec2(r,0.)).rgb+texture(uF,q-vec2(r,0.)).rgb+texture(uF,q+vec2(0.,r)).rgb+texture(uF,q-vec2(0.,r)).rgb)/6.;}
 fb=max(hueRot(fb,uHue*6.28318),0.)*uGain;
 vec3 c;
 if(uMode==0){float m=smoothstep(uThr-.08,uThr+.08,luma(cur));c=mix(mix(cur,fb,uAmt),cur,m);}
 else if(uMode==1)c=mix(cur,max(cur,fb),uAmt);
 else if(uMode==2)c=cur+fb*uAmt*.6;
 else c=mix(cur,fb,uAmt*.94);
 o=vec4(clamp(c,0.,1.),1.);}`;
const FS_PERSIST = HEAD + `uniform sampler2D uF,uP; uniform float uDecay; void main(){vec3 n=texture(uF,uv).rgb;vec3 p=texture(uP,uv).rgb*uDecay;o=vec4(max(n,p),1.);}`;
const FS_TUBE = HEAD + `
uniform sampler2D uP; uniform vec2 uOut; uniform float uCurv,uScan,uMask,uBloom,uConv,uChroma,uNoise,uHum,uRoll,uJit,uVig,uTime,uGain,uLines,uField; uniform int uMaskType;
vec2 curve(vec2 q){q=q*2.-1.;float k=mix(40.,3.4,uCurv);vec2 off=abs(q.yx)/k;q+=q*off*off;return q*.5+.5;}
vec3 tap(vec2 q){return texture(uP,q).rgb;}
void main(){vec2 q=curve(uv);
 vec2 e=smoothstep(vec2(0.),vec2(.006),q)*smoothstep(vec2(0.),vec2(.006),1.-q);float inside=e.x*e.y;
 if(inside<=0.){o=vec4(0.,0.,0.,1.);return;}
 float yy=q.y+uRoll; float blank=1.; float fy=fract(yy); if(uRoll!=0.){blank=smoothstep(0.,.025,fy)*smoothstep(1.,.985,fy);} q.y=fy;
 float line=floor(q.y*uLines);
 q.x+=(hash(vec2(line,floor(uTime*30.)))-.5)*uJit*.006+sin(q.y*38.+uTime*2.7)*uJit*.0025;
 float cv=uConv*.0025;
 vec3 c=vec3(tap(q+vec2(cv,0.)).r,tap(q).g,tap(q-vec2(cv,cv*.4)).b);
 if(uChroma>0.){vec3 s=vec3(0.);for(int i=1;i<=4;i++)s+=tap(q-vec2(float(i)*uChroma*.0035,0.));s/=4.;vec3 a=toYiq(c),b=toYiq(s);c=fromYiq(vec3(a.x,mix(a.yz,b.yz,.85)));}
 if(uBloom>0.){vec3 bl=textureLod(uP,q,2.5).rgb*.5+textureLod(uP,q,4.).rgb*.35+textureLod(uP,q,5.5).rgb*.25;c+=bl*bl*uBloom*.9;}
 float sl=.5+.5*cos((q.y*uLines+uField*.5)*6.28318);float L=luma(c);
 c*=mix(1.,mix(.35,1.,pow(sl,mix(2.,.6,clamp(L,0.,1.)))),uScan);
 vec2 fc=gl_FragCoord.xy; vec3 m=vec3(1.);
 if(uMaskType==0){int i=int(mod(fc.x,3.));m=i==0?vec3(1.,.25,.25):i==1?vec3(.25,1.,.25):vec3(.25,.25,1.);}
 else if(uMaskType==1){float sh=mod(floor(fc.y/2.),2.)*1.5;int i=int(mod(fc.x+sh,3.));m=i==0?vec3(1.,.3,.3):i==1?vec3(.3,1.,.3):vec3(.3,.3,1.);if(mod(fc.y,2.)<1.)m*=.8;}
 else{int i=int(mod(fc.x,3.));m=i==0?vec3(1.,.3,.3):i==1?vec3(.3,1.,.3):vec3(.3,.3,1.);float r=mod(fc.y+floor(fc.x/3.)*2.,6.);if(r<1.)m*=.4;}
 c*=mix(vec3(1.),m,uMask);
 c*=1.+uMask*.75+uScan*.35;
 c*=1.-uHum*.22*(.5+.5*sin((q.y-uTime*.11)*6.28318));
 c+=(hash(uv*uOut+fract(uTime*7.13))-.5)*uNoise*.55;
 float v=pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.28);c*=mix(1.,v,uVig);
 c*=uGain*blank*inside;
 c+=vec3(.035,.04,.045)*smoothstep(.55,0.,length(uv-vec2(.28,.82)))*uCurv;
 o=vec4(clamp(c,0.,1.),1.);}`;

let PR = {}, T_ = {}, F16 = false, histTex, histFb, quad;
let glOk = !!gl;
function mkProg(fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function mkTex(w, h, fmt, mip) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const f16 = fmt === 'f16';
  if (mip) { gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA8, w, h); }
  else gl.texImage2D(gl.TEXTURE_2D, 0, f16 ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, f16 ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function mkTarget(w, h, fmt, mip) { const tex = mkTex(w, h, fmt, mip); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return { tex, fb, w, h, mip }; }
function clearTarget(t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
function initGL() {
  if (!gl) return false;
  try {
    F16 = !!gl.getExtension('EXT_color_buffer_float');
    PR.mix = mkProg(FS_MIX); PR.cc = mkProg(FS_CC); PR.copy = mkProg(FS_COPY); PR.time = mkProg(FS_TIME); PR.glitch = mkProg(FS_GLITCH); PR.fb = mkProg(FS_FB); PR.persist = mkProg(FS_PERSIST); PR.tube = mkProg(FS_TUBE);
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    T_.srcA = mkTex(2, 2); T_.srcB = mkTex(2, 2);
    for (const t of [T_.srcA, T_.srcB]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    T_.M = mkTarget(PW, PH); T_.C = mkTarget(PW, PH); T_.T = mkTarget(PW, PH); T_.G = mkTarget(PW, PH);
    const ff = F16 ? 'f16' : 'u8'; T_.F = [mkTarget(PW, PH, ff), mkTarget(PW, PH, ff)];
    T_.P = [mkTarget(PW, PH, 'u8', true), mkTarget(PW, PH, 'u8', true)];
    T_.D = mkTarget(OW, OH);
    histTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, histTex); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HW, HH, HL);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    histFb = gl.createFramebuffer();
    for (const t of [T_.M, T_.C, T_.T, T_.G, ...T_.F, ...T_.P, T_.D]) clearTarget(t);
    return true;
  } catch (e) { console.error(e); return false; }
}
function pass(prog, target, tex, uni) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
  gl.viewport(0, 0, target ? target.w : cv.width, target ? target.h : cv.height);
  gl.useProgram(prog.p);
  let unit = 0;
  for (const k in tex) { const [t, kind] = Array.isArray(tex[k]) ? tex[k] : [tex[k], 0]; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(kind ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, t); if (prog.u[k]) gl.uniform1i(prog.u[k], unit); unit++; }
  for (const k in uni) {
    const l = prog.u[k] || prog.u[k + '[0]']; if (!l) continue; const v = uni[k];
    if (typeof v === 'number') gl.uniform1f(l, v); else if (v.i != null) gl.uniform1i(l, v.i);
    else if (v.iv) gl.uniform1iv(l, v.iv); else if (v.fv) gl.uniform1fv(l, v.fv); else if (v.f4) gl.uniform4fv(l, v.f4);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
const I = i => ({ i: i | 0 });
function upload(tex, el) {
  gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el); gl.generateMipmap(gl.TEXTURE_2D); } catch (e) { }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

/* ---------------- clips (bin) ---------------- */
const clips = []; let clipSeq = 1, selClip = null;
const PALETTE = ['#e0a33a', '#4fb3d9', '#d9645a', '#7bc96f', '#b48be0', '#e07fb0', '#d6cf5a', '#5ad6b4'];
function newClip(kind, name, extra = {}) { const c = Object.assign({ id: 'c' + (clipSeq++), kind, name, dur: 30, in: 0, out: 30, w: 640, h: 480, color: PALETTE[(clipSeq - 2) % PALETTE.length], thumb: '', busy: '' }, extra); clips.push(c); return c; }
const clipById = id => clips.find(c => c.id === id) || null;

const TS_EXT = ['m2ts', 'mts', 'm2t', 'ts', 'tod', 'mod'];
async function addFiles(list) { for (const f of list) await addFile(f); }
async function addFile(f) {
  const name = f.name || 'file'; const ext = (name.split('.').pop() || '').toLowerCase();
  if (TS_EXT.includes(ext) || f.type === 'video/mp2t') return addTs(f, name);
  if (f.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp'].includes(ext)) return addImage(f, name);
  const c = newClip('video', name, { busy: '読込中' }); renderBin();
  try { const m = await probeVideo(f); finishVideo(c, m, f); }
  catch (e) {
    removeClip(c);
    const why = ext === 'mov' || ext === 'qt' ? `「${name}」はこのブラウザで再生できない MOV です。ProRes は Mac の Safari だけで再生できます。HEVC はハードウェアデコードに対応した Chrome / Edge か Safari で開いてください。`
      : `「${name}」はこのブラウザで再生できない形式です。H.264 の MP4 / MOV、または M2TS で読み込んでください。`;
    toast(why, 9000);
  }
}
function probeVideo(src) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(src); const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = url; $('#hold').append(v);
    let done = false; const to = setTimeout(() => fail(new Error('timeout')), 25000);
    const fail = e => { if (done) return; done = true; clearTimeout(to); v.remove(); URL.revokeObjectURL(url); rej(e); };
    v.addEventListener('error', () => fail(new Error('decode')), { once: true });
    v.addEventListener('loadedmetadata', async () => {
      if (!v.videoWidth) return fail(new Error('novideo'));
      let d = v.duration;
      if (!isFinite(d)) { v.currentTime = 1e7; await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 4000); }); d = isFinite(v.duration) ? v.duration : 10; }
      v.currentTime = Math.min(d * .15, 2);
      await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 5000); });
      if (done) return;
      let thumb = ''; try { const k = document.createElement('canvas'); k.width = 160; k.height = 120; const x = k.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 160, 120); const s = Math.max(160 / v.videoWidth, 120 / v.videoHeight); x.drawImage(v, (160 - v.videoWidth * s) / 2, (120 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s); thumb = k.toDataURL('image/jpeg', .8); } catch (e) { }
      done = true; clearTimeout(to); res({ url, el: v, dur: d, w: v.videoWidth, h: v.videoHeight, thumb });
    }, { once: true });
  });
}
function finishVideo(c, m, blob, note) {
  Object.assign(c, { url: m.url, el: m.el, dur: m.dur, in: 0, out: m.dur, w: m.w, h: m.h, thumb: m.thumb, busy: '', blob });
  m.el.controls = true; m.el.muted = false; m.el.pause();
  if (note) c.note = note;
  renderBin(); onClipReady(c);
}
async function addTs(f, name) {
  let vcodecSeen = '';
  const c = newClip('video', name, { busy: '解析 0%' }); renderBin();
  try {
    const r = await TSRemux.remux(f, p => { c.busy = '詰め替え ' + Math.round(p * 100) + '%'; renderBin(); });
    const i = r.info; vcodecSeen = i.vcodec; const probe = document.createElement('video');
    let withAudio = r.hasAudio;
    if (withAudio && i.acodec === 'ac3' && !probe.canPlayType('audio/mp4; codecs="ac-3"')) withAudio = false;
    let blob = r.build(withAudio), m;
    try { m = await probeVideo(blob); }
    catch (e) { if (!withAudio) throw e; withAudio = false; blob = r.build(false); m = await probeVideo(blob); }
    const vc = i.vcodec === 'avc' ? 'H.264' : 'HEVC';
    let note = `${vc} ${i.w}×${i.h}${i.dispW !== i.w ? `（表示 ${i.dispW}×${i.h}）` : ''} を MP4 に詰め替え`;
    if (r.hasAudio && !withAudio) note += '・音声（' + i.acodec.toUpperCase() + '）はこのブラウザで鳴らせないので映像のみ';
    else if (i.unsupportedAudio) note += `・音声（${i.unsupportedAudio}）は未対応なので映像のみ`;
    else if (withAudio) note += '・音声 ' + i.acodec.toUpperCase();
    finishVideo(c, m, blob, note);
    toast(`「${name}」を読み込みました。${note}。`, 6000);
  } catch (e) {
    removeClip(c);
    const msg = e && (e.message === 'decode' || e.message === 'timeout') ? (vcodecSeen === 'hevc' ? `「${name}」は HEVC（H.265）です。このブラウザではデコードできませんでした。Safari か、ハードウェアデコード対応の Chrome / Edge でお試しください。` : `「${name}」の H.264 映像をこのブラウザがデコードできませんでした。Chrome・Safari・Edge でお試しください（一部の Linux 版 Chromium は H.264 を再生できません）。`) : (e && e.message && e.message.length > 12 ? e.message : `「${name}」を読み込めませんでした。`);
    toast(msg, 9000);
  }
}
function addImage(f, name) {
  const url = URL.createObjectURL(f); const img = new Image(); img.decoding = 'async';
  img.onload = () => {
    const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)); const k = document.createElement('canvas'); k.width = Math.round(img.naturalWidth * s); k.height = Math.round(img.naturalHeight * s); k.getContext('2d').drawImage(img, 0, 0, k.width, k.height);
    const tk = document.createElement('canvas'); tk.width = 160; tk.height = 120; const x = tk.getContext('2d'); const ss = Math.max(160 / k.width, 120 / k.height); x.drawImage(k, (160 - k.width * ss) / 2, (120 - k.height * ss) / 2, k.width * ss, k.height * ss);
    URL.revokeObjectURL(url);
    const c = newClip('image', name, { canvas: k, w: k.width, h: k.height, dur: 4, out: 4, thumb: tk.toDataURL('image/jpeg', .8) }); renderBin(); onClipReady(c);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast(`「${name}」はこのブラウザで開けない画像です（HEIC は Safari で開けます）。`, 7000); };
  img.src = url;
}
async function addCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('この環境ではカメラが使えません。撮った動画をファイルとして読み込んでください。', 6000); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const c = newClip('live', 'ライブカメラ', { stream, dur: 3600, out: 3600, thumb: '' }); renderBin(); onClipReady(c);
    toast('カメラを素材に追加しました。タイムラインに置くか、パッドに割り当ててください。');
  } catch (e) { toast('カメラの使用が許可されませんでした。この画面ではカメラを使えないことがあります。撮った動画をファイルとして読み込んでください。', 7000); }
}
function removeClip(c) {
  const i = clips.indexOf(c); if (i >= 0) clips.splice(i, 1);
  for (const k of ['A', 'B']) tracks[k] = tracks[k].filter(s => s.clip !== c.id);
  pads.forEach((p, j) => { if (p === c.id) pads[j] = null; });
  for (const [k, v] of pool) if (v.clip === c) poolFree(k);
  try { if (c.el) { c.el.pause(); c.el.remove(); } if (c.url) URL.revokeObjectURL(c.url); if (c.stream) c.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
  if (selClip === c) selClip = null;
  for (const k of ['A', 'B']) if (decks[k].clip === c) { decks[k].clip = null; decks[k].dir = 0; }
  renderDecks();
  renderBin(); renderPads(); renderTimeline();
}

/* ---------------- media element pool + audio graph ---------------- */
const pool = new Map();
let AC = null, master = null, recDest = null; const buses = {};
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => { }); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.connect(AC.destination);
    recDest = AC.createMediaStreamDestination(); master.connect(recDest);
    analyser = AC.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .5; fbuf = new Uint8Array(analyser.frequencyBinCount); master.connect(analyser);
    for (const k of ['A', 'B', 'P']) { buses[k] = AC.createGain(); buses[k].connect(master); }
    pool.forEach(connectAudio);
  } catch (e) { AC = null; }
}
function connectAudio(v) {
  if (!AC || v.node || v.clip.kind !== 'video') return;
  try { v.node = AC.createMediaElementSource(v.el); v.g = AC.createGain(); v.g.gain.value = 0; v.node.connect(v.g); v.g.connect(buses[v.bus]); v.el.muted = false; } catch (e) { }
}
function poolGet(key, clip) {
  let v = pool.get(key); if (v && v.clip === clip) return v; if (v) poolFree(key);
  const el = document.createElement('video'); el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'auto'; el.muted = true;
  if (clip.kind === 'live') { el.srcObject = clip.stream; el.play().catch(() => { }); } else el.src = clip.url;
  $('#hold').append(el); v = { key, clip, el, bus: key }; pool.set(key, v); connectAudio(v); return v;
}
function poolFree(key) { const v = pool.get(key); if (!v) return; try { v.el.pause(); if (v.node) v.node.disconnect(); v.el.removeAttribute('src'); v.el.srcObject = null; v.el.load(); v.el.remove(); } catch (e) { } pool.delete(key); }

/* ---------------- timeline model ---------------- */
const tracks = { A: [], B: [] }; let segSeq = 1, selSeg = null;
const pads = new Array(8).fill(null);
function mkSeg(clip, start, len, o = {}) {
  return Object.assign({ id: 's' + (segSeq++), clip: clip.id, start, len, in: clip.in, out: clip.out, speed: 1, rev: 0, stutter: 0, rep: 2, vol: 1, mode: -1, wipe: -1, fade: 0 }, o);
}
function seqEnd() { let e = 0; for (const k of ['A', 'B']) for (const s of tracks[k]) e = Math.max(e, s.start + s.len); return e; }
const undoStack = [];
function pushUndo() { undoStack.push(JSON.stringify(tracks)); if (undoStack.length > 80) undoStack.shift(); }
function undo() {
  const s = undoStack.pop(); if (!s) { toast('取り消せる操作がありません。', 2000); return; }
  const o = JSON.parse(s); tracks.A = o.A.filter(x => clipById(x.clip)); tracks.B = o.B.filter(x => clipById(x.clip));
  if (selSeg) selSeg = findSeg(selSeg.id); renderTimeline(); renderSegInsp();
}
function findSeg(id) { for (const k of ['A', 'B']) { const s = tracks[k].find(x => x.id === id); if (s) return s; } return null; }
function trackOf(seg) { return tracks.A.includes(seg) ? 'A' : tracks.B.includes(seg) ? 'B' : null; }
function activeSeg(k, t) { const L = tracks[k]; for (let i = L.length - 1; i >= 0; i--) { const s = L[i]; if (t >= s.start && t < s.start + s.len) return s; } return null; }
function srcSpan(seg) { const c = clipById(seg.clip); const out = Math.min(seg.out, c ? c.dur : seg.out); return Math.max(1 / 30, out - seg.in); }
function localTime(seg, t) {
  let u = t - seg.start;
  if (seg.stutter > 0) { const sl = seg.stutter, rep = Math.max(1, seg.rep); u = Math.floor(u / (sl * rep)) * sl + (u % sl); }
  const span = srcSpan(seg); const m = (u * seg.speed) % span;
  return seg.rev ? seg.in + span - m - 1 / 60 : seg.in + m;
}
function envelope(seg, t) { if (!seg.fade) return 1; return clamp(Math.min((t - seg.start) / seg.fade, (seg.start + seg.len - t) / seg.fade), 0, 1); }


/* ---------------- playback state ---------------- */
let T = 0, playing = false, loop = true, masterRate = 1, exporting = false;
let padHit = null, assignMode = false, latch = false, padRec = false;
let freeze = false, strobeCount = 0, histHead = 0, fbIdx = 0, rollPos = 0, field = 0, blockSeed = 1;
let lastNow = performance.now();

/* ---------------- live decks ---------------- */
const mkDeck = () => ({ clip: null, pos: 0, speed: 1, rev: 0, p: 0, dir: 0 });
const decks = { A: mkDeck(), B: mkDeck() };
const offAir = () => { if (!decks.A.clip && !decks.B.clip) return 'A'; return P.amt < .5 ? 'B' : 'A'; };
function loadDeck(k, c) {
  if (!c || c.busy) return;
  ensureAudio();
  const d = decks[k]; d.clip = c; d.pos = 0; d.dir = 1; d.p = P.appear === 0 ? 1 : 0; if (d.p >= 1) d.dir = 0;
  const v = pool.get(k); if (v && v.clip === c && c.kind === 'video') { try { v.el.currentTime = c.in; } catch (e) { } }
  if (P.autoMix && (decks.A.clip && decks.B.clip)) xGlide(k === 'A' ? 0 : 1, Math.max(P.appearT, beatSec() * 2));
  else if (!decks[k === 'A' ? 'B' : 'A'].clip) { xGlide(k === 'A' ? 0 : 1, .01); }
  renderDecks();
}
function ejectDeck(k) { const d = decks[k]; if (!d.clip) return; if (P.appear === 0) { d.clip = null; d.dir = 0; renderDecks(); } else d.dir = -1; }
let xAnim = null;
function xGlide(to, sec) { xAnim = { from: P.amt, to, t0: performance.now(), dur: Math.max(.01, sec) * 1000 }; }

/* ---------------- tempo clock + audio reaction ---------------- */
let bpm = LS.get('phosphor-cut-bpm') || 120, tickPh = 0, tickN = 0, beatN = 0, env = 0, gSeed = 1, holdF = 0, taps = [];
let analyser = null, fbuf = null, bassAvg = 0, lastOnset = 0, level = 0;
const beatSec = () => 60 / bpm;
function setBpm(v) { bpm = clamp(Math.round(v * 10) / 10, 40, 220); $('#bpm').textContent = bpm.toFixed(1); LS.set('phosphor-cut-bpm', bpm); }
function tap() {
  const n = performance.now(); if (taps.length && n - taps[taps.length - 1] > 2000) taps = []; taps.push(n); if (taps.length > 6) taps.shift();
  if (taps.length >= 3) { const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]); setBpm(60000 / (iv.reduce((a, b) => a + b) / iv.length)); }
  tickPh = 0; tickN = 0; beatN = 0; onTick();
}
function trigger() {
  env = 1; gSeed = Math.random() * 100; blockSeed = Math.random() * 100;
  if (P.gStutter > 0 && Math.random() < P.gStutter) holdF = Math.max(2, Math.round(30 * beatSec() / 4));
}
function onTick() { // two ticks per beat
  const even = tickN % 2 === 0;
  if (P.modSrc !== 1) { const ev = P.gEvery; if (ev === 3 || (even && (ev === 0 || (ev === 1 && tickN % 4 === 0) || (ev === 2 && tickN % 8 === 0)))) trigger(); }
  if (even) {
    const b = beatN; const leds = document.querySelectorAll('#beats i'); leds.forEach((l, i) => l.classList.toggle('on', i === b % 4));
    if (b > 0 && P.xAuto && b % P.xDiv === 0 && decks.A.clip && decks.B.clip) { const to = P.amt < .5 ? 1 : 0; if (P.xAuto === 2) { xAnim = null; P.amt = to; syncX(); } else xGlide(to, beatSec() * P.xDiv * .9); }
    if (b > 0 && P.diceEvery && b % P.diceEvery === 0) autoDice();
    beatN++;
  }
  tickN++;
}
function audioReact(now) {
  if (!analyser || P.modSrc === 0) { level = 0; return; }
  analyser.getByteFrequencyData(fbuf); let bass = 0, all = 0; for (let i = 0; i < fbuf.length; i++) { all += fbuf[i]; if (i < 8) bass += fbuf[i]; }
  bass /= 8 * 255; all /= fbuf.length * 255; level = all;
  if (bass - bassAvg > .1 && bass > .25 && now - lastOnset > 180) { lastOnset = now; trigger(); }
  bassAvg = lerp(bassAvg, bass, .06);
  env = Math.max(env, Math.min(1, all * P.audioGain * 2.2));
}

/* ---------------- dice ---------------- */
const glides = {};
const DEFS = {}; for (const k in SECS) for (const d of SECS[k].defs) if (typeof d === 'object') { d.sec = k; DEFS[d.id] = d; }
['wbX', 'wbY', 'bbX', 'bbY'].forEach(id => { DEFS[id] = { t: 'r', id, min: -1, max: 1, step: .01, r: [-.35, .35], sec: 'cc' }; });
function rollValue(d) {
  if (d.t === 'ch') { const pool = d.r || d.opts.map((_, i) => i); return pool[Math.floor(Math.random() * pool.length)]; }
  const r = d.r || [lerp(DEF[d.id], d.min, .5), lerp(DEF[d.id], d.max, .5)];
  const v = r[0] + Math.random() * (r[1] - r[0]); return d.step >= 1 ? Math.round(v) : v;
}
function setTarget(id, v, glide) {
  const d = DEFS[id];
  if (d.t === 'ch' || !glide) { delete glides[id]; P[id] = v; return; }
  glides[id] = { from: P[id], to: v, t0: performance.now(), dur: glide * 1000 };
}
function rollSection(sec, glide = P.glide) { let n = 0; for (const id in DEFS) { const d = DEFS[id]; if (d.sec === sec && DICE[id]) { setTarget(id, rollValue(d), glide); n++; } } syncAll(); saveFx(); return n; }
function autoDice() { let n = 0; for (const s in AUTO) if (AUTO[s]) n += rollSection(s); return n; }
function diceAll() { let n = 0; for (const s in SECS) n += rollSection(s); toast(n ? `チェックした ${n} 項目を振りました。` : 'ダイスの対象がありません。各項目の左のチェックを入れてください。', 1800); }
function stepGlides(now) {
  let any = false;
  for (const id in glides) { const g = glides[id]; const k = clamp((now - g.t0) / g.dur, 0, 1); const e = k * k * (3 - 2 * k); P[id] = lerp(g.from, g.to, e); any = true; if (k >= 1) delete glides[id]; }
  return any;
}

/* ---------------- sources ---------------- */
function driveVideo(v, local, rate, continuous) {
  const el = v.el; if (el.readyState < 1) return;
  const dur = v.clip.dur || el.duration || 0; local = clamp(local, 0, Math.max(0, dur - 1 / 60));
  if (continuous) {
    if (Math.abs(el.playbackRate - rate) > 1e-3) { try { el.playbackRate = rate; } catch (e) { } }
    if (el.paused) { if (Math.abs(el.currentTime - local) > .08) el.currentTime = local; el.play().catch(() => { }); }
    else if (!el.seeking && Math.abs(el.currentTime - local) > .3 + .08 * rate) el.currentTime = local;
  } else {
    if (!el.paused) el.pause();
    if (!el.seeking && Math.abs(el.currentTime - local) > .02) el.currentTime = local;
  }
}
function resolveSource(key, clip, local, rate, continuous, vol) {
  if (clip.kind === 'image') return { clip, img: clip.canvas, asp: clip.w / clip.h, ready: true, still: true };
  const v = poolGet(key, clip); v.used = true;
  if (clip.kind === 'video') driveVideo(v, local, rate, continuous);
  if (v.g) v.g.gain.setTargetAtTime(vol, AC.currentTime, .03);
  const el = v.el; return { clip, img: el, asp: el.videoWidth ? el.videoWidth / el.videoHeight : 4 / 3, ready: el.readyState >= 2 && el.videoWidth > 0 };
}
const texOwner = { A: null, B: null }; const texAsp = { A: 4 / 3, B: 4 / 3 };
function pushTex(slot, src) {
  if (!src) return false;
  if (!src.ready) return texOwner[slot] !== null;
  if (src.still && texOwner[slot] === src.clip.id) return true;
  upload(slot === 'A' ? T_.srcA : T_.srcB, src.img); texOwner[slot] = src.clip.id; texAsp[slot] = src.asp; return true;
}
function clipSpan(c) { return Math.max(1 / 30, Math.min(c.out, c.dur) - c.in); }
function deckLocal(d) { const c = d.clip, span = clipSpan(c); const m = ((d.pos % span) + span) % span; return c.in + m; }
function layerXf(k, t) { // position / size / rotation with the slow "float" drift
  const f = P[k + 'Float']; const ph = k === 'a' ? 0 : 2.1;
  return [P[k + 'X'] + Math.sin(t * .31 + ph) * f * .06, P[k + 'Y'] + Math.cos(t * .23 + ph) * f * .045, P[k + 'Scale'] * (1 + Math.sin(t * .17 + ph) * f * .05), P[k + 'Rot'] + Math.sin(t * .13 + ph) * f * .04];
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(1, (now - lastNow) / 1000), dt = Math.min(.1, rawDt); lastNow = now; const ts = now / 1000;
  // clocks (tempo runs on wall-clock time even when frames drop)
  tickPh += rawDt * bpm / 30; while (tickPh >= 1) { tickPh -= 1; onTick(); }
  env *= Math.exp(-dt / Math.max(.05, P.gDecay)); audioReact(now);
  if (xAnim) { const k = clamp((now - xAnim.t0) / xAnim.dur, 0, 1); P.amt = lerp(xAnim.from, xAnim.to, k * k * (3 - 2 * k)); if (k >= 1) xAnim = null; syncX(); }
  if (stepGlides(now) && (frameN++ % 4 === 0)) syncAll();
  if (playing) {
    T += dt * masterRate; const end = seqEnd();
    if (T >= end) { if (exporting) { T = end; finishExport(); } else if (loop && end > 0) T = T % end; else { T = end; setPlaying(false); } }
  }
  for (const k of ['A', 'B']) {
    const d = decks[k]; if (!d.clip) continue;
    d.pos += dt * d.speed * masterRate * (d.rev ? -1 : 1);
    if (d.dir) { d.p += d.dir * dt / Math.max(.05, P.appearT); if (d.p >= 1) { d.p = 1; d.dir = 0; } if (d.p <= 0) { d.p = 0; d.dir = 0; d.clip = null; renderDecks(); } }
  }
  pool.forEach(v => { v.used = false; });
  // slot A: deck A, otherwise the timeline's A track
  let sA = null, pA = 1, sB = null, pB = 1, mode = P.mixMode, wipe = P.wipe, amt = P.amt;
  const fromSeg = (key, seg, vol) => { const c = clipById(seg.clip); if (!c || c.busy) return null; const r = seg.speed * masterRate; const cont = playing && !seg.rev && !seg.stutter && r >= .0625 && r <= 16; return resolveSource(key, c, localTime(seg, T), r, cont, vol); };
  const fromDeck = (key, d, vol) => { const r = d.speed * masterRate; return resolveSource(key, d.clip, deckLocal(d), r, !d.rev && r >= .0625 && r <= 16, vol); };
  if (decks.A.clip) { sA = fromDeck('A', decks.A, (1 - P.amt * .5) * decks.A.p); pA = decks.A.p; }
  else { const s = activeSeg('A', T); if (s) sA = fromSeg('A', s, s.vol); }
  if (padHit) {
    const c = padHit.clip; const loc = c.in + (((now - padHit.t0) / 1000) * masterRate) % clipSpan(c);
    sB = resolveSource('P', c, loc, masterRate, true, 1); amt = 1; pB = clamp((now - padHit.t0) / 1000 / Math.max(.05, P.appearT * .35), 0, 1);
    if (!padHit.started) { padHit.started = true; const v = pool.get('P'); if (v && c.kind === 'video') { try { v.el.currentTime = c.in; } catch (e) { } } }
  } else if (decks.B.clip) { sB = fromDeck('B', decks.B, P.amt * decks.B.p); pB = decks.B.p; }
  else { const s = activeSeg('B', T); if (s) { sB = fromSeg('B', s, s.vol * envelope(s, T) * P.amt); if (s.mode >= 0) mode = s.mode; if (s.wipe >= 0) wipe = s.wipe; amt = P.amt * envelope(s, T); } }
  pool.forEach(v => { if (!v.used) { if (!v.el.paused && v.clip.kind !== 'live') v.el.pause(); if (v.g) v.g.gain.setTargetAtTime(0, AC.currentTime, .03); } });
  if (master) master.gain.setTargetAtTime(P.fadeAudio ? 1 - P.fade : 1, AC.currentTime, .03);
  updateTally(sA, sB); updateAir();
  if (!glOk) { updateClock(); return; }

  let hold = freeze; if (holdF > 0) { holdF--; hold = true; }
  if (!hold && P.strobe > 0) { strobeCount = (strobeCount + 1) % (P.strobe + 1); hold = strobeCount !== 0; }
  if (!hold) {
    const hasA = pushTex('A', sA), hasB = pushTex('B', sB);
    const xa = layerXf('a', ts), xb = layerXf('b', ts);
    const sty = st => P.appear === 0 ? 0 : P.appear;
    pass(PR.mix, T_.M, { uA: T_.srcA, uB: T_.srcB }, {
      uHas: { iv: [hasA ? 1 : 0, hasB ? 1 : 0] }, uSty: { iv: [sty(), sty()] }, uShape: { iv: [P.aShape, P.bShape] }, uTiles: { iv: [P.aTiles + 1, P.bTiles + 1] },
      uAsp: { fv: [texAsp.A, texAsp.B] }, uDep: { fv: [P.aDepth, P.bDepth] }, uFea: { fv: [P.aFeather, P.bFeather] }, uP: { fv: [hasA ? pA : 0, hasB ? pB : 0] },
      uXf: { f4: [...xa, ...xb] }, uAmt: hasB ? amt : 0, uSoft: P.soft, uBorder: P.border, uKey: P.keyThr, uFade: P.fade, uTime: ts, uSeed: ts * .001,
      uFit: I(P.fit), uMode: I(mode), uWipe: I(wipe), uBg: I(P.bg), uBorderCol: hsl(P.borderHue, .9, .6), uBgCol: BG_COLORS[Math.min(7, P.bg)] || [0, 0, 0]
    });
  }
  const rw = P.wideW ? .55 : .2, rb = P.wideB ? .5 : .18;
  pass(PR.cc, T_.C, { uM: T_.M.tex }, { uWB: [P.wbX, P.wbY], uBB: [P.bbX, P.bbY], uRW: rw, uRB: rb, uHue: P.hue, uSat: P.sat, uGamma: P.gamma, uBright: P.bright, uContrast: P.contrast, uCnr: P.cnr, uMosaic: P.mosaic, uPost: P.post, uNeg: P.neg, uTint: P.tint, uTintHue: P.tintHue });
  histHead = (histHead + 1) % HL;
  gl.bindFramebuffer(gl.FRAMEBUFFER, histFb); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, histTex, 0, histHead);
  gl.viewport(0, 0, HW, HH); gl.useProgram(PR.copy.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T_.C.tex); gl.uniform1i(PR.copy.u.uS, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  pass(PR.time, T_.T, { uC: T_.C.tex, uH: [histTex, 1] }, { uMode: I(P.tmode), uHead: I(histHead), uN: I(HL), uD: P.tdepth, uSeed: blockSeed, uMix: P.tmix });
  const echoD = clamp([1 / 16, 1 / 8, 1 / 4, 1 / 2][P.echoDiv] * beatSec() * 30, 1, 7.7);
  pass(PR.glitch, T_.G, { uT: T_.T.tex, uH: [histTex, 1] }, { uHead: I(histHead), uN: I(HL), uEnv: env, uSlip: P.gSlip, uRgb: P.gRgb, uBlock: P.gBlock, uSeed: gSeed, uEchoMix: P.echoMix, uEchoD: echoD, uEchoFb: P.echoFb, uVerb: P.verb, uPunch: P.gPunch, uWarp: P.gWarp * (.4 + .6 * env), uTime: ts });
  const prevF = T_.F[fbIdx], nextF = T_.F[1 - fbIdx];
  pass(PR.fb, nextF, { uT: T_.G.tex, uF: P.fbTube ? T_.D.tex : prevF.tex }, { uAmt: P.fbAmt, uZoom: P.fbZoom, uRot: P.fbRot * Math.PI / 180, uHue: P.fbHue, uGain: P.fbGain, uThr: P.fbThr, uBlur: P.fbBlur, uOff: [P.fbX, P.fbY], uMode: I(P.fbMode) });
  fbIdx = 1 - fbIdx;
  const pp = T_.P[0], pn = T_.P[1]; T_.P = [pn, pp];
  pass(PR.persist, pn, { uF: nextF.tex, uP: pp.tex }, { uDecay: P.persist });
  gl.bindTexture(gl.TEXTURE_2D, pn.tex); gl.generateMipmap(gl.TEXTURE_2D);
  if (Math.abs(P.roll) > .015) rollPos = (rollPos + P.roll * dt * .6) % 1; else rollPos = Math.abs(rollPos) < .002 ? 0 : rollPos * .9;
  field = 1 - field;
  pass(PR.tube, T_.D, { uP: pn.tex }, {
    uOut: [OW, OH], uCurv: P.curv, uScan: P.scan, uMask: P.mask, uBloom: P.bloom, uConv: P.conv, uChroma: P.chroma, uNoise: P.noise, uHum: P.hum, uRoll: rollPos, uJit: P.jitter, uVig: P.vig,
    uTime: ts, uGain: P.tgain, uLines: P.lines ? 480 : 240, uField: field, uMaskType: I(P.maskType)
  });
  pass(PR.copy, null, { uS: T_.D.tex }, {});
  updateClock();
}
let frameN = 0;
function hsl(h, s, l) { const k = n => (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return [f(0), f(8), f(4)]; }

/* ---------------- UI: transport / status ---------------- */
function setPlaying(p) { playing = p; $('#bPlay').setAttribute('aria-pressed', p); $('#playLbl').textContent = p ? '停止' : '再生'; if (p) ensureAudio(); }
let lastTcText = '';
function updateClock() {
  const t = tcode(T); if (t !== lastTcText) { lastTcText = t; $('#tc').firstChild.textContent = t; }
  const ph = $('#phLine'); if (ph) ph.style.left = (T * pps) + 'px';
  if (playing && !dragging) { const sc = $('#tlScroll'); const x = T * pps; if (sc.clientWidth && (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 30)) sc.scrollLeft = Math.max(0, x - 60); }
}
let lastTally = '';
function updateTally(a, b) {
  const s = (a ? a.clip.id : '-') + (b ? b.clip.id : '-') + (padHit ? 1 : 0);
  if (s === lastTally) return; lastTally = s;
  $('#tA').classList.toggle('on', !!a); $('#tB').classList.toggle('on', !!b && !padHit); $('#tP').classList.toggle('on', !!padHit);
  $('#srcInfo').textContent = [a ? 'A ' + a.clip.name : 'A —', b ? (padHit ? 'PAD ' : 'B ') + b.clip.name : 'B —'].join('  /  ');
}
let lastAir = '';
function updateAir() {
  const s = (P.amt < .5 ? 'A' : 'B') + (decks.A.clip ? 1 : 0) + (decks.B.clip ? 1 : 0); if (s === lastAir) return; lastAir = s;
  $('#deckA').classList.toggle('air', !!decks.A.clip && P.amt < .98); $('#deckB').classList.toggle('air', !!decks.B.clip && P.amt > .02);
}
function syncX() { const x = $('#xf'); if (document.activeElement !== x || xAnim) x.value = P.amt; updateAir(); }

/* ---------------- UI: controls ---------------- */
const syncers = [];
function syncAll() { syncers.forEach(f => f()); }
function diceBox(id) {
  const b = document.createElement('input'); b.type = 'checkbox'; b.className = 'dk'; b.title = 'ダイスで動かす'; b.setAttribute('aria-label', 'ダイスで動かす');
  b.checked = !!DICE[id]; b.onchange = () => { DICE[id] = b.checked ? 1 : 0; saveFx(); }; b.onclick = e => e.stopPropagation(); return b;
}
function rangeCtl(d, host) {
  const w = document.createElement('div'); w.className = 'c'; const id = 'p-' + d.id;
  w.innerHTML = `<label class="lab" for="${id}"><b>${d.label}</b><output></output></label><input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}">`;
  w.querySelector('.lab').prepend(diceBox(d.id));
  const inp = w.querySelector('input[type=range]'), out = w.querySelector('output');
  const sync = () => { if (document.activeElement !== inp) inp.value = P[d.id]; out.textContent = d.fmt(P[d.id]); w.classList.toggle('moving', !!glides[d.id]); };
  inp.addEventListener('input', () => { delete glides[d.id]; P[d.id] = parseFloat(inp.value); out.textContent = d.fmt(P[d.id]); saveFx(); });
  inp.addEventListener('dblclick', () => { P[d.id] = DEF[d.id]; sync(); saveFx(); });
  sync(); host.append(w); syncers.push(sync);
}
function choiceCtl(d, host) {
  const w = document.createElement('div'); w.className = 'c'; w.style.gridColumn = '1/-1';
  const row = document.createElement('div'); row.className = 'segbar'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', d.label);
  row.append(diceBox(d.id)); const lab = document.createElement('span'); lab.className = 'silk'; lab.textContent = d.label; lab.style.marginRight = '4px'; row.append(lab);
  const bs = d.opts.map((l, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = l; b.onclick = () => { P[d.id] = i; syncAll(); saveFx(); }; row.append(b); return b; });
  syncers.push(() => bs.forEach((b, i) => b.setAttribute('aria-pressed', P[d.id] === i)));
  w.append(row); host.append(w);
}
function toggleBtn(label, key, host) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.innerHTML = '<span class="led"></span>' + label; b.onclick = () => { P[key] = P[key] ? 0 : 1; syncAll(); saveFx(); }; syncers.push(() => b.setAttribute('aria-pressed', !!P[key])); host.append(b); return b; }
function plainBtn(label, f, host, cls = '') { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = label; b.onclick = f; host.append(b); return b; }
function buildSection(key) {
  const S = SECS[key], host = $('#sec-' + key); host.innerHTML = '';
  const hd = document.createElement('div'); hd.className = 'sech';
  hd.innerHTML = `<h3>${S.h}<small>${S.jp}</small></h3>`;
  const db = document.createElement('button'); db.type = 'button'; db.className = 'btn sm dice'; db.innerHTML = '<b>⚄</b>ダイス'; db.title = 'この欄のチェックした項目を振る'; db.onclick = () => { const n = rollSection(key); if (!n) toast('この欄にダイスの対象がありません。項目の左のチェックを入れてください。', 2400); };
  const ab = document.createElement('button'); ab.type = 'button'; ab.className = 'btn sm'; ab.innerHTML = '<span class="led"></span>自動'; ab.title = '自動ダイスの拍でこの欄も振る';
  ab.onclick = () => { AUTO[key] = AUTO[key] ? 0 : 1; ab.setAttribute('aria-pressed', !!AUTO[key]); saveFx(); if (AUTO[key] && !P.diceEvery) toast('自動ダイスの間隔（左の Auto 欄）を選ぶと、拍に合わせて振られます。', 3200); };
  ab.setAttribute('aria-pressed', !!AUTO[key]);
  hd.append(db, ab); host.append(hd);
  let grid = null; const g = () => { if (!grid) { grid = document.createElement('div'); grid.className = 'cgrid'; host.append(grid); } return grid; };
  const flush = () => { grid = null; };
  for (const d of S.defs) {
    if (typeof d === 'object') { if (d.t === 'r') rangeCtl(d, g()); else { choiceCtl(d, g()); } continue; }
    flush();
    const box = document.createElement('div'); box.className = 'row'; host.append(box);
    if (d === 'wipes') { box.remove(); buildWipes(host); }
    else if (d === 'bgs') { box.className = 'bgs'; buildBgs(box); }
    else if (d === 'automix') { toggleBtn('読み込んだら自動でクロスフェード', 'autoMix', box); }
    else if (d === 'timebtns') { const f = plainBtn('フリーズ', () => { freeze = !freeze; f.setAttribute('aria-pressed', freeze); }, box); f.title = 'F キー'; plainBtn('ブロックを振り直す', () => { blockSeed = Math.random() * 100; }, box); }
    else if (d === 'fbbtns') { toggleBtn('管面ごと再撮影', 'fbTube', box); plainBtn('帰還を消す', () => { if (glOk) { T_.F.forEach(clearTarget); T_.P.forEach(clearTarget); } }, box); }
    else if (d === 'ccreset') { plainBtn('補正をリセット', () => { ['wbX', 'wbY', 'bbX', 'bbY', 'wideW', 'wideB', ...SECS.cc.defs.filter(x => typeof x === 'object').map(x => x.id)].forEach(k => P[k] = DEF[k]); syncAll(); saveFx(); }, box); }
    else if (d === 'joys') { box.remove(); buildJoys(host); }
    else if (d === 'layers') {
      box.remove(); const two = document.createElement('div'); two.className = 'lay2'; host.append(two);
      for (const k of ['a', 'b']) {
        const col = document.createElement('div'); col.className = k.toUpperCase(); col.innerHTML = `<h4>${k === 'a' ? 'LAYER A（下）' : 'LAYER B（上）'}</h4>`;
        const cg = document.createElement('div'); cg.className = 'cgrid'; col.append(cg); two.append(col);
        layerDefs(k).forEach(x => { const dd = DEFS[x.id]; if (dd.t === 'r') rangeCtl(dd, cg); else choiceCtl(dd, cg); });
        const rr = document.createElement('div'); rr.className = 'row'; rr.style.marginTop = '6px'; col.append(rr);
        plainBtn('元に戻す', () => { layerDefs(k).forEach(x => { delete glides[x.id]; P[x.id] = DEF[x.id]; }); syncAll(); saveFx(); }, rr);
      }
      break;
    }
  }
}
function buildJoys(host) {
  const wrap = document.createElement('div'); wrap.className = 'joys'; host.append(wrap);
  for (const [lab, kx, ky, wide] of [['White balance', 'wbX', 'wbY', 'wideW'], ['Black balance', 'bbX', 'bbY', 'wideB']]) {
    const j = document.createElement('div'); j.className = 'joy';
    j.innerHTML = `<span class="silk">${lab}</span><div class="pad2" role="slider" tabindex="0" aria-label="${lab}"><span class="ax" style="left:6px;top:48px">B</span><span class="ax" style="right:6px;top:48px">R</span><span class="ax" style="left:51px;top:6px">G</span><span class="ax" style="left:51px;bottom:6px">M</span><div class="stick"></div></div>`;
    const row = document.createElement('div'); row.className = 'row'; const dk = diceBox(kx); dk.onchange = () => { DICE[kx] = DICE[ky] = dk.checked ? 1 : 0; saveFx(); }; row.append(dk);
    toggleBtn('Wide', wide, row); plainBtn('中央', () => { P[kx] = P[ky] = 0; syncAll(); saveFx(); }, row);
    j.append(row); wrap.append(j); joystick(j.querySelector('.pad2'), kx, ky);
  }
}
function joystick(el, kx, ky) {
  const st = el.querySelector('.stick');
  const render = () => { const r = el.clientWidth / 2 - 17; st.style.left = (el.clientWidth / 2 + P[kx] * r) + 'px'; st.style.top = (el.clientHeight / 2 - P[ky] * r) + 'px'; };
  let drag = false;
  const at = e => { const b = el.getBoundingClientRect(); const r = b.width / 2 - 17; let x = (e.clientX - b.left - b.width / 2) / r, y = -(e.clientY - b.top - b.height / 2) / r; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } delete glides[kx]; delete glides[ky]; P[kx] = x; P[ky] = y; render(); saveFx(); };
  el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); at(e); });
  el.addEventListener('pointermove', e => { if (drag) at(e); });
  el.addEventListener('pointerup', () => drag = false); el.addEventListener('pointercancel', () => drag = false);
  el.addEventListener('dblclick', () => { P[kx] = 0; P[ky] = 0; render(); saveFx(); });
  el.addEventListener('keydown', e => { const s = .05; const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key]; if (m) { P[kx] = clamp(P[kx] + m[0], -1, 1); P[ky] = clamp(P[ky] + m[1], -1, 1); render(); saveFx(); e.preventDefault(); } });
  syncers.push(render); requestAnimationFrame(render);
}
function wipeJs(i, x, y) {
  const cx = x - .5, cy = y - .5; const fr = v => v - Math.floor(v);
  switch (i) {
    case 0: return x; case 1: return 1 - y; case 2: return (x + 1 - y) / 2; case 3: return Math.max(Math.abs(cx), Math.abs(cy)) * 2;
    case 4: return Math.hypot(cx * 4 / 3, cy) / .8334; case 5: return Math.abs(cx) + Math.abs(cy); case 6: return fr(Math.atan2(cx, cy) / 6.28318 + 1);
    case 7: return fr(y * 8); case 8: return fr(x * 10); case 9: return ((Math.floor(x * 8) + Math.floor(y * 6)) % 2) * .5 + fr(x * 8) * .5;
    case 10: return Math.abs(cx) * 2; case 11: return Math.abs(cy) * 2; case 12: return Math.max(x, 1 - y); case 13: return Math.min(Math.abs(cx), Math.abs(cy)) * 2;
    default: return fr(Math.sin(Math.floor(x * 32) * 12.9898 + Math.floor(y * 24) * 78.233) * 43758.5453);
  }
}
function buildWipes(parent) {
  const wrap = document.createElement('div'); wrap.className = 'c'; wrap.style.gap = '6px';
  const lab = document.createElement('div'); lab.className = 'chrow'; lab.append(diceBox('wipe')); const s = document.createElement('span'); s.className = 'silk'; s.textContent = 'ワイプパターン（ワイプ選択時）'; lab.append(s); wrap.append(lab);
  DEFS.wipe = { t: 'ch', id: 'wipe', opts: Array(15).fill(0), sec: 'mix' };
  const host = document.createElement('div'); host.className = 'wipes'; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'ワイプパターン'); wrap.append(host); parent.append(wrap);
  for (let i = 0; i < 15; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.title = 'ワイプ ' + (i + 1); b.setAttribute('aria-label', 'ワイプパターン ' + (i + 1));
    const k = document.createElement('canvas'); k.width = 48; k.height = 36; const x = k.getContext('2d'); const im = x.createImageData(48, 36);
    for (let py = 0; py < 36; py++) for (let px = 0; px < 48; px++) { const v = wipeJs(i, (px + .5) / 48, 1 - (py + .5) / 36); const on = v < .5; const o = (py * 48 + px) * 4; im.data[o] = on ? 143 : 255; im.data[o + 1] = on ? 183 : 211; im.data[o + 2] = on ? 255 : 110; im.data[o + 3] = 255; }
    x.putImageData(im, 0, 0); b.append(k); const n = document.createElement('span'); n.textContent = i + 1; b.append(n);
    b.onclick = () => { P.wipe = i; P.mixMode = 0; syncAll(); saveFx(); }; host.append(b);
  }
  syncers.push(() => [...host.children].forEach((b, i) => b.setAttribute('aria-pressed', P.wipe === i && P.mixMode === 0)));
}
function buildBgs(host) {
  const l = document.createElement('span'); l.className = 'silk'; l.textContent = 'Back color'; host.append(l);
  const all = [];
  BG_COLORS.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.style.background = `rgb(${c.map(v => Math.round(v * 255)).join(',')})`; b.setAttribute('aria-label', '背景色 ' + (i + 1)); b.onclick = () => { P.bg = i; syncAll(); saveFx(); }; host.append(b); all.push(b); });
  const bb = document.createElement('button'); bb.type = 'button'; bb.className = 'sw'; bb.setAttribute('aria-label', 'カラーバー'); bb.style.cssText = 'width:34px;background:linear-gradient(90deg,#c0c0c0 0 14%,#c0c000 14% 28%,#00c0c0 28% 43%,#00c000 43% 57%,#c000c0 57% 71%,#c00000 71% 86%,#0000c0 86%)';
  bb.onclick = () => { P.bg = 8; syncAll(); saveFx(); }; host.append(bb); all.push(bb);
  toggleBtn('音もフェード', 'fadeAudio', host);
  syncers.push(() => all.forEach((b, i) => b.setAttribute('aria-pressed', P.bg === i)));
}
function buildControls() {
  for (const k in SECS) buildSection(k);
  // tabs
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.tabp').forEach(p => p.hidden = p.dataset.p !== b.dataset.tab);
    LS.set('phosphor-cut-tab2', b.dataset.tab); if (b.dataset.tab === 'edit') renderTimeline();
  });
  const t = LS.get('phosphor-cut-tab2'); const tb = t && document.querySelector(`#tabs button[data-tab="${t}"]`); if (tb) tb.click();
  const ps = $('#preset'); ps.innerHTML = '<option value="">プリセット…</option>' + Object.keys(PRESETS).map(k => `<option>${k}</option>`).join('');
  ps.onchange = () => {
    const p = PRESETS[ps.value]; if (!p) return; const keep = {}; ['amt', 'fade', 'bg', 'fit', 'modSrc', 'diceEvery', 'glide', 'xDiv'].forEach(k => keep[k] = P[k]);
    for (const k in glides) delete glides[k]; Object.assign(P, DEF, keep, p); syncAll(); syncSelects(); saveFx(); toast('プリセット「' + ps.value + '」', 1800); ps.value = '';
  };
  // tempo / auto selects
  const sel = (id, key) => { const s = $('#' + id); s.onchange = () => { P[key] = +s.value; saveFx(); }; };
  sel('modSrc', 'modSrc'); sel('xAuto', 'xAuto'); sel('xDiv', 'xDiv'); sel('diceEvery', 'diceEvery');
  const gs = document.createElement('select'); gs.id = 'glideSel'; gs.setAttribute('aria-label', 'ダイスの変化の速さ');
  gs.innerHTML = [[0, '変化：すぐ'], [.5, 'ふわっと 0.5 秒'], [1.5, 'ふわっと 1.5 秒'], [4, 'ゆっくり 4 秒'], [8, 'とてもゆっくり 8 秒']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  gs.onchange = () => { P.glide = +gs.value; saveFx(); }; $('#diceEvery').after(gs);
  syncSelects();
  $('#xf').addEventListener('input', e => { xAnim = null; P.amt = +e.target.value; updateAir(); saveFx(); });
  $('#fadeR').addEventListener('input', e => { P.fade = +e.target.value; $('#oFade').textContent = Math.round(P.fade * 100); saveFx(); });
  syncers.push(() => { syncX(); $('#fadeR').value = P.fade; $('#oFade').textContent = Math.round(P.fade * 100); });
  syncAll();
}
function syncSelects() { $('#modSrc').value = P.modSrc; $('#xAuto').value = P.xAuto; $('#xDiv').value = P.xDiv; $('#diceEvery').value = P.diceEvery; const g = $('#glideSel'); if (g) g.value = P.glide; }

/* ---------------- UI: decks ---------------- */
function renderDecks() {
  for (const k of ['A', 'B']) {
    const d = decks[k], c = d.clip, host = $('#deck' + k); host.innerHTML = '';
    const hd = document.createElement('div'); hd.className = 'dh'; hd.innerHTML = `<b>DECK ${k}</b><i></i>`;
    if (c) { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn sm x'; x.textContent = '抜く'; x.title = 'デッキから外す（消え方は現れ方と同じ）'; x.onclick = () => ejectDeck(k); hd.append(x); }
    host.append(hd);
    const th = document.createElement('div'); th.className = 'dth' + (c ? '' : ' empty');
    if (c) { th.style.backgroundImage = c.thumb ? `url(${c.thumb})` : 'none'; th.innerHTML = `<span>${esc(c.name)}</span>`; }
    else th.textContent = '素材をタップ / ドロップ';
    host.append(th);
    if (c) {
      const ctl = document.createElement('div'); ctl.className = 'dctl';
      const r = document.createElement('input'); r.type = 'range'; r.min = .1; r.max = 3; r.step = .05; r.value = d.speed; r.setAttribute('aria-label', `デッキ ${k} の速度`);
      const o = document.createElement('output'); o.textContent = '×' + d.speed.toFixed(2);
      r.oninput = () => { d.speed = +r.value; o.textContent = '×' + d.speed.toFixed(2); }; r.ondblclick = () => { d.speed = 1; r.value = 1; o.textContent = '×1.00'; };
      const rv = document.createElement('button'); rv.type = 'button'; rv.className = 'btn sm'; rv.textContent = '逆'; rv.title = '逆再生'; rv.setAttribute('aria-pressed', !!d.rev); rv.onclick = () => { d.rev = d.rev ? 0 : 1; rv.setAttribute('aria-pressed', !!d.rev); };
      ctl.append(r, o, rv); host.append(ctl);
    }
  }
  lastAir = ''; updateAir();
}

/* ---------------- UI: clip strip (bin) ---------------- */
function renderBin() {
  const host = $('#strip'); host.innerHTML = '';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'clip add'; add.innerHTML = '<span><b>＋</b>素材を<br>入れる</span>'; add.onclick = () => $('#fFile').click(); host.append(add);
  for (const c of clips) {
    const b = document.createElement('div'); b.className = 'clip' + (selClip === c ? ' sel' : ''); b.tabIndex = 0; b.setAttribute('role', 'button');
    b.setAttribute('aria-label', `${c.name}：タップで空いている側のデッキに入れる`);
    const kind = { image: 'STILL', video: 'VIDEO', live: 'LIVE' }[c.kind];
    b.innerHTML = `<div class="th" style="background-image:${c.thumb ? `url(${c.thumb})` : 'none'}"><i style="background:${c.color}"></i><em>${c.kind === 'video' && !c.busy ? tcode(c.dur, false).slice(3) : kind}</em>${c.busy ? `<div class="busy">${esc(c.busy)}</div>` : ''}</div><div class="nm">${esc(c.name)}</div>` +
      (c.busy ? '' : `<div class="ab"><span class="a" data-k="A" title="デッキ A に入れる">A</span><span class="b" data-k="B" title="デッキ B に入れる">B</span><span class="i" data-k="i" title="詳細・タイムライン">i</span></div>`);
    b.onclick = e => {
      if (c.busy) return; const k = e.target.dataset && e.target.dataset.k;
      if (k === 'i') { selectClip(c); openTab('edit'); return; }
      loadDeck(k || offAir(), c);
    };
    b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (!c.busy) loadDeck(offAir(), c); } };
    b.draggable = !c.busy; b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-clip', c.id); e.dataTransfer.effectAllowed = 'copy'; });
    host.append(b);
  }
}
function openTab(t) { const b = document.querySelector(`#tabs button[data-tab="${t}"]`); if (b) b.click(); }
function onClipReady(c) {
  renderBin();
  if (pendingDeck) loadDeck(pendingDeck, c);
  else if (!decks.A.clip) loadDeck('A', c); else if (!decks.B.clip) loadDeck('B', c);
}
let delArm = null;
function selectClip(c) {
  selClip = c; renderBin();
  const box = $('#clipInsp'); box.hidden = !c; if (!c) return; box.innerHTML = '';
  const row = document.createElement('div'); row.className = 'insp-row';
  if (c.kind === 'video' && c.el) { c.el.style.cssText = ''; row.append(c.el); }
  else { const im = document.createElement('div'); im.style.cssText = `width:180px;max-width:100%;aspect-ratio:4/3;background:#000 url(${c.thumb}) center/cover;border-radius:3px;border:1px solid #000`; row.append(im); }
  const meta = document.createElement('div'); meta.className = 'meta';
  const inout = c.kind === 'video' ? `<div>IN ${tcode(c.in)}　OUT ${tcode(c.out)}　長さ ${fmtSec(c.out - c.in)}</div>` : '';
  meta.innerHTML = `<b>${esc(c.name)}</b>${inout}${c.note ? `<div>${esc(c.note)}</div>` : ''}`;
  row.append(meta); box.append(row);
  const bar = document.createElement('div'); bar.className = 'insp-row';
  const btn = (t, f, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = f; bar.append(b); return b; };
  if (c.kind === 'video') {
    btn('IN をここに', () => { c.in = Math.min(c.el.currentTime, c.out - .05); selectClip(c); });
    btn('OUT をここに', () => { c.out = Math.max(c.el.currentTime, c.in + .05); selectClip(c); });
    btn('IN/OUT を戻す', () => { c.in = 0; c.out = c.dur; selectClip(c); });
  }
  btn('デッキ A へ', () => loadDeck('A', c)); btn('デッキ B へ', () => loadDeck('B', c));
  btn('タイムライン A に置く', () => placeClip(c, 'A'), 'prime'); btn('タイムライン B に置く', () => placeClip(c, 'B'), 'prime');
  btn('パッドへ', () => { const i = pads.findIndex(p => !p); const j = i < 0 ? 7 : i; pads[j] = c.id; renderPads(); toast(`パッド ${j + 1} に割り当てました。`, 1800); });
  const d = btn('素材を外す', () => { if (delArm === c) { delArm = null; removeClip(c); $('#clipInsp').hidden = true; } else { delArm = c; d.textContent = 'もう一度押すと外す'; setTimeout(() => { if (delArm === c) { delArm = null; d.textContent = '素材を外す'; } }, 3000); } });
  box.append(bar);
}
function placeClip(c, k, at) {
  pushUndo();
  const start = at != null ? at : T; const len = c.kind === 'video' ? (c.out - c.in) : c.kind === 'image' ? 4 : 5;
  const s = mkSeg(c, Math.max(0, start), Math.max(.1, len), k === 'B' ? { fade: .5 } : {});
  if (c.kind !== 'video') { s.in = 0; s.out = c.dur; }
  tracks[k].push(s); selSeg = s; if (at == null) T = s.start + s.len;
  renderTimeline(); renderSegInsp();
}

/* ---------------- UI: pads ---------------- */
function renderPads() {
  const host = $('#pads'); host.innerHTML = '';
  pads.forEach((id, i) => {
    const c = clipById(id); const b = document.createElement('button'); b.type = 'button'; b.className = 'pad' + (c ? '' : ' empty') + (padHit && padHit.i === i ? ' hot' : '');
    b.setAttribute('aria-label', `パッド ${i + 1}${c ? '：' + c.name : '（空き）'}`);
    b.innerHTML = `<span class="th" style="${c && c.thumb ? `background-image:url(${c.thumb})` : ''}"></span><span class="k">${i + 1}</span><span class="n">${c ? esc(c.name) : '空き'}</span>`;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); padDown(i); });
    b.addEventListener('pointerup', () => padUp(i)); b.addEventListener('pointercancel', () => padUp(i));
    b.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); padDown(i); } });
    b.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); padUp(i); } });
    host.append(b);
  });
}
function padDown(i) {
  if (assignMode) { if (!selClip) { toast('先に Bin で素材を選んでから、パッドを押してください。', 2500); return; } pads[i] = selClip.id; renderPads(); return; }
  const c = clipById(pads[i]); if (!c) { toast('空きパッドです。素材を選んで「割り当て」をオンにしてから押すと登録できます。', 3000); return; }
  if (latch && padHit && padHit.i === i) { padRelease(); return; }
  if (padHit) padRelease();
  ensureAudio(); padHit = { i, clip: c, t0: performance.now(), T0: T, wasPlaying: playing }; renderPads();
}
function padUp(i) { if (!padHit || padHit.i !== i || latch) return; padRelease(); }
function padRelease() {
  const h = padHit; padHit = null;
  if (h && padRec && playing && h.wasPlaying) {
    let len = T - h.T0; if (len < 0) len += seqEnd();
    if (len > .05) { pushUndo(); const s = mkSeg(h.clip, h.T0, len, { fade: .1 }); if (h.clip.kind !== 'video') { s.in = 0; s.out = h.clip.dur; } tracks.B.push(s); renderTimeline(); }
  }
  renderPads();
}

/* ---------------- UI: timeline ---------------- */
let pps = 36, dragging = null;
function renderTimeline() {
  const sc = $('#tlScroll'), inner = $('#tlIn'); const end = seqEnd();
  const W = Math.max(sc.clientWidth, (end + 20) * pps); inner.style.width = W + 'px';
  for (const k of ['A', 'B']) {
    const lane = inner.querySelector(`.lane[data-t="${k}"]`); lane.innerHTML = '';
    tracks[k].forEach((s, z) => {
      const c = clipById(s.clip); if (!c) return;
      const d = document.createElement('div'); d.className = 'seg' + (selSeg === s ? ' sel' : ''); d.dataset.id = s.id; d.tabIndex = 0;
      d.style.left = s.start * pps + 'px'; d.style.width = Math.max(6, s.len * pps) + 'px'; d.style.zIndex = 1 + z;
      d.style.backgroundImage = `linear-gradient(${c.color}88,${c.color}55)${c.thumb ? `,url(${c.thumb})` : ''}`; d.style.borderLeft = `3px solid ${c.color}`;
      const tags = []; if (s.speed !== 1) tags.push('×' + s.speed.toFixed(2)); if (s.rev) tags.push('逆'); if (s.stutter) tags.push('STT'); if (k === 'B' && s.mode >= 0) tags.push(MIX_MODES[s.mode]); if (k === 'B' && s.wipe >= 0) tags.push('W' + (s.wipe + 1));
      const fw = s.fade ? Math.min(s.len / 2, s.fade) * pps : 0;
      d.innerHTML = `${fw ? `<span class="fadeL" style="width:${fw}px"></span><span class="fadeR" style="width:${fw}px"></span>` : ''}<span class="lbl">${esc(c.name)}</span><span class="tag">${tags.join(' ')}</span><span class="h l"></span><span class="h r"></span>`;
      d.setAttribute('aria-label', `${k} トラック ${c.name} ${fmtSec(s.start)} から ${fmtSec(s.len)}`);
      lane.append(d);
    });
  }
  drawRuler(W);
  $('#tcEnd').textContent = '/ ' + tcode(end, false);
  $('#tlInfo').textContent = `A ${tracks.A.length}・B ${tracks.B.length} セグメント`;
  updateClock();
}
function drawRuler(W) {
  const k = $('#rulerCv'); const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.min(W, 16000);
  k.width = Math.round(w * dpr); k.height = 24 * dpr; k.style.width = w + 'px';
  const x = k.getContext('2d'); x.scale(dpr, dpr); x.fillStyle = '#5c636b'; x.font = '10px "Share Tech Mono", monospace'; x.textBaseline = 'top';
  const major = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 10 ? 5 : 10;
  for (let s = 0; s * pps < w; s += major / (major === 1 ? 4 : 2)) {
    const px = Math.round(s * pps) + .5; const isMaj = Math.abs(s / major - Math.round(s / major)) < 1e-6;
    x.fillRect(px, isMaj ? 10 : 17, 1, isMaj ? 14 : 7); if (isMaj) x.fillText(tcode(s, false).slice(3), px + 3, 2);
  }
}
function laneAt(y) { for (const k of ['A', 'B']) { const r = $(`#tlIn .lane[data-t="${k}"]`).getBoundingClientRect(); if (y >= r.top && y < r.bottom) return k; } return null; }
function snapPoints(except) { const p = [0, T]; for (const k of ['A', 'B']) for (const s of tracks[k]) if (s !== except) p.push(s.start, s.start + s.len); return p; }
function snap(v, pts) { const th = 8 / pps; let best = v, bd = th; for (const p of pts) { const d = Math.abs(p - v); if (d < bd) { bd = d; best = p; } } return best; }
function initTimeline() {
  const inner = $('#tlIn');
  const scrubTo = e => { const r = inner.getBoundingClientRect(); T = clamp((e.clientX - r.left) / pps, 0, Math.max(seqEnd(), 0)); updateClock(); };
  inner.addEventListener('pointerdown', e => {
    const segEl = e.target.closest('.seg');
    if (!segEl) {
      if (e.target.closest('.ruler') || e.target.closest('.lane')) { if (selSeg) { selSeg = null; renderTimeline(); renderSegInsp(); } dragging = { mode: 'scrub' }; inner.setPointerCapture(e.pointerId); scrubTo(e); }
      return;
    }
    const s = findSeg(segEl.dataset.id); if (!s) return;
    if (selSeg !== s) { selSeg = s; renderSegInsp(); }
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    dragging = { mode, s, x0: e.clientX, start0: s.start, len0: s.len, in0: s.in, moved: false, pts: snapPoints(s), track: trackOf(s) };
    inner.setPointerCapture(e.pointerId); renderTimeline();
  });
  inner.addEventListener('pointermove', e => {
    if (!dragging) return;
    if (dragging.mode === 'scrub') { scrubTo(e); return; }
    const d = dragging, s = d.s; const dx = (e.clientX - d.x0) / pps;
    if (!d.moved) { if (Math.abs(e.clientX - d.x0) < 3) return; d.moved = true; pushUndo(); }
    if (d.mode === 'move') {
      let ns = Math.max(0, d.start0 + dx); const ne = snap(ns + s.len, d.pts); const sn = snap(ns, d.pts);
      ns = sn !== ns ? sn : ne !== ns + s.len ? ne - s.len : ns; s.start = Math.max(0, ns);
      const lk = laneAt(e.clientY); const cur = trackOf(s);
      if (lk && lk !== cur) { tracks[cur] = tracks[cur].filter(x => x !== s); tracks[lk].push(s); if (lk === 'B' && !s.fade) s.fade = .5; }
    } else if (d.mode === 'l') {
      const minStart = Math.max(0, d.start0 - d.in0 / s.speed);
      let ns = clamp(snap(d.start0 + dx, d.pts), minStart, d.start0 + d.len0 - .05); const delta = ns - d.start0;
      s.start = ns; s.len = d.len0 - delta; if (!s.rev) s.in = clamp(d.in0 + delta * s.speed, 0, s.out - 1 / 30);
    } else {
      const ne = snap(d.start0 + d.len0 + dx, d.pts); s.len = Math.max(.05, ne - s.start);
    }
    renderTimeline(); renderSegInspValues();
  });
  const up = () => { if (dragging && dragging.mode !== 'scrub' && dragging.moved) renderSegInsp(); dragging = null; };
  inner.addEventListener('pointerup', up); inner.addEventListener('pointercancel', up);
  // drop clips from the bin onto lanes
  inner.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-clip')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  inner.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/x-clip'); if (!id) return; e.preventDefault(); e.stopPropagation();
    const c = clipById(id); const k = laneAt(e.clientY) || 'A'; const r = inner.getBoundingClientRect();
    if (c) placeClip(c, k, snap(Math.max(0, (e.clientX - r.left) / pps), snapPoints(null)));
  });
  $('#bZi').onclick = () => zoom(1.4); $('#bZo').onclick = () => zoom(1 / 1.4);
  $('#tlScroll').addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
  $('#bSplit').onclick = splitSel; $('#bDel').onclick = delSel; $('#bUndo').onclick = undo;
  $('#bDup').onclick = () => { if (!selSeg) return noSel(); pushUndo(); const k = trackOf(selSeg); const n = Object.assign({}, selSeg, { id: 's' + (segSeq++), start: selSeg.start + selSeg.len }); tracks[k].push(n); selSeg = n; renderTimeline(); renderSegInsp(); };
  window.addEventListener('resize', () => renderTimeline());
}
function zoom(f) { const sc = $('#tlScroll'); const cx = T * pps - sc.scrollLeft; pps = clamp(pps * f, 4, 300); renderTimeline(); sc.scrollLeft = T * pps - cx; }
function noSel() { toast('タイムラインのセグメントを選んでください。', 2000); }
function splitSel() {
  const s = selSeg; if (!s) return noSel();
  if (T <= s.start + .02 || T >= s.start + s.len - .02) { toast('再生位置（赤い線）をセグメントの途中に置いてから分割してください。', 3000); return; }
  pushUndo(); const k = trackOf(s); const cut = T - s.start;
  const n = Object.assign({}, s, { id: 's' + (segSeq++), start: T, len: s.len - cut });
  if (!s.stutter) { const span = srcSpan(s); const m = (cut * s.speed) % span; if (!s.rev) n.in = s.in + m; else n.out = s.in + span - m; }
  s.len = cut; tracks[k].push(n); selSeg = n; renderTimeline(); renderSegInsp();
}
function delSel() { const s = selSeg; if (!s) return noSel(); pushUndo(); const k = trackOf(s); tracks[k] = tracks[k].filter(x => x !== s); selSeg = null; renderTimeline(); renderSegInsp(); }

let segInspCtl = [];
function renderSegInsp() {
  const box = $('#segInsp'); const s = selSeg; box.hidden = !s; box.innerHTML = ''; segInspCtl = []; if (!s) return;
  const c = clipById(s.clip); const k = trackOf(s);
  const head = document.createElement('div'); head.className = 'head';
  head.innerHTML = `<span class="chip ${k}">${k}</span><b>${esc(c ? c.name : '')}</b><span class="silk" id="siTime"></span>`;
  box.append(head);
  const grid = document.createElement('div'); grid.className = 'ctl-grid'; box.append(grid);
  const rng = (label, min, max, step, get, set, fmt) => {
    const w = document.createElement('label'); w.className = 'ctl'; const id = 'si-' + segInspCtl.length;
    w.innerHTML = `<span class="lab"><b>${label}</b><output></output></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}">`;
    const inp = w.querySelector('input'), out = w.querySelector('output');
    const sync = () => { inp.value = get(); out.textContent = fmt(get()); };
    let armed = false;
    inp.addEventListener('pointerdown', () => { armed = false; });
    inp.addEventListener('input', () => { if (!armed) { pushUndo(); armed = true; } set(parseFloat(inp.value)); out.textContent = fmt(get()); renderTimeline(); renderSegInspValues(); });
    inp.addEventListener('change', () => { armed = false; });
    sync(); segInspCtl.push(sync); grid.append(w);
  };
  rng('速度', .1, 4, .05, () => s.speed, v => { const old = s.speed; s.speed = v; if (!s.stutter) s.len = Math.max(.05, s.len * old / v); }, v => '×' + v.toFixed(2));
  rng('スタッター（区切り）', 0, 6, 1, () => [0, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1].findIndex(x => Math.abs(x - s.stutter) < 1e-4), v => { s.stutter = [0, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1][v | 0]; }, v => ['オフ', '1/30 秒', '1/15 秒', '1/8 秒', '1/4 秒', '1/2 秒', '1 秒'][v | 0] || 'オフ');
  rng('スタッター（繰り返し）', 1, 8, 1, () => s.rep, v => { s.rep = v; }, v => v + ' 回');
  rng('音量', 0, 1.5, .01, () => s.vol, v => { s.vol = v; }, v => Math.round(v * 100) + '');
  if (k === 'B') {
    rng('合成モード', -1, MIX_MODES.length - 1, 1, () => s.mode, v => { s.mode = v; }, v => v < 0 ? '共通（上の設定）' : MIX_MODES[v]);
    rng('ワイプパターン', -1, 14, 1, () => s.wipe, v => { s.wipe = v; }, v => v < 0 ? '共通（上の設定）' : (v + 1) + ' 番');
    rng('フェードイン / アウト', 0, 3, .05, () => s.fade, v => { s.fade = v; }, v => v ? v.toFixed(2) + 's' : 'なし');
  }
  const bar = document.createElement('div'); bar.className = 'insp-row'; box.append(bar);
  const btn = (t, f, pressed) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; if (pressed != null) { b.setAttribute('aria-pressed', pressed); b.innerHTML = '<span class="led"></span>' + t; } else b.textContent = t; b.onclick = f; bar.append(b); return b; };
  btn('逆再生', () => { pushUndo(); s.rev = s.rev ? 0 : 1; renderTimeline(); renderSegInsp(); }, !!s.rev);
  btn('長さを素材に合わせる', () => { pushUndo(); s.len = srcSpan(s) / s.speed * (s.stutter ? Math.max(1, s.rep) : 1); renderTimeline(); renderSegInspValues(); });
  btn(k === 'A' ? 'B へ移す' : 'A へ移す', () => { pushUndo(); const to = k === 'A' ? 'B' : 'A'; tracks[k] = tracks[k].filter(x => x !== s); tracks[to].push(s); if (to === 'B' && !s.fade) s.fade = .5; renderTimeline(); renderSegInsp(); });
  btn('再生位置へ', () => { T = s.start; updateClock(); });
  const note = document.createElement('p'); note.className = 'hint'; note.textContent = '右端を素材より長く伸ばすと、IN〜OUT の範囲がループします。端をドラッグで長さ、まん中をドラッグで移動（A↔B もドラッグで移せます）。';
  box.append(note);
  renderSegInspValues();
}
function renderSegInspValues() { const s = selSeg; if (!s) return; const el = $('#siTime'); if (el) el.textContent = `${tcode(s.start)} → ${tcode(s.start + s.len)}（${fmtSec(s.len)}）・素材 ${fmtSec(s.in)}〜${fmtSec(s.in + srcSpan(s))}`; segInspCtl.forEach(f => f()); }

/* ---------------- recording / export ---------------- */
let rec = null, recChunks = [], recBlob = null, recUrl = null, recKind = '';
const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
function startRec(kind) {
  if (!window.MediaRecorder || !cv.captureStream) { toast('このブラウザは録画（MediaRecorder）に対応していません。', 6000); return false; }
  ensureAudio();
  const vs = cv.captureStream(30); const tr = [...vs.getVideoTracks()]; if (recDest) tr.push(...recDest.stream.getAudioTracks());
  const mime = MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
  try { rec = new MediaRecorder(new MediaStream(tr), mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : {}); } catch (e) { toast('録画を開始できませんでした：' + e.message, 6000); return false; }
  recChunks = []; recKind = kind;
  rec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = () => { const type = rec.mimeType || mime || 'video/webm'; recBlob = new Blob(recChunks, { type }); rec = null; showResult(); };
  rec.start(500); $('#bRec').setAttribute('aria-pressed', 'true'); $('#bRec').innerHTML = '<span class="recdot"></span>録画中';
  return true;
}
function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); $('#bRec').setAttribute('aria-pressed', 'false'); $('#bRec').innerHTML = '<span class="led"></span>録画'; }
function startExport() {
  if (seqEnd() <= 0) { toast('タイムラインが空です。素材を A に置いてから書き出してください。', 3000); return; }
  if (rec) stopRec();
  T = 0; exporting = true; if (!startRec('export')) { exporting = false; return; }
  setPlaying(true); $('#bExport').disabled = true; toast(`書き出し中…（${tcode(seqEnd(), false)} を実時間で録画します）`, 0);
}
function finishExport() { exporting = false; setPlaying(false); $('#bExport').disabled = false; stopRec(); }
function showResult() {
  if (recUrl) URL.revokeObjectURL(recUrl); recUrl = URL.createObjectURL(recBlob);
  $('#toast').hidden = true; const m = $('#modal'); m.hidden = false; $('#mVid').src = recUrl;
  $('#mInfo').textContent = `${recBlob.type.includes('mp4') ? 'MP4' : 'WebM'}・${(recBlob.size / 1048576).toFixed(1)} MB`;
}
let DL = null, dlTried = false;
async function getDownloads() { if (dlTried) return DL; dlTried = true; try { if (window.claude && window.claude.use) DL = await window.claude.use('downloads'); } catch (e) { DL = null; } return DL; }
async function saveResult() {
  if (!recBlob) return; const ext = recBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date(), p = n => String(n).padStart(2, '0'); const name = `phosphor-cut-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename: name, data: recBlob }); toast('保存しました：' + name, 3000); }
    catch (e) { toast(e && e.code === 'declined' ? '保存をキャンセルしました。' : '保存できませんでした（' + ((e && e.code) || 'error') + '）。', 4000); }
    return;
  }
  const a = document.createElement('a'); a.href = recUrl; a.download = name; document.body.append(a); a.click(); a.remove(); toast('保存しました：' + name, 3000);
}


/* ---------------- wiring ---------------- */
function wire() {
  $('#bAdd').onclick = () => $('#fFile').click();
  $('#fFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  $('#bCam').onclick = addCamera;
  $('#bDiceAll').onclick = diceAll;
  $('#bPlay').onclick = () => { if (exporting) return; if (!seqEnd()) { toast('タイムラインが空です。素材の「i」→「タイムライン A に置く」で並べられます。デッキは再生ボタンなしで常に動いています。', 4200); return; } if (!playing && T >= seqEnd() - .01) T = 0; setPlaying(!playing); };
  $('#bHome').onclick = () => { if (exporting) return; T = 0; updateClock(); };
  $('#bLoop').onclick = () => { loop = !loop; $('#bLoop').setAttribute('aria-pressed', loop); };
  $('#bRec').onclick = () => { if (exporting) return; if (rec) stopRec(); else startRec('live'); };
  $('#bExport').onclick = startExport;
  $('#mClose').onclick = () => { $('#modal').hidden = true; $('#mVid').pause(); };
  $('#mSave').onclick = saveResult;
  $('#master').oninput = e => { masterRate = parseFloat(e.target.value); $('#oMaster').textContent = '×' + masterRate.toFixed(2); };
  $('#bpmDn').onclick = () => setBpm(bpm - 1); $('#bpmUp').onclick = () => setBpm(bpm + 1); $('#bTap').onclick = tap;
  $('#bAssign').onclick = () => { assignMode = !assignMode; $('#bAssign').setAttribute('aria-pressed', assignMode); if (assignMode) toast('素材の「i」で選んでからパッドを押すと割り当てます。終わったらもう一度「割り当て」を押してください。', 4000); };
  $('#bLatch').onclick = () => { latch = !latch; $('#bLatch').setAttribute('aria-pressed', latch); if (!latch && padHit) padRelease(); };
  $('#bPadRec').onclick = () => { padRec = !padRec; $('#bPadRec').setAttribute('aria-pressed', padRec); if (padRec) toast('タイムライン再生中にパッドを叩くと、押していた長さで B トラックに記録されます。', 3500); };
  // drop onto the monitor: left half → deck A, right half → deck B (clips from the strip, or files)
  const tube = $('#tube');
  const side = e => { const r = tube.getBoundingClientRect(); return e.clientX - r.left < r.width / 2 ? 'A' : 'B'; };
  tube.addEventListener('dragover', e => { const ty = [...e.dataTransfer.types]; if (ty.includes('text/x-clip') || ty.includes('Files')) { e.preventDefault(); e.stopPropagation(); const s = side(e); tube.classList.toggle('dropA', s === 'A'); tube.classList.toggle('dropB', s === 'B'); } });
  tube.addEventListener('dragleave', () => tube.classList.remove('dropA', 'dropB'));
  tube.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation(); tube.classList.remove('dropA', 'dropB'); const k = side(e);
    const id = e.dataTransfer.getData('text/x-clip'); if (id) { loadDeck(k, clipById(id)); return; }
    const files = [...(e.dataTransfer.files || [])]; if (!files.length) return;
    pendingDeck = k; await addFiles(files); pendingDeck = null;
  });
  const strip = $('#strip');
  window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); strip.classList.add('over'); } });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) strip.classList.remove('over'); });
  window.addEventListener('drop', e => { strip.classList.remove('over'); if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
  // keyboard
  const typing = e => /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  window.addEventListener('keydown', e => {
    if (typing(e) || e.altKey) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey) return;
    if (/^[1-8]$/.test(e.key)) { if (!e.repeat) padDown(+e.key - 1); e.preventDefault(); return; }
    if (e.target.closest && e.target.closest('button,[role=slider],[role=button],input')) { if (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow')) return; }
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); $('#bPlay').click(); }
    else if (k === 'x') { xAnim = null; P.amt = P.amt < .5 ? 1 : 0; syncX(); }
    else if (k === 'c') { xGlide(P.amt < .5 ? 1 : 0, beatSec() * 2); }
    else if (k === 'd') diceAll();
    else if (k === 't') tap();
    else if (k === 'g') trigger();
    else if (k === 'f') { freeze = !freeze; toast(freeze ? 'フリーズ' : 'フリーズ解除', 900); }
    else if (k === 's') splitSel();
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selSeg) { e.preventDefault(); delSel(); } }
    else if (e.key === 'ArrowLeft') { T = Math.max(0, T - (e.shiftKey ? 1 : 1 / 30)); updateClock(); }
    else if (e.key === 'ArrowRight') { T = T + (e.shiftKey ? 1 : 1 / 30); updateClock(); }
  });
  window.addEventListener('keyup', e => { if (/^[1-8]$/.test(e.key)) padUp(+e.key - 1); });
  document.addEventListener('pointerdown', () => { if (AC && AC.state === 'suspended') AC.resume().catch(() => { }); }, { capture: true });
  // keep the tab bar just under the pinned monitor on phones
  const pinH = () => { const p = $('#pin'); const sticky = getComputedStyle(p).position === 'sticky'; document.documentElement.style.setProperty('--pinH', sticky ? p.offsetHeight + 'px' : '0px'); };
  window.addEventListener('resize', pinH); new ResizeObserver(pinH).observe($('#pin')); pinH();
}
let pendingDeck = null;

/* ---------------- boot ---------------- */
glOk = initGL();
if (!glOk) toast('このブラウザでは WebGL2 が使えないため、映像処理を動かせません。最新の Chrome / Safari / Edge / Firefox で開いてください。', 0);
setBpm(bpm); buildControls(); renderBin(); renderDecks(); renderPads(); initTimeline(); renderTimeline(); wire();
requestAnimationFrame(frame);
getDownloads();
