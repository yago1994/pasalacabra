import { isStagingMode } from "../env/getSpeechTokenUrl";

/**
 * Staging/dev experiment, ?audio=single: every sound the game makes plays
 * through the mic's own AudioContext (questions read by Azure TTS instead of
 * the browser's speechSynthesis, SFX and the goat on the same context).
 *
 * Why: on iOS 27, any audio played outside the capturing context (Safari's
 * speechSynthesis, a second AudioContext) makes iOS interrupt the capture:
 * mic and camera muted, sometimes for 20 s or more.
 */
export const SINGLE_AUDIO: boolean =
  (import.meta.env.DEV || isStagingMode()) &&
  new URLSearchParams(location.search).get("audio") === "single";

if (SINGLE_AUDIO) console.log("[audio] single-context mode");
