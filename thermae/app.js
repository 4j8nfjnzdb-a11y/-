// yukemuri — UI + audio graph
//
// The DSP lives in engine.js as a dependency-free class. We stringify it
// into a Blob and hand it to an AudioWorklet so it runs on the audio
// thread (low latency, no glitching while the UI redraws). If the
// browser refuses — old Safari, file:// weirdness — we fall back to a
// ScriptProcessorNode running the exact same class on the main thread.

(() => {
  'use strict';

  // ---------------------------------------------------------------
  // parameter model
  // ---------------------------------------------------------------

  // Interval detents. The real pedal's interval knobs land on musical
  // stops (4th, 5th, octave, octave+5th, two octaves) either side of a
  // centre OFF position, which is why it never fights what you play.
  const DETENTS = [-24, -19, -12, -7, -5, null, 5, 7, 12, 19, 24];
  const CHROMATIC = (() => {
    const a = [];
    for (let i = -24; i <= 24; i++) a.push(i === 0 ? null : i);
    return a;
  })();

  const NAMES = {
    '-24': '2oct↓', '-19': 'oct+5↓', '-12': 'oct↓', '-7': '5th↓', '-5': '4th↓',
    '5': '4th↑', '7': '5th↑', '12': 'oct↑', '19': 'oct+5↑', '24': '2oct↑',
  };

  const KNOBS = [
    { id: 'mix', name: 'MIX', def: 0.55, fmt: v => Math.round(v * 100) + '%' },
    { id: 'regen', name: 'REGEN', def: 0.45, fmt: v => Math.round(v * 100) + '%' },
    { id: 'tone', name: 'LPF', def: 0.62, fmt: v => fmtHz(150 * Math.pow(8000 / 150, v)) },
    { id: 'glide', name: 'GLIDE', def: 0.0, fmt: v => v < 0.02 ? 'jump' : Math.round(v * v * 1600) + 'ms' },
    { id: 'int1', name: 'INT 1', def: 0.2, interval: true },
    { id: 'int2', name: 'INT 2', def: 0.6, interval: true },
  ];

  const DIPS = [
    { id: 'baseMs', type: 'range', label: 'TIME（基準ディレイタイム）', def: 500, min: 40, max: 2000, curve: 'log',
      fmt: v => Math.round(v) + 'ms  /  ' + (60000 / v).toFixed(1) + 'BPM' },
    { id: 'modWave', type: 'select', label: 'MOD 波形', def: 0,
      options: ['サイン', 'トライアングル', 'ランプ↑', 'ランプ↓', 'スクエア', 'サンプル&ホールド', 'ドリフト（補間ランダム）', 'サイン×ランダム', 'カオス（2波重ね）'] },
    { id: 'modDepth', type: 'range', label: 'MOD 深さ', def: 0, min: 0, max: 1,
      fmt: v => v === 0 ? 'off' : '±' + (v * 12).toFixed(1) + '半音' },
    { id: 'modRate', type: 'range', label: 'MOD 速さ', def: 0.4, min: 0.02, max: 12, curve: 'log',
      fmt: v => v.toFixed(2) + 'Hz' },
    { id: 'drive', type: 'range', label: 'DRIVE（BBDの飽和）', def: 0.35, min: 0, max: 1, fmt: pct },
    { id: 'grit', type: 'range', label: 'GRIT（ノイズフロア）', def: 0.35, min: 0, max: 1, fmt: pct },
    { id: 'reso', type: 'range', label: 'RESO（LPFのQ）', def: 0.35, min: 0, max: 1, fmt: pct },
    { id: 'slowDepth', type: 'range', label: 'SLOWDOWN の深さ', def: 0.8, min: 0.1, max: 1, fmt: pct },
    { id: 'compander', type: 'switch', label: 'COMPANDER（BBDのノイズリダクション）', def: 1 },
    { id: 'trails', type: 'switch', label: 'TRAILS（バイパスしても残響を残す）', def: 1 },
    { id: 'stepMode', type: 'switch', label: 'STEP MODE（TAPを踏むたびに1ステップ進む）', def: 0 },
    { id: 'bounce', type: 'switch', label: 'BOUNCE 往復シーケンス［拡張］', def: 0 },
    { id: 'chromatic', type: 'switch', label: 'CHROMATIC（INTを半音きざみに）［拡張］', def: 0, local: true },
  ];

  const P = {
    mix: 0.55, regen: 0.45, tone: 0.62, reso: 0.35, glide: 0,
    int1: -12, int2: 5, baseMs: 500,
    divBase: 1, div1: 1, div2: 1,
    seq: 1, stepMode: 0, bounce: 0,
    modDepth: 0, modRate: 0.4, modWave: 0,
    drive: 0.35, grit: 0.35, compander: 1,
    slowDepth: 0.8, inGain: 1, outGain: 1,
    bypass: 0, trails: 1,
  };
  // knob positions (0..1) live separately from the engine values
  const K = {};
  KNOBS.forEach(k => { K[k.id] = k.def; });
  let chromatic = false;

  function pct(v) { return Math.round(v * 100) + '%'; }
  function fmtHz(h) { return h >= 1000 ? (h / 1000).toFixed(1) + 'k' : Math.round(h) + 'Hz'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function detents() { return chromatic ? CHROMATIC : DETENTS; }
  function intervalAt(pos) {
    const d = detents();
    return d[clamp(Math.round(pos * (d.length - 1)), 0, d.length - 1)];
  }
  function intervalLabel(v) {
    if (v === null) return 'OFF';
    return (v > 0 ? '+' : '') + v + (NAMES[String(v)] ? ' ' + NAMES[String(v)] : '');
  }

  // ---------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------

  let ctx = null, inputGain = null, master = null, analyser = null, node = null;
  let engine = null;          // set only in ScriptProcessor fallback
  let recDest = null, recorder = null, recChunks = [];
  let scopeData = null;
  let ready = false;

  const WORKLET_TAIL = `
class ThermaeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.eng = new ThermaeEngine(sampleRate);
    this.eng.onEvent = (name, value) => this.port.postMessage({ t: name, v: value });
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.t === 'params') this.eng.setParams(d.v);
      else if (d.t === 'cmd') this.eng.command(d.name, d.v);
    };
  }
  process(inputs, outputs) {
    const inp = (inputs[0] && inputs[0][0]) ? inputs[0][0] : null;
    const out = outputs[0];
    this.eng.process(inp, out[0], out[1] || out[0], out[0].length);
    return true;
  }
}
registerProcessor('thermae-processor', ThermaeProcessor);
`;

  async function boot() {
    if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

    inputGain = ctx.createGain();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    scopeData = new Float32Array(analyser.fftSize);

    let made = false;
    if (ctx.audioWorklet) {
      try {
        const src = ThermaeEngine.toString() + '\n' + WORKLET_TAIL;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        node = new AudioWorkletNode(ctx, 'thermae-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        });
        node.port.onmessage = e => onEngineEvent(e.data.t, e.data.v);
        made = true;
      } catch (err) {
        console.warn('AudioWorklet unavailable, falling back:', err);
      }
    }
    if (!made) {
      engine = new ThermaeEngine(ctx.sampleRate);
      engine.onEvent = onEngineEvent;
      node = ctx.createScriptProcessor(1024, 1, 2);
      node.onaudioprocess = ev => {
        const i = ev.inputBuffer.getChannelData(0);
        const o = ev.outputBuffer;
        engine.process(i, o.getChannelData(0), o.getChannelData(1), o.length);
      };
    }

    inputGain.connect(node);
    node.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);

    if (ctx.createMediaStreamDestination) {
      recDest = ctx.createMediaStreamDestination();
      master.connect(recDest);
    }

    ready = true;
    pushAll();
    draw();
  }

  function send(patch) {
    if (!ready) return;
    if (node && node.port) node.port.postMessage({ t: 'params', v: patch });
    else if (engine) engine.setParams(patch);
  }
  function cmd(name, v) {
    if (!ready) return;
    if (node && node.port) node.port.postMessage({ t: 'cmd', name, v });
    else if (engine) engine.command(name, v);
  }
  function pushAll() { send(P); }

  // ---------------------------------------------------------------
  // readouts
  // ---------------------------------------------------------------

  const el = id => document.getElementById(id);
  let meter = { peak: 0, delayMs: 500, cents: 0, step: 0 };

  function onEngineEvent(name, v) {
    if (name === 'meter') {
      meter = v;
    } else if (name === 'step') {
      meter.step = v.step;
    }
    setLamp(meter.step);
  }

  function setLamp(step) {
    const lamps = el('lamps').children;
    for (let i = 0; i < lamps.length; i++) {
      const off = (i === 1 && P.int1 === null) || (i === 2 && P.int2 === null);
      lamps[i].classList.toggle('is-on', i === step && !off);
      lamps[i].classList.toggle('is-off', off);
    }
  }

  function refreshReadout() {
    el('bpmVal').textContent = (60000 / P.baseMs).toFixed(1);
    el('baseVal').textContent = Math.round(P.baseMs);
    el('nowVal').textContent = Math.round(meter.delayMs || P.baseMs);
    el('centVal').textContent = (meter.cents > 0 ? '+' : '') + Math.round(meter.cents || 0);
    el('l1').textContent = P.int1 === null ? 'OFF' : (P.int1 > 0 ? '+' : '') + P.int1;
    el('l2').textContent = P.int2 === null ? 'OFF' : (P.int2 > 0 ? '+' : '') + P.int2;
  }

  // ---------------------------------------------------------------
  // knobs
  // ---------------------------------------------------------------

  function buildKnobs() {
    const row = el('knobRow');
    KNOBS.forEach(spec => {
      const wrap = document.createElement('div');
      wrap.className = 'knob';
      wrap.innerHTML =
        '<div class="dial" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100"' +
        ' aria-label="' + spec.name + '"><span class="ptr"></span></div>' +
        '<div class="name">' + spec.name + '</div><div class="val"></div>';
      const dial = wrap.querySelector('.dial');
      const val = wrap.querySelector('.val');

      function render() {
        const p = K[spec.id];
        dial.style.setProperty('--pct', p.toFixed(4));
        wrap.querySelector('.ptr').style.transform =
          'translate(-50%, -100%) rotate(' + (-140 + p * 280) + 'deg)';
        if (spec.interval) {
          const iv = intervalAt(p);
          val.textContent = intervalLabel(iv);
          dial.setAttribute('aria-valuetext', intervalLabel(iv));
          P[spec.id] = iv;
        } else {
          val.textContent = spec.fmt(p);
          dial.setAttribute('aria-valuetext', spec.fmt(p));
          P[spec.id] = p;
        }
        dial.setAttribute('aria-valuenow', Math.round(p * 100));
      }
      function set(p, silent) {
        K[spec.id] = clamp(p, 0, 1);
        render();
        if (!silent) { send({ [spec.id]: P[spec.id] }); refreshReadout(); setLamp(meter.step); save(); }
      }
      spec.set = set;
      spec.render = render;

      let dragging = false, lastY = 0;
      dial.addEventListener('pointerdown', e => {
        dragging = true; lastY = e.clientY; dial.setPointerCapture(e.pointerId);
        dial.style.cursor = 'grabbing';
      });
      dial.addEventListener('pointermove', e => {
        if (!dragging) return;
        const fine = e.shiftKey ? 0.25 : 1;
        set(K[spec.id] + (lastY - e.clientY) * 0.005 * fine);
        lastY = e.clientY;
      });
      const up = e => { dragging = false; dial.style.cursor = 'grab'; try { dial.releasePointerCapture(e.pointerId); } catch (_) {} };
      dial.addEventListener('pointerup', up);
      dial.addEventListener('pointercancel', up);
      dial.addEventListener('wheel', e => {
        e.preventDefault();
        set(K[spec.id] - Math.sign(e.deltaY) * (spec.interval ? 1 / (detents().length - 1) : 0.03));
      }, { passive: false });
      dial.addEventListener('keydown', e => {
        const stepSize = spec.interval ? 1 / (detents().length - 1) : (e.shiftKey ? 0.01 : 0.05);
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(K[spec.id] + stepSize); e.preventDefault(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(K[spec.id] - stepSize); e.preventDefault(); }
        else if (e.key === 'Home') { set(0); e.preventDefault(); }
        else if (e.key === 'End') { set(1); e.preventDefault(); }
      });

      row.appendChild(wrap);
      render();
    });
  }

  // ---------------------------------------------------------------
  // toggles (step lengths) — a division of the tapped tempo, per step
  // ---------------------------------------------------------------

  const DIVS = [{ v: 1, l: '♩' }, { v: 0.75, l: '♪.' }, { v: 0.5, l: '♪' }];
  const TOGS = [
    { id: 'divBase', name: 'TAP / UNITY' },
    { id: 'div1', name: 'INT 1 の長さ' },
    { id: 'div2', name: 'INT 2 の長さ' },
  ];

  function buildToggles() {
    const row = el('toggleRow');
    TOGS.forEach(t => {
      const w = document.createElement('div');
      w.className = 'tog';
      const segs = document.createElement('div');
      segs.className = 'segs';
      DIVS.forEach(d => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = d.l;
        b.title = d.v === 1 ? '4分' : d.v === 0.75 ? '付点8分' : '8分';
        b.classList.toggle('is-on', P[t.id] === d.v);
        b.addEventListener('click', () => {
          P[t.id] = d.v;
          [...segs.children].forEach(c => c.classList.toggle('is-on', c === b));
          send({ [t.id]: d.v }); save();
        });
        segs.appendChild(b);
      });
      t.segs = segs;
      w.appendChild(segs);
      const n = document.createElement('div');
      n.className = 'name';
      n.textContent = t.name;
      w.appendChild(n);
      row.appendChild(w);
    });
  }

  function syncToggles() {
    TOGS.forEach(t => {
      [...t.segs.children].forEach((c, i) => c.classList.toggle('is-on', DIVS[i].v === P[t.id]));
    });
  }

  // ---------------------------------------------------------------
  // dip switches
  // ---------------------------------------------------------------

  function buildDips() {
    const host = el('dips');
    DIPS.forEach(d => {
      const w = document.createElement('div');
      w.className = 'dip' + (d.type === 'switch' ? ' toggleDip' : '');
      const label = document.createElement('span');
      label.textContent = d.label;

      if (d.type === 'select') {
        w.appendChild(label);
        const s = document.createElement('select');
        d.options.forEach((o, i) => {
          const op = document.createElement('option');
          op.value = String(i); op.textContent = o;
          s.appendChild(op);
        });
        s.value = String(P[d.id]);
        s.addEventListener('change', () => { P[d.id] = +s.value; send({ [d.id]: P[d.id] }); save(); });
        d.sync = () => { s.value = String(P[d.id]); };
        w.appendChild(s);
      } else if (d.type === 'range') {
        const out = document.createElement('em');
        out.style.cssText = 'font-style:normal;float:right;color:var(--hot)';
        label.appendChild(out);
        w.appendChild(label);
        const r = document.createElement('input');
        r.type = 'range'; r.min = '0'; r.max = '1000';
        const toVal = x => d.curve === 'log'
          ? d.min * Math.pow(d.max / d.min, x / 1000)
          : d.min + (d.max - d.min) * x / 1000;
        const toPos = v => d.curve === 'log'
          ? 1000 * Math.log(v / d.min) / Math.log(d.max / d.min)
          : 1000 * (v - d.min) / (d.max - d.min);
        r.value = String(toPos(P[d.id]));
        out.textContent = d.fmt(P[d.id]);
        r.addEventListener('input', () => {
          P[d.id] = toVal(+r.value);
          out.textContent = d.fmt(P[d.id]);
          send({ [d.id]: P[d.id] }); save();
        });
        d.sync = () => { r.value = String(toPos(P[d.id])); out.textContent = d.fmt(P[d.id]); };
        w.appendChild(r);
      } else {
        const sw = document.createElement('div');
        sw.className = 'switch';
        sw.tabIndex = 0;
        sw.setAttribute('role', 'switch');
        const cur = () => d.local ? chromatic : !!P[d.id];
        const apply = () => {
          sw.classList.toggle('is-on', cur());
          sw.setAttribute('aria-checked', String(cur()));
        };
        const flip = () => {
          if (d.local) {
            chromatic = !chromatic;
            KNOBS.filter(k => k.interval).forEach(k => k.set(K[k.id]));
          } else {
            P[d.id] = P[d.id] ? 0 : 1;
            send({ [d.id]: P[d.id] });
          }
          apply(); save();
        };
        sw.addEventListener('click', flip);
        sw.addEventListener('keydown', e => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        });
        d.sync = apply;
        apply();
        w.appendChild(sw);
        w.appendChild(label);
      }
      host.appendChild(w);
    });
  }

  function syncDips() { DIPS.forEach(d => d.sync && d.sync()); }

  // ---------------------------------------------------------------
  // footswitches: tap tempo, slowdown, step advance, bypass
  // ---------------------------------------------------------------

  let taps = [];
  function tap() {
    const now = performance.now();
    taps = taps.filter(t => now - t < 3000);
    taps.push(now);
    if (taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
      setBase(sum / (taps.length - 1));
    }
    if (taps.length > 5) taps.shift();
  }
  function setBase(ms) {
    P.baseMs = clamp(ms, 40, 2000);
    send({ baseMs: P.baseMs });
    const d = DIPS.find(x => x.id === 'baseMs');
    if (d && d.sync) d.sync();
    refreshReadout(); save();
  }

  function holdable(btn, onClick, onHoldStart, onHoldEnd) {
    let timer = null, held = false, down = false;
    function finish(fire) {
      if (!down) return;
      down = false;
      clearTimeout(timer);
      btn.classList.remove('is-active');
      if (held) { if (onHoldEnd) onHoldEnd(); }
      else if (fire) onClick();
      held = false;
    }
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      down = true; held = false;
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      timer = setTimeout(() => { held = true; if (onHoldStart) onHoldStart(); }, 320);
      btn.classList.add('is-active');
    });
    btn.addEventListener('pointerup', () => finish(true));
    btn.addEventListener('pointercancel', () => finish(false));
    btn.addEventListener('lostpointercapture', () => finish(false));
  }

  function wireFootswitches() {
    const tapBtn = el('fsTap');
    holdable(tapBtn,
      () => { boot().then(() => { if (P.stepMode) cmd('trigger'); else tap(); }); },
      () => { boot().then(() => { cmd('slow', 1); tapBtn.classList.add('is-slow'); }); },
      () => { cmd('slow', 0); tapBtn.classList.remove('is-slow'); });

    const byBtn = el('fsBypass');
    holdable(byBtn,
      () => {
        boot().then(() => {
          P.bypass = P.bypass ? 0 : 1;
          send({ bypass: P.bypass });
          byBtn.classList.toggle('is-bypassed', !!P.bypass);
          save();
        });
      },
      null,
      () => cmd('clear'));

    document.addEventListener('keydown', e => {
      if (e.repeat || /input|select|textarea|button|a/i.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); boot().then(() => { if (P.stepMode) cmd('trigger'); else tap(); }); }
      else if (e.key === 'b' || e.key === 'B') byBtn.click();
      else if (e.key === 's' || e.key === 'S') { boot().then(() => { cmd('slow', 1); el('fsTap').classList.add('is-slow'); }); }
      else if (e.key === 'p' || e.key === 'P') el('demoPluck').click();
    });
    document.addEventListener('keyup', e => {
      if (e.key === 's' || e.key === 'S') { cmd('slow', 0); el('fsTap').classList.remove('is-slow'); }
    });
  }

  // ---------------------------------------------------------------
  // sources
  // ---------------------------------------------------------------

  let micStream = null, fileBuf = null, fileNode = null, demoTimer = null;

  function selectSource(which) {
    document.querySelectorAll('.srcBtn').forEach(b => b.classList.toggle('is-on', b.dataset.src === which));
    ['mic', 'file', 'demo'].forEach(s => { el('panel-' + s).hidden = s !== which; });
  }

  async function startMic() {
    try {
      await boot();
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, noiseSuppression: false,
          autoGainControl: false, channelCount: 1,
        },
      });
      const src = ctx.createMediaStreamSource(micStream);
      src.connect(inputGain);
      el('micStatus').textContent = '接続しました（' + Math.round(ctx.baseLatency * 1000 || 0) + 'ms 前後の遅延）';
      el('micStart').disabled = true;
    } catch (err) {
      el('micStatus').textContent = '入力を取得できませんでした: ' + err.message;
    }
  }

  async function loadFile(f) {
    await boot();
    const buf = await f.arrayBuffer();
    fileBuf = await ctx.decodeAudioData(buf);
    el('fileStatus').textContent = f.name + ' / ' + fileBuf.duration.toFixed(1) + '秒';
    el('filePlay').disabled = false;
  }

  function toggleFile() {
    if (fileNode) { try { fileNode.stop(); } catch (_) {} fileNode = null; el('filePlay').textContent = '再生'; return; }
    if (!fileBuf) return;
    fileNode = ctx.createBufferSource();
    fileNode.buffer = fileBuf;
    fileNode.loop = el('fileLoop').checked;
    fileNode.connect(inputGain);
    fileNode.onended = () => { fileNode = null; el('filePlay').textContent = '再生'; };
    fileNode.start();
    el('filePlay').textContent = '停止';
  }

  // A Karplus-Strong pluck, so the pedal has something to chew on with
  // no guitar plugged in. Short noise burst into a tuned feedback comb.
  function pluck(freq, when, gain) {
    const t = when || ctx.currentTime;
    // Excite with exactly one period of noise — a longer burst keeps
    // pumping the comb and the "pluck" turns into a loud drone.
    const b = ctx.createBuffer(1, Math.max(32, Math.ceil(ctx.sampleRate / freq)), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const noise = ctx.createBufferSource(); noise.buffer = b;
    const dl = ctx.createDelay(0.1); dl.delayTime.value = 1 / freq;
    // Web Audio reads lowpass Q in dB, so the default Q=1 is a ~+1.2dB
    // resonant peak and pushes this comb above unity gain — it runs away.
    // -3.01dB is Butterworth: flat, so the loop gain really is fb.gain.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = -3.01;
    const fb = ctx.createGain(); fb.gain.value = 0.982;
    const out = ctx.createGain(); out.gain.value = gain || 0.5;
    noise.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); dl.connect(out);
    out.connect(inputGain);
    noise.start(t); noise.stop(t + b.length / ctx.sampleRate);
    out.gain.setValueAtTime(gain || 0.5, t);
    out.gain.setTargetAtTime(0.0001, t + 1.0, 0.45);
    setTimeout(() => { [out, fb, lp, dl, noise].forEach(n => { try { n.disconnect(); } catch (_) {} }); },
      (t - ctx.currentTime + 3.2) * 1000);
  }

  const SCALE = [0, 3, 5, 7, 10, 12, 15, 17];   // minor pentatonic-ish
  function demoStep() {
    const density = +el('demoDensity').value / 100;
    if (Math.random() > 0.18 + density * 0.8) return;
    const root = 110 * Math.pow(2, [0, 0, 0, 5, 7][Math.floor(Math.random() * 5)] / 12);
    const n = SCALE[Math.floor(Math.random() * SCALE.length)];
    pluck(root * Math.pow(2, n / 12), ctx.currentTime + 0.01, 0.75 + Math.random() * 0.4);
  }

  async function toggleDemo() {
    await boot();
    if (demoTimer) {
      clearInterval(demoTimer); demoTimer = null;
      el('demoPlay').textContent = 'デモ演奏をはじめる';
    } else {
      demoStep();
      demoTimer = setInterval(demoStep, 520);
      el('demoPlay').textContent = 'デモ演奏をとめる';
    }
  }

  // ---------------------------------------------------------------
  // presets
  // ---------------------------------------------------------------

  const PRESETS = [
    { n: 'ただのアナログディレイ', p: { mix: .5, regen: .42, tone: .66, glide: 0, int1: null, int2: null, baseMs: 420, modDepth: 0, grit: .3, drive: .3 } },
    { n: 'オクターブ下降', p: { mix: .62, regen: .6, tone: .5, glide: 0, int1: -12, int2: -12, baseMs: 500, divBase: 1, div1: 1, div2: 1, modDepth: 0, grit: .45 } },
    { n: '上へ登る3ステップ', p: { mix: .6, regen: .58, tone: .75, glide: 0, int1: 7, int2: 5, baseMs: 380, divBase: .5, div1: .5, div2: .5, modDepth: 0 } },
    { n: '鳥のさえずり', p: { mix: .55, regen: .66, tone: .9, glide: 0, int1: 12, int2: 12, baseMs: 160, divBase: .5, div1: .5, div2: .5, grit: .2 } },
    { n: 'にじむ（GLIDE全開）', p: { mix: .65, regen: .62, tone: .55, glide: .85, int1: -12, int2: 7, baseMs: 600, modDepth: .03, modRate: .3 } },
    { n: '壊れたコンピュータ', p: { mix: .7, regen: .72, tone: .68, glide: .1, int1: 19, int2: -7, baseMs: 240, divBase: .5, div1: .75, div2: .5, modWave: 5, modDepth: .35, modRate: 5.5, grit: .6, drive: .6 } },
    { n: 'テープの揺れ', p: { mix: .5, regen: .55, tone: .48, glide: .2, int1: null, int2: null, baseMs: 520, modWave: 0, modDepth: .035, modRate: .55, grit: .6, drive: .5 } },
    { n: '湯船（32秒）', p: { mix: .75, regen: .78, tone: .38, glide: .6, int1: -12, int2: null, baseMs: 1800, divBase: 1, div1: 1, modDepth: .02, grit: .7 } },
  ];

  // Anything a preset does not name goes back to the factory value, so
  // presets are reproducible instead of inheriting whatever you left on.
  const TONE_KEYS = ['mix', 'regen', 'tone', 'reso', 'glide', 'int1', 'int2', 'baseMs',
    'divBase', 'div1', 'div2', 'bounce', 'modDepth', 'modRate', 'modWave', 'drive', 'grit'];
  const FACTORY = {
    mix: .55, regen: .45, tone: .62, reso: .35, glide: 0, int1: -12, int2: 5, baseMs: 500,
    divBase: 1, div1: 1, div2: 1, bounce: 0, modDepth: 0, modRate: .4, modWave: 0,
    drive: .35, grit: .35,
  };

  function applyPreset(p) {
    TONE_KEYS.forEach(k => { P[k] = (p[k] !== undefined) ? p[k] : FACTORY[k]; });
    // reflect engine values back onto knob positions
    KNOBS.forEach(k => {
      if (k.interval) {
        const d = detents();
        let idx = d.indexOf(P[k.id]);
        if (idx < 0) { chromatic = true; idx = CHROMATIC.indexOf(P[k.id]); }
        if (idx < 0) idx = d.indexOf(null);
        K[k.id] = idx / (detents().length - 1);
      } else {
        K[k.id] = P[k.id];
      }
      k.render();
    });
    syncToggles(); syncDips(); refreshReadout(); setLamp(0);
    pushAll(); cmd('resync'); save();
  }

  function buildPresets() {
    const host = el('presets');
    PRESETS.forEach(pr => {
      const b = document.createElement('button');
      b.className = 'preset'; b.type = 'button'; b.textContent = pr.n;
      b.addEventListener('click', () => boot().then(() => applyPreset(pr.p)));
      host.appendChild(b);
    });
  }

  // ---------------------------------------------------------------
  // persistence
  // ---------------------------------------------------------------

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem('yukemuri', JSON.stringify({ P, K, chromatic })); } catch (_) {}
    }, 250);
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem('yukemuri') || 'null');
      if (!s) return;
      Object.assign(P, s.P); Object.assign(K, s.K);
      chromatic = !!s.chromatic;
      P.bypass = 0;
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // scope
  // ---------------------------------------------------------------

  function draw() {
    const cv = el('scope');
    const g = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const trail = [];

    function frame() {
      requestAnimationFrame(frame);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr; cv.height = h * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      if (!analyser) return;
      analyser.getFloatTimeDomainData(scopeData);

      // pitch-shift trail: how far the clock currently sits from unity
      trail.push(clamp((meter.cents || 0) / 2400, -1, 1));
      if (trail.length > w) trail.shift();

      g.strokeStyle = 'rgba(95,201,192,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const y = h / 2 - trail[i] * (h / 2 - 6);
        i ? g.lineTo(i, y) : g.moveTo(i, y);
      }
      g.stroke();

      g.strokeStyle = 'rgba(232,228,220,0.06)';
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();

      // waveform
      let peak = 0;
      g.strokeStyle = P.bypass ? 'rgba(232,228,220,0.3)' : '#d98c3f';
      g.lineWidth = 1.4;
      g.beginPath();
      const stepX = scopeData.length / w;
      for (let x = 0; x < w; x++) {
        const v = scopeData[Math.floor(x * stepX)];
        if (Math.abs(v) > peak) peak = Math.abs(v);
        const y = h / 2 - v * (h / 2 - 8);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();

      el('meterBar').style.width = Math.min(100, peak * 100) + '%';
      refreshReadout();
    }
    frame();
  }

  // ---------------------------------------------------------------
  // recording
  // ---------------------------------------------------------------

  function wireRecorder() {
    const btn = el('recBtn'), dl = el('recDl');
    if (typeof MediaRecorder === 'undefined') { btn.hidden = true; return; }
    btn.addEventListener('click', async () => {
      await boot();
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
        btn.textContent = '⏺ 録音'; btn.classList.remove('is-rec');
        return;
      }
      recChunks = [];
      recorder = new MediaRecorder(recDest.stream);
      recorder.ondataavailable = e => e.data.size && recChunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(recChunks, { type: recorder.mimeType });
        dl.href = URL.createObjectURL(blob);
        dl.hidden = false;
      };
      recorder.start();
      btn.textContent = '⏹ 停止'; btn.classList.add('is-rec');
    });
  }

  // ---------------------------------------------------------------
  // wire up
  // ---------------------------------------------------------------

  restore();
  buildKnobs();
  buildToggles();
  buildDips();
  buildPresets();
  wireFootswitches();
  wireRecorder();
  refreshReadout();
  selectSource('demo');

  document.querySelectorAll('.srcBtn').forEach(b => {
    b.addEventListener('click', () => selectSource(b.dataset.src));
  });
  el('micStart').addEventListener('click', startMic);
  el('demoPlay').addEventListener('click', toggleDemo);
  el('demoPluck').addEventListener('click', async () => {
    await boot();
    pluck(110 * Math.pow(2, SCALE[Math.floor(Math.random() * SCALE.length)] / 12), 0, 0.95);
  });
  el('filePlay').addEventListener('click', toggleFile);
  el('fileInput').addEventListener('change', e => e.target.files[0] && loadFile(e.target.files[0]));

  const drop = el('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f) { selectSource('file'); loadFile(f); }
  });

  el('inGain').addEventListener('input', e => {
    P.inGain = +e.target.value / 100; send({ inGain: P.inGain }); save();
  });
  el('outGain').addEventListener('input', e => {
    P.outGain = +e.target.value / 100;
    if (master) master.gain.setTargetAtTime(P.outGain, ctx.currentTime, 0.02);
    save();
  });
  el('panicBtn').addEventListener('click', () => cmd('clear'));

  document.addEventListener('pointerdown', () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: false });

  // small handle for debugging / automated checks
  window.yukemuri = {
    P, K, boot, send, cmd,
    get ctx() { return ctx; },
    get inputGain() { return inputGain; },
    get master() { return master; },
  };
})();
