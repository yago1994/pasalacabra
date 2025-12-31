import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getSpeechTokenUrl, isLocalDevHost } from "../env/getSpeechTokenUrl";

type AzureAuth = {
  token: string;
  region: string;
  fetchedAt: number;
};

const AUTH_TTL_MS = 8 * 60 * 1000; // tokens are short-lived; refresh proactively
let cachedAuth: AzureAuth | null = null;

export async function fetchSpeechToken(): Promise<{ token: string; region: string }> {
  const headers: Record<string, string> = {};

  // Only send dev gate from localhost
  if (isLocalDevHost() && import.meta.env.VITE_DEV_GATE_KEY) {
    headers["X-Dev-Key"] = import.meta.env.VITE_DEV_GATE_KEY;
  }

  const res = await fetch(getSpeechTokenUrl(), { method: "GET", headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Speech token failed: ${res.status} ${text}`);
  }

  return await res.json();
}

async function fetchAzureAuth(): Promise<AzureAuth> {
  const { token, region } = await fetchSpeechToken();
  return { token, region, fetchedAt: Date.now() };
}

export async function getAzureAuth(force = false): Promise<Pick<AzureAuth, "token" | "region">> {
  const now = Date.now();
  if (!force && cachedAuth && now - cachedAuth.fetchedAt < AUTH_TTL_MS) {
    return { token: cachedAuth.token, region: cachedAuth.region };
  }
  cachedAuth = await fetchAzureAuth();
  return { token: cachedAuth.token, region: cachedAuth.region };
}

// Call this from a settings/setup page so we don't fetch during TTS/gameplay.
export async function preflightAzureAuth(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getAzureAuth(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createAzureRecognizer() {
  const { token, region } = await getAzureAuth(false);

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "es-ES";

  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  return new sdk.SpeechRecognizer(speechConfig, audioConfig);
}

export function setPhraseHints(
  phraseList: sdk.PhraseListGrammar,
  phrases: string[],
  weight = 0.8
) {
  phraseList.clear();
  phrases.forEach((p) => phraseList.addPhrase(p));
  phraseList.setWeight?.(weight);
}

export function recognizeOnceFast(
  recognizer: sdk.SpeechRecognizer,
  onPartial: (t: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    recognizer.recognizing = (_s, e) => onPartial(e.result.text ?? "");
    recognizer.recognizeOnceAsync(
      (r) => resolve(r.text ?? ""),
      (err) => reject(err)
    );
  });
}
