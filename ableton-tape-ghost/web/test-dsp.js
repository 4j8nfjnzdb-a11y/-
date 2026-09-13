const { RingChannel, GranularPitchShifter, semitonesToRatio } = require('./dsp-core.js');

function approxEqual(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`FAIL: ${msg} — expected ${b}, got ${a} (tol ${tol})`);
  }
  console.log(`ok: ${msg} (${a.toFixed(4)} ~= ${b.toFixed(4)})`);
}

// --- Test 1: fixed-delay read reproduces the input exactly ---
(function testDelayRead() {
  const N = 1000;
  const ch = new RingChannel(N);
  const input = [];
  for (let i = 0; i < 5000; i++) input.push(Math.sin(i * 0.13) * 0.5);

  const delaySamples = 300;
  let writeCounter = 0;
  const out = [];
  for (let i = 0; i < input.length; i++) {
    ch.write(writeCounter, input[i]);
    const readPos = writeCounter - delaySamples;
    if (readPos >= 0) out.push(ch.readInterp(readPos));
    writeCounter++;
  }
  // out[k] should equal input[k] (since readPos at writeCounter=delaySamples+k reads index k)
  let maxErr = 0;
  for (let k = 0; k < out.length; k++) {
    maxErr = Math.max(maxErr, Math.abs(out[k] - input[k]));
  }
  approxEqual(maxErr, 0, 1e-6, 'delayed read reproduces original signal sample-for-sample');
})();

// --- Test 2: reverse read (negative rate) plays the buffer backwards ---
(function testReverse() {
  const N = 2000;
  const ch = new RingChannel(N);
  const input = [];
  for (let i = 0; i < 500; i++) input.push(i); // ramp 0..499, easy to check ordering
  let writeCounter = 0;
  for (let i = 0; i < input.length; i++) { ch.write(writeCounter, input[i]); writeCounter++; }
  // writeCounter is now 500 (next free slot). Start reading backwards from sample 400.
  let readPos = 400;
  const out = [];
  for (let i = 0; i < 50; i++) {
    out.push(ch.readInterp(readPos));
    readPos -= 1; // reverse at normal speed
  }
  // Expect out = [400, 399, 398, ...]
  let ok = true;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i] - (400 - i)) > 1e-6) ok = false;
  }
  if (!ok) throw new Error('FAIL: reverse read did not descend in order: ' + out.slice(0, 10));
  console.log('ok: reverse read descends sample-by-sample (tape rewind direction correct)');
})();

// --- Test 3: pitch shifter changes frequency by the expected ratio ---
function measureFreqByZeroCrossings(signal, sampleRate, skip) {
  let crossings = 0;
  for (let i = skip + 1; i < signal.length; i++) {
    if (signal[i - 1] < 0 && signal[i] >= 0) crossings++;
  }
  const seconds = (signal.length - skip) / sampleRate;
  return crossings / seconds;
}

// More robust than zero-crossing counting when the granular window puts brief
// amplitude dips into the signal: autocorrelation peak-picking.
function measureFreqByAutocorrelation(signal, sampleRate, skip, minHz, maxHz) {
  const seg = signal.slice(skip);
  const maxLag = Math.floor(sampleRate / minHz);
  const minLag = Math.floor(sampleRate / maxHz);
  let bestLag = minLag, bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < seg.length - maxLag; i++) sum += seg[i] * seg[i + lag];
    if (sum > bestVal) { bestVal = sum; bestLag = lag; }
  }
  return sampleRate / bestLag;
}

(function testPitchShift() {
  const sampleRate = 48000;
  const testFreq = 440;
  const durationSec = 1.5;
  const nSamples = Math.round(sampleRate * durationSec);

  for (const semi of [-12, -5, 0, 7, 12]) {
    const shifter = new GranularPitchShifter(sampleRate, 0.05);
    const ratio = semitonesToRatio(semi);
    shifter.setRatio(ratio);
    const out = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      const inSample = Math.sin(2 * Math.PI * testFreq * i / sampleRate);
      out[i] = shifter.process(inSample);
    }
    const expected = testFreq * ratio;
    // narrow search band: autocorrelation of a pure sine has near-equal peaks at
    // octave multiples too, so a wide band risks picking the wrong one
    const measured = measureFreqByAutocorrelation(out, sampleRate, Math.round(sampleRate * 0.3), expected * 0.85, expected * 1.15);
    // granular shifter is approximate/grainy; allow ~6% tolerance
    approxEqual(measured, expected, expected * 0.06, `pitch shift ${semi} semitones (ratio ${ratio.toFixed(4)})`);
  }
})();

console.log('\nAll DSP core tests passed.');
