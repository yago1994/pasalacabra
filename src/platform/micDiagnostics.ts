/**
 * Why "Empezar" is disabled, in terms a player (and we) can act on.
 *
 * "Empezar" only enables once the speech token, the microphone and the Azure
 * connection all succeed. Any of them failing used to leave a silent grey
 * button, so we classify the failure, show it next to the button, and report
 * it to Pendo ("Mic Start Failed") so bug reports arrive with the real cause.
 */
import { trackPendoEvent } from "../lib/pendo";
import { getMediaPermissionState, isAndroidInAppBrowser } from "./androidPermissions";

export type MicFailureReason =
  | "waiting" // getUserMedia never settled: prompt ignored or hidden by the browser
  | "denied" // the site is blocked in the browser
  | "denied-system" // the OS blocks the browser itself (macOS / Windows / iOS settings)
  | "no-mic"
  | "busy" // another app holds the mic
  | "unsupported" // no getUserMedia here (in-app browser, insecure context)
  | "network" // token fetch or Azure connection failed
  | "unknown";

/** Where in the start sequence it failed. */
export type MicFailureStage = "token" | "mic" | "azure" | "timeout";

export type MicFailure = {
  reason: MicFailureReason;
  stage: MicFailureStage;
  errorName: string;
  errorMessage: string;
};

/** Thrown by createAzureRecognizer when the speech token can't be fetched. */
export class SpeechServiceError extends Error {
  name = "SpeechServiceError";
}

export type BrowserName = "chrome" | "edge" | "firefox" | "safari" | "samsung" | "other";
export type OsName = "ios" | "android" | "mac" | "windows" | "other";
export type BrowserEnv = { browser: BrowserName; os: OsName; inApp: boolean };

export function describeBrowser(): BrowserEnv {
  const dev = devOverride();
  if (dev?.env) return dev.env;

  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os: OsName = ios
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : /Macintosh/.test(ua)
        ? "mac"
        : /Windows/.test(ua)
          ? "windows"
          : "other";

  const browser: BrowserName = /EdgiOS|Edg\//.test(ua)
    ? "edge"
    : /SamsungBrowser/.test(ua)
      ? "samsung"
      : /CriOS|Chrome\//.test(ua)
        ? "chrome"
        : /FxiOS|Firefox\//.test(ua)
          ? "firefox"
          : /Safari\//.test(ua)
            ? "safari"
            : "other";

  const inApp =
    isAndroidInAppBrowser() || /\b(FBAN|FBAV|Instagram|TikTok|Line|MicroMessenger|GSA)\b/i.test(ua);

  return { browser, os, inApp };
}

export function classifyMicError(err: unknown, stage: MicFailureStage): MicFailure {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const base = { stage, errorName: name || "Error", errorMessage: message.slice(0, 200) };

  if (stage === "azure" || name === "SpeechServiceError") {
    return { ...base, stage: stage === "azure" ? "azure" : "token", reason: "network" };
  }
  if (!navigator.mediaDevices?.getUserMedia || name === "SecurityError") {
    return { ...base, reason: "unsupported" };
  }
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      // Chrome says "Permission denied by system" when the OS blocks the browser.
      return { ...base, reason: /system/i.test(message) ? "denied-system" : "denied" };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { ...base, reason: "no-mic" };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { ...base, reason: "busy" };
    default:
      return { ...base, reason: "unknown" };
  }
}

const reported = new Set<string>();

/** Send one "Mic Start Failed" Pendo event per distinct failure per page load. */
export async function reportMicFailure(failure: MicFailure) {
  const key = `${failure.reason}:${failure.errorName}`;
  if (reported.has(key)) return;
  reported.add(key);

  const env = describeBrowser();
  const permission = await getMediaPermissionState("microphone");
  trackPendoEvent("Mic Start Failed", {
    reason: failure.reason,
    stage: failure.stage,
    errorName: failure.errorName,
    errorMessage: failure.errorMessage,
    browser: env.browser,
    os: env.os,
    inApp: env.inApp,
    permission,
    secureContext: window.isSecureContext,
    hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    host: location.hostname,
    path: location.pathname,
    userAgent: navigator.userAgent.slice(0, 300),
  });
}

/**
 * Dev-only preview of each state: `?micdebug=denied&micenv=ios-chrome`.
 * Stripped from production builds.
 */
export function devOverride(): { reason?: MicFailureReason; env?: BrowserEnv } | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(location.search);
  const reason = params.get("micdebug") as MicFailureReason | null;
  const envParam = params.get("micenv");
  if (!reason && !envParam) return null;
  let env: BrowserEnv | undefined;
  if (envParam) {
    const [os, browser, inApp] = envParam.split("-");
    env = { os: os as OsName, browser: (browser ?? "chrome") as BrowserName, inApp: inApp === "inapp" };
  }
  return { reason: reason ?? undefined, env };
}

const DEV_ERROR_NAME: Record<MicFailureReason, string> = {
  waiting: "Timeout",
  denied: "NotAllowedError",
  "denied-system": "NotAllowedError",
  "no-mic": "NotFoundError",
  busy: "NotReadableError",
  unsupported: "TypeError",
  network: "SpeechServiceError",
  unknown: "Error",
};

/** The failure forced by `?micdebug=`, in dev only. */
export function devPreviewFailure(): MicFailure | null {
  const reason = devOverride()?.reason;
  if (!reason) return null;
  return { reason, stage: "mic", errorName: DEV_ERROR_NAME[reason], errorMessage: "" };
}
