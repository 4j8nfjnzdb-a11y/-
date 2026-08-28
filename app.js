// 線音 SenOn — draw lines, hear melody.
//
// Every stroke is a track-colored polyline. A playhead scans across the
// canvas and, whenever it crosses a segment of a stroke, triggers a note
// (synth or chopped sample) whose pitch comes from the segment's y
// position. The scan itself can run three ways: a plain left-to-right
// sweep, a hand-drawn path that the playhead follows at constant
// arc-length speed (so a squiggly path speeds up, slows down, and can
// even move backward across x — non-linear time from a drawing), or a
// smoothed random wander.

(() => {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  // Finished strokes are cached here and only re-rendered on structural
  // changes (draw, erase, undo, clear, resize) — every animation frame
  // just blits this layer instead of re-tracing every point of every
  // stroke ever drawn, which used to make the app slow down and
  // eventually stall the longer a session went on.
  const strokesCanvas = document.createElement("canvas");
  const strokesCtx = strokesCanvas.getContext("2d");
  const waveCanvas = document.getElementById("waveCanvas");
  const waveCtx = waveCanvas.getContext("2d");
  const hint = document.getElementById("hint");

  const playBtn = document.getElementById("playBtn");
  const clearBtn = document.getElementById("clearBtn");
  const undoBtn = document.getElementById("undoBtn");
  const scanModeSelect = document.getElementById("scanMode");
  const speedSlider = document.getElementById("speed");
  const loopToggle = document.getElementById("loopToggle");
  const reverseToggle = document.getElementById("reverseToggle");
  const polyphonySelect = document.getElementById("polyphonyLimit");
  const filterSlider = document.getElementById("filterKnob");
  const spaceSlider = document.getElementById("spaceKnob");
  const keySelect = document.getElementById("keySelect");
  const scaleSelect = document.getElementById("scaleSelect");
  const tracksEl = document.getElementById("tracks");
  const colorBarEl = document.getElementById("colorBar");
  const brushBarEl = document.getElementById("brushBar");
  const toolButtons = [...document.querySelectorAll(".toolBtn")];

  const sampleFileInput = document.getElementById("sampleFile");
  const sampleStatus = document.getElementById("sampleStatus");
  const chopCountSlider = document.getElementById("chopCount");
  const chopCountLabel = document.getElementById("chopCountLabel");
  const chopBtn = document.getElementById("chopBtn");

  // ---- musical material -------------------------------------------

  const SCALES = {
    pentaMajor: { label: "ペンタトニック (Major)", degrees: [0, 2, 4, 7, 9] },
    pentaMinor: { label: "ペンタトニック (minor)", degrees: [0, 3, 5, 7, 10] },
    major: { label: "メジャー (Ionian)", degrees: [0, 2, 4, 5, 7, 9, 11] },
    minor: { label: "マイナー (Aeolian)", degrees: [0, 2, 3, 5, 7, 8, 10] },
    dorian: { label: "ドリアン", degrees: [0, 2, 3, 5, 7, 9, 10] },
    major7: { label: "Major 7", degrees: [0, 2, 4, 5, 7, 9, 11] },
    wholeTone: { label: "ホールトーン", degrees: [0, 2, 4, 6, 8, 10] },
  };

  const KEYS = [
    ["C", 60], ["C#", 61], ["D", 62], ["D#", 63], ["E", 64], ["F", 65],
    ["F#", 66], ["G", 67], ["G#", 68], ["A", 69], ["A#", 70], ["B", 71],
  ];

  const OCTAVE_SPAN = 3;
  const MAX_STROKES = 200; // oldest strokes drop once a session draws past this

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // ---- tracks (draw colors) -----------------------------------------

  // `color` is a literal hex used for canvas drawing (ctx.fillStyle can't
  // resolve CSS custom properties without a DOM element); `css` is the
  // matching var() reference used for DOM styling elsewhere. `instrument`
  // is one of the INSTRUMENT_OPTIONS values below; `fx` is one of
  // FX_OPTIONS. Object keys are legacy internal ids, not the gem names
  // shown in the UI.
  function defaultFx() {
    return { ring: false, tremolo: false, vibrato: false, pitchBend: false, echo: false };
  }

  const TRACKS = {
    cyan: { hue: 213, color: "#5b8dee", css: "var(--cyan)", instrument: "sine", fx: defaultFx(), sampleSlice: 0, sampleMode: "walk" },
    magenta: { hue: 333, color: "#ff8fc0", css: "var(--magenta)", instrument: "triangle", fx: defaultFx(), sampleSlice: 1, sampleMode: "walk" },
    yellow: { hue: 66, color: "#d4e157", css: "var(--yellow)", instrument: "kick", fx: defaultFx(), sampleSlice: 2, sampleMode: "walk" },
    green: { hue: 157, color: "#35c48a", css: "var(--green)", instrument: "square", fx: defaultFx(), sampleSlice: 3, sampleMode: "walk" },
    purple: { hue: 261, color: "#a374e8", css: "var(--purple)", instrument: "sawtooth", fx: defaultFx(), sampleSlice: 4, sampleMode: "walk" },
    orange: { hue: 350, color: "#e0566f", css: "var(--orange)", instrument: "snare", fx: defaultFx(), sampleSlice: 5, sampleMode: "walk" },
  };
  const TRACK_IDS = Object.keys(TRACKS);

  // How playSample picks which chopped slice to use each time a track
  // fires — "fixed" keeps the old one-slice-per-track behavior (for
  // when the color identity matters more than variety); the others
  // move through the chopped material instead of always landing on
  // the same syllable.
  const SAMPLE_MODE_LIST = [
    { value: "fixed", label: "固定" },
    { value: "sequential", label: "順次" },
    { value: "random", label: "ランダム" },
    { value: "walk", label: "ゆらぎ" },
  ];

  const INSTRUMENT_OPTIONS = [
    { value: "sine", label: "サイン波" },
    { value: "triangle", label: "三角波" },
    { value: "square", label: "矩形波" },
    { value: "sawtooth", label: "ノコギリ波" },
    { value: "kick", label: "キック" },
    { value: "snare", label: "スネア" },
    { value: "hihatClosed", label: "クローズハイハット" },
    { value: "hihatOpen", label: "オープンハイハット" },
    { value: "clap", label: "クラップ" },
    { value: "sample", label: "サンプル" },
  ];
  const DRUM_VOICE_SET = new Set(["kick", "snare", "hihatClosed", "hihatOpen", "clap"]);

  // Independent toggles, not a single pick — any combination can stack
  // on one track (e.g. ring + vibrato together).
  const FX_LIST = [
    { key: "ring", label: "リング" },
    { key: "tremolo", label: "トレモロ" },
    { key: "vibrato", label: "ビブラート" },
    { key: "pitchBend", label: "ベンド" },
    { key: "echo", label: "エコー" },
  ];

  // Brush = how a stroke is drawn AND how it sounds. Purely a set of
  // multipliers/flags applied on top of whatever the track's own
  // instrument/fx already do — no extra audio nodes, so picking a
  // brush costs nothing extra to render or play.
  const BRUSH_LIST = [
    { key: "dot", label: "点描" },
    { key: "thin", label: "細" },
    { key: "normal", label: "標準" },
    { key: "thick", label: "太" },
    { key: "blur", label: "ぼかし" },
  ];
  const BRUSH_PROFILES = {
    dot: { lineWidth: 3.4, core: true, dotStyle: true, decayMul: 0.4, gainMul: 0.95, filterMul: 1.15, wetAdd: 0.05 },
    thin: { lineWidth: 1.3, core: true, dotStyle: false, decayMul: 0.7, gainMul: 0.78, filterMul: 1.3, wetAdd: 0 },
    normal: { lineWidth: 2.2, core: true, dotStyle: false, decayMul: 1, gainMul: 1, filterMul: 1, wetAdd: 0 },
    thick: { lineWidth: 6.5, core: true, dotStyle: false, decayMul: 1.6, gainMul: 1.15, filterMul: 0.85, wetAdd: 0.08 },
    blur: { lineWidth: 9, core: false, dotStyle: false, decayMul: 1.35, gainMul: 0.85, filterMul: 0.45, wetAdd: 0.28 },
  };

  // ---- app state ------------------------------------------------------

  const state = {
    tool: "pen",
    activeColorId: "cyan",
    brush: "normal",
    strokes: [], // {id, colorId, brush, points:[{x,y}]}
    playheadPath: null, // {points:[{x,y}], cum:[dist...], total}
    scanMode: "sweep",
    bounceDir: 1,
    playing: false,
    loop: true,
    reverse: false,
    speedValue: 45, // 1..100 slider
    key: 60,
    scaleName: "pentaMajor",
    scanProgress: 0, // 0..1 for sweep/path/bounce, px for wander
    polyphonyLimit: 3, // 0 = unlimited; otherwise max notes sounding at once
  };

  let strokeSeq = 1;
  let cssWidth = 0, cssHeight = 0;
  let currentStroke = null;
  let drawing = false;

  // ---- audio engine ---------------------------------------------------

  let audioCtx = null;
  let master, dry, wet, delayA, delayB, masterFilter;

  function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    master = audioCtx.createGain();
    master.gain.value = 0.9;

    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = filterKnobToHz(+filterSlider.value);
    masterFilter.Q.value = 0.4;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3.2;
    master.connect(masterFilter).connect(compressor).connect(audioCtx.destination);

    dry = audioCtx.createGain();
    dry.gain.value = 0.6;
    dry.connect(master);

    wet = audioCtx.createGain();
    wet.gain.value = spaceKnobToGain(+spaceSlider.value);
    wet.connect(master);

    delayA = audioCtx.createDelay(2.0);
    delayA.delayTime.value = 0.28;
    const fbA = audioCtx.createGain();
    fbA.gain.value = 0.32;
    const dampA = audioCtx.createBiquadFilter();
    dampA.type = "lowpass";
    dampA.frequency.value = 2400;
    delayA.connect(dampA).connect(fbA).connect(delayA);
    delayA.connect(wet);

    delayB = audioCtx.createDelay(2.0);
    delayB.delayTime.value = 0.41;
    const fbB = audioCtx.createGain();
    fbB.gain.value = 0.28;
    const dampB = audioCtx.createBiquadFilter();
    dampB.type = "lowpass";
    dampB.frequency.value = 1900;
    delayB.connect(dampB).connect(fbB).connect(delayB);
    delayB.connect(wet);
  }

  // The two damped feedback delays (below) are what give notes their
  // sense of space now — a convolution reverb used to sit alongside
  // them here, but that ran continuously and was expensive enough to
  // be a likely cause of audio crackling (the render thread not
  // keeping up), independent of how many notes were playing.
  function sendToSpace(node, dryAmt, wetAmt) {
    const dg = audioCtx.createGain();
    dg.gain.value = dryAmt;
    node.connect(dg).connect(dry);

    const rg = audioCtx.createGain();
    rg.gain.value = wetAmt;
    node.connect(rg).connect(delayA);
    node.connect(rg).connect(delayB);
  }

  function currentScale() {
    return SCALES[state.scaleName].degrees;
  }

  function yToMidi(y) {
    const norm = 1 - clamp(y / cssHeight, 0, 1); // 0 bottom .. 1 top
    const scale = currentScale();
    const steps = scale.length * OCTAVE_SPAN;
    const idx = Math.round(norm * (steps - 1));
    const octave = Math.floor(idx / scale.length);
    const degree = scale[idx % scale.length];
    return state.key + degree + octave * 12 - 12; // center register
  }

  // ---- per-track modulation (cheap, native WebAudio nodes only) --------
  // Any combination of these can be on for one track at once. "ring"
  // and "tremolo" each insert one extra gain stage, chained in series;
  // "vibrato" wires an LFO into the source's own detune param; "echo"
  // just turns up that note's send to the shared delay/reverb bus, no
  // extra node. Every enabled effect is at most a couple of short-lived
  // oscillator+gain nodes — negligible next to what's already built per
  // note, so stacking several doesn't reintroduce the earlier heaviness.
  function applyModulation(track, sourceNode, now, dur) {
    let node = sourceNode;
    if (track.fx.ring) {
      const carrier = audioCtx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.value = 55 + Math.random() * 220;
      const ringGain = audioCtx.createGain();
      ringGain.gain.value = 0; // pure multiply: carrier IS the gain signal
      carrier.connect(ringGain.gain);
      node.connect(ringGain);
      carrier.start(now);
      carrier.stop(now + dur + 0.2);
      node = ringGain;
    }
    if (track.fx.tremolo) {
      const lfo = audioCtx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 5 + Math.random() * 4;
      const depth = audioCtx.createGain();
      depth.gain.value = 0.35;
      const trem = audioCtx.createGain();
      trem.gain.value = 0.65;
      lfo.connect(depth).connect(trem.gain);
      node.connect(trem);
      lfo.start(now);
      lfo.stop(now + dur + 0.2);
      node = trem;
    }
    return node;
  }

  function applyVibrato(track, sourceNode, now, dur) {
    if (!track.fx.vibrato) return;
    const lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 4.5 + Math.random() * 3;
    const depth = audioCtx.createGain();
    depth.gain.value = 9;
    lfo.connect(depth).connect(sourceNode.detune);
    lfo.start(now);
    lfo.stop(now + dur + 0.2);
  }

  // Pitch bend schedules the frequency ramp itself instead of a static
  // value; sample playback bends playbackRate the same way since that's
  // what actually controls its pitch.
  function applyPitchBend(track, oscNode, freq, now, dur) {
    if (!track.fx.pitchBend) {
      oscNode.frequency.value = freq;
      return;
    }
    oscNode.frequency.setValueAtTime(freq, now);
    oscNode.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.8), now + dur * 0.85);
  }

  function applyPitchBendRate(track, srcNode, rate, now, dur) {
    if (!track.fx.pitchBend) {
      srcNode.playbackRate.value = rate;
      return;
    }
    srcNode.playbackRate.setValueAtTime(rate, now);
    srcNode.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, rate * 0.8), now + dur * 0.85);
  }

  function echoWet(track, baseWet) {
    return track.fx.echo ? Math.min(1, baseWet * 1.8) : baseWet;
  }

  // Waveform character (the buzz of a sawtooth, the hollowness of a
  // square) lives in harmonics well above the fundamental. Keep this
  // filter's cutoff far above the note so those harmonics survive —
  // it used to track close to the fundamental and quietly sanded every
  // waveform down to a near-sine.
  function playSynth(track, midi, x, velocity, brush) {
    const now = audioCtx.currentTime;
    const freq = midiToFreq(midi);

    const osc = audioCtx.createOscillator();
    osc.type = track.instrument;
    osc.detune.value = (Math.random() * 2 - 1) * 6; // humanize: no two notes identical

    const decay = (0.7 + Math.random() * 0.7) * brush.decayMul;
    applyPitchBend(track, osc, freq, now, decay);
    applyVibrato(track, osc, now, decay);
    const modOut = applyModulation(track, osc, now, decay);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.2 * velocity * brush.gainMul, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0006, now + decay);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 9000 * brush.filterMul;
    filter.Q.value = 0.3;

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp((x / cssWidth) * 2 - 1, -1, 1);

    modOut.connect(filter).connect(env).connect(panner);
    sendToSpace(panner, 0.5, Math.min(1, echoWet(track, 0.55) + brush.wetAdd));

    osc.start(now);
    osc.stop(now + decay + 0.15);
  }

  // Which slice a track uses next, per its sampleMode. "walk" takes a
  // bounded random step from wherever it last was — the "行き交う"
  // (wandering back and forth) behavior — instead of jumping anywhere
  // in the material like plain "random" does.
  function pickSampleSlice(track, sliceCount) {
    if (sliceCount <= 1) return 0;
    const startAt = clamp(track.sampleSlice || 0, 0, sliceCount - 1);
    if (track.sampleMode === "sequential") {
      const cur = track.sampleCursor == null ? startAt : track.sampleCursor;
      track.sampleCursor = (cur + 1) % sliceCount;
      return track.sampleCursor;
    }
    if (track.sampleMode === "random") {
      return Math.floor(Math.random() * sliceCount);
    }
    if (track.sampleMode === "walk") {
      const cur = track.sampleCursor == null ? startAt : track.sampleCursor;
      const step = Math.random() < 0.5 ? -1 : 1;
      track.sampleCursor = clamp(cur + step, 0, sliceCount - 1);
      return track.sampleCursor;
    }
    return startAt; // "fixed"
  }

  function playSample(track, midi, x, velocity, brush) {
    if (!sampleBank || !sampleBank.slices.length) {
      playSynth(track, midi, x, velocity, brush);
      return;
    }
    const now = audioCtx.currentTime;
    const idx = pickSampleSlice(track, sampleBank.slices.length);
    const buffer = state.reverse
      ? sampleBank.reversedSlices[idx]
      : sampleBank.slices[idx];

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const rate = clamp(Math.pow(2, (midi - 60) / 12), 0.25, 4);
    const dur = buffer.duration / rate;
    applyPitchBendRate(track, src, rate, now, dur);
    applyVibrato(track, src, now, dur);
    const modOut = applyModulation(track, src, now, dur);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 9000 * brush.filterMul;
    filter.Q.value = 0.3;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.75 * velocity * brush.gainMul, now + 0.008);
    const fadeStart = Math.max(now + 0.01, now + dur - 0.03);
    env.gain.setValueAtTime(0.75 * velocity * brush.gainMul, fadeStart);
    env.gain.linearRampToValueAtTime(0, now + dur);

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp((x / cssWidth) * 2 - 1, -1, 1);

    modOut.connect(filter).connect(env).connect(panner);
    sendToSpace(panner, 0.7, Math.min(1, echoWet(track, 0.35) + brush.wetAdd));

    src.start(now);
    src.stop(now + dur + 0.05);
  }

  // ---- drum synthesis ----------------------------------------------
  // Each track now picks one fixed voice directly (no more guessing by
  // vertical position, which in practice meant most casual strokes only
  // ever landed in the hi-hat band).

  let noiseBuf = null;
  function noiseBuffer() {
    if (!noiseBuf) {
      const len = audioCtx.sampleRate; // 1s of white noise, reused/re-sliced per hit
      noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function playDrum(track, voice, x, velocity, brush) {
    const now = audioCtx.currentTime;
    const v = velocity * brush.gainMul;
    const dm = brush.decayMul;
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp((x / cssWidth) * 2 - 1, -1, 1);
    sendToSpace(panner, 0.85, Math.min(1, echoWet(track, 0.2) + brush.wetAdd));

    if (voice === "kick") {
      const dur = 0.32 * dm;
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(38 + Math.random() * 8, now + 0.13);
      applyVibrato(track, osc, now, dur);
      const modOut = applyModulation(track, osc, now, dur);
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0.9 * v, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);
      modOut.connect(env).connect(panner);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      return;
    }

    if (voice === "snare") {
      const dur = 0.16 * dm;
      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer();
      applyVibrato(track, src, now, dur);
      const modOut = applyModulation(track, src, now, dur);
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800 * brush.filterMul;
      bp.Q.value = 0.7;
      const nEnv = audioCtx.createGain();
      nEnv.gain.setValueAtTime(0.5 * v, now);
      nEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
      modOut.connect(bp).connect(nEnv).connect(panner);
      src.start(now);
      src.stop(now + dur + 0.02);

      const osc = audioCtx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 190;
      const oEnv = audioCtx.createGain();
      oEnv.gain.setValueAtTime(0.35 * v, now);
      oEnv.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.75);
      osc.connect(oEnv).connect(panner);
      osc.start(now);
      osc.stop(now + dur * 0.75 + 0.02);
      return;
    }

    if (voice === "hihatClosed" || voice === "hihatOpen") {
      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer();
      const dur = (voice === "hihatOpen" ? 0.28 : 0.05) * dm;
      applyVibrato(track, src, now, dur);
      const modOut = applyModulation(track, src, now, dur);
      const hp = audioCtx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000 * brush.filterMul;
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0.28 * v, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);
      modOut.connect(hp).connect(env).connect(panner);
      src.start(now);
      src.stop(now + dur + 0.02);
      return;
    }

    // clap: three quick layered noise bursts
    const clapDur = 0.08 * dm;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.011;
      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuffer();
      const modOut = applyModulation(track, src, t, clapDur);
      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500 * brush.filterMul;
      bp.Q.value = 1.2;
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0.4 * v, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + clapDur);
      modOut.connect(bp).connect(env).connect(panner);
      src.start(t);
      src.stop(t + clapDur + 0.02);
    }
  }

  // Each note with FX stacked on it (ring + tremolo + vibrato, say) can
  // spawn a dozen-plus AudioNodes. That's fine for a few notes at once
  // but adds up fast with several busy tracks — this caps how many can
  // be sounding simultaneously, dropping (not queuing) new triggers
  // past the limit so the audio graph never grows unbounded. 0 = no cap.
  let activeVoiceCount = 0;
  function reserveVoice(durationSec) {
    if (state.polyphonyLimit > 0 && activeVoiceCount >= state.polyphonyLimit) return false;
    activeVoiceCount++;
    setTimeout(() => { activeVoiceCount = Math.max(0, activeVoiceCount - 1); }, Math.max(0, durationSec * 1000));
    return true;
  }

  function triggerNote(stroke, x, y, velocity) {
    if (!reserveVoice(1.2)) return;
    const track = TRACKS[stroke.colorId];
    const brush = BRUSH_PROFILES[stroke.brush] || BRUSH_PROFILES.normal;
    if (track.instrument === "sample") {
      playSample(track, yToMidi(y), x, velocity, brush);
    } else if (DRUM_VOICE_SET.has(track.instrument)) {
      playDrum(track, track.instrument, x, velocity, brush);
    } else {
      playSynth(track, yToMidi(y), x, velocity, brush);
    }
    spawnBurst(x, y, track.color);
  }

  // ---- sample loading / chopping ---------------------------------------

  let sampleBuffer = null;
  let sampleBank = null; // {slices:[AudioBuffer], reversedSlices:[AudioBuffer]}

  function reverseBuffer(buffer) {
    const rev = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = rev.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    return rev;
  }

  function chopBuffer(buffer, n) {
    const slices = [];
    const reversedSlices = [];
    const total = buffer.length;
    const sliceLen = Math.max(1, Math.floor(total / n));
    for (let i = 0; i < n; i++) {
      const start = i * sliceLen;
      const len = i === n - 1 ? total - start : sliceLen;
      if (len <= 0) continue;
      const slice = audioCtx.createBuffer(buffer.numberOfChannels, len, buffer.sampleRate);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        slice.getChannelData(ch).set(buffer.getChannelData(ch).subarray(start, start + len));
      }
      slices.push(slice);
      reversedSlices.push(reverseBuffer(slice));
    }
    return { slices, reversedSlices };
  }

  function drawWaveform(buffer, chopN) {
    const dpr = effectiveDpr();
    const w = waveCanvas.width = waveCanvas.clientWidth * dpr;
    const h = waveCanvas.height = waveCanvas.clientHeight * dpr;
    waveCtx.clearRect(0, 0, w, h);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    waveCtx.strokeStyle = "rgba(246,238,247,0.55)";
    waveCtx.lineWidth = 1;
    waveCtx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      for (let i = 0; i < step; i++) {
        const v = data[start + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = h / 2 + min * h * 0.48;
      const y2 = h / 2 + max * h * 0.48;
      waveCtx.moveTo(x, y1);
      waveCtx.lineTo(x, y2);
    }
    waveCtx.stroke();

    if (chopN > 1) {
      waveCtx.strokeStyle = "rgba(255,45,107,0.55)";
      for (let i = 1; i < chopN; i++) {
        const x = (i / chopN) * w;
        waveCtx.beginPath();
        waveCtx.moveTo(x, 0);
        waveCtx.lineTo(x, h);
        waveCtx.stroke();
      }
    }
  }

  async function loadSampleFromArrayBuffer(arrayBuffer, label) {
    if (!audioCtx) initAudio();
    try {
      sampleBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      sampleStatus.textContent = `${label}（${sampleBuffer.duration.toFixed(1)}秒）読み込み済み`;
      chopBtn.disabled = false;
      drawWaveform(sampleBuffer, 1);
      doChop();
    } catch (err) {
      sampleStatus.textContent = "読み込みに失敗しました";
    }
  }

  function doChop() {
    if (!sampleBuffer) return;
    const n = +chopCountSlider.value;
    sampleBank = chopBuffer(sampleBuffer, n);
    drawWaveform(sampleBuffer, n);
    sampleStatus.textContent = `${sampleBank.slices.length}個にチョップ済み`;
    // spread tracks across the available slices by default, so switching
    // several tracks to "サンプル" gives each one a different chunk
    // right away instead of all landing on slice 1
    TRACK_IDS.forEach((id, i) => {
      TRACKS[id].sampleSlice = i % sampleBank.slices.length;
    });
    buildTracksUI();
  }

  sampleFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    loadSampleFromArrayBuffer(buf, file.name);
  });

  chopBtn.addEventListener("click", doChop);
  chopCountSlider.addEventListener("input", () => {
    chopCountLabel.textContent = chopCountSlider.value;
  });

  // ---- color bar: the ONLY control that switches the drawing color.
  // Big dedicated circular buttons — nothing else layered on top of them
  // to steal the tap, unlike the old combined color+instrument row.
  // -----------------------------------------------------------------

  function buildColorBar() {
    colorBarEl.innerHTML = "";
    TRACK_IDS.forEach((id) => {
      const track = TRACKS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "colorSwatch";
      btn.dataset.color = id;
      btn.style.color = track.css;
      btn.title = id;
      btn.addEventListener("click", () => {
        state.tool = "pen";
        state.activeColorId = id;
        updateToolUI();
      });
      colorBarEl.appendChild(btn);
    });
    updateColorBarUI();
  }

  function updateColorBarUI() {
    [...colorBarEl.children].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.color === state.activeColorId && state.tool === "pen");
    });
  }

  function buildBrushBar() {
    brushBarEl.innerHTML = "";
    BRUSH_LIST.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghostBtn brushBtn";
      btn.dataset.brush = key;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        state.brush = key;
        updateBrushBarUI();
      });
      brushBarEl.appendChild(btn);
    });
    updateBrushBarUI();
  }

  function updateBrushBarUI() {
    [...brushBarEl.children].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.brush === state.brush);
    });
  }

  // ---- per-track instrument rows (settings drawer only) -----------------

  function buildTracksUI() {
    tracksEl.innerHTML = "";
    TRACK_IDS.forEach((id) => {
      const track = TRACKS[id];
      const row = document.createElement("div");
      row.className = "trackRow";
      row.style.color = track.css;

      const dot = document.createElement("span");
      dot.className = "trackDot";
      row.appendChild(dot);

      const select = document.createElement("select");
      INSTRUMENT_OPTIONS.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === "sample") {
          opt.disabled = !sampleBank;
          opt.dataset.sampleOpt = "1";
        }
        select.appendChild(opt);
      });
      select.value = track.instrument;
      select.addEventListener("change", () => {
        track.instrument = select.value;
      });
      row.appendChild(select);

      const fxToggles = document.createElement("div");
      fxToggles.className = "fxToggles";
      FX_LIST.forEach(({ key, label }) => {
        const chip = document.createElement("label");
        chip.className = "fxChip";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!track.fx[key];
        cb.addEventListener("change", () => {
          track.fx[key] = cb.checked;
        });
        const span = document.createElement("span");
        span.textContent = label;
        chip.appendChild(cb);
        chip.appendChild(span);
        fxToggles.appendChild(chip);
      });
      row.appendChild(fxToggles);

      const modeSelect = document.createElement("select");
      modeSelect.className = "sampleModeSelect";
      modeSelect.title = "サンプル使用時の再生順";
      SAMPLE_MODE_LIST.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        modeSelect.appendChild(opt);
      });
      modeSelect.value = track.sampleMode;
      modeSelect.disabled = !sampleBank;
      modeSelect.addEventListener("change", () => {
        track.sampleMode = modeSelect.value;
        track.sampleCursor = null;
      });
      row.appendChild(modeSelect);

      const sliceCount = sampleBank ? sampleBank.slices.length : 1;
      const sliceSelect = document.createElement("select");
      sliceSelect.className = "sliceSelect";
      for (let i = 0; i < sliceCount; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = `スライス${i + 1}`;
        sliceSelect.appendChild(opt);
      }
      sliceSelect.value = clamp(track.sampleSlice || 0, 0, sliceCount - 1);
      sliceSelect.disabled = !sampleBank;
      sliceSelect.title = "固定モード時のスライス、他モードの開始位置";
      sliceSelect.addEventListener("change", () => {
        track.sampleSlice = +sliceSelect.value;
        track.sampleCursor = null;
      });
      row.appendChild(sliceSelect);

      tracksEl.appendChild(row);
    });
  }

  // ---- key / scale UI -----------------------------------------------

  KEYS.forEach(([name, midi]) => {
    const opt = document.createElement("option");
    opt.value = midi;
    opt.textContent = name;
    keySelect.appendChild(opt);
  });
  keySelect.value = state.key;

  Object.entries(SCALES).forEach(([id, s]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = s.label;
    scaleSelect.appendChild(opt);
  });
  scaleSelect.value = state.scaleName;

  keySelect.addEventListener("change", () => (state.key = +keySelect.value));
  scaleSelect.addEventListener("change", () => (state.scaleName = scaleSelect.value));

  // ---- tool / transport UI ------------------------------------------

  function updateToolUI() {
    toolButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === state.tool));
    updateColorBarUI();
  }

  toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tool = btn.dataset.tool;
      updateToolUI();
    });
  });

  clearBtn.addEventListener("click", () => {
    state.strokes = [];
    state.playheadPath = null;
    hint.classList.remove("hidden");
    strokesCtx.clearRect(0, 0, cssWidth, cssHeight);
    triggerCooldowns.clear();
    // the main canvas keeps a fading trail of whatever was composited
    // onto it each frame (that's how the ambient glow trail works) —
    // without this, cleared strokes would linger as a faint ghost for
    // several frames instead of vanishing immediately
    ctx.clearRect(0, 0, cssWidth, cssHeight);
  });

  undoBtn.addEventListener("click", () => {
    if (state.tool === "path") {
      state.playheadPath = null;
    } else {
      const removed = state.strokes.pop();
      if (removed) triggerCooldowns.delete(removed.id);
      redrawStrokesLayer();
    }
  });

  scanModeSelect.addEventListener("change", () => {
    state.scanMode = scanModeSelect.value;
    state.scanProgress = 0;
    state.bounceDir = 1;
    wanderDrift.value = cssWidth / 2;
    wanderDrift.target = cssWidth / 2;
    prevScanX = state.scanMode === "wander" ? wanderDrift.value : 0;
  });

  speedSlider.addEventListener("input", () => (state.speedValue = +speedSlider.value));
  loopToggle.addEventListener("change", () => (state.loop = loopToggle.checked));
  reverseToggle.addEventListener("change", () => (state.reverse = reverseToggle.checked));
  polyphonySelect.addEventListener("change", () => (state.polyphonyLimit = +polyphonySelect.value));

  // ---- macro fx knobs -------------------------------------------------

  function filterKnobToHz(v) {
    // exponential taper: 0 -> muffled (~250Hz), 100 -> fully open (~14kHz)
    return 250 * Math.pow(14000 / 250, v / 100);
  }
  function spaceKnobToGain(v) {
    return (v / 100) * 1.3;
  }

  filterSlider.addEventListener("input", () => {
    if (masterFilter) {
      masterFilter.frequency.setTargetAtTime(filterKnobToHz(+filterSlider.value), audioCtx.currentTime, 0.02);
    }
  });
  spaceSlider.addEventListener("input", () => {
    if (wet) wet.gain.setTargetAtTime(spaceKnobToGain(+spaceSlider.value), audioCtx.currentTime, 0.05);
  });

  playBtn.addEventListener("click", () => {
    if (!audioCtx) initAudio();
    if (audioCtx.state === "suspended") audioCtx.resume();
    state.playing = !state.playing;
    playBtn.textContent = state.playing ? "停止" : "再生";
    playBtn.classList.toggle("playing", state.playing);
  });

  // ---- drawing --------------------------------------------------------

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function nearestStrokeIndex(p, threshold) {
    let best = -1, bestD = threshold;
    state.strokes.forEach((s, i) => {
      s.points.forEach((pt) => {
        const d = dist(p, pt);
        if (d < bestD) { bestD = d; best = i; }
      });
    });
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    hint.classList.add("hidden");

    if (state.tool === "eraser") {
      drawing = true;
      const idx = nearestStrokeIndex(p, 16);
      if (idx >= 0) {
        const [removed] = state.strokes.splice(idx, 1);
        triggerCooldowns.delete(removed.id);
        redrawStrokesLayer();
      }
      return;
    }

    drawing = true;
    const pressure = e.pressure > 0 ? e.pressure : 0.8;
    if (state.tool === "path") {
      currentStroke = { points: [{ x: p.x, y: p.y }] };
      state.playheadPath = currentStroke;
    } else {
      currentStroke = {
        id: strokeSeq++,
        colorId: state.activeColorId,
        brush: state.brush,
        velocity: 0.5 + pressure * 0.5,
        points: [{ x: p.x, y: p.y }],
      };
      state.strokes.push(currentStroke);

      // an unbounded canvas keeps growing in memory (and in cooldown
      // bookkeeping) for the entire session no matter how fast per-frame
      // rendering is — cap it so a long, heavy drawing session can't
      // eventually exhaust memory on its own. Oldest strokes fall off
      // first, same as any other bounded history.
      if (state.strokes.length > MAX_STROKES) {
        const dropped = state.strokes.shift();
        triggerCooldowns.delete(dropped.id);
        redrawStrokesLayer();
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = pointerPos(e);

    if (state.tool === "eraser") {
      const idx = nearestStrokeIndex(p, 16);
      if (idx >= 0) {
        const [removed] = state.strokes.splice(idx, 1);
        triggerCooldowns.delete(removed.id);
        redrawStrokesLayer();
      }
      return;
    }

    if (!currentStroke) return;
    const last = currentStroke.points[currentStroke.points.length - 1];
    // dot brush wants visibly separate dots, not points every ~2.5px
    const minGap = currentStroke.brush === "dot" ? 16 : 2.5;
    if (dist(last, p) < minGap) return;
    currentStroke.points.push({ x: p.x, y: p.y });

    // paint just the new bit onto the cached layer immediately, instead
    // of waiting to redraw the whole stroke — keeps drawing itself O(1)
    // per point no matter how long the stroke gets
    if (state.tool === "pen") {
      const color = TRACKS[currentStroke.colorId].color;
      if (currentStroke.brush === "dot") {
        paintStroke(strokesCtx, [p], color, currentStroke.brush);
      } else {
        const n = currentStroke.points.length;
        paintStroke(strokesCtx, [currentStroke.points[n - 2], currentStroke.points[n - 1]], color, currentStroke.brush);
      }
    }
  });

  // Full-resolution points (every ~2.5px) make the curve render smooth,
  // but triggering a note on every single one of those segments turns
  // any drawn line into a rapid, mechanical "pa-pa-pa-pa" — the note
  // rate and rhythm just tracked how fast the mouse sampled, not
  // anything about the shape. Trigger off a coarser subset instead;
  // the drawing itself stays fully smooth since rendering still uses
  // the original dense points.
  function buildTriggerPoints(points) {
    // a tapped dot (no drag) is one point — duplicate it so the segment
    // loop below still has something to test the playhead against
    if (points.length === 1) return [points[0], points[0]];
    if (points.length <= 2) return points;
    // gap measured in x only: triggering is driven by the playhead's x
    // position, so a wiggly-but-x-narrow squiggle (lots of arc length,
    // little horizontal progress) shouldn't still spam extra notes —
    // 2D arc-length spacing was letting that slip through
    const minGapX = 26;
    const out = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      if (Math.abs(points[i].x - last.x) >= minGapX) {
        out.push(points[i]);
        last = points[i];
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function endStroke() {
    if (currentStroke && currentStroke.id != null) {
      // a plain tap (pointerdown+up, no drag in between) never fires
      // pointermove, so nothing got painted incrementally — paint the
      // single dot now so tapping alone still leaves a mark
      if (currentStroke.points.length === 1) {
        paintStroke(strokesCtx, currentStroke.points, TRACKS[currentStroke.colorId].color, currentStroke.brush);
      }
      currentStroke.triggerPoints = buildTriggerPoints(currentStroke.points);
    }
    drawing = false;
    currentStroke = null;
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  // ---- scan / playhead -------------------------------------------------

  function preparePath(path) {
    if (!path || path.points.length < 2) { path && (path.total = 0); return; }
    const cum = [0];
    for (let i = 1; i < path.points.length; i++) {
      cum.push(cum[i - 1] + dist(path.points[i - 1], path.points[i]));
    }
    path.cum = cum;
    path.total = cum[cum.length - 1];
  }

  function pointOnPath(path, s) {
    // s: arc-length distance along path, wrapped to [0,total)
    const total = path.total;
    if (total <= 0) return path.points[0];
    let d = s % total;
    if (d < 0) d += total;
    const cum = path.cum;
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    i = clamp(i, 1, cum.length - 1);
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / segLen;
    const a = path.points[i - 1], b = path.points[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  const wanderDrift = { value: 0, target: 0 };

  function speedToDuration() {
    // slider 1..100 -> seconds to cross the canvas once, fast..slow
    return 21 - (state.speedValue / 100) * 20;
  }

  let prevScanX = 0;
  let scanY = null; // for path mode marker

  function advanceScan(dt) {
    const dir = state.reverse ? -1 : 1;

    if (state.scanMode === "sweep") {
      const duration = speedToDuration();
      state.scanProgress += (dt / duration) * dir;
      if (state.scanProgress >= 1 || state.scanProgress < 0) {
        if (state.loop) {
          state.scanProgress = ((state.scanProgress % 1) + 1) % 1;
        } else {
          state.scanProgress = clamp(state.scanProgress, 0, 1);
          state.playing = false;
          playBtn.textContent = "再生";
          playBtn.classList.remove("playing");
        }
      }
      return state.scanProgress * cssWidth;
    }

    if (state.scanMode === "bounce") {
      // ping-pong sweep: reverses at each edge on its own, independent
      // of the reverse toggle — a triangle-wave motion instead of a saw
      const duration = speedToDuration();
      state.scanProgress += (dt / duration) * state.bounceDir;
      if (state.scanProgress >= 1) {
        state.scanProgress = 1;
        state.bounceDir = -1;
      } else if (state.scanProgress <= 0) {
        state.scanProgress = 0;
        state.bounceDir = 1;
      }
      return state.scanProgress * cssWidth;
    }

    if (state.scanMode === "path") {
      const path = state.playheadPath;
      if (!path || !path.total) return prevScanX;
      const duration = speedToDuration();
      const speedPxPerSec = path.total / duration;
      state.scanProgress += speedPxPerSec * dt * dir;
      if (state.scanProgress >= path.total || state.scanProgress < 0) {
        if (state.loop) {
          state.scanProgress = ((state.scanProgress % path.total) + path.total) % path.total;
        } else {
          state.scanProgress = clamp(state.scanProgress, 0, path.total);
          state.playing = false;
          playBtn.textContent = "再生";
          playBtn.classList.remove("playing");
        }
      }
      const pos = pointOnPath(path, state.scanProgress);
      scanY = pos.y;
      return pos.x;
    }

    // wander: smoothed random walk across x
    if (Math.random() < 0.035) {
      wanderDrift.target = Math.random() * cssWidth;
    }
    const speed = 0.4 + (state.speedValue / 100) * 2.2;
    const bias = state.reverse ? -6 : 0;
    wanderDrift.value += (wanderDrift.target - wanderDrift.value) * dt * speed + bias * dt;
    wanderDrift.value = clamp(wanderDrift.value, 0, cssWidth);
    return wanderDrift.value;
  }

  // strokeId -> Map(segmentIndex -> lastTriggerTime). Nested so a
  // removed stroke's cooldown entries can be dropped in one call
  // (triggerCooldowns.delete(id)) instead of leaking forever — a flat
  // "id_seg" map never got cleaned up as strokes were erased/undone,
  // growing for the entire session regardless of how much was still
  // on screen. That's the "draw a lot and it breaks" leak.
  const triggerCooldowns = new Map();

  function testCrossings(loX, hiX, now) {
    if (hiX < loX) { const t = loX; loX = hiX; hiX = t; }
    state.strokes.forEach((stroke) => {
      const pts = stroke.triggerPoints || stroke.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const segLo = Math.min(a.x, b.x), segHi = Math.max(a.x, b.x);
        const lo = Math.max(loX, segLo), hi = Math.min(hiX, segHi);
        if (lo <= hi) {
          let strokeCooldowns = triggerCooldowns.get(stroke.id);
          const last = strokeCooldowns ? strokeCooldowns.get(i) || 0 : 0;
          if (now - last > 100) {
            const xTrig = (lo + hi) / 2;
            const t = b.x === a.x ? 0 : (xTrig - a.x) / (b.x - a.x);
            const y = a.y + (b.y - a.y) * clamp(t, 0, 1);
            triggerNote(stroke, xTrig, y, stroke.velocity || 0.7);
            if (!strokeCooldowns) {
              strokeCooldowns = new Map();
              triggerCooldowns.set(stroke.id, strokeCooldowns);
            }
            strokeCooldowns.set(i, now);
          }
        }
      }
    });
  }

  function updateScan(dt) {
    const now = performance.now();
    const newX = advanceScan(dt);

    if (Math.abs(newX - prevScanX) > cssWidth * 0.5) {
      if (state.scanMode === "sweep") {
        if (state.reverse) {
          testCrossings(0, prevScanX, now);
          testCrossings(newX, cssWidth, now);
        } else {
          testCrossings(prevScanX, cssWidth, now);
          testCrossings(0, newX, now);
        }
      }
      // path/wander teleport: skip to avoid spurious mass-trigger
    } else {
      testCrossings(prevScanX, newX, now);
    }
    prevScanX = newX;
    return newX;
  }

  // ---- particles / bursts ----------------------------------------------

  let bursts = [];

  function spawnBurst(x, y, color) {
    bursts.push({ x, y, color, life: 0, maxLife: 0.5 });
    if (bursts.length > 200) bursts.shift();
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---- ambient background blobs -----------------------------------------

  const blobs = [0, 1].map((i) => ({
    hue: TRACKS[TRACK_IDS[i]].hue,
    a: Math.random() * Math.PI * 2,
    speed: 0.05 + Math.random() * 0.05,
    r: 0.18 + Math.random() * 0.12,
  }));

  // a handful of twinkling stars for a starlit-sky feel — cheap: no
  // shadowBlur, no gradients, just small filled circles
  const stars = Array.from({ length: 16 }, () => ({
    xr: Math.random(),
    yr: Math.random(),
    r: 0.6 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
    speed: 0.5 + Math.random() * 1.1,
  }));

  // Ambient decoration (blobs + stars) is slow-moving and doesn't need
  // full 60fps — skipping it every other frame roughly halves its cost
  // (gradient creation is one of the pricier canvas ops) with no
  // visible difference, since the fade trail still runs every frame.
  let ambientFrameToggle = false;

  function drawBackground(t) {
    ctx.fillStyle = "rgba(11,8,22,0.22)";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ambientFrameToggle = !ambientFrameToggle;
    if (!ambientFrameToggle) return;

    // fill only each blob's own bounding box (its gradient is fully
    // transparent past r anyway) instead of the whole canvas per blob —
    // a large share of this function's fill-rate cost otherwise
    blobs.forEach((b) => {
      const cx = cssWidth * (0.5 + Math.cos(t * b.speed + b.a) * 0.38);
      const cy = cssHeight * (0.5 + Math.sin(t * b.speed * 0.8 + b.a) * 0.38);
      const r = Math.min(cssWidth, cssHeight) * b.r;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `hsla(${b.hue}, 70%, 55%, 0.05)`);
      grad.addColorStop(1, `hsla(${b.hue}, 70%, 55%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });

    ctx.fillStyle = "#f6eef7";
    stars.forEach((s) => {
      const twinkle = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.globalAlpha = 0.55 * twinkle;
      ctx.beginPath();
      ctx.arc(s.xr * cssWidth, s.yr * cssHeight, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawGrid() {
    const scale = currentScale();
    const rows = scale.length * OCTAVE_SPAN;
    const rowH = cssHeight / rows;
    ctx.lineWidth = 1;
    for (let i = 0; i <= rows; i++) {
      const y = i * rowH;
      const isRoot = i % scale.length === 0;
      ctx.strokeStyle = isRoot ? "rgba(246,238,247,0.13)" : "rgba(246,238,247,0.045)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssWidth, y);
      ctx.stroke();
    }
  }

  function strokePath(targetCtx, points) {
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      targetCtx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    if (points.length > 1) {
      const last = points[points.length - 1];
      targetCtx.lineTo(last.x, last.y);
    }
  }

  // cheap glow: a wide low-alpha pass underneath a crisp core pass.
  // shadowBlur reads as identical but is dramatically slower per call —
  // it was the single biggest cost behind "feels heavy" on phones.
  // brushKey picks a BRUSH_PROFILES entry: line width, whether the
  // crisp core pass is drawn at all (off for "blur"), and whether
  // points render as separate dots ("dot") instead of a connected
  // path. A stroke with only one point (a tap, no drag) always
  // renders as a single dot regardless of brush, so "just tap" works.
  function paintStroke(targetCtx, points, color, brushKey) {
    if (!points.length) return;
    const profile = BRUSH_PROFILES[brushKey] || BRUSH_PROFILES.normal;
    targetCtx.save();

    if (profile.dotStyle || points.length === 1) {
      const rGlow = profile.lineWidth * 1.9;
      const rCore = Math.max(1.6, profile.lineWidth * 0.85);
      points.forEach((p) => {
        targetCtx.beginPath();
        targetCtx.fillStyle = hexToRgba(color, 0.35);
        targetCtx.arc(p.x, p.y, rGlow, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.beginPath();
        targetCtx.fillStyle = color;
        targetCtx.arc(p.x, p.y, rCore, 0, Math.PI * 2);
        targetCtx.fill();
      });
      targetCtx.restore();
      return;
    }

    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    targetCtx.strokeStyle = hexToRgba(color, 0.35);
    targetCtx.lineWidth = profile.lineWidth + 4.8;
    strokePath(targetCtx, points);
    targetCtx.stroke();
    if (profile.core) {
      targetCtx.strokeStyle = color;
      targetCtx.lineWidth = profile.lineWidth;
      strokePath(targetCtx, points);
      targetCtx.stroke();
    }
    targetCtx.restore();
  }

  // Rebuilds the cached strokes layer from scratch. Only called on
  // structural changes (erase, undo, clear, resize) — never per frame.
  function redrawStrokesLayer() {
    strokesCtx.clearRect(0, 0, cssWidth, cssHeight);
    state.strokes.forEach((s) => {
      paintStroke(strokesCtx, s.points, TRACKS[s.colorId].color, s.brush);
    });
    // this only runs on removals/rebuilds (undo, erase, resize), never
    // per frame — also wipe the main canvas's own accumulated trail, or
    // a just-removed stroke lingers as a fading ghost for a few frames
    // (same issue "clear all" had: the ambient trail only partially
    // erases each frame, so old composited pixels stick around briefly)
    ctx.clearRect(0, 0, cssWidth, cssHeight);
  }

  function drawStrokes() {
    ctx.drawImage(strokesCanvas, 0, 0, cssWidth, cssHeight);

    if (state.playheadPath && state.playheadPath.points.length > 1) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(246,238,247,0.4)";
      ctx.lineWidth = 1.4;
      strokePath(ctx, state.playheadPath.points);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlayhead(x) {
    if (!state.playing) return;
    ctx.save();
    ctx.strokeStyle = "#ffcf5c";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#ffcf5c";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssHeight);
    ctx.stroke();
    ctx.restore();

    // live intersection dots — same sparse point set used for triggering,
    // so this scan also stays cheap regardless of how much has been drawn
    ctx.save();
    state.strokes.forEach((s) => {
      const pts = s.triggerPoints || s.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
        if (x >= lo && x <= hi) {
          const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
          const y = a.y + (b.y - a.y) * t;
          ctx.beginPath();
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.shadowBlur = 8;
          ctx.shadowColor = "#fff";
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    });

    if (state.scanMode === "path" && scanY != null) {
      ctx.beginPath();
      ctx.fillStyle = "#fff";
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#fff";
      ctx.arc(x, scanY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBursts(dt) {
    bursts.forEach((b) => {
      b.life += dt;
      const t = b.life / b.maxLife;
      const alpha = Math.max(0, 1 - t);
      const r = 4 + t * 26;
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      grad.addColorStop(0, hexToRgba(b.color, alpha * 0.9));
      grad.addColorStop(1, hexToRgba(b.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    bursts = bursts.filter((b) => b.life < b.maxLife);
  }

  // ---- main loop --------------------------------------------------------

  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;

    drawBackground(t);
    drawGrid();
    drawStrokes();

    if (state.playing) {
      preparePath(state.playheadPath);
      const x = updateScan(dt);
      drawPlayhead(x);
    }

    drawBursts(dt);

    requestAnimationFrame(frame);
  }

  // ---- utils / resize -----------------------------------------------

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Retina/mobile devicePixelRatio (often 3) makes every canvas fill cost
  // 9x the pixels of a 1x screen; capping it is the single biggest lever
  // for smoothness on phones and costs almost no visible sharpness.
  function effectiveDpr() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = effectiveDpr();
    const oldW = cssWidth, oldH = cssHeight;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cssWidth = rect.width;
    cssHeight = rect.height;

    strokesCanvas.width = canvas.width;
    strokesCanvas.height = canvas.height;
    strokesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // keep existing drawings proportionally placed instead of distorting
    if (oldW > 0 && oldH > 0 && (oldW !== cssWidth || oldH !== cssHeight)) {
      const sx = cssWidth / oldW, sy = cssHeight / oldH;
      const rescale = (pts) => pts.forEach((p) => { p.x *= sx; p.y *= sy; });
      state.strokes.forEach((s) => rescale(s.points));
      if (state.playheadPath) rescale(state.playheadPath.points);
    }

    // setting canvas.width/height always wipes the bitmap, so the cache
    // needs rebuilding here regardless of whether this was a real resize
    redrawStrokesLayer();
  }
  window.addEventListener("resize", () => {
    resizeCanvas();
    drawWaveform(sampleBuffer, sampleBank ? sampleBank.slices.length : 1);
  });

  // ---- init -----------------------------------------------------------

  buildColorBar();
  buildBrushBar();
  buildTracksUI();
  resizeCanvas();
  requestAnimationFrame(frame);
})();
