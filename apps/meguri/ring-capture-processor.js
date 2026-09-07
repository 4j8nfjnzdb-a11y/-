// AudioWorklet processor used for two jobs in looper.js:
// 1) tapping the live input into the rolling ring buffer that voices sample from
// 2) tapping the master bus while the internal recorder is armed
// Both just accumulate incoming frames and flush a chunk to the main thread
// periodically, so the audio thread never does more than a copy.

class RingCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkFrames = 4096;
    this.chunkL = new Float32Array(this.chunkFrames);
    this.chunkR = new Float32Array(this.chunkFrames);
    this.writeIndex = 0;
  }

  flush() {
    if (this.writeIndex === 0) return;
    const outL = this.chunkL.slice(0, this.writeIndex);
    const outR = this.chunkR.slice(0, this.writeIndex);
    this.port.postMessage({ l: outL, r: outR }, [outL.buffer, outR.buffer]);
    this.chunkL = new Float32Array(this.chunkFrames);
    this.chunkR = new Float32Array(this.chunkFrames);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const inL = input && input[0];
    if (!inL || inL.length === 0) return true;
    const inR = input[1] || inL;

    for (let i = 0; i < inL.length; i++) {
      this.chunkL[this.writeIndex] = inL[i];
      this.chunkR[this.writeIndex] = inR[i];
      this.writeIndex++;
      if (this.writeIndex >= this.chunkFrames) this.flush();
    }
    return true;
  }
}

registerProcessor("ring-capture-processor", RingCaptureProcessor);
