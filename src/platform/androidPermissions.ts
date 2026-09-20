/**
 * Android-specific permission helpers.
 *
 * Why this file only targets Android:
 *
 * Chrome on Android persists a microphone denial per-origin *forever* and stops
 * showing the prompt (three dismissals also auto-block the origin). Once that
 * happens `getUserMedia` rejects instantly with `NotAllowedError` and no UI, the
 * Azure recognizer never starts, `isListening` stays false, and the "Empezar"
 * button is disabled for good. Reloading does not clear it.
 *
 * iOS Safari re-asks on the next page load, so the same mistake is self-healing
 * there. That is why this class of bug is invisible on iOS, and why every code
 * path gated on `isAndroid()` below cannot affect the iOS flow.
 */

/** UA-based Android detection. */
export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

/**
 * Android in-app browsers (Instagram, Facebook, TikTok…) embed a WebView that
 * rejects `getUserMedia` unless the host app implements
 * `WebChromeClient.onPermissionRequest()` — which most do not. There is no
 * in-page fix, so we tell the user to reopen the game in Chrome.
 *
 * iOS in-app browsers use WKWebView and inherit the host app's own grant, so
 * this check is Android-only by construction.
 */
export function isAndroidInAppBrowser(): boolean {
  if (!isAndroid()) return false;
  const ua = navigator.userAgent;
  // "; wv)" marks a plain Android WebView; the rest are app-specific tokens.
  return (
    /;\s*wv\)/.test(ua) ||
    /\b(FBAN|FBAV|FB_IAB|Instagram|TikTok|Line|MicroMessenger|GSA)\b/i.test(ua)
  );
}

export type MediaPermissionState = "granted" | "denied" | "prompt" | "unknown";

/**
 * Reads a media permission *without* prompting.
 *
 * Returns "unknown" wherever the Permissions API is missing or rejects the
 * descriptor — notably iOS Safari, which does not implement it for microphone
 * or camera. Callers treat "unknown" as "carry on exactly as before", so this
 * cannot change behaviour on iOS.
 */
export async function getMediaPermissionState(
  name: "microphone" | "camera"
): Promise<MediaPermissionState> {
  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";
  try {
    // "microphone"/"camera" are valid at runtime in Chrome but are not in every
    // TS DOM lib's PermissionName union, hence the cast.
    const status = await permissions.query({ name } as unknown as PermissionDescriptor);
    return status.state as MediaPermissionState;
  } catch {
    // Firefox rejects descriptor names it does not support.
    return "unknown";
  }
}
