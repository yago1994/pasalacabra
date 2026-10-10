// The goat's sounds: audio files, played by name from scene cues.
//
// To add a sound, put the file in src/assets/ and map its cue name below. A cue whose name
// has no file is silent, so scenes can already name the sounds they want (munch, ding…).

import pasalacabraUrl from "../assets/sfx-pasalacabra.wav";

/** Cue name → audio file. */
export const SOUND_FILES: Record<string, string> = {
  // The game's own Pasalacabra bleat: any "¡Beee!" bubble plays it.
  pasalacabra: pasalacabraUrl,
  // Tapping the goat. Placeholder until there's a cowbell recording: the bleat for now.
  cowbell: pasalacabraUrl,
};

type Opts = { pitch?: number; gain?: number };

const buffers = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer | null>>>();
function load(ctx: AudioContext, url: string) {
  let m = buffers.get(ctx);
  if (!m) buffers.set(ctx, (m = new Map()));
  let p = m.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    m.set(url, p);
  }
  return p;
}

/** Starts decoding the sound files early so the first one isn't late. */
export function preloadSounds(ctx: AudioContext) {
  for (const url of new Set(Object.values(SOUND_FILES))) void load(ctx, url);
}

// The same file never starts twice within this window, so a tap that both shows "¡Beee!"
// and rings the (placeholder) cowbell bleats once.
const MIN_GAP = 0.5;
const lastStart = new WeakMap<AudioContext, Map<string, number>>();

/** Plays the file mapped to `name`, if there is one. */
export function playSound(ctx: AudioContext, name: string, opts: Opts = {}, master = 1) {
  const url = SOUND_FILES[name];
  if (!url) return;
  let m = lastStart.get(ctx);
  if (!m) lastStart.set(ctx, (m = new Map()));
  const now = ctx.currentTime;
  if (now - (m.get(url) ?? -Infinity) < MIN_GAP) return;
  m.set(url, now);
  void load(ctx, url).then((buf) => {
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.pitch ?? 1;
    const g = ctx.createGain();
    g.gain.value = (opts.gain ?? 1) * master;
    src.connect(g).connect(ctx.destination);
    src.start();
  });
}
