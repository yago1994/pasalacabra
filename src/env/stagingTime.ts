import { isStagingMode } from "./getSpeechTokenUrl";

/**
 * Staging/dev only: how long each player's clock is, set from the home screen
 * (StagingTimeControl) or with ?secs=N in the URL, which wins. Remembered on
 * this device; null means the usual staging defaults.
 */
const KEY = "pasalacabra_staging_secs";

export function getStagingSeconds(): number | null {
  if (!isStagingMode()) return null;
  const fromUrl = Number(new URLSearchParams(location.search).get("secs"));
  if (fromUrl > 0) return fromUrl;
  try {
    const saved = Number(localStorage.getItem(KEY));
    return saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

export function setStagingSeconds(secs: number | null) {
  try {
    if (secs && secs > 0) localStorage.setItem(KEY, String(Math.round(secs)));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode etc.: the setting just won't stick
  }
}
