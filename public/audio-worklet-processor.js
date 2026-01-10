/**
 * AudioWorklet processor for low-latency audio capture.
 * Captures audio frames from the microphone and sends them to the main thread.
 * Supports mono conversion and RMS calculation for volume gating.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // Aim for ~20ms chunks at 16kHz = 320 samples, but we'll buffer to ~2048 samples
    // for efficiency since worklet runs at 128 samples per quantum
    this._targetBufferSamples = 2048;
  }

  /**
   * Process audio frames from the microphone.
   * @param {Float32Array[][]} inputs - Input audio data (channel arrays)
   * @param {Float32Array[][]} outputs - Output audio data (not used)
   * @param {Object} parameters - AudioParam values (not used)
   * @returns {boolean} - True to keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    // Get first channel (or mix down to mono if stereo)
    let monoSamples;
    if (input.length === 1) {
      monoSamples = input[0];
    } else {
      // Mix channels to mono
      monoSamples = new Float32Array(input[0].length);
      const numChannels = input.length;
      for (let i = 0; i < monoSamples.length; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += input[ch][i];
        }
        monoSamples[i] = sum / numChannels;
      }
    }

    // Calculate RMS for this frame
    let sumSquares = 0;
    for (let i = 0; i < monoSamples.length; i++) {
      sumSquares += monoSamples[i] * monoSamples[i];
    }
    const rms = Math.sqrt(sumSquares / monoSamples.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-10));

    // Buffer the samples
    this._buffer.push(new Float32Array(monoSamples));
    this._bufferSize += monoSamples.length;

    // Send when we have enough samples
    if (this._bufferSize >= this._targetBufferSamples) {
      // Concatenate buffered frames
      const totalSamples = new Float32Array(this._bufferSize);
      let offset = 0;
      for (const chunk of this._buffer) {
        totalSamples.set(chunk, offset);
        offset += chunk.length;
      }

      // Send to main thread
      this.port.postMessage({
        type: 'audio',
        samples: totalSamples,
        sampleRate: sampleRate,
        db: db,
      });

      // Reset buffer
      this._buffer = [];
      this._bufferSize = 0;
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
