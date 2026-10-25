import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getSpeechTokenFallbackUrl, getSpeechTokenUrl, isLocalDevHost } from "../env/getSpeechTokenUrl";

type AzureAuth = {
  token: string;
  region: string;
  fetchedAt: number;
};

const AUTH_TTL_MS = 8 * 60 * 1000; // tokens are short-lived; refresh proactively
let cachedAuth: AzureAuth | null = null;

// A flaky mobile connection can leave a fetch hanging for a minute on iOS, or
// fail it outright ("Load failed"). Give each attempt a deadline and retry a
// couple of times before reporting the speech service as unreachable.
//
// With a fallback endpoint (VITE_SPEECH_TOKEN_FALLBACK_URL, hosted off
// Cloudflare) the primary gets a shorter deadline: on LaLiga match days Spanish
// ISPs block Cloudflare IPs and connections just hang, so waiting longer on it
// only delays the switch.
const TOKEN_ATTEMPT_TIMEOUT_MS = 8000;
const TOKEN_ATTEMPT_TIMEOUT_WITH_FALLBACK_MS = 4000;
const TOKEN_RETRY_DELAYS_MS = [600, 1800];

// Whichever endpoint answered last goes first next time.
let preferredTokenUrl: string | null = null;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`Speech token timed out after ${ms / 1000}s`);
    throw err;
  } finally {
    window.clearTimeout(t);
  }
}

/** One endpoint, one attempt: the parsed token, or an error saying what went wrong. */
async function requestToken(url: string, headers: Record<string, string>, timeoutMs: number) {
  const res = await fetchWithTimeout(url, { method: "GET", headers }, timeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Speech token failed: ${res.status} ${text}`), { status: res.status });
  }

  // A misconfigured URL can answer 200 with an HTML page (a dev server serving
  // index.html, a login wall, a CDN error page). Parsing that as JSON fails
  // with an opaque syntax error, so check what came back first.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const preview = (await res.text().catch(() => "")).slice(0, 80);
    throw new Error(
      `Speech token endpoint returned ${contentType || "an unknown type"} instead of JSON: ${preview}`
    );
  }

  return (await res.json()) as { token: string; region: string };
}

export async function fetchSpeechToken(): Promise<{ token: string; region: string }> {
  const headers: Record<string, string> = {};

  // Only send dev gate from localhost
  if (isLocalDevHost() && import.meta.env.VITE_DEV_GATE_KEY) {
    headers["X-Dev-Key"] = import.meta.env.VITE_DEV_GATE_KEY;
  }

  const urls = [getSpeechTokenUrl(), getSpeechTokenFallbackUrl()].filter((u): u is string => !!u);
  if (preferredTokenUrl && urls.includes(preferredTokenUrl)) {
    urls.sort((a, b) => Number(b === preferredTokenUrl) - Number(a === preferredTokenUrl));
  }
  const timeoutMs = urls.length > 1 ? TOKEN_ATTEMPT_TIMEOUT_WITH_FALLBACK_MS : TOKEN_ATTEMPT_TIMEOUT_MS;

  let lastErr: unknown;
  for (let round = 0; round <= TOKEN_RETRY_DELAYS_MS.length; round++) {
    if (round > 0) await new Promise((r) => window.setTimeout(r, TOKEN_RETRY_DELAYS_MS[round - 1]));
    for (const url of urls) {
      try {
        const auth = await requestToken(url, headers, timeoutMs);
        preferredTokenUrl = url;
        return auth;
      } catch (err) {
        lastErr = err;
        // A 4xx from the only endpoint won't fix itself; with a fallback, try it.
        const status = (err as { status?: number }).status;
        if (status !== undefined && status < 500 && urls.length === 1) throw err;
      }
    }
  }
  throw lastErr;
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
