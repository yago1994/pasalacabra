/**
 * Staging/dev experiment: ?audiosession=play-and-record (or playback, ambient,
 * transient, transient-solo, auto) sets Safari's Audio Session API type before
 * any audio starts.
 *
 * Why: on iOS 27 every sound the page plays (read-aloud, SFX) switches the
 * audio session's mode while the mic is capturing, and iOS mutes the mic and
 * the camera for ~1.5 s each time (the camera flicker). Pinning the session
 * to play-and-record may stop that switching. Off unless the URL asks for it.
 */
import { isStagingMode } from "../env/getSpeechTokenUrl";

const TYPES = ["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"];

export function applyAudioSessionExperiment() {
  const want = new URLSearchParams(location.search).get("audiosession");
  if (!want || !(import.meta.env.DEV || isStagingMode())) return;
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) {
    console.log("[audiosession] not supported in this browser");
    return;
  }
  if (!TYPES.includes(want)) {
    console.log("[audiosession] unknown type", want, "- expected one of", TYPES.join(", "));
    return;
  }
  try {
    session.type = want;
    console.log("[audiosession] type set to", session.type);
  } catch (err) {
    console.log("[audiosession] could not set type", String(err));
  }
}

applyAudioSessionExperiment();
