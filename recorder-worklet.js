// Lightweight rolling-buffer capture: copies incoming mono audio into
// fixed-size chunks and posts them to the main thread. No per-sample
// message overhead — chunks are batched, keeping CPU cost negligible.
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
