// Custom games need an account. Signing in leaves the page (OAuth redirect,
// email link opened in a new tab), so "take me to the custom game once I'm in"
// is kept on the device for a while instead of in React state.
const KEY = "pasalacabra.pendingCustomGame";
const MAX_AGE_MS = 60 * 60 * 1000;

export function setPendingCustomGame(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(KEY, String(Date.now()));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the player just lands on the home page after signing in
  }
}

/** True (once) when the player asked for a custom game in the last hour. */
export function takePendingCustomGame(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    localStorage.removeItem(KEY);
    return at > 0 && Date.now() - at < MAX_AGE_MS;
  } catch {
    return false;
  }
}
