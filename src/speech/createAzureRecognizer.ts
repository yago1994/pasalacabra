// src/speech/createAzureRecognizer.ts
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getAzureAuth } from "./speechazure";
import { createPushAudioStreamManager, type PushAudioStreamBundle } from "./PushAudioStreamManager";

export type AzureRecognizerBundle = {
  recognizer: sdk.SpeechRecognizer;
  /** Current mic loudness in dBFS-ish */
  getDb: () => number;
  /** Stop meter + close audio context + stop tracks + close recognizer */
  close: () => void;
  /** The MediaStream from getUserMedia */
  stream: MediaStream;
  /** Open the audio gate - start sending real audio to Azure (call after TTS ends) */
  openGate: () => void;
  /** Close the audio gate - send silence to Azure (call before TTS starts) */
  closeGate: () => void;
  /** Check if the gate is currently open */
  isGateOpen: () => boolean;
  /** Resume AudioContext (call on user gesture or visibility change) */
  resume: () => Promise<void>;
};

export interface CreateAzureRecognizerOptions {
  /** Volume threshold in dBFS. Audio below this is treated as silence. Default: -45 */
  volumeThresholdDb?: number;
  /** Time in ms to keep sending audio after volume drops below threshold. Default: 300 */
  hangoverMs?: number;
  /** Enable debug logging for audio stream manager */
  debug?: boolean;
  /** Existing MediaStream to reuse (avoids repeated getUserMedia calls) */
  existingStream?: MediaStream;
}

/**
 * Creates an Azure Speech Recognizer with push-stream gating.
 * 
 * The recognizer uses a PushAudioInputStream that you control via openGate/closeGate.
 * - Call closeGate() before TTS starts to send silence (prevents leakage)
 * - Call openGate() after TTS ends to send real audio
 * 
 * This design keeps the recognizer "warm" (always running) while preventing
 * TTS audio from being picked up and causing false recognitions.
 * 
 * @param options Configuration options
 * @returns Promise resolving to the recognizer bundle
 */
export async function createAzureRecognizer(
  options: CreateAzureRecognizerOptions = {}
): Promise<AzureRecognizerBundle> {
  const { token, region } = await getAzureAuth(false);

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "es-ES";

  // Create the push audio stream manager with gating
  const audioBundle: PushAudioStreamBundle = await createPushAudioStreamManager({
    volumeThresholdDb: options.volumeThresholdDb,
    hangoverMs: options.hangoverMs,
    debug: options.debug,
    existingStream: options.existingStream,
  });

  // Create the recognizer with the push stream audio config
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioBundle.audioConfig);

  const close = () => {
    try {
      recognizer.close();
    } catch {}
    try {
      audioBundle.close();
    } catch {}
  };

  return {
    recognizer,
    getDb: audioBundle.getDb,
    close,
    stream: audioBundle.stream,
    openGate: audioBundle.openGate,
    closeGate: audioBundle.closeGate,
    isGateOpen: audioBundle.isGateOpen,
    resume: audioBundle.resume,
  };
}
