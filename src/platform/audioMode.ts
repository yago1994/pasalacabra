/**
 * Single-audio mode, on everywhere (?audio=browser turns it off): every sound
 * the game makes plays through the mic's own AudioContext. Questions are read
 * by the Azure voice (pre-generated for the daily set, live otherwise) instead
 * of the browser's speechSynthesis; SFX and the goat use the same context.
 *
 * Why: on iOS 27, any audio played outside the capturing context (Safari's
 * speechSynthesis, a second AudioContext) makes iOS interrupt the capture:
 * mic and camera muted, sometimes for 20 s or more.
 */
export const SINGLE_AUDIO: boolean = new URLSearchParams(location.search).get("audio") !== "browser";

if (SINGLE_AUDIO) console.log("[audio] single-context mode");
