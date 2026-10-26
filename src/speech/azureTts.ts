/**
 * Azure text-to-speech, played through an AudioContext we choose (the mic's,
 * in ?audio=single mode) instead of the browser's speechSynthesis.
 * Same Speech resource and token as recognition.
 */
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getAzureAuth } from "./speechazure";
import { isStagingMode } from "../env/getSpeechTokenUrl";

const VOICE = "es-ES-ElviraNeural";

// Same text at the same rate is synthesized once (repeats, re-reads after a pause).
const cache = new Map<string, Promise<ArrayBuffer>>();

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function ssml(text: string, rate: number) {
  const pct = Math.round((rate - 1) * 100);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES">` +
    `<voice name="${VOICE}"><prosody rate="${pct >= 0 ? "+" : ""}${pct}%">${escapeXml(text)}</prosody></voice></speak>`
  );
}

/** WAV bytes for `text` (cached). */
export function synthesize(text: string, rate = 1): Promise<ArrayBuffer> {
  const key = `${rate}|${text}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { token, region } = await getAzureAuth(false);
      const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
      // null audio config: hand us the bytes, don't play them through the SDK's own player.
      const synth = new sdk.SpeechSynthesizer(config, null as unknown as sdk.AudioConfig);
      try {
        return await new Promise<ArrayBuffer>((resolve, reject) => {
          synth.speakSsmlAsync(
            ssml(text, rate),
            (r) =>
              r.reason === sdk.ResultReason.SynthesizingAudioCompleted
                ? resolve(r.audioData)
                : reject(new Error(r.errorDetails || `tts ${r.reason}`)),
            (e) => reject(new Error(String(e)))
          );
        });
      } finally {
        synth.close();
      }
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/**
 * Speak `text` through `ctx`. `onDone` is called exactly once: "onend",
 * "stopped" or "error". Returns a function that stops playback.
 */
export function playTts(ctx: AudioContext, text: string, rate: number, onDone: (why: string) => void): () => void {
  let stopped = false;
  let done = false;
  let src: AudioBufferSourceNode | null = null;
  const finish = (why: string) => {
    if (done) return;
    done = true;
    onDone(why);
  };
  synthesize(text, rate)
    // decodeAudioData detaches its input; keep the cached bytes intact.
    .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
    .then((audio) => {
      if (stopped) return finish("stopped");
      src = ctx.createBufferSource();
      src.buffer = audio;
      src.connect(ctx.destination);
      src.onended = () => finish(stopped ? "stopped" : "onend");
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      src.start();
    })
    .catch((err) => {
      console.log("[tts] azure failed", String(err));
      finish("error");
    });
  return () => {
    stopped = true;
    try {
      src?.stop();
    } catch {
      // not started yet
    }
    finish("stopped");
  };
}

// Staging/dev: lets a console (or Claude, through the log relay) check that
// synthesis works end to end without playing a game.
if (import.meta.env.DEV || isStagingMode()) {
  (window as unknown as { __pasalacabraTts?: (text: string) => Promise<number> }).__pasalacabraTts = (text) =>
    synthesize(text).then((bytes) => bytes.byteLength);
}
