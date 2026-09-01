// 4-track random pitch/loop sampler.
//
// Mic input is continuously captured into a rolling ring buffer (via an
// AudioWorklet, so capture itself costs almost nothing). Each of the 4
// tracks independently grabs a short random (or manually chosen) slice
// of that buffer, loops it seamlessly (edge-faded to avoid clicks), and
// plays it back at an adjustable/randomizable pitch (varispeed). A
// master limiter + soft-clip stage keeps the mix from ever crackling no
// matter how many tracks pile up.

(() => {
  // Inlined as a Blob URL (rather than fetched as a separate .js file) so
  // the worklet loads even when index.html is opened directly via file://
  // — Chrome blocks module fetches against the file: scheme, which is the
  // most common cause of "Unable to load a worklet's module".
  const RECORDER_WORKLET_SOURCE = `
    class RecorderProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.chunkSize = 2048;
        this.buf = new Float32Array(this.chunkSize);
        this.pos = 0;
      }
      process(inputs) {
        const input = inputs[0];
        if (input && input.length > 0) {
          const channel = input[0];
          for (let i = 0; i < channel.length; i++) {
            this.buf[this.pos++] = channel[i];
            if (this.pos >= this.chunkSize) {
              this.port.postMessage(this.buf);
              this.buf = new Float32Array(this.chunkSize);
              this.pos = 0;
            }
          }
        }
        return true;
      }
    }
    registerProcessor("recorder-processor", RecorderProcessor);

    // Captures the final (post-limiter) master output in raw PCM chunks so
    // it can be encoded to a real .wav file on stop — MediaRecorder only
    // offers compressed formats (webm/opus), never wav.
    class CaptureProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.chunkSize = 4096;
        this.bufL = new Float32Array(this.chunkSize);
        this.bufR = new Float32Array(this.chunkSize);
        this.pos = 0;
      }
      process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0 || !input[0] || input[0].length === 0) return true;
        const left = input[0];
        const right = input.length > 1 ? input[1] : input[0];
        for (let i = 0; i < left.length; i++) {
          this.bufL[this.pos] = left[i];
          this.bufR[this.pos] = right[i];
          this.pos++;
          if (this.pos >= this.chunkSize) {
            this.port.postMessage([this.bufL, this.bufR]);
            this.bufL = new Float32Array(this.chunkSize);
            this.bufR = new Float32Array(this.chunkSize);
            this.pos = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("capture-processor", CaptureProcessor);
  `;

  const NUM_TRACKS = 4;
  const RING_SECONDS = 25; // long enough to hold a real played-in phrase for looper mode
  const VOICE_FADE = 0.12; // seconds, crossfade when a loop is replaced
  const PARAM_GLIDE = 0.08; // seconds, smoothing for slider-driven params

  let audioCtx = null;
  let micStream = null;
  let micSource = null;
  let recorderNode = null;
  let inputAnalyser = null;
  let outputAnalyser = null;
  let masterGain = null; // sum of the 4 tracks + reverb ("wet" / effect bus)
  let dryGain = null; // raw mic signal, for the dry/wet crossfade
  let wetMixGain = null; // wet side of the dry/wet crossfade
  let masterOutGain = null; // overall output volume, post dry/wet mix
  let reverbInput = null;
  let masterOutputNode = null; // final (post-limiter) node — tap point for recording
  let captureSilentSink = null;
  let captureNode = null;
  let workletSupported = false;
  let recordChunksL = [];
  let recordChunksR = [];
  let recording = false;
  let micActive = false;

  let ringBuffer = null;
  let ringLen = 0;
  let writeIndex = 0;
  let totalWritten = 0;

  let chaosMode = false;
  let chaosTimer = null;

  // Track state exists independently of the audio graph so the 4 panels
  // can render immediately; audio nodes are attached once the AudioContext
  // is created (on first mic start).
  const tracks = [];
  for (let i = 0; i < NUM_TRACKS; i++) {
    tracks.push({
      index: i,
      panNode: null,
      depthFilter: null,
      depthGain: null,
      reverbSend: null,
      fader: null,
      analyser: null,
      voice: null,
      pitchSemitones: 0,
      randomPitch: false,
      pitchTimer: null,
      lock: false,
      auto: false,
      autoTimer: null,
      loopMaxSec: 1.0,
      looperArmed: false,
      looperStartTotal: 0,
      chaosActive: false,
      el: {},
    });
  }

  // ---------- helpers ----------------------------------------------

  function semitonesToRatio(st) {
    return Math.pow(2, st / 12);
  }

  function buildImpulseResponse(context, duration, decay) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  function makeSoftClipCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = Math.tanh(amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / k;
    }
    return curve;
  }

  // ---------- ring buffer -------------------------------------------

  function writeChunkToRing(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      ringBuffer[writeIndex] = chunk[i];
      writeIndex = (writeIndex + 1) % ringLen;
      totalWritten++;
    }
  }

  // Reads `length` samples ending `backOffset` samples before "now" and
  // makes the result loop without a click: rather than fading both edges
  // to silence (which leaves an audible gap/"click" every time the loop
  // wraps — the source of the crackling), it crossfades the tail of the
  // segment into a copy of its own head, so by the time playback wraps
  // back to sample 0 the waveform already matches it.
  function readRing(backOffset, length) {
    const startIdx = ((writeIndex - backOffset) % ringLen + ringLen * 2) % ringLen;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = ringBuffer[(startIdx + i) % ringLen];
    }
    const fadeLen = Math.min(Math.floor(audioCtx.sampleRate * 0.03), Math.floor(length * 0.3));
    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      const gainOut = Math.cos((t * Math.PI) / 2);
      const gainIn = Math.sin((t * Math.PI) / 2);
      const tailIdx = length - fadeLen + i;
      out[tailIdx] = out[tailIdx] * gainOut + out[i] * gainIn;
    }
    return { data: out, length, sampleRate: audioCtx.sampleRate };
  }

  function extractRandomSegment(minSec, maxSec) {
    const available = Math.min(totalWritten, ringLen);
    const sr = audioCtx.sampleRate;
    if (available < sr * 0.08) return null;
    const maxLen = Math.min(Math.floor(sr * maxSec), available - 1);
    const minLen = Math.min(Math.floor(sr * minSec), maxLen);
    const length = minLen + Math.floor(Math.random() * Math.max(1, maxLen - minLen + 1));
    const backOffset = length + Math.floor(Math.random() * Math.max(1, available - length));
    return readRing(backOffset, length);
  }

  function extractSegmentAt(posFrac, lenSec) {
    const available = Math.min(totalWritten, ringLen);
    const sr = audioCtx.sampleRate;
    if (available < sr * 0.05) return null;
    const length = Math.max(Math.floor(sr * 0.05), Math.min(Math.floor(sr * lenSec), available - 1));
    const minBack = length;
    const maxBack = available;
    const backOffset = Math.floor(minBack + (1 - posFrac) * (maxBack - minBack));
    return readRing(backOffset, length);
  }

  // ---------- audio graph --------------------------------------------

  function initAudioGraph() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1; // just a summing bus now; track faders set levels

    dryGain = audioCtx.createGain();
    wetMixGain = audioCtx.createGain();
    const mixSlider = document.getElementById("dryWetMix");
    setDryWetMix(mixSlider ? +mixSlider.value : 100, true);

    const mixBus = audioCtx.createGain();
    mixBus.gain.value = 1;

    masterOutGain = audioCtx.createGain();
    const volSlider = document.getElementById("masterVol");
    masterOutGain.gain.value = (volSlider ? +volSlider.value : 80) / 100;

    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    const shaper = audioCtx.createWaveShaper();
    shaper.curve = makeSoftClipCurve(2);
    shaper.oversample = "4x";

    outputAnalyser = audioCtx.createAnalyser();
    outputAnalyser.fftSize = 256;

    captureSilentSink = audioCtx.createGain();
    captureSilentSink.gain.value = 0;
    captureSilentSink.connect(audioCtx.destination);

    masterGain.connect(wetMixGain).connect(mixBus);
    dryGain.connect(mixBus);
    mixBus.connect(masterOutGain);
    masterOutGain.connect(limiter).connect(shaper);
    shaper.connect(outputAnalyser);
    shaper.connect(audioCtx.destination);
    masterOutputNode = shaper;

    const reverb = audioCtx.createConvolver();
    reverb.buffer = buildImpulseResponse(audioCtx, 2.6, 2.2);
    const reverbReturn = audioCtx.createGain();
    reverbReturn.gain.value = 0.6;
    reverb.connect(reverbReturn).connect(masterGain);
    reverbInput = reverb;

    ringLen = Math.floor(audioCtx.sampleRate * RING_SECONDS);
    ringBuffer = new Float32Array(ringLen);

    buildTrackGraphs();
  }

  // 0 = dry mic only, 100 = the 4 tracks' effect mix only (equal-power
  // crossfade so the perceived loudness stays steady in between).
  function setDryWetMix(mixPercent, immediate) {
    const t = mixPercent / 100;
    const dry = Math.cos((t * Math.PI) / 2);
    const wet = Math.sin((t * Math.PI) / 2);
    if (immediate || !audioCtx) {
      dryGain.gain.value = dry;
      wetMixGain.gain.value = wet;
    } else {
      const now = audioCtx.currentTime;
      dryGain.gain.setTargetAtTime(dry, now, PARAM_GLIDE);
      wetMixGain.gain.setTargetAtTime(wet, now, PARAM_GLIDE);
    }
  }

  function buildTrackGraphs() {
    tracks.forEach((track) => {
      const panNode = audioCtx.createStereoPanner();
      const depthFilter = audioCtx.createBiquadFilter();
      depthFilter.type = "lowpass";
      depthFilter.frequency.value = 18000;
      const depthGain = audioCtx.createGain();
      depthGain.gain.value = 1;
      const reverbSend = audioCtx.createGain();
      reverbSend.gain.value = 0;
      const fader = audioCtx.createGain();
      fader.gain.value = 0;
      const trackAnalyser = audioCtx.createAnalyser();
      trackAnalyser.fftSize = 256;

      panNode.connect(depthFilter);
      depthFilter.connect(depthGain);
      depthGain.connect(fader);
      depthGain.connect(reverbSend).connect(reverbInput);
      fader.connect(masterGain);
      fader.connect(trackAnalyser);

      track.panNode = panNode;
      track.depthFilter = depthFilter;
      track.depthGain = depthGain;
      track.reverbSend = reverbSend;
      track.fader = fader;
      track.analyser = trackAnalyser;

      // Carry over any slider values the user touched before the mic
      // (and therefore the audio graph) was started.
      if (track.el.fader) fader.gain.value = (+track.el.fader.value / 100) * 0.85;
      if (track.el.panSlider) panNode.pan.value = +track.el.panSlider.value / 100;
      if (track.el.depthSlider) applyDepth(track, +track.el.depthSlider.value / 100);
    });
  }

  // ---------- loop voice playback -------------------------------------

  function playSegmentOnTrack(track, seg) {
    if (!seg) return;
    const buffer = audioCtx.createBuffer(1, seg.length, seg.sampleRate);
    buffer.copyToChannel(seg.data, 0);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = semitonesToRatio(track.pitchSemitones);

    const voiceGain = audioCtx.createGain();
    voiceGain.gain.value = 0;
    source.connect(voiceGain).connect(track.panNode);

    const now = audioCtx.currentTime;
    voiceGain.gain.linearRampToValueAtTime(1, now + VOICE_FADE);
    source.start();

    const old = track.voice;
    track.voice = { source, gain: voiceGain };

    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + VOICE_FADE);
      const oldSource = old.source;
      setTimeout(() => {
        try { oldSource.stop(); } catch (e) {}
      }, (VOICE_FADE + 0.05) * 1000);
    }

    track.el.status.textContent = "再生中";
    track.el.status.classList.add("live");
  }

  function triggerRandomLoop(track) {
    if (!audioCtx) return;
    const seg = extractRandomSegment(0.08, track.loopMaxSec);
    if (!seg) return;
    playSegmentOnTrack(track, seg);
  }

  function triggerManualLoop(track) {
    if (!audioCtx) return;
    const posFrac = +track.el.posSlider.value / 100;
    const seg = extractSegmentAt(posFrac, track.loopMaxSec);
    if (!seg) return;
    playSegmentOnTrack(track, seg);
  }

  // Real looper-pedal behavior: press once to mark the start, play, press
  // again to close the loop — the loop length is exactly however long you
  // played, not a random slice. Complements (doesn't replace) the random
  // short-loop mode above.
  function toggleLooper(track) {
    if (!audioCtx) {
      alert("先にマイクを開始してください");
      return;
    }
    if (track.autoTimer) { clearTimeout(track.autoTimer); track.auto = false; track.el.autoBtn.classList.remove("active"); }

    if (!track.looperArmed) {
      track.looperArmed = true;
      track.looperStartTotal = totalWritten;
      track.el.looperBtn.textContent = "⏹ ここまで";
      track.el.looperBtn.classList.add("active");
      return;
    }

    track.looperArmed = false;
    track.el.looperBtn.textContent = "⏺ ルーパー";
    track.el.looperBtn.classList.remove("active");

    const sr = audioCtx.sampleRate;
    const played = totalWritten - track.looperStartTotal;
    const length = Math.max(Math.floor(sr * 0.05), Math.min(played, ringLen - 1));
    const seg = readRing(length, length);
    if (!seg) return;
    playSegmentOnTrack(track, seg);
    track.loopMaxSec = length / sr;
    track.el.lenSlider.value = String(Math.round(track.loopMaxSec * 10));
    track.el.lenLabel.textContent = track.loopMaxSec.toFixed(1) + "s";
  }

  // ---------- auto-regeneration & pitch drift -------------------------

  function scheduleAutoLoop(track) {
    if (track.autoTimer) clearTimeout(track.autoTimer);
    if (!track.auto || track.lock) return;
    triggerRandomLoop(track);
    const wait = 1500 + Math.random() * 3500;
    track.autoTimer = setTimeout(() => scheduleAutoLoop(track), wait);
  }

  // ---------- chaos mode: one switch, everything shifts on its own ----
  //
  // A single global engine that keeps grabbing a random track and either
  // bringing it in, re-rolling its loop with a fresh (independently
  // randomized) length, or dropping it back out — so the set of tracks
  // sounding at once drifts between 1 and the chosen max in no fixed
  // order, loop lengths never settle on a pattern, and the gap between
  // events is itself randomized (sometimes a fast flurry, sometimes a
  // long held drone).

  function fireChaosLoop(track) {
    const maxLen = 0.3 + Math.random() * 4.7; // ceiling itself varies each call
    const seg = extractRandomSegment(0.08, maxLen);
    if (!seg) return;
    playSegmentOnTrack(track, seg);
    const secs = seg.length / seg.sampleRate;
    track.loopMaxSec = secs;
    if (track.el.lenSlider) {
      track.el.lenSlider.value = String(Math.min(250, Math.round(secs * 10)));
      track.el.lenLabel.textContent = secs.toFixed(2) + "s";
    }
  }

  function activateChaosTrack(track) {
    track.chaosActive = true;
    if (track.auto) {
      track.auto = false;
      track.el.autoBtn.classList.remove("active");
      if (track.autoTimer) clearTimeout(track.autoTimer);
    }
    if (+track.el.fader.value === 0) {
      track.el.fader.value = 45 + Math.floor(Math.random() * 45);
      track.el.fader.dispatchEvent(new Event("input"));
    }
    fireChaosLoop(track);
  }

  function deactivateChaosTrack(track) {
    track.chaosActive = false;
    track.el.fader.value = 0;
    track.el.fader.dispatchEvent(new Event("input"));
  }

  function chaosTick() {
    if (!chaosMode) return;
    const maxTracks = Math.max(1, Math.min(4, +document.getElementById("chaosCount").value));
    const active = tracks.filter((t) => t.chaosActive);
    const inactive = tracks.filter((t) => !t.chaosActive);

    const roll = Math.random();
    if (active.length === 0 || (inactive.length > 0 && active.length < maxTracks && roll < 0.55)) {
      activateChaosTrack(inactive[Math.floor(Math.random() * inactive.length)]);
    } else if (active.length > 1 && roll < 0.75) {
      deactivateChaosTrack(active[Math.floor(Math.random() * active.length)]);
    } else {
      fireChaosLoop(active[Math.floor(Math.random() * active.length)]);
    }

    const fastBurst = Math.random() < 0.35;
    const wait = fastBurst ? 150 + Math.random() * 500 : 1200 + Math.random() * 3500;
    chaosTimer = setTimeout(chaosTick, wait);
  }

  function setChaosMode(on) {
    if (on && !audioCtx) {
      alert("先にマイクを開始してください");
      return;
    }
    chaosMode = on;
    document.getElementById("chaosBtn").classList.toggle("active", chaosMode);
    document.getElementById("chaosBtn").textContent = chaosMode ? "🌀 カオス停止" : "🌀 カオス・ランダム";
    if (chaosMode) {
      chaosTick();
    } else {
      if (chaosTimer) clearTimeout(chaosTimer);
      tracks.forEach((t) => { t.chaosActive = false; });
    }
  }

  function applyPitch(track, semitones, glideSec) {
    track.pitchSemitones = Math.max(-12, Math.min(12, semitones));
    track.el.pitchSlider.value = String(Math.round(track.pitchSemitones));
    updatePitchLabel(track);
    if (track.voice) {
      const ratio = semitonesToRatio(track.pitchSemitones);
      const now = audioCtx.currentTime;
      const p = track.voice.source.playbackRate;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(ratio, now + (glideSec ?? PARAM_GLIDE));
    }
  }

  function schedulePitchDrift(track) {
    if (track.pitchTimer) clearTimeout(track.pitchTimer);
    if (!track.randomPitch) return;
    const target = -12 + Math.random() * 24;
    applyPitch(track, target, 0.5 + Math.random() * 1.2);
    const wait = 500 + Math.random() * 1800;
    track.pitchTimer = setTimeout(() => schedulePitchDrift(track), wait);
  }

  function updatePitchLabel(track) {
    const st = Math.round(track.pitchSemitones);
    track.el.pitchLabel.textContent = (st > 0 ? "+" : "") + st + " st";
  }

  // ---------- depth / pan --------------------------------------------

  function applyDepth(track, depth01) {
    const now = audioCtx.currentTime;
    const freq = 800 + (1 - depth01) * 17200; // near = bright, far = dark
    track.depthFilter.frequency.setTargetAtTime(freq, now, PARAM_GLIDE);
    const gain = 1 - depth01 * 0.55; // far = quieter
    track.depthGain.gain.setTargetAtTime(gain, now, PARAM_GLIDE);
    const send = depth01 * 0.6; // far = more reverb
    track.reverbSend.gain.setTargetAtTime(send, now, PARAM_GLIDE);
  }

  // ---------- UI building ---------------------------------------------

  function buildTrackUI(track) {
    const card = document.createElement("div");
    card.className = "track-card";

    card.innerHTML = `
      <div class="track-head">
        <h2>トラック ${track.index + 1}</h2>
        <span class="status" data-role="status">停止中</span>
      </div>
      <div class="meter track-meter">
        <div class="meter-track"><div class="meter-fill" data-role="meterFill"></div></div>
      </div>

      <label class="hslider">
        <span>音量 <em data-role="volLabel">0</em></span>
        <input type="range" min="0" max="100" value="0" data-role="fader" />
      </label>

      <div class="btn-row">
        <button class="bigTrackBtn" data-role="looperBtn">⏺ ルーパー</button>
      </div>
      <div class="btn-row">
        <button class="smallBtn" data-role="loopBtn">🎲 ランダムループ</button>
        <button class="smallBtn" data-role="manualBtn">📍 この位置</button>
      </div>
      <div class="btn-row">
        <button class="toggleBtn" data-role="lockBtn">🔒 固定</button>
        <button class="toggleBtn" data-role="autoBtn">🔁 自動</button>
      </div>

      <label class="hslider">
        <span>ループ長(ランダム用上限) <em data-role="lenLabel">1.0s</em></span>
        <input type="range" min="1" max="250" value="10" data-role="lenSlider" />
      </label>
      <label class="hslider">
        <span>位置(古い←→新しい)</span>
        <input type="range" min="0" max="100" value="80" data-role="posSlider" />
      </label>

      <label class="hslider">
        <span>ピッチ <em data-role="pitchLabel">0 st</em></span>
        <input type="range" min="-12" max="12" value="0" step="1" data-role="pitchSlider" />
      </label>
      <div class="btn-row">
        <button class="toggleBtn" data-role="randomPitchBtn">🎲 ランダムピッチ</button>
      </div>

      <label class="hslider">
        <span>パン</span>
        <input type="range" min="-100" max="100" value="0" data-role="panSlider" />
      </label>
      <label class="hslider">
        <span>奥行き</span>
        <input type="range" min="0" max="100" value="0" data-role="depthSlider" />
      </label>
    `;

    const el = {};
    card.querySelectorAll("[data-role]").forEach((node) => {
      el[node.dataset.role] = node;
    });
    track.el = el;
    track.el.pitchLabel = el.pitchLabel;

    el.fader.addEventListener("input", () => {
      const v = +el.fader.value;
      el.volLabel.textContent = v;
      const now = audioCtx ? audioCtx.currentTime : 0;
      if (audioCtx) track.fader.gain.setTargetAtTime((v / 100) * 0.85, now, PARAM_GLIDE);
      card.classList.toggle("armed", v > 0);
    });

    el.looperBtn.addEventListener("click", () => toggleLooper(track));
    el.loopBtn.addEventListener("click", () => triggerRandomLoop(track));
    el.manualBtn.addEventListener("click", () => triggerManualLoop(track));

    el.lockBtn.addEventListener("click", () => {
      track.lock = !track.lock;
      el.lockBtn.classList.toggle("active", track.lock);
      if (!track.lock && track.auto) scheduleAutoLoop(track);
      else if (track.lock && track.autoTimer) clearTimeout(track.autoTimer);
    });

    el.autoBtn.addEventListener("click", () => {
      track.auto = !track.auto;
      el.autoBtn.classList.toggle("active", track.auto);
      if (track.auto) scheduleAutoLoop(track);
      else if (track.autoTimer) clearTimeout(track.autoTimer);
    });

    el.lenSlider.addEventListener("input", () => {
      track.loopMaxSec = +el.lenSlider.value / 10;
      el.lenLabel.textContent = track.loopMaxSec.toFixed(1) + "s";
    });

    el.pitchSlider.addEventListener("input", () => {
      track.randomPitch = false;
      el.randomPitchBtn.classList.remove("active");
      if (track.pitchTimer) clearTimeout(track.pitchTimer);
      applyPitch(track, +el.pitchSlider.value, PARAM_GLIDE);
    });

    el.randomPitchBtn.addEventListener("click", () => {
      track.randomPitch = !track.randomPitch;
      el.randomPitchBtn.classList.toggle("active", track.randomPitch);
      if (track.randomPitch) schedulePitchDrift(track);
      else if (track.pitchTimer) clearTimeout(track.pitchTimer);
    });

    el.panSlider.addEventListener("input", () => {
      if (!audioCtx) return;
      const now = audioCtx.currentTime;
      track.panNode.pan.setTargetAtTime(+el.panSlider.value / 100, now, PARAM_GLIDE);
    });

    el.depthSlider.addEventListener("input", () => {
      if (!audioCtx) return;
      applyDepth(track, +el.depthSlider.value / 100);
    });

    return card;
  }

  function buildAllTrackUI() {
    const container = document.getElementById("tracks");
    tracks.forEach((track) => container.appendChild(buildTrackUI(track)));
  }

  // ---------- mic / recording ------------------------------------------

  async function startMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      alert("マイクにアクセスできませんでした: " + err.message);
      return;
    }

    if (!audioCtx) initAudioGraph();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    micSource = audioCtx.createMediaStreamSource(micStream);

    // AudioWorklet is preferred (runs off the main thread) but Chrome
    // refuses to load worklet modules — even from a Blob URL — when the
    // page itself was opened as a local file:// document. Fall back to a
    // ScriptProcessorNode in that case so the app still works without a
    // local server; it just does its (still cheap) sample copying on the
    // main thread instead.
    try {
      const blob = new Blob([RECORDER_WORKLET_SOURCE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      recorderNode = new AudioWorkletNode(audioCtx, "recorder-processor");
      recorderNode.port.onmessage = (e) => writeChunkToRing(e.data);
      workletSupported = true;
    } catch (err) {
      recorderNode = audioCtx.createScriptProcessor(2048, 1, 1);
      recorderNode.onaudioprocess = (e) => writeChunkToRing(e.inputBuffer.getChannelData(0));
      workletSupported = false;
    }

    inputAnalyser = audioCtx.createAnalyser();
    inputAnalyser.fftSize = 256;

    micSource.connect(recorderNode);
    micSource.connect(inputAnalyser);
    micSource.connect(dryGain);

    const silentSink = audioCtx.createGain();
    silentSink.gain.value = 0;
    recorderNode.connect(silentSink).connect(audioCtx.destination);

    micActive = true;
    document.getElementById("micBtn").textContent = "🎙 マイク停止";
    document.getElementById("micBtn").classList.add("active");
    startMeterLoop();
  }

  function stopMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micActive = false;
    document.getElementById("micBtn").textContent = "🎙 マイク開始";
    document.getElementById("micBtn").classList.remove("active");
  }

  // Encodes raw stereo Float32 PCM as a standard 16-bit .wav file.
  function encodeWav(left, right, sampleRate) {
    const numFrames = left.length;
    const blockAlign = 4; // 2 channels * 16-bit
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true); offset += 2;
      view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true); offset += 2;
    }
    return new Blob([view], { type: "audio/wav" });
  }

  function concatChunks(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  function toggleRecord() {
    if (!masterOutputNode) {
      alert("先にマイクを開始してください");
      return;
    }
    if (!recording) {
      recordChunksL = [];
      recordChunksR = [];
      if (workletSupported) {
        captureNode = new AudioWorkletNode(audioCtx, "capture-processor");
        captureNode.port.onmessage = (e) => { recordChunksL.push(e.data[0]); recordChunksR.push(e.data[1]); };
      } else {
        captureNode = audioCtx.createScriptProcessor(4096, 2, 2);
        captureNode.onaudioprocess = (e) => {
          const l = e.inputBuffer.getChannelData(0).slice();
          const r = (e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : e.inputBuffer.getChannelData(0)).slice();
          recordChunksL.push(l); recordChunksR.push(r);
        };
      }
      masterOutputNode.connect(captureNode).connect(captureSilentSink);
      recording = true;
      document.getElementById("recordBtn").textContent = "⏹ 録音停止";
      document.getElementById("recordBtn").classList.add("active");
    } else {
      try { masterOutputNode.disconnect(captureNode); } catch (e) {}
      try { captureNode.disconnect(); } catch (e) {}
      recording = false;
      document.getElementById("recordBtn").textContent = "⏺ 録音開始";
      document.getElementById("recordBtn").classList.remove("active");

      const left = concatChunks(recordChunksL);
      const right = concatChunks(recordChunksR);
      recordChunksL = []; recordChunksR = [];
      if (left.length === 0) return;

      const blob = encodeWav(left, right, audioCtx.sampleRate);
      const url = URL.createObjectURL(blob);
      const audioEl = document.getElementById("recordingAudio");
      const link = document.getElementById("recordingDownload");
      audioEl.src = url;
      link.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.download = `loop-session-${stamp}.wav`;
      document.getElementById("recordingResult").hidden = false;
    }
  }

  // ---------- meters ----------------------------------------------------

  function peakLevel(analyser) {
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak);
  }

  function startMeterLoop() {
    const inputFill = document.getElementById("inputMeterFill");
    const outputFill = document.getElementById("outputMeterFill");

    function tick() {
      if (inputAnalyser) inputFill.style.width = Math.round(peakLevel(inputAnalyser) * 100) + "%";
      if (outputAnalyser) outputFill.style.width = Math.round(peakLevel(outputAnalyser) * 100) + "%";
      tracks.forEach((track) => {
        if (track.el.meterFill) {
          track.el.meterFill.style.width = Math.round(peakLevel(track.analyser) * 100) + "%";
        }
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------- wiring -----------------------------------------------------

  buildAllTrackUI();

  document.getElementById("micBtn").addEventListener("click", () => {
    if (micActive) stopMic();
    else startMic();
  });

  document.getElementById("recordBtn").addEventListener("click", toggleRecord);

  document.getElementById("masterVol").addEventListener("input", (e) => {
    if (!audioCtx) return;
    masterOutGain.gain.setTargetAtTime(+e.target.value / 100, audioCtx.currentTime, PARAM_GLIDE);
  });

  document.getElementById("chaosBtn").addEventListener("click", () => setChaosMode(!chaosMode));

  document.getElementById("chaosCount").addEventListener("input", (e) => {
    document.getElementById("chaosCountLabel").textContent = e.target.value;
  });

  document.getElementById("dryWetMix").addEventListener("input", (e) => {
    const v = +e.target.value;
    setDryWetMix(v, false);
    document.getElementById("dryWetLabel").textContent =
      v === 0 ? "0(ドライのみ)" : v === 100 ? "100(4トラック)" : v;
  });

  document.getElementById("randomAllBtn").addEventListener("click", () => {
    tracks.forEach((track) => {
      if (+track.el.fader.value === 0) {
        track.el.fader.value = 70;
        track.el.fader.dispatchEvent(new Event("input"));
      }
      triggerRandomLoop(track);
      track.randomPitch = true;
      track.el.randomPitchBtn.classList.add("active");
      schedulePitchDrift(track);
    });
  });
})();
