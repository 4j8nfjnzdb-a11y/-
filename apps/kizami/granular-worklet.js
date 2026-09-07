// kizami — capture-processor
//
// Runs on the audio thread. Its only job is to hand the live input
// stream to the main thread in small chunks, cheaply, so the main
// thread can write it into the rolling loop buffer that the granular
// engine reads from. No DSP happens here — keeping this processor
// trivial is what keeps the audio thread from ever glitching.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.bufL = new Float32Array(this.chunkSize);
    this.bufR = new Float32Array(this.chunkSize);
    this.idx = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const chL = input[0];
    const chR = input.length > 1 ? input[1] : input[0];
    const n = chL.length;

    for (let i = 0; i < n; i++) {
      this.bufL[this.idx] = chL[i];
      this.bufR[this.idx] = chR ? chR[i] : chL[i];
      this.idx++;
      if (this.idx >= this.chunkSize) {
        this.port.postMessage(
          { l: this.bufL, r: this.bufR },
          [this.bufL.buffer, this.bufR.buffer]
        );
        this.bufL = new Float32Array(this.chunkSize);
        this.bufR = new Float32Array(this.chunkSize);
        this.idx = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
