// Sawari circuit: what comes in from outside the world — an audio interface or a
// microphone, MIDI keyboards and controllers, four knobs — and where it goes.
// Input objects placed in the world are heard from where they stand; their onsets
// can send rings across the world, touch the nearest fragment, or become fragments.
const CIR = {
  stream: null, devices: [], devId: '', level: 0, peak: 0,
  midi: null, midiIns: [], learn: null, learnKey: null, last: '', capCount: 0,
  rt: new Map(),        // input object id -> {slow, last, cap}
  ring: null,           // ~30 s of recent input for capturing
  tap: null,
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

// ---------- audio input ----------
async function enableInput(devId) {
  await ensureAudio();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('このブラウザ、またはこの表示では音声入力を使えません。sawari/index.html を Chrome か Safari で直接開いてください。', 6000); return false; }
  try {
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
    if (devId) audio.deviceId = { exact: devId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    if (CIR.stream) CIR.stream.getTracks().forEach(t => t.stop());
    CIR.stream = stream;
    const tr = stream.getAudioTracks()[0];
    CIR.devId = (tr && tr.getSettings && tr.getSettings().deviceId) || devId || '';
    CIR.label = (tr && tr.label) || '入力';
    eng.attachInput(stream);
    await startTap();
    try { CIR.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { CIR.devices = []; }
    if (!sim.inputs.length) { const o = W.newInput(view.x - 120, view.y); addObj(o, false); commit(); }
    renderCircuit(); renderInspector();
    toast(`「${CIR.label}」を使っています。スピーカーで鳴らすとハウリングするので、ヘッドホンを使ってください。`, 5000);
    return true;
  } catch (e) {
    const why = e && e.name === 'NotAllowedError' ? '入力の使用が許可されませんでした（ブラウザのサイト設定でマイクを許可してください）。' : e && e.name === 'NotFoundError' ? '入力の機器が見つかりませんでした。' : 'この表示では音声入力を使えません。sawari/index.html を直接ブラウザで開いてください。';
    toast(why, 6500);
    return false;
  }
}
function disableInput() {
  stopTap();
  if (eng) eng.detachInput();
  if (CIR.stream) CIR.stream.getTracks().forEach(t => t.stop());
  CIR.stream = null; CIR.level = 0; sim.ext.inLevel = 0;
  renderCircuit();
  toast('入力を止めました。');
}
const TAP_SRC = `class SawariTap extends AudioWorkletProcessor{constructor(){super();this.n=0;this.on=true;this.L=new Float32Array(2048);this.R=new Float32Array(2048);this.port.onmessage=e=>{if(e.data==='stop')this.on=false}}
process(ins){const i=ins[0];if(i&&i.length){const l=i[0],r=i[1]||i[0];for(let k=0;k<l.length;k++){this.L[this.n]=l[k];this.R[this.n]=r[k];if(++this.n===2048){this.port.postMessage([this.L,this.R],[this.L.buffer,this.R.buffer]);this.L=new Float32Array(2048);this.R=new Float32Array(2048);this.n=0}}}return this.on}}
registerProcessor('sawari-tap',SawariTap);`;
async function startTap() {
  stopTap();
  const sr = ctx.sampleRate, size = Math.round(sr * 30);
  CIR.ring = { L: new Float32Array(size), R: new Float32Array(size), n: 0, size, sr };
  const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
  const write = (l, r) => { const g = CIR.ring; for (let k = 0; k < l.length; k++) { const i = (g.n + k) % g.size; g.L[i] = l[k]; g.R[i] = r[k]; } g.n += l.length; };
  let node;
  try {
    if (!ctx.audioWorklet) throw new Error('no worklet');
    if (!S.tapLoaded) { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP_SRC], { type: 'application/javascript' }))); S.tapLoaded = true; }
    node = new AudioWorkletNode(ctx, 'sawari-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = e => write(e.data[0], e.data[1]);
  } catch (e) {
    node = ctx.createScriptProcessor(2048, 2, 2);
    node.onaudioprocess = ev => { const b = ev.inputBuffer; write(b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)); };
  }
  eng.inp.src.connect(node); node.connect(sink);
  CIR.tap = { node, sink };
}
function stopTap() {
  if (!CIR.tap) return;
  try { CIR.tap.node.port && CIR.tap.node.port.postMessage('stop'); CIR.tap.node.disconnect(); CIR.tap.sink.disconnect(); } catch (e) {}
  CIR.tap = null;
}
// cut frames [a, b) of the ring into a new source and fragment next to the input object
function makeCapture(o, a, b, quiet) {
  const g = CIR.ring; if (!g) return null;
  a = Math.max(a, g.n - g.size + 1, 0); b = Math.min(b, g.n);
  const n = b - a; if (n < g.sr * 0.08) return null;
  const L = new Float32Array(n), R = new Float32Array(n);
  let pk = 0;
  for (let k = 0; k < n; k++) { const i = (a + k) % g.size; L[k] = g.L[i]; R[k] = g.R[i]; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
  if (pk < 0.004) { if (!quiet) toast('入力が静かすぎて、採れませんでした。'); return null; }
  const fade = Math.min(n >> 2, Math.round(g.sr * 0.006));
  for (let k = 0; k < fade; k++) { const w = k / fade; L[k] *= w; R[k] *= w; L[n - 1 - k] *= w; R[n - 1 - k] *= w; }
  const id = C.uid('a'), name = `入力 ${++CIR.capCount}`;
  const rec = registerSource(id, name, { sr: g.sr, ch: [L, R] }, K.encodeWav([L, R], g.sr, 16), 'wav');
  const rng = C.makeRng(randSeed()), ang = rng() * C.TAU, d = o.r + 50 + rng() * 140;
  const f = W.newFrag(id, 0, rec.dur, o.x + Math.cos(ang) * d, o.y + Math.sin(ang) * d, rng);
  f.mode = o.capMode || 'hit'; f.move.type = 'none';
  world.objs.push(f); sim.index(); sim.refresh(); renderLibrary(); updateEmpty(); scheduleAutosave();
  return f;
}
function captureNow(o) {
  if (!CIR.ring) { toast('先に回路で「入力を使う」を押してください。'); return; }
  const g = CIR.ring, f = makeCapture(o, g.n - Math.round(g.sr * (o.capLen || 4)), g.n);
  if (f) { commit(); toast(`直前の ${o.capLen || 4} 秒を断片にしました。`); }
}
// per frame: level, onsets, auto capture
function circuitTick() {
  if (!eng || !eng.inp) { CIR.level = 0; if (sim.ext.inLevel) sim.ext.inLevel = 0; return; }
  const an = eng.inp.an, buf = CIR.abuf || (CIR.abuf = new Float32Array(an.fftSize));
  an.getFloatTimeDomainData(buf);
  let s = 0, pk = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
  const lv = C.clamp(Math.sqrt(s / buf.length) * 4, 0, 1);
  CIR.level = lv; CIR.peak = Math.max(pk, CIR.peak * 0.9);
  sim.ext.inLevel += (lv - sim.ext.inLevel) * 0.35;
  const now = performance.now(), g = CIR.ring;
  for (const o of sim.inputs) {
    let rt = CIR.rt.get(o.id); if (!rt) { rt = { slow: 0, last: 0, cap: null, quiet: 0 }; CIR.rt.set(o.id, rt); }
    const onset = lv > o.thr && lv > rt.slow * 1.6 + 0.02 && now - rt.last > 140;
    rt.slow = rt.slow * 0.95 + lv * 0.05;
    if (onset) {
      rt.last = now; rt.flash = now;
      if (o.trig === 'ripple') { if (S.playing) sim.addRing(o.x, o.y, sim.T, C.clamp(lv * 1.6, 0.3, 1)); }
      else if (o.trig === 'hit') {
        let best = null, bd = 520;
        for (const f of sim.frags) { const d = Math.hypot(f.x - o.x, f.y - o.y); if (d < bd) { bd = d; best = f; } }
        if (best) touchFrag(best, C.clamp(lv * 1.5, 0.3, 1));
      }
      if (o.auto && g && !rt.cap) rt.cap = { a: g.n - Math.round(g.sr * 0.1), t: now };
    }
    if (rt.cap) {
      rt.quiet = lv < o.thr * 0.6 ? rt.quiet + 16 : 0;
      if (rt.quiet > 380 || now - rt.cap.t > 8000) {
        const f = makeCapture(o, rt.cap.a, g.n, true); rt.cap = null; rt.quiet = 0;
        if (f) { rt.made = (rt.made || 0) + 1; if (rt.made >= 48) { o.auto = false; toast('自動で採った断片が 48 個になったので、自動で採るのを止めました。'); renderInspector(); } }
      }
    }
  }
  const m = $('cirMeter');
  if (m) { m.style.setProperty('--lv', lv.toFixed(3)); m.style.setProperty('--pk', CIR.peak.toFixed(3)); }
}

// ---------- MIDI ----------
async function enableMidi() {
  if (!navigator.requestMIDIAccess) { toast('このブラウザは MIDI に対応していません。Chrome で開いてください（Safari は未対応です）。', 6000); return; }
  try {
    CIR.midi = await navigator.requestMIDIAccess({ sysex: false });
    bindMidi(); CIR.midi.onstatechange = bindMidi;
    toast(CIR.midiIns.length ? `MIDI：${CIR.midiIns.join('、')}` : 'MIDI を使えるようにしました。機器をつなぐと自動で認識します。');
  } catch (e) { toast('MIDI を使えませんでした。この表示では許可されていない可能性があります。sawari/index.html を Chrome で直接開いてください。', 6500); }
}
function bindMidi() {
  CIR.midiIns = [];
  CIR.midi.inputs.forEach(inp => { inp.onmidimessage = e => onMidi(e.data); CIR.midiIns.push(inp.name || 'MIDI'); });
  renderCircuit();
}
function onMidi(d) {
  const st = d[0] & 0xF0, a = d[1], b = d[2];
  if (st === 0x90 && b > 0) { CIR.last = `鍵 ${noteName(a)}（${a}） 強さ ${b}`; noteOn(a, b / 127); }
  else if (st === 0xB0) { CIR.last = `つまみ CC ${a} = ${b}`; midiCC(a, b / 127); }
  else if (st === 0xE0) { const v = (((b << 7) | a) - 8192) / 8192; CIR.last = `ベンド ${v.toFixed(2)}`; sim.ext.bend = v; }
  else return;
  const l = $('cirLast'); if (l) l.textContent = CIR.last;
}
function noteOn(note, vel) {
  ensureAudio();
  sim.ext.key = C.clamp((note - 36) / 60, 0, 1);
  if (CIR.learnKey) {
    const f = sim.byId.get(CIR.learnKey); CIR.learnKey = null;
    if (f) { f.key = note; commit(); toast(`鍵 ${noteName(note)} でこの断片が鳴ります。`); renderInspector(); }
    return;
  }
  let targets = sim.frags.filter(f => f.key === note || f.key === 'all'), chromatic = false;
  if (!targets.length) { targets = selObjs().filter(o => o.kind === 'frag'); chromatic = true; }
  if (!targets.length) { toast('鍵盤で鳴らすには、断片を選ぶか、断片の「鍵盤」を設定してください。', 3000); return; }
  for (const f of targets) touchFrag(f, vel, { st: chromatic || f.key === 'all' ? note - 60 : 0, vol: (vel - 0.75) * 14 });
}
function midiCC(num, val) {
  const kn = world.circuit.knobs;
  if (CIR.learn != null) { kn[CIR.learn].cc = num; toast(`つまみ ${'ABCD'[CIR.learn]} を CC ${num} に割り当てました。`); CIR.learn = null; commit(); renderCircuit(); }
  kn.forEach((k, i) => { if (k.cc === num) { k.v = val; const s = $('knob' + i); if (s) { s.value = val; const o = s.closest('.row').querySelector('.val'); if (o) o.textContent = fmtPct(val); } } });
  clearTimeout(CIR.ccT); CIR.ccT = setTimeout(scheduleAutosave, 800);
}

// ---------- panel ----------
function openCircuit() { $('circuit').hidden = false; $('cirBtn').setAttribute('aria-pressed', 'true'); renderCircuit(); }
function closeCircuit() { $('circuit').hidden = true; $('cirBtn').setAttribute('aria-pressed', 'false'); }
function renderCircuit() {
  const box = $('circuit'); if (!box || box.hidden) return;
  const on = !!(eng && eng.inp);
  const dev = el('select', { id: 'cirDev', 'aria-label': '入力の機器' }, el('option', { value: '' }, '既定の入力'), ...CIR.devices.map(d => el('option', { value: d.deviceId, selected: d.deviceId === CIR.devId }, d.label || '入力')));
  dev.addEventListener('change', () => enableInput(dev.value));
  const knobs = world.circuit.knobs.map((k, i) => {
    const row = slider(`つまみ ${'ABCD'[i]}`, () => k.v, v => { k.v = v; }, { min: 0, max: 1, step: 0.005, fmt: fmtPct, def: 0.5 });
    row.querySelector('input').id = 'knob' + i;
    const learn = btn(CIR.learn === i ? '動かして…' : k.cc != null ? `CC ${k.cc}` : '覚える', () => { CIR.learn = CIR.learn === i ? null : i; renderCircuit(); if (CIR.learn != null && !CIR.midi) enableMidi(); }, { cls: 'sm' + (CIR.learn === i ? ' learning' : ''), tip: 'MIDI のつまみを動かすと、このつまみに割り当てます' });
    return el('div', { class: 'knobrow' }, row, learn);
  });
  // what the outside currently reaches, read from the laws
  const links = [];
  world.laws.forEach(l => { for (const [key, v] of Object.entries(l.m)) { const [s, t] = key.split('>'); const S0 = W.SMAP[s]; if (S0 && S0.g === '外から') links.push(`${S0.l} → ${W.TMAP[t].l} ${v > 0 ? '+' : ''}${v.toFixed(2)}（${l.name}）`); } });
  box.replaceChildren(...[
    el('header', { class: 'lawhead' }, el('h2', null, '回路'), el('span', { class: 'sub' }, '外から入るもの（オーディオインターフェース・マイク・MIDI・つまみ）と、その行き先'), el('span', { class: 'acts' }, btn('閉じる', closeCircuit, { cls: 'sm' }))),
    inViewer ? el('p', { class: 'note warn' }, 'claude.ai の中の表示では、マイク・オーディオインターフェースと MIDI はブラウザに止められます。sawari/index.html を Chrome（MIDI は Chrome のみ）で直接開くと使えます。つまみ A〜D はここでも使えます。') : null,
    el('div', { class: 'cirgrid' },
      el('section', { class: 'sec' }, el('h3', null, '音声入力'),
        el('p', { class: 'note' }, on ? `使用中：${CIR.label || '入力'}` : 'オーディオインターフェースやマイクの音を、世界の中に置いて鳴らします。'),
        el('div', { class: 'acts' }, on ? btn('止める', disableInput) : btn('入力を使う', () => enableInput(CIR.devId), { cls: 'primary' }), on ? dev : null),
        el('div', { class: 'meter', id: 'cirMeter', 'aria-label': '入力の大きさ' }, el('i'), el('b')),
        el('div', { class: 'acts' }, btn('入力を世界に置く', () => { const o = W.newInput(view.x, view.y); addObj(o); commit(); if (!on) enableInput(CIR.devId); }, { tip: '道具 I でも置けます' })),
        el('p', { class: 'note' }, '置いた「入」はその場所から聞こえ、耳・部屋・法則が効きます。音の立ち上がりで波紋を出す、近くの断片を鳴らす、自動で断片として採る、を選べます（「入」を選んで右の板で）。'),
      ),
      el('section', { class: 'sec' }, el('h3', null, 'MIDI'),
        el('p', { class: 'note' }, CIR.midi ? (CIR.midiIns.length ? `受信中：${CIR.midiIns.join('、')}` : '機器が見つかりません。つなぐと自動で認識します。') : 'MIDI キーボードやコントローラーを使います（Chrome）。'),
        el('div', { class: 'acts' }, CIR.midi ? null : btn('MIDI を使う', enableMidi, { cls: 'primary' })),
        el('p', { class: 'note mono', id: 'cirLast' }, CIR.last || '—'),
        slider('ベンド幅', () => world.circuit.pb, v => { world.circuit.pb = v; }, { min: 0, max: 12, step: 1, fmt: v => `±${v} 半音`, def: 2 }),
        el('p', { class: 'note' }, '鍵盤：選んでいる断片がその高さで鳴ります（C4 が元の高さ）。断片の「鍵盤」で、特定の鍵に割り当てたり、常に鍵盤で弾けるようにできます。ピッチベンドはすべての音を曲げます。'),
      ),
      el('section', { class: 'sec' }, el('h3', null, 'つまみ'),
        ...knobs,
        el('p', { class: 'note' }, 'つまみは法則の表の「つまみA〜D」の行から、好きな音の性質へつながります。いま鳴っている音にもすぐ効きます。'),
        el('h3', null, 'いまのつながり'),
        links.length ? el('ul', { class: 'links' }, ...links.map(t => el('li', null, t))) : el('p', { class: 'note' }, 'まだありません。'),
        el('div', { class: 'acts' }, btn('法則の表を開く', () => openLaws())),
      ),
    ),
  ].filter(Boolean));
}
