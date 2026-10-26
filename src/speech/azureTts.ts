/**
 * Azure text-to-speech, played through an AudioContext we choose (the mic's,
 * in ?audio=single mode) instead of the browser's speechSynthesis.
 * Same Speech resource and token as recognition.
 */
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getAzureAuth } from "./speechazure";
import { isStagingMode } from "../env/getSpeechTokenUrl";

const DEFAULT_VOICE = "es-ES-ElviraNeural";
const VOICE_KEY = "pasalacabra_tts_voice";

/** Voice picked in the staging voice picker, else the default. */
export function getVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function setVoice(name: string | null) {
  try {
    if (name) localStorage.setItem(VOICE_KEY, name);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    // the choice just won't stick
  }
}

export type VoiceInfo = { name: string; label: string; gender: string; locale: string; kind: string };

/** Azure voices that speak Spain Spanish (es-ES natives first, then multilingual ones). */
export async function listSpanishVoices(): Promise<VoiceInfo[]> {
  const { token, region } = await getAzureAuth(false);
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`voices list ${res.status}`);
  const all = (await res.json()) as Array<{
    ShortName: string;
    DisplayName?: string;
    LocalName?: string;
    Gender?: string;
    Locale: string;
    VoiceType?: string;
    SecondaryLocaleList?: string[];
  }>;
  const native = all.filter((v) => v.Locale === "es-ES");
  const multi = all.filter((v) => v.Locale !== "es-ES" && v.SecondaryLocaleList?.includes("es-ES"));
  return [...native, ...multi].map((v) => ({
    name: v.ShortName,
    label: v.LocalName || v.DisplayName || v.ShortName,
    gender: v.Gender ?? "",
    locale: v.Locale,
    kind: v.ShortName.includes("DragonHD") ? "HD" : v.Locale === "es-ES" ? "neural" : "multilingüe",
  }));
}

// Same text at the same rate is synthesized once (repeats, re-reads after a pause).
const cache = new Map<string, Promise<ArrayBuffer>>();

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Pause marks used by the voice lab (and the generator): "/" short, "//" long. */
export const SHORT_PAUSE_MS = 300;
export const LONG_PAUSE_MS = 700;

function withPauses(escaped: string) {
  // Mark first, then expand: the <break …/> tags contain "/" themselves.
  return escaped
    .replace(/\s*\/\/\s*/g, "\u0001")
    .replace(/\s*\/\s*/g, "\u0002")
    .replace(/\u0001/g, ` <break time="${LONG_PAUSE_MS}ms"/> `)
    .replace(/\u0002/g, ` <break time="${SHORT_PAUSE_MS}ms"/> `);
}

function ssml(text: string, rate: number, voice: string, pauseMarks: boolean) {
  const pct = Math.round((rate - 1) * 100);
  const body = pauseMarks ? withPauses(escapeXml(text)) : escapeXml(text);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES">` +
    `<voice name="${voice}"><lang xml:lang="es-ES"><prosody rate="${pct >= 0 ? "+" : ""}${pct}%">${body}</prosody></lang></voice></speak>`
  );
}

/** WAV bytes for `text` (cached). */
export function synthesize(text: string, rate = 1, voice = getVoice(), pauseMarks = false): Promise<ArrayBuffer> {
  const key = `${voice}|${rate}|${pauseMarks ? 1 : 0}|${text}`;
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
            ssml(text, rate, voice, pauseMarks),
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
export function playTts(
  ctx: AudioContext,
  text: string,
  rate: number,
  onDone: (why: string) => void,
  voice = getVoice(),
  pauseMarks = false
): () => void {
  let stopped = false;
  let done = false;
  let src: AudioBufferSourceNode | null = null;
  const finish = (why: string) => {
    if (done) return;
    done = true;
    onDone(why);
  };
  synthesize(text, rate, voice, pauseMarks)
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
  (
    window as unknown as {
      __pasalacabraTts?: (text: string, voice?: string, pauseMarks?: boolean, rate?: number) => Promise<number>;
    }
  ).__pasalacabraTts = (text, voice = getVoice(), pauseMarks = false, rate = 1) =>
    synthesize(text, rate, voice, pauseMarks).then((bytes) => bytes.byteLength);
}
