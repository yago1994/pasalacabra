// src/game/createAzureRecognizer.ts
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getAzureAuth } from "../speech/speechazure"; // adjust import

export type AzureRecognizerBundle = {
  recognizer: sdk.SpeechRecognizer;
  getDb: () => number;          // current mic loudness in dBFS-ish
  close: () => void;            // stop meter + close audio context + stop tracks + close recognizer
  stream: MediaStream;
};

function startMicMeter(stream: MediaStream) {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);

  let db = -100;
  let raf = 0;

  const tick = () => {
    analyser.getFloatTimeDomainData(buf);

    // RMS -> dB
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    // avoid -Infinity
    const v = Math.max(rms, 1e-8);
    db = 20 * Math.log10(v);

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return {
    getDb: () => db,
    stop: () => {
      if (raf) cancelAnimationFrame(raf);
      try { source.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    },
  };
}

function stopStream(stream: MediaStream) {
  for (const t of stream.getTracks()) {
    try { t.stop(); } catch {}
  }
}

export async function createAzureRecognizer(): Promise<AzureRecognizerBundle> {
  const { token, region } = await getAzureAuth(false);

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "es-ES";

  // IMPORTANT: request one mic stream we can use for BOTH Azure + meter
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const meter = startMicMeter(stream);

  // Prefer using the same stream for Azure if supported by your SDK build.
  // Some versions support AudioConfig.fromStreamInput(MediaStream) in browsers.
  let audioConfig: sdk.AudioConfig | null = null;
  const anyAudioConfig = sdk.AudioConfig as any;

  if (typeof anyAudioConfig?.fromStreamInput === "function") {
    try {
      audioConfig = anyAudioConfig.fromStreamInput(stream);
    } catch {
      audioConfig = null;
    }
  }

  // Fallback (less ideal): Azure opens its own mic input.
  // Meter still works, but you may see more “already speaking” situations.
  if (!audioConfig) {
    audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  }

  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  const close = () => {
    try { recognizer.close(); } catch {}
    try { meter.stop(); } catch {}
    try { stopStream(stream); } catch {}
  };

  return { recognizer, getDb: meter.getDb, close, stream };
}