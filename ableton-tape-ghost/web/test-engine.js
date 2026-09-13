const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/dsp-core.js', 'utf8') + '\n' +
            fs.readFileSync(__dirname + '/worklet-processor.js', 'utf8');
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'combined-engine.js' });
const { TapeGhostEngine } = sandbox.module.exports;
if (!TapeGhostEngine) throw new Error('TapeGhostEngine not exported');

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('ok: ' + msg);
}

const SR = 48000;

function runSilence(engine, seconds) {
  const n = Math.round(seconds * SR);
  for (let i = 0; i < n; i++) engine.processSample(0, 0);
}

function runTone(engine, seconds, freq, ampL = 1, ampR = 1, phaseOffset = 0) {
  const n = Math.round(seconds * SR);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (engine.writeCounter) / SR;
    const s = Math.sin(2 * Math.PI * freq * t + phaseOffset);
    const [l, r] = engine.processSample(s * ampL, s * ampR);
    outL[i] = l; outR[i] = r;
  }
  return { outL, outR };
}

// --- Test: idle default keeps a ~2s delay once mix is up ---
(function testIdleDefaultDelay() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  // record a short burst at time 0, then silence; the granular pitch-shifter
  // (always in the wet path, even at 0 semitones) smears a single-sample
  // impulse across its ~80ms window, so use a short burst and measure energy
  // in a moving window rather than checking one exact sample.
  const burstLen = Math.round(0.02 * SR);
  for (let i = 0; i < burstLen; i++) eng.processSample(1.0, 1.0);
  const energies = [];
  const winLen = Math.round(0.02 * SR);
  let win = [];
  const N = Math.round(3 * SR);
  for (let i = burstLen; i < N; i++) {
    const [l] = eng.processSample(0, 0);
    win.push(l * l);
    if (win.length > winLen) win.shift();
    energies.push({ t: i / SR, e: win.reduce((a, b) => a + b, 0) });
  }
  const peak = energies.reduce((best, cur) => (cur.e > best.e ? cur : best), energies[0]);
  // generous tolerance: the ~80ms granular pitch-shifter window (always in the
  // wet path, even at 0 semitones) and the 30ms mix ramp both smear timing
  assert(Math.abs(peak.t - 2.0) < 0.15, `idle default replays the burst near the ~2s mark (peak energy at t=${peak.t.toFixed(3)}s)`);
})();

// --- Test: Jump moves the read head back by the requested amount ---
(function testJump() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  // record 5 seconds of a rising ramp so we can identify "how far back" by value
  for (let i = 0; i < 5 * SR; i++) eng.processSample(i / SR, i / SR);
  eng.handleMessage({ type: 'jump', seconds: 3.0 });
  // the granular pitch-shifter's ~80ms window needs a little time to flush the
  // pre-jump history out of its two taps before the new position fully "wins";
  // meanwhile readPos keeps advancing forward in real time (jump doesn't
  // freeze playback, it resumes forward from the jumped-to point), so the
  // expected value drifts up by the same wall-clock time we wait here.
  const waitSec = 0.15;
  let l = 0;
  for (let i = 0; i < Math.round(waitSec * SR); i++) l = eng.processSample(0, 0)[0];
  const expected = 2.0 + waitSec;
  assert(Math.abs(l - expected) < 0.1, `jump 3s back from t=5s lands near value ${expected.toFixed(2)} (got ${l.toFixed(3)})`);
})();

// --- Test: Rewind decreases the played-back position over time ---
(function testRewind() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  for (let i = 0; i < 5 * SR; i++) eng.processSample(i / SR, i / SR);
  eng.handleMessage({ type: 'jump', seconds: 1.0 }); // start near the 4s mark
  eng.handleMessage({ type: 'setRewindSpeed', value: 2.0 });
  eng.handleMessage({ type: 'rewind', on: true });
  const readings = [];
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < SR * 0.2; k++) eng.processSample(5.0, 5.0); // hold input constant, irrelevant to wet
    const [l] = eng.processSample(5.0, 5.0);
    readings.push(l);
  }
  let decreasing = true;
  for (let i = 1; i < readings.length; i++) if (readings[i] >= readings[i - 1]) decreasing = false;
  assert(decreasing, `rewind steadily decreases played-back position over time: ${readings.map(v => v.toFixed(2))}`);
})();

// --- Test: Loop Mark (2 clicks) repeats the marked window ---
(function testLoop() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  // record a ramp so each sample value is unique/identifiable, then use Jump
  // to park the read head, mark a short loop, and confirm periodicity.
  for (let i = 0; i < 3 * SR; i++) eng.processSample(i / SR, i / SR);
  eng.handleMessage({ type: 'jump', seconds: 2.0 }); // read head parked at ~1s mark
  eng.handleMessage({ type: 'loopMarkClick' }); // capture start
  for (let i = 0; i < Math.round(0.25 * SR); i++) eng.processSample(9, 9); // advance 0.25s (readPos advances too)
  eng.handleMessage({ type: 'loopMarkClick' }); // capture end, engage loop (~0.25s long)
  const loopSamples = Math.round(0.25 * SR);
  // let the loop-gain ramp finish AND let the pitch-shifter's ~80ms grain
  // window fully flush the pre-loop (non-periodic) history out of both taps
  // before comparing cycles -- otherwise cycle1 still carries some settling
  // transient that cycle2 won't have.
  for (let i = 0; i < loopSamples; i++) eng.processSample(9, 9);
  const cycle1 = [];
  for (let i = 0; i < loopSamples; i++) cycle1.push(eng.processSample(9, 9)[0]);
  const cycle2 = [];
  for (let i = 0; i < loopSamples; i++) cycle2.push(eng.processSample(9, 9)[0]);
  let maxDiff = 0;
  for (let i = 0; i < loopSamples; i++) maxDiff = Math.max(maxDiff, Math.abs(cycle1[i] - cycle2[i]));
  assert(maxDiff < 0.01, `looped segment repeats identically cycle-to-cycle (max diff ${maxDiff.toFixed(4)})`);
})();

// --- Test: Miracle segment plays audio from the requested "seconds ago" window ---
(function testMiracle() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  for (let i = 0; i < 5 * SR; i++) eng.processSample(i / SR, i / SR); // writeCounter now 5s
  eng.handleMessage({ type: 'miracleSegment', startAgoSeconds: 3.0, lenSeconds: 0.3, speedMul: 1.0 });
  // wait past both the loop-gain ramp (~15ms) AND the pitch-shifter's ~80ms
  // grain window, so old pre-segment history is fully flushed from its taps
  const settleSamples = Math.round(0.15 * SR);
  for (let i = 0; i < settleSamples; i++) eng.processSample(9, 9);
  const l = eng.processSample(9, 9)[0];
  // segment starts at writeCounter(5s)-3s = 2s mark; by now the loop-local
  // counter has advanced (settleSamples+1) into that 0.3s segment
  const expected = 2.0 + (settleSamples + 1) / SR;
  assert(Math.abs(l - expected) < 0.1, `miracle segment reads from ~3s ago (got value ${l.toFixed(3)}, expected ~${expected.toFixed(3)})`);
})();

// --- Test: Freeze creates a very short stutter loop at the current position ---
(function testFreeze() {
  const eng = new TapeGhostEngine(SR, 60);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  for (let i = 0; i < 3 * SR; i++) eng.processSample(i / SR, i / SR);
  eng.handleMessage({ type: 'jump', seconds: 1.0 });
  const freezeLen = 0.1;
  eng.handleMessage({ type: 'freeze', lenSeconds: freezeLen });
  // settle past the pitch-shifter's ~80ms grain window before the first
  // measurement, same as the loop/miracle tests above
  const freezeSamples = Math.round(freezeLen * SR);
  for (let i = 0; i < freezeSamples; i++) eng.processSample(9, 9);
  const a = eng.processSample(9, 9)[0];
  for (let i = 0; i < freezeSamples - 1; i++) eng.processSample(9, 9);
  const b = eng.processSample(9, 9)[0];
  assert(Math.abs(a - b) < 0.01, `freeze repeats after one loop period (${a.toFixed(3)} vs ${b.toFixed(3)})`);
})();

console.log('\nAll engine scenario tests passed.');

// --- Test: input level meter reflects actual signal presence ---
(function testInputMeter() {
  const eng = new TapeGhostEngine(SR, 60);
  assert(eng.inputPeak < 1e-6, 'input meter starts at ~0 with no signal');
  for (let i = 0; i < 1000; i++) eng.processSample(0.8, 0.8);
  assert(eng.inputPeak > 0.7, `input meter rises to reflect a loud signal (got ${eng.inputPeak.toFixed(3)})`);
  for (let i = 0; i < SR; i++) eng.processSample(0, 0);
  assert(eng.inputPeak < 0.01, `input meter decays back down once signal stops (got ${eng.inputPeak.toFixed(4)})`);
})();

console.log('input meter test passed.');

// --- Test: delay/echo is transparent when off, and produces a timed repeat when on ---
(function testDelayOff() {
  const a = new TapeGhostEngine(SR, 30);
  const b = new TapeGhostEngine(SR, 30);
  a.handleMessage({ type: 'setMix', value: 1.0 });
  b.handleMessage({ type: 'setMix', value: 1.0 });
  b.handleMessage({ type: 'setDelayMix', value: 0.0 }); // explicit 0, should match default
  let maxDiff = 0;
  for (let i = 0; i < SR * 3; i++) {
    const s = Math.sin(i * 0.05);
    const [la] = a.processSample(s, s);
    const [lb] = b.processSample(s, s);
    maxDiff = Math.max(maxDiff, Math.abs(la - lb));
  }
  assert(maxDiff < 1e-9, `delayMix=0 is bit-identical to no delay stage at all (max diff ${maxDiff})`);
})();

(function testDelayEcho() {
  const eng = new TapeGhostEngine(SR, 30);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  eng.handleMessage({ type: 'setDelayTime', value: 0.2 });
  eng.handleMessage({ type: 'setDelayFeedback', value: 0.0 }); // single repeat only, no repeats-of-repeats
  eng.handleMessage({ type: 'setDelayMix', value: 1.0 });
  // jump-based trick from earlier tests to get real (non-silent) wet content
  // flowing quickly instead of waiting out the ~2s idle anchor
  const burstLen = Math.round(0.02 * SR);
  for (let i = 0; i < burstLen; i++) eng.processSample(1.0, 1.0);
  for (let i = 0; i < Math.round(0.05 * SR); i++) eng.processSample(0, 0);
  eng.handleMessage({ type: 'jump', seconds: 0.05 + burstLen / SR });
  const energies = [];
  const winLen = Math.round(0.02 * SR);
  let win = [];
  const N = Math.round(0.6 * SR);
  for (let i = 0; i < N; i++) {
    const [l] = eng.processSample(0, 0);
    win.push(l * l);
    if (win.length > winLen) win.shift();
    energies.push({ t: i / SR, e: win.reduce((x, y) => x + y, 0) });
  }
  // delayMix=1.0 replaces the direct signal with the delayed tap entirely (a
  // parallel blend, not a delay-send-on-top-of-dry), so the burst should show
  // up ONLY once, shifted forward by the configured 0.2s delay time -- plus
  // the same ~80ms pitch-shifter grain-window settling lag seen in the jump/
  // miracle/freeze tests above (the jump discontinuity needs one grain window
  // to fully flush old silence out of the shifter's two taps before the real
  // burst content gets through to the delay line at all).
  const expectedT = 0.2 + 0.08;
  const peak = energies.reduce((b, c) => (c.e > b.e ? c : b), energies[0]);
  assert(Math.abs(peak.t - expectedT) < 0.03, `delayed burst lands ~0.2s (delay time) + ~0.08s (shifter settling) after the jump (found at t=${peak.t.toFixed(3)}, expected ~${expectedT.toFixed(3)}, energy ${peak.e.toFixed(4)})`);
  assert(peak.e > 0.01, `delayed repeat has real energy (got ${peak.e.toFixed(4)})`);
  const nearZero = energies.filter((e) => e.t < 0.15).reduce((b, c) => (c.e > b.e ? c : b), energies[0]);
  assert(nearZero.e < 0.001, `with delayMix=1.0 nothing appears before the delay time (got ${nearZero.e.toFixed(5)} before t=0.15)`);
})();

(function testDelayFeedbackDecay() {
  const eng = new TapeGhostEngine(SR, 30);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  eng.handleMessage({ type: 'setDelayTime', value: 0.1 });
  eng.handleMessage({ type: 'setDelayFeedback', value: 0.5 });
  eng.handleMessage({ type: 'setDelayMix', value: 1.0 });
  const burstLen = Math.round(0.02 * SR);
  for (let i = 0; i < burstLen; i++) eng.processSample(1.0, 1.0);
  for (let i = 0; i < Math.round(0.05 * SR); i++) eng.processSample(0, 0);
  eng.handleMessage({ type: 'jump', seconds: 0.05 + burstLen / SR });
  const N = Math.round(1.0 * SR);
  const vals = [];
  for (let i = 0; i < N; i++) vals.push(eng.processSample(0, 0)[0]);
  // find peak amplitude within each ~0.1s repeat window after the initial settle
  const delaySamples = Math.round(0.1 * SR);
  const settleOffset = Math.round(0.08 * SR); // pitch-shifter grain settling, as above
  const repeatPeaks = [];
  for (let r = 0; r < 5; r++) {
    // r=0's window starts right after the settle offset PLUS one full delay
    // period, since nothing plays before the first echo actually arrives
    const start = settleOffset + (r + 1) * delaySamples;
    let m = 0;
    for (let i = start; i < start + delaySamples && i < N; i++) m = Math.max(m, Math.abs(vals[i]));
    repeatPeaks.push(m);
  }
  assert(repeatPeaks[0] > 0.5, `first repeat is near full amplitude (got ${repeatPeaks[0].toFixed(3)})`);
  let decaying = true;
  for (let i = 1; i < repeatPeaks.length; i++) if (repeatPeaks[i] >= repeatPeaks[i - 1] - 1e-6) decaying = false;
  assert(decaying, `feedback repeats decay each cycle: ${repeatPeaks.map((v) => v.toFixed(3))}`);
})();

// --- Test: a hard Loop/Miracle segment switch declicks instead of jumping ---
(function testMiracleDeclick() {
  const eng = new TapeGhostEngine(SR, 30);
  eng.handleMessage({ type: 'setMix', value: 1.0 });
  // region A (+1) then region B (-1), so a raw jump between them would be
  // impossible to miss
  for (let i = 0; i < SR; i++) eng.processSample(1, 1);
  for (let i = 0; i < SR; i++) eng.processSample(-1, -1);

  // force a fully-engaged loop reading mid-way into region A (poking engine
  // state directly for precision, rather than going through jump/loopMark)
  eng.loopActive = true;
  eng.loopStartAbs = 0;
  eng.loopLen = Math.round(0.5 * SR);
  eng.loopLocal = Math.round(0.3 * SR);
  eng.loopGain = 1.0;
  for (let i = 0; i < 500; i++) eng.processSample(0, 0); // let it settle on +1

  // now switch to region B abruptly, exactly as a Miracle tick does every
  // 80-580ms in normal use
  eng.loopStartAbs = SR;
  eng.loopLen = Math.round(0.5 * SR);
  eng.loopLocal = 0;

  // the pitch-shifter is an exact fixed delay at ratio=1 (proven by the loop
  // periodicity test above), so whatever wetL was AT the switch instant
  // reappears unmodified exactly (windowSamples-1) samples later
  const windowSamples = eng.pitchShifterL.windowSamples;
  const around = [];
  for (let i = 0; i < windowSamples + 5; i++) {
    const [l] = eng.processSample(0, 0);
    if (i >= windowSamples - 4) around.push(l);
  }
  const dipMin = Math.min(...around.map(Math.abs));
  assert(dipMin < 0.05, `hard segment switch dips toward 0 (declick) instead of jumping straight from +1 to -1 (min |value| near the switch: ${dipMin.toFixed(4)})`);
})();

console.log('declick test passed.');

console.log('delay/echo test passed.');
