// Granular (overlap-add) pitch shifter running on the audio thread.
// Two Hann-windowed "grains" read from a ring buffer at a variable rate
// (pitchRatio) while the window crossfade keeps the grain wrap silent —
// classic delay-line pitch shifting, no external library needed.
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "pitchRatio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.grainSize = 4096;
    this.bufferSize = this.grainSize * 4;
    this.ring = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.pos1 = 0;
    this.pos2 = this.grainSize / 2;
  }

  hann(pos) {
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * pos) / this.grainSize);
  }

  process(inputs, outputs, parameters) {
    const inputChannel = inputs[0] && inputs[0][0];
    const output = outputs[0][0];
    if (!output) return true;
    if (!inputChannel || inputChannel.length === 0) {
      output.fill(0);
      return true;
    }

    const ratio = parameters.pitchRatio[0];
    const step = ratio - 1;
    const N = this.bufferSize;
    const G = this.grainSize;

    for (let i = 0; i < inputChannel.length; i++) {
      this.ring[this.writeIndex] = inputChannel[i];

      const idx1 = (((this.writeIndex - G + this.pos1) % N) + N) % N;
      const idx2 = (((this.writeIndex - G + this.pos2) % N) + N) % N;
      const s1 = this.ring[Math.floor(idx1)];
      const s2 = this.ring[Math.floor(idx2)];
      output[i] = s1 * this.hann(this.pos1) + s2 * this.hann(this.pos2);

      this.pos1 = ((this.pos1 + step) % G + G) % G;
      this.pos2 = ((this.pos2 + step) % G + G) % G;
      this.writeIndex = (this.writeIndex + 1) % N;
    }
    return true;
  }
}

registerProcessor("pitch-shift-processor", PitchShiftProcessor);
