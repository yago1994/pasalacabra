/**
 * PushAudioStreamManager - Manages audio capture and gating for Azure STT.
 * 
 * Key features:
 * - Uses PushAudioInputStream for gated audio delivery to Azure
 * - Captures mic via AudioWorklet (with ScriptProcessorNode fallback)
 * - Gates audio during TTS playback (sends silence)
 * - Optional volume threshold filtering
 * - Mobile hardening (AudioContext resume on visibility change)
 */

import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// Azure Speech SDK expects 16kHz mono 16-bit PCM
const AZURE_SAMPLE_RATE = 16000;
const AZURE_CHANNELS = 1;
const AZURE_BITS_PER_SAMPLE = 16;

// Volume gating defaults
const DEFAULT_VOLUME_THRESHOLD_DB = -45;
const DEFAULT_HANGOVER_MS = 300;

export interface PushAudioStreamManagerOptions {
  /** Volume threshold in dBFS. Audio below this is treated as silence. Default: -45 */
  volumeThresholdDb?: number;
  /** Time in ms to keep sending audio after volume drops below threshold. Default: 300 */
  hangoverMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Existing MediaStream to reuse (avoids repeated getUserMedia calls).
   * The stream will NOT be stopped when this manager closes. */
  existingStream?: MediaStream;
}

/** What the capture pipeline is actually doing, for spotting a mic that "listens" but hears nothing. */
export interface MicHealth {
  /** "running" when audio flows; iOS can leave it "suspended" or "interrupted". */
  contextState: string;
  sampleRate: number;
  /** ms since the last audio frame reached us (Infinity before the first). */
  msSinceFrame: number;
  /** ms since a frame that wasn't pure digital silence (Infinity before the first). */
  msSinceSound: number;
  /** The mic track: "live" / "ended", and whether the OS muted it. */
  trackState: string;
  trackMuted: boolean;
}

// Real microphones always pick up some noise (around -70 dBFS in a quiet room);
// below this the samples are zeros, i.e. the OS is feeding us silence.
const DIGITAL_SILENCE_DB = -110;

export interface PushAudioStreamBundle {
  /** The PushAudioInputStream to pass to Azure AudioConfig */
  pushStream: sdk.PushAudioInputStream;
  /** The AudioConfig configured with the push stream */
  audioConfig: sdk.AudioConfig;
  /** Open the gate - start sending real audio to Azure */
  openGate: () => void;
  /** Close the gate - send silence to Azure (during TTS) */
  closeGate: () => void;
  /** Check if gate is currently open */
  isGateOpen: () => boolean;
  /** Get current mic volume in dBFS */
  getDb: () => number;
  /** Resume AudioContext (call on user gesture or visibility change) */
  resume: () => Promise<void>;
  /** Snapshot of the capture pipeline's health */
  health: () => MicHealth;
  /** Clean up all resources */
  close: () => void;
  /** The MediaStream from getUserMedia */
  stream: MediaStream;
}

/**
 * Linear interpolation resampler.
 * Converts audio from one sample rate to another.
 */
function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return samples;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const t = srcIndex - srcIndexFloor;

    result[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t;
  }

  return result;
}

/**
 * Convert float32 samples (-1 to 1) to 16-bit PCM ArrayBuffer.
 */
function floatTo16BitPCM(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1]
    const s = Math.max(-1, Math.min(1, samples[i]));
    // Convert to 16-bit signed integer
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(i * 2, val, true); // little-endian
  }

  return buffer;
}

/**
 * Creates a PushAudioStreamManager that captures mic audio and gates it for Azure STT.
 * 
 * @param options Configuration options
 * @returns Promise resolving to the manager bundle
 */
export async function createPushAudioStreamManager(
  options: PushAudioStreamManagerOptions = {}
): Promise<PushAudioStreamBundle> {
  const {
    volumeThresholdDb = DEFAULT_VOLUME_THRESHOLD_DB,
    hangoverMs = DEFAULT_HANGOVER_MS,
    debug = false,
    existingStream,
  } = options;

  const log = (...args: unknown[]) => {
    if (debug) console.log("[PushAudioStreamManager]", ...args);
  };

  // State
  let gateOpen = false;
  let currentDb = -100;
  let lastAboveThresholdAt = 0;
  let closed = false;
  let lastFrameAt = 0;
  let lastSoundAt = 0;
  let streamOwned = false; // Track if we created this stream or it was passed in

  // Create Azure PushAudioInputStream
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(
    AZURE_SAMPLE_RATE,
    AZURE_BITS_PER_SAMPLE,
    AZURE_CHANNELS
  );
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  // Get microphone stream - reuse existing if provided and valid
  let stream: MediaStream;
  
  if (existingStream) {
    // Validate that the existing stream is still usable
    const tracks = existingStream.getTracks();
    const hasActiveTrack = tracks.some(track => track.readyState === "live");
    
    if (!hasActiveTrack) {
      log("Existing stream has no active tracks, requesting new stream");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamOwned = true;
      log("Got new microphone stream (existing was inactive)");
    } else {
      stream = existingStream;
      streamOwned = false;
      log("Reusing existing microphone stream");
    }
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    streamOwned = true;
    log("Got microphone stream");
  }

  // Create AudioContext
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioCtx();
  
  // Resume on user gesture (needed for Safari/mobile)
  const resume = async () => {
    // iOS can also report "interrupted" (after a call, Siri, other audio).
    if (audioContext.state !== "running" && audioContext.state !== "closed") {
      log("Resuming AudioContext");
      await audioContext.resume();
    }
  };

  // iOS suspends or "interrupts" the context when something else takes the
  // audio session (a call, Siri, another tab, sometimes our own TTS). Nothing
  // reached Azure after that until the page was hidden and shown again.
  audioContext.onstatechange = () => {
    log("AudioContext state:", audioContext.state);
    if (!closed && audioContext.state !== "running" && audioContext.state !== "closed") {
      void audioContext.resume().catch(() => {});
    }
  };

  // Get the native sample rate
  const nativeSampleRate = audioContext.sampleRate;
  log("Native sample rate:", nativeSampleRate, "Azure sample rate:", AZURE_SAMPLE_RATE);

  // Create source from mic stream
  const source = audioContext.createMediaStreamSource(stream);

  // Track the processor node for cleanup
  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;

  /**
   * Process audio samples: resample, convert to PCM, gate, and push to Azure.
   */
  const processAudio = (samples: Float32Array, sampleRate: number, frameDb: number) => {
    if (closed) return;

    const frameAt = Date.now();
    lastFrameAt = frameAt;
    if (frameDb > DIGITAL_SILENCE_DB) lastSoundAt = frameAt;

    // Update current dB (smoothed a bit)
    currentDb = currentDb * 0.3 + frameDb * 0.7;

    // Resample to Azure's expected rate
    const resampled = resample(samples, sampleRate, AZURE_SAMPLE_RATE);

    // Apply gating logic
    let shouldSendRealAudio = false;

    if (gateOpen) {
      // Check volume threshold
      const now = Date.now();
      if (frameDb >= volumeThresholdDb) {
        lastAboveThresholdAt = now;
        shouldSendRealAudio = true;
      } else {
        // Hangover: keep sending audio for a bit after volume drops
        if (now - lastAboveThresholdAt < hangoverMs) {
          shouldSendRealAudio = true;
        }
      }
    }

    // Convert to PCM and push
    if (shouldSendRealAudio) {
      const pcm = floatTo16BitPCM(resampled);
      pushStream.write(pcm);
    } else {
      // Send silence (zeros)
      const silenceBuffer = new ArrayBuffer(resampled.length * 2);
      pushStream.write(silenceBuffer);
    }
  };

  // Try AudioWorklet first (modern browsers, lower latency)
  let usingWorklet = false;
  try {
    await audioContext.audioWorklet.addModule("/audio-worklet-processor.js");
    workletNode = new AudioWorkletNode(audioContext, "audio-capture-processor");
    
    workletNode.port.onmessage = (event) => {
      if (event.data.type === "audio") {
        processAudio(event.data.samples, event.data.sampleRate, event.data.db);
      }
    };

    source.connect(workletNode);
    // Don't connect to destination - we don't want playback
    usingWorklet = true;
    log("Using AudioWorklet for audio capture");
  } catch (err) {
    log("AudioWorklet not available, falling back to ScriptProcessorNode:", err);
  }

  // Fallback to ScriptProcessorNode (deprecated but wider support)
  if (!usingWorklet) {
    const bufferSize = 4096;
    scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);

    scriptNode.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const samples = inputBuffer.getChannelData(0);
      
      // Calculate RMS
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));

      processAudio(new Float32Array(samples), inputBuffer.sampleRate, db);
    };

    source.connect(scriptNode);
    // Must connect to destination for ScriptProcessorNode to fire (Safari quirk)
    // We'll use a gain node set to 0 to mute output
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    scriptNode.connect(muteGain);
    muteGain.connect(audioContext.destination);
    
    log("Using ScriptProcessorNode for audio capture (fallback)");
  }

  // Mobile hardening: handle visibility changes
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible" && !closed) {
      log("Page became visible, resuming AudioContext");
      void resume();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Also handle page show (back-forward cache)
  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted && !closed) {
      log("Page restored from bfcache, resuming AudioContext");
      void resume();
    }
  };
  window.addEventListener("pageshow", handlePageShow);

  // Cleanup function
  const close = () => {
    if (closed) return;
    closed = true;
    log("Closing PushAudioStreamManager", { streamOwned });

    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pageshow", handlePageShow);

    try {
      source.disconnect();
    } catch { /* ignore */ }

    if (workletNode) {
      try {
        workletNode.disconnect();
        workletNode.port.close();
      } catch { /* ignore */ }
    }

    if (scriptNode) {
      try {
        scriptNode.disconnect();
        scriptNode.onaudioprocess = null;
      } catch { /* ignore */ }
    }

    try {
      audioContext.close();
    } catch { /* ignore */ }

    // Only stop stream tracks if we created the stream (not if it was passed in)
    if (streamOwned) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch { /* ignore */ }
      }
    }

    try {
      pushStream.close();
    } catch { /* ignore */ }
  };

  // Start with gate closed (silence)
  log("PushAudioStreamManager ready, gate is closed");

  return {
    pushStream,
    audioConfig,
    openGate: () => {
      if (!gateOpen) {
        log("Opening gate");
        gateOpen = true;
        lastAboveThresholdAt = Date.now(); // Prevent immediate silence due to hangover
      }
    },
    closeGate: () => {
      if (gateOpen) {
        log("Closing gate");
        gateOpen = false;
      }
    },
    isGateOpen: () => gateOpen,
    getDb: () => currentDb,
    health: () => {
      const now = Date.now();
      const track = stream.getAudioTracks()[0];
      return {
        contextState: audioContext.state,
        sampleRate: audioContext.sampleRate,
        msSinceFrame: lastFrameAt ? now - lastFrameAt : Infinity,
        msSinceSound: lastSoundAt ? now - lastSoundAt : Infinity,
        trackState: track?.readyState ?? "none",
        trackMuted: track?.muted ?? false,
      };
    },
    resume,
    close,
    stream,
  };
}
