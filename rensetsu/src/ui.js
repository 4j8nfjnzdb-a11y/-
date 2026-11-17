/* RENSETSU interface: audio scheduling, taps, live input, display and export. */
(function () {
'use strict';
const E = RS;
const $ = id => document.getElementById(id);
const inViewer = !!(window.claude && typeof window.claude.use === 'function');
const LOOK = 0.2, TAPE_MAX = 600, FILE_MAX = 360;
const CUE_SHORT = { a: '時間', b: '音高', c: '音色', d: '音量', e: '反復' };
const KS = { cand: '候補', tail: '前の音の尾' };
const KE = { next: '次の候補', merge: '吸収', cap: '上限', trunc: '切詰', end: '素材の終わり' };

let ctx = null, master = null;
const S = {
  mode: 'sample', files: [], live: null, nextId: 1,
  P: { maxLen: 200, sens: 50, density: 50, N: 8, cues: { a: true, b: true, c: true, d: true, e: true } },
  eng: true, seed: newSeed(), st: null, playing: false, sess: null, nextT: 0, timer: 0,
  queue: [], shown: null, gates: [], srcs: [], waiting: false,
  lv: { len: 30, keep: false, frozen: false, self: 'aec', full: false }, mic: null,
  lastInfo: 0,
};

function newSeed() {
  const a = new Uint32Array(1);
  try { crypto.getRandomValues(a); } catch (e) { a[0] = (Date.now() * 2654435761) >>> 0; }
  return a[0] >>> 0;
}
const hex = n => (n >>> 0).toString(16).padStart(8, '0');
const f2 = v => v.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '-.');
const sec = (p, sr) => (p / sr).toFixed(4);
function msg(t) { $('msg').textContent = t; }

// ---------- audio ----------
function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
  master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  return ctx;
}
function unlock() {
  ensureCtx();
  try { if (navigator.audioSession) navigator.audioSession.type = S.mode === 'live' ? 'play-and-record' : 'playback'; } catch (e) { /* older Safari */ }
  if (ctx.state !== 'running') ctx.resume();
  const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start(0);
}
const latency = () => Math.max(0, (ctx.outputLatency || 0) + (ctx.baseLatency || 0));
const mats = () => S.mode === 'live' ? (S.live ? [S.live] : []) : S.files;
const matLabel = m => S.mode === 'live' ? 'L' : String(m + 1);

// output tape: what was played, sample-exact, on the session clock
class Tape {
  constructor(sr, maxSec) { this.sr = sr; this.max = sr * maxSec; this.ch = []; this.len = 0; this.full = false; }
  write(off, data) {
    const sr = this.sr;
    for (let i = 0; i < data.length; i++) {
      const p = off + i;
      if (p < 0) continue;
      if (p >= this.max) { this.full = true; break; }
      const c = (p / sr) | 0, k = p - c * sr;
      while (this.ch.length <= c) this.ch.push(new Int16Array(sr));
      let v = data[i]; v = v > 1 ? 1 : v < -1 ? -1 : v;
      this.ch[c][k] = Math.round(v * 32767);
    }
    this.len = Math.max(this.len, Math.min(this.max, off + data.length));
  }
  wav() {
    const n = this.len, sr = this.sr, out = new Uint8Array(44 + n * 2), dv = new DataView(out.buffer);
    const w4 = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
    w4(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w4(8, 'WAVE'); w4(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w4(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let p = 0; p < n; p++) { const c = (p / sr) | 0, ch = this.ch[c]; dv.setInt16(44 + p * 2, ch ? ch[p - c * sr] : 0, true); }
    return out;
  }
}

// ---------- playing ----------
function start() {
  unlock();
  if (S.mode === 'live' && !S.mic) { micStart(); return; }
  const ms = mats();
  if (!ms.length) {
    msg(S.mode === 'live' ? 'マイクを開始して、素材がたまるのを待ってください。' : '素材がありません。ファイルを追加してください。');
    return;
  }
  stopPlay();
  readSeed();
  const sr = ctx.sampleRate, thr = E.sensThr(S.P.sens);
  S.st = E.newState(S.seed);
  S.st.cur = { m: 0, pos: S.mode === 'live' ? Math.max(ms[0].start, ms[0].end - Math.round(2 * sr)) : ms[0].start };
  S.sess = {
    t0: ctx.currentTime + 0.15, units: [], taps: [], events: [], tape: new Tape(sr, TAPE_MAX), lat: latency(),
    date: new Date(), seed: S.seed, mode: S.mode, P0: JSON.parse(JSON.stringify(S.P)), eng0: S.eng,
    mats: ms.map((m, i) => ({ n: matLabel(i), dur: m.dur, count: m.count(thr), hash: S.mode === 'live' ? '（ライブ）' : m.hash })),
  };
  S.nextT = S.sess.t0; S.queue = []; S.shown = null; S.gates = []; S.playing = true; S.waiting = false;
  S.timer = setInterval(tick, 25);
  tick();
  requestAnimationFrame(frame);
  msg(S.mode === 'live' ? 'ライブ入力の素材から鳴らしています。' : '鳴らしています。');
  syncUI();
}
function stopPlay() {
  if (!S.playing) return;
  S.playing = false;
  clearInterval(S.timer);
  for (const s of S.srcs) { try { s.stop(); } catch (e) { /* already ended */ } }
  S.srcs = [];
  syncUI();
}
function tick() {
  if (!S.playing) return;
  const now = ctx.currentTime;
  if (S.nextT < now + 0.005) S.nextT = now + 0.03;
  for (let k = 0; k < 12 && S.nextT < now + LOOK; k++) {
    const ms = mats();
    const rec = ms.length ? E.decide(S.st, ms, S.P, S.eng) : null;
    if (!rec) {
      S.nextT = now + 0.1;
      if (!S.waiting) { S.waiting = true; msg(S.mode === 'live' ? '素材がたまるのを待っています。' : '候補境界がありません。感度を上げるか、素材を足してください。'); }
      return;
    }
    if (S.waiting) { S.waiting = false; msg('鳴らしています。'); }
    play(rec, ms[rec.m]);
    S.nextT += rec.ioi;
  }
}
function play(rec, mat) {
  const data = E.render(mat, rec), sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, data.length, sr);
  if (buf.copyToChannel) buf.copyToChannel(data, 0); else buf.getChannelData(0).set(data);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(master); src.start(S.nextT);
  S.srcs.push(src);
  src.onended = () => { const i = S.srcs.indexOf(src); if (i >= 0) S.srcs.splice(i, 1); };
  rec.t = S.nextT - S.sess.t0;
  rec.ml = matLabel(rec.m);
  S.sess.tape.write(Math.round(rec.t * sr), data);
  S.sess.units.push(rec);
  S.queue.push(rec);
  S.gates.push([S.nextT, S.nextT + data.length / sr]);
  if (S.gates.length > 64) S.gates.shift();
}
function frame() {
  if (!S.playing) return;
  const t = ctx.currentTime - S.sess.t0 - S.sess.lat;
  let cur = null;
  while (S.queue.length && S.queue[0].t <= t) cur = S.queue.shift();
  if (cur) show(cur);
  const now = performance.now();
  if (now - S.lastInfo > 250) { S.lastInfo = now; expInfo(); if (S.mode === 'live') renderMats(); }
  requestAnimationFrame(frame);
}
function event(text) {
  if (!S.playing || !S.sess) return;
  S.sess.events.push({ t: ctx.currentTime - S.sess.t0, n: S.st.n + 1, text });
}

// ---------- display ----------
function unadopted(r, sr) {
  const a = r.absorbed.map(p => '内' + sec(p, sr)), b = r.skipped.map(p => (p < r.s ? '前' : '外') + sec(p, sr));
  return a.concat(b).join(' ') || '-';
}
function cutName(r) {
  const ke = r.ke === 'merge' ? `吸収${r.absorbed.length}` : KE[r.ke];
  return `始=${KS[r.ks]}  終=${ke}`;
}
function show(r) {
  S.shown = r;
  const sr = ctx.sampleRate, F = r.F;
  const f0 = F.voiced ? `${F.f0.toFixed(1)} Hz` : 'なし';
  $('now').textContent =
    `#${String(r.n).padStart(4, '0')}  ${r.eng === 'ON' ? 'エンジンON' : 'エンジンOFF'}  t ${r.t.toFixed(3)} s\n` +
    `素材 ${r.ml}  ${sec(r.s, sr)} – ${sec(r.e, sr)} s  (${((r.e - r.s) / sr * 1000).toFixed(1)} ms)\n` +
    `切り方 ${cutName(r)}\n` +
    `不採用の候補 ${unadopted(r, sr)}\n` +
    `次の間隔 ${r.ioi.toFixed(4)} s  発音 ${r.snd.toFixed(4)} s\n` +
    `f0 ${f0}（明瞭度 ${f2(F.clar)}）  重心 ${F.cent.toFixed(0)} Hz\n` +
    `量 ${r.L.toFixed(1)} dB  立上 ${F.rise.toFixed(0)} ms  平坦度 ${f2(F.fla)}`;
  const rows = E.CUES.map(c => {
    const on = S.P.cues[c], hi = r.S[c] > E.TH_HI[c];
    return `<tr class="${on ? '' : 'off'}"><td>${c} ${E.CUE_NAME[c]}</td><td class="n${hi ? ' hi' : ''}">${f2(r.S[c])}</td><td class="n">${f2(r.w[c])}</td><td>${on ? r.pred[c] : '（外す）'}</td></tr>`;
  });
  $('cueTab').tBodies[0].innerHTML = rows.join('');
  const st = S.st.stat, pc = k => st[k].pairs ? `${(st[k].simple / st[k].pairs * 100).toFixed(1)}%（${st[k].pairs}組）` : '—';
  $('cueNote').textContent =
    `食い違い ${f2(r.dis)}　閾値 ${f2(E.TH_HI.a)}（e ${f2(E.TH_HI.e)}）　下限 ${f2(E.TH_LO)}\n` +
    `単純な整数比に近い隣接間隔　ON ${pc('ON')}　OFF ${pc('OFF')}` +
    (r.eng === 'OFF' ? '\nエンジンOFF：強さは観察だけで、選択には使っていません。' : '');
  const br = [];
  for (let i = S.sess.units.length - 1; i >= 0 && br.length < 9; i--) {
    const u = S.sess.units[i];
    if (u.t > r.t) continue;
    if (u.eng === 'ON' && u.broken !== '-') br.push(`#${String(u.n).padStart(4, '0')}  ${u.broken}`);
  }
  $('broken').textContent = br.length ? br.join('\n') : 'まだありません';
  $('barUnit').textContent = '#' + String(r.n).padStart(4, '0');
  $('barModel').textContent = E.CUES.map(c => `${c} ${f2(r.w[c])}`).join('  ');
}
function syncUI() {
  $('mSample').setAttribute('aria-pressed', S.mode === 'sample');
  $('mLive').setAttribute('aria-pressed', S.mode === 'live');
  $('eOn').setAttribute('aria-pressed', S.eng);
  $('eOff').setAttribute('aria-pressed', !S.eng);
  $('barEng').textContent = S.eng ? 'エンジン ON' : 'エンジン OFF';
  $('barSeed').textContent = 'seed ' + hex(S.seed);
  $('go').textContent = S.playing ? '最初から' : '開始';
  $('stop').disabled = !S.playing;
  $('matSec').hidden = S.mode !== 'sample';
  $('liveSec').hidden = S.mode !== 'live';
  const has = !!(S.sess && S.sess.units.length);
  $('xWav').disabled = $('xLog').disabled = $('xTap').disabled = !has;
  $('kDrop').setAttribute('aria-pressed', !S.lv.keep);
  $('kKeep').setAttribute('aria-pressed', S.lv.keep);
  $('freeze').setAttribute('aria-pressed', S.lv.frozen);
  $('sAec').setAttribute('aria-pressed', S.lv.self === 'aec');
  $('sGate').setAttribute('aria-pressed', S.lv.self === 'gate');
  $('sNone').setAttribute('aria-pressed', S.lv.self === 'none');
  $('micBtn').textContent = S.mic ? 'マイクを止める' : 'マイクを開始';
  for (const c of E.CUES) $('cue_' + c).setAttribute('aria-pressed', S.P.cues[c]);
  if (!S.playing && !S.shown) $('barModel').textContent = E.CUES.map(c => `${c} ${f2(S.st ? S.st.w[c] : 0.2)}`).join('  ');
  expInfo();
  renderMats();
}
function renderMats() {
  const thr = E.sensThr(S.P.sens), tb = $('matTab').tBodies[0];
  if (S.mode === 'live') {
    const L = S.live;
    $('micState').textContent = !L ? (S.mic ? '取り込み中' : '止まっています')
      : `${S.mic ? (S.lv.frozen ? '凍結' : S.lv.full ? '満杯（取り込み停止）' : '取り込み中') : '止まっています'}　${L.dur.toFixed(1)} / ${S.lv.len} s　候補境界 ${L.count(thr)}`;
    return;
  }
  tb.innerHTML = S.files.length ? S.files.map((m, i) =>
    `<tr><td>${i + 1}</td><td class="n">${m.dur.toFixed(2)} s${m.trunc ? '（先頭のみ）' : ''}</td><td class="n">${m.count(thr)}</td><td><button type="button" data-rm="${i}">外す</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="dim">まだありません</td></tr>';
}
function expInfo() {
  const s = S.sess;
  if (!s) { $('expInfo').textContent = `録音 0:00 / ${TAPE_MAX / 60}:00`; return; }
  const t = s.tape.len / s.tape.sr, mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  $('expInfo').textContent = `録音 ${mm}:${String(ss).padStart(2, '0')} / ${TAPE_MAX / 60}:00${s.tape.full ? '（上限に達しました）' : ''}　単位 ${s.units.length}　タップ ${s.taps.length}`;
  const has = s.units.length > 0;
  if ($('xWav').disabled === has) { $('xWav').disabled = $('xLog').disabled = $('xTap').disabled = !has; }
}

// ---------- taps: the listener's line of segmentation ----------
// the time is taken when the finger lands; the tap counts once it lifts without having scrolled
function doTap(at) {
  const el = $('tap');
  el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 70);
  if (!S.playing || !S.sess || !S.sess.units.length) { $('tapInfo').textContent = '開始してから押してください'; return; }
  if (ctx.state !== 'running') ctx.resume();
  const t = (at === undefined ? ctx.currentTime : at) - S.sess.t0, heard = t - S.sess.lat, us = S.sess.units;
  let k = us.length - 1;
  while (k > 0 && us[k].t > heard - E.REACT) k--;
  const u = us[k].n;
  const tp = { id: S.sess.taps.length + 1, t, heard, u, eng: S.eng ? 'ON' : 'OFF' };
  S.sess.taps.push(tp);
  S.st.pendingTaps.push(tp);
  $('tapInfo').textContent = `タップ ${tp.id}　t ${t.toFixed(3)} s　境界 ${u - 1}|${u}　${S.eng ? '次の数音でこの切れ目の手がかりを弱めます' : '記録のみ（エンジンOFF）'}`;
}

// ---------- files ----------
function decodeWith(c, ab) {
  return new Promise((res, rej) => { const p = c.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
}
async function decode(ab) {
  const copy = ab.slice(0);
  try { return await decodeWith(ctx, ab); }
  catch (e) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) throw e;
    return await decodeWith(new OAC(2, ctx.sampleRate, ctx.sampleRate), copy);
  }
}
function mixdown(buf, maxSec) {
  const n = Math.min(buf.length, Math.round(maxSec * buf.sampleRate)), out = new Float32Array(n), ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
  return out;
}
async function addFiles(list) {
  if (!list.length) return;
  ensureCtx();
  let ok = 0, bad = 0;
  for (let i = 0; i < list.length; i++) {
    msg(`読み込み中 ${i + 1}/${list.length}`);
    try {
      const buf = await decode(await list[i].arrayBuffer());
      if (buf.sampleRate !== ctx.sampleRate) throw new Error('rate');
      const mono = mixdown(buf, FILE_MAX);
      const m = new E.Mat(S.nextId++, ctx.sampleRate, mono.length, false);
      await E.analyzeFile(m, mono, p => msg(`解析中 ${i + 1}/${list.length}　${Math.round(p * 100)}%`));
      m.hash = E.hashMat(m); m.trunc = buf.duration > FILE_MAX;
      S.files.push(m); ok++;
      renderMats();
    } catch (err) { bad++; }
  }
  msg(bad ? `${ok} 個を読み込みました。${bad} 個は読めませんでした（wav・mp3・m4a を選んでください）。` : `${ok} 個を読み込みました。開始を押してください。`);
  if (S.playing) event(`素材を追加（${S.files.length} 個に）`);
}

// ---------- live input ----------
const WK = `class C extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.i=0}
process(I){const x=I[0];if(x&&x.length){const a=x[0],c=x[1];for(let k=0;k<a.length;k++){this.b[this.i++]=c?(a[k]+c[k])*.5:a[k];
if(this.i===2048){this.port.postMessage({b:this.b,t:currentTime+(k+1)/sampleRate},[this.b.buffer]);this.b=new Float32Array(2048);this.i=0}}}return true}}
registerProcessor('rs-cap',C)`;
async function micStart() {
  unlock();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg(inViewer ? 'この表示ではマイクを使えません。index.html をブラウザで直接開くと使えます。' : 'このブラウザではマイクを使えません。');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: S.lv.self === 'aec', noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (err) {
    msg(inViewer ? 'この表示ではマイクを使えません。index.html をブラウザで直接開くと使えます。'
      : 'マイクの許可が得られませんでした。ブラウザの設定でこのページにマイクを許可してください。');
    return;
  }
  if (ctx.state !== 'running') await ctx.resume();
  if (!S.live) S.live = new E.Mat('L', ctx.sampleRate, Math.round(S.lv.len * ctx.sampleRate), true);
  S.live.frozen = S.lv.frozen;
  const src = ctx.createMediaStreamSource(stream), sink = ctx.createGain();
  sink.gain.value = 0; sink.connect(ctx.destination);
  let node = null;
  try {
    if (!ctx.audioWorklet || !window.AudioWorkletNode) throw new Error('no worklet');
    const url = URL.createObjectURL(new Blob([WK], { type: 'application/javascript' }));
    await Promise.race([ctx.audioWorklet.addModule(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    node = new AudioWorkletNode(ctx, 'rs-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = e => onChunk(e.data.b, e.data.t);
  } catch (err) {
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); onChunk(new Float32Array(d), e.playbackTime - (ctx.baseLatency || 0)); };
  }
  src.connect(node); node.connect(sink);
  S.mic = { stream, src, node, sink, timer: setInterval(() => { if (!S.playing) renderMats(); }, 300) };
  msg(S.playing ? 'マイクから取り込み直しています。' : 'マイクから素材を取り込んでいます。少したまったら開始を押してください。');
  syncUI();
}
function micStop() {
  const m = S.mic; if (!m) return;
  clearInterval(m.timer);
  try { m.src.disconnect(); m.node.disconnect(); m.sink.disconnect(); } catch (e) { /* already gone */ }
  if (m.node.port) m.node.port.onmessage = null;
  for (const t of m.stream.getTracks()) t.stop();
  S.mic = null;
  syncUI();
}
function onChunk(b, tEnd) {
  const L = S.live;
  if (!L || S.lv.frozen || !S.mic) return;
  if (S.lv.self === 'gate' && S.gates.length) {
    const sr = ctx.sampleRate, n = b.length;
    for (const [a, e] of S.gates) {
      const i0 = Math.max(0, Math.floor(n - 1 - (tEnd - (a - 0.005)) * sr)), i1 = Math.min(n, Math.ceil(n - 1 - (tEnd - (e + 0.15)) * sr));
      for (let i = i0; i < i1; i++) b[i] = 0;
    }
  }
  if (S.lv.keep && L.end - L.start + b.length > L.C) {
    if (!S.lv.full) { S.lv.full = true; L.frozen = true; event('バッファが満杯（古い部分を残す）'); }
    return;
  }
  L.append(b);
}
function rebuildLive() {
  if (!ctx) return;
  const old = S.live, sr = ctx.sampleRate, m = new E.Mat('L', sr, Math.round(S.lv.len * sr), true);
  if (old) {
    const a = Math.max(old.start, old.end - m.C), tmp = new Float32Array(old.end - a);
    for (let i = a; i < old.end; i++) tmp[i - a] = old.x(i);
    for (let i = 0; i < tmp.length; i += 4096) m.append(tmp.subarray(i, i + 4096));
  }
  S.lv.full = false;
  m.frozen = S.lv.frozen;
  S.live = m;
  if (S.playing && S.mode === 'live') S.st.cur = { m: 0, pos: Math.max(m.start, m.end - 2 * sr) };
}

// ---------- export ----------
function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function header(kind) {
  const s = S.sess, P = s.P0;
  const cues = E.CUES.filter(c => P.cues[c]).join('') || 'なし';
  return [
    `# RENSETSU ${kind}`,
    '# 時刻 t = 開始後の出力時刻（秒）。出音ログ・分節の線・出力 wav の 0 秒は同じ。',
    `# シード ${hex(s.seed)}　サンプルレート ${ctx.sampleRate}　出力遅延の見込み ${s.lat.toFixed(3)} s　開始 ${s.date.toISOString()}`,
    `# モード ${s.mode === 'live' ? 'ライブ入力' : 'サンプル'}　開始時の設定: 長さの上限 ${P.maxLen} ms / 候補の感度 ${P.sens} / 密度 ${P.density} / 直近N ${P.N} / 手がかり ${cues} / エンジン ${s.eng0 ? 'ON' : 'OFF'}`,
    ...s.mats.map(m => `# 素材 ${m.n}　${m.dur.toFixed(3)} s　候補境界 ${m.count}　hash ${m.hash}`),
  ];
}
function buildLog() {
  const s = S.sess, sr = ctx.sampleRate, L = header('出音ログ');
  L.push('# 再現: 同じシード・同じ素材（hash）で開始し、下の # 行の操作とタップを同じ単位番号で行えば、同じ出音になる。');
  L.push('# 採用した境界: 始=/終= のあとに位置（素材上の秒）と種類。不採用の候補: 内=一音の中に吸収、外=届かずに切った、前=尾として切り出した音の頭。');
  L.push('# 強さ・境界の予測・食い違いは、その単位を置いたあとの直近N音で測った値。崩した境界: 素材のままなら手がかりが揃っていた切れ目と、その一致の度合いの変化。');
  const cols = ['t', '単位', 'エンジン', '素材', '開始s', '終了s', '長さms', '次の間隔s', '発音s', '採用した境界', '不採用の候補', 'f0Hz', '明瞭度', '重心Hz', '平坦度', '量dB', '立上ms', '強さ(a b c d e)', '境界の予測(a b c d e)', '食い違い', '崩した境界'];
  L.push(cols.join('\t'));
  const ev = s.events.slice().sort((a, b) => a.n - b.n || a.t - b.t);
  let k = 0;
  for (const r of s.units) {
    while (k < ev.length && ev[k].n <= r.n) { L.push(`# t=${ev[k].t.toFixed(3)} 単位#${ev[k].n}から: ${ev[k].text}`); k++; }
    const F = r.F;
    L.push([
      r.t.toFixed(4), r.n, r.eng, r.ml, sec(r.s, sr), sec(r.e, sr), ((r.e - r.s) / sr * 1000).toFixed(1),
      r.ioi.toFixed(4), r.snd.toFixed(4),
      `始=${sec(r.s, sr)}(${KS[r.ks]}) 終=${sec(r.e, sr)}(${r.ke === 'merge' ? '吸収' + r.absorbed.length : KE[r.ke]})`,
      unadopted(r, sr), F.voiced ? F.f0.toFixed(1) : '-', F.clar.toFixed(2), F.cent.toFixed(0), F.fla.toFixed(3),
      r.L.toFixed(1), F.rise.toFixed(1),
      E.CUES.map(c => r.S[c].toFixed(3)).join(' '), E.CUES.map(c => r.pred[c]).join(' '), r.dis.toFixed(3), r.broken,
    ].join('\t'));
  }
  while (k < ev.length) { L.push(`# t=${ev[k].t.toFixed(3)} 単位#${ev[k].n}から: ${ev[k].text}`); k++; }
  return L.join('\n') + '\n';
}
function buildTaps() {
  const s = S.sess, L = header('分節の線（聴き手のタップ）');
  L.push(`# 聴取補正t = t − 出力遅延の見込み。境界 = 聴取補正t の ${E.REACT} s 前までに始まった最後の単位の直前。`);
  L.push('# 反映 = エンジンが受け取った単位番号（ONのときだけ出音に効く）。支え = その切れ目を各手がかりがどれだけ示していたか（0〜1）。');
  L.push(['t', '聴取補正t', 'タップ', '境界', 'エンジン', '反映', '支え(a b c d e)'].join('\t'));
  for (const tp of s.taps) {
    L.push([tp.t.toFixed(4), tp.heard.toFixed(4), tp.id, `${tp.u - 1}|${tp.u}`, tp.eng,
      tp.atUnit ? `#${tp.atUnit}${tp.applied ? '' : '（記録のみ）'}` : '-',
      tp.support ? E.CUES.map(c => tp.support[c].toFixed(2)).join(' ') : '-'].join('\t'));
  }
  return L.join('\n') + '\n';
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// uncompressed ZIP: the claude.ai viewer saves .zip but not .wav
function zip(name, data) {
  const nm = new TextEncoder().encode(name), crc = crc32(data), d = new Date();
  const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  const L = new DataView(new ArrayBuffer(30)); L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x0800, true); L.setUint16(10, dt, true); L.setUint16(12, dd, true); L.setUint32(14, crc, true); L.setUint32(18, data.length, true); L.setUint32(22, data.length, true); L.setUint16(26, nm.length, true);
  const C = new DataView(new ArrayBuffer(46)); C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x0800, true); C.setUint16(12, dt, true); C.setUint16(14, dd, true); C.setUint32(16, crc, true); C.setUint32(20, data.length, true); C.setUint32(24, data.length, true); C.setUint16(28, nm.length, true);
  const Z = new DataView(new ArrayBuffer(22)); Z.setUint32(0, 0x06054b50, true); Z.setUint16(8, 1, true); Z.setUint16(10, 1, true); Z.setUint32(12, 46 + nm.length, true); Z.setUint32(16, 30 + nm.length + data.length, true);
  return new Blob([L.buffer, nm, data, C.buffer, nm, Z.buffer]);
}
async function deliver(name, data) {
  const isWav = name.endsWith('.wav');
  if (inViewer) {
    const dl = await window.claude.use('downloads');
    if (!dl) throw new Error('この表示ではファイルを保存できません。');
    const fn = isWav ? name.replace(/\.wav$/, '.zip') : name;
    try { await dl.save({ filename: fn, data: isWav ? zip(name, data) : data }); return isWav ? `${fn} を保存しました（中に ${name}）。` : `${fn} を保存しました。`; }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') return '保存をやめました。';
      if (c === 'rate_limited') throw new Error('保存の確認がまだ開いています。閉じてからもう一度押してください。');
      throw new Error('この表示ではファイルを保存できません。');
    }
  }
  const blob = new Blob([data], { type: isWav ? 'audio/wav' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return `${name} を書き出しました。`;
}
async function exportOne(kind) {
  const s = S.sess; if (!s) return;
  const base = `rensetsu_${hex(s.seed)}_${stamp(s.date)}`;
  try {
    if (kind === 'wav') msg(await deliver(base + '.wav', s.tape.wav()));
    else if (kind === 'log') msg(await deliver(base + '_log.txt', buildLog()));
    else msg(await deliver(base + '_taps.txt', buildTaps()));
  } catch (e) { msg(e.message || '書き出せませんでした。'); }
}

// ---------- controls ----------
function readSeed() {
  const v = $('seed').value.trim().toLowerCase();
  if (/^[0-9a-f]{1,8}$/.test(v)) S.seed = parseInt(v, 16) >>> 0;
  $('seed').value = hex(S.seed);
}
function slider(id, fmt, set) {
  const el = $(id), out = $(id + 'V');
  const upd = () => { out.textContent = fmt(+el.value); };
  el.addEventListener('input', () => { upd(); set(+el.value); });
  el.addEventListener('change', () => event(`${el.labels && el.labels[0] ? el.labels[0].textContent : id} → ${out.textContent}`));
  upd();
}
function bind() {
  $('mSample').onclick = () => { if (S.mode === 'sample') return; stopPlay(); micStop(); S.mode = 'sample'; msg(S.files.length ? '開始を押してください。' : 'ファイルを追加して、開始を押してください。'); syncUI(); };
  $('mLive').onclick = () => { if (S.mode === 'live') return; stopPlay(); S.mode = 'live'; syncUI(); micStart(); };
  $('go').onclick = start;
  $('stop').onclick = () => { stopPlay(); msg('止めました。書き出しができます。'); };
  $('eOn').onclick = () => { if (!S.eng) { S.eng = true; event('エンジン ON'); syncUI(); } };
  $('eOff').onclick = () => { if (S.eng) { S.eng = false; event('エンジン OFF'); syncUI(); } };
  const tap = $('tap'); let down = null;
  tap.addEventListener('pointerdown', e => { down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: ctx ? ctx.currentTime : 0 }; });
  tap.addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), at = down.t; down = null;
    if (moved < 14) doTap(at);
  });
  tap.addEventListener('pointercancel', () => { down = null; });
  tap.addEventListener('click', e => { if (e.detail === 0) doTap(); });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || (t.tagName === 'BUTTON' && t !== tap))) return;
    e.preventDefault(); doTap();
  });
  $('files').addEventListener('change', e => { const l = [...e.target.files]; e.target.value = ''; addFiles(l); });
  $('clearMats').onclick = () => { stopPlay(); S.files = []; renderMats(); msg('素材を外しました。'); };
  $('matTab').addEventListener('click', e => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    if (S.playing) stopPlay();
    S.files.splice(+b.dataset.rm, 1); renderMats(); msg('素材を外しました。番号が詰まるので、開始し直してください。');
  });
  slider('maxLen', v => `${v} ms`, v => { S.P.maxLen = v; });
  slider('sens', v => String(v), v => { S.P.sens = v; renderMats(); });
  slider('density', v => `${E.ioiCenter(v).toFixed(3)} s`, v => { S.P.density = v; });
  slider('nWin', v => String(v), v => { S.P.N = v; });
  slider('bufLen', v => `${v} s`, v => { S.lv.len = v; rebuildLive(); renderMats(); });
  const box = $('cueBtns');
  for (const c of E.CUES) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'cue_' + c; b.className = 'cue'; b.textContent = `${c} ${CUE_SHORT[c]}`;
    b.title = E.CUE_NAME[c];
    b.onclick = () => { S.P.cues[c] = !S.P.cues[c]; event(`手がかり ${c} ${S.P.cues[c] ? 'オン' : 'オフ'}`); syncUI(); };
    box.append(b);
  }
  $('seed').addEventListener('change', () => { readSeed(); syncUI(); });
  $('seedNew').onclick = () => { S.seed = newSeed(); $('seed').value = hex(S.seed); syncUI(); if (S.playing) msg('新しいシードは次の開始から使います。'); };
  $('micBtn').onclick = () => { if (S.mic) micStop(); else micStart(); };
  $('kDrop').onclick = () => { S.lv.keep = false; S.lv.full = false; if (S.live) S.live.frozen = S.lv.frozen; event('満杯時: 古い部分を捨てる'); syncUI(); };
  $('kKeep').onclick = () => { S.lv.keep = true; event('満杯時: 古い部分を残す'); syncUI(); };
  $('freeze').onclick = () => { S.lv.frozen = !S.lv.frozen; if (S.live) S.live.frozen = S.lv.frozen || S.lv.full; event(S.lv.frozen ? 'バッファを凍結' : '凍結を解く'); syncUI(); };
  const self = v => () => { if (S.lv.self === v) return; S.lv.self = v; syncUI(); if (S.mic) { micStop(); micStart(); } };
  $('sAec').onclick = self('aec'); $('sGate').onclick = self('gate'); $('sNone').onclick = self('none');
  $('xWav').onclick = () => exportOne('wav');
  $('xLog').onclick = () => exportOne('log');
  $('xTap').onclick = () => exportOne('tap');
}

bind();
$('seed').value = hex(S.seed);
syncUI();
window.__rensetsu = S;
})();
