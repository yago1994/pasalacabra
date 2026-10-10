// The goat's scene library. Each scene is plain JSON-shaped data (see scene.ts), so a
// scene made in Cabra Studio can be pasted straight in here.
//
// Conventions:
// - Every scene starts and ends in the standing pose at a letter, so the director can
//   cross-fade between any two.
// - Travel scenes move cabra.travel 0 → 1 from the `from` letter to the `to` letter.
// - Scenes that play while a question is being read (moves, idle moments) have no sound
//   cues, so the goat never talks over the question or the microphone.

import type { Key, Prop, Scene } from "./scene";

const k = (t: number, v: number, e?: Key[2]): Key => (e ? [t, v, e] : [t, v]);

/** Keys tracing amp·sin(πs) from t0 to t1: a flight arc that matches a rainbow prop's bow. */
const sineKeys = (t0: number, t1: number, amp: number, steps = 8): Key[] =>
  Array.from({ length: steps + 1 }, (_, i) => k(t0 + ((t1 - t0) * i) / steps, Math.round(amp * Math.sin((Math.PI * i) / steps) * 10) / 10, "linear"));

/**
 * Compresses (factor < 1) or stretches a whole scene in time: keys, oscillators, emitters
 * and cues. The game never waits for the goat, so in-game scenes are kept short; this lets
 * them be choreographed at a comfortable pace and then tightened to fit the game.
 */
export function retime(scene: Scene, factor: number, name = scene.name): Scene {
  const tr: Record<string, Key[]> = {};
  for (const [key, keys] of Object.entries(scene.tracks || {})) tr[key] = keys.map(([t, v, e]) => (e ? [t * factor, v, e] : [t * factor, v]) as Key);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    ...scene,
    name,
    duration: Math.round(scene.duration * factor * 100) / 100,
    tracks: tr,
    oscillators: scene.oscillators?.map((o) => ({ ...o, period: o.period * factor, from: o.from !== undefined ? o.from * factor : undefined, to: o.to !== undefined ? o.to * factor : undefined, fade: o.fade !== undefined ? o.fade * factor : undefined })),
    props: scene.props?.map((p) => {
      if (p.type !== "emitter") return p;
      const q: Prop = { ...p };
      if (num(p.start) !== undefined) q.start = num(p.start)! * factor;
      if (num(p.end) !== undefined) q.end = num(p.end)! * factor;
      // particles live a little shorter too, but not so short they flicker
      q.life = Math.max(0.35, (num(p.life) ?? 1) * Math.max(factor, 0.75));
      if (num(p.rate) !== undefined) q.rate = num(p.rate)! / factor;
      return q;
    }),
    cues: scene.cues?.map((c) => ({ ...c, t: c.t * factor })),
  };
}

const dust = (id: string, at: "from" | "to" | "goat", start: number, extra: Partial<Prop> = {}): Prop => ({
  id, type: "emitter", particle: "dust", at, start, burst: 7, life: 0.55, speed: 22, spread: 170, gravity: 30, size: 1.1, ...extra,
});

/* ---------------- Resting ---------------- */

const rest: Scene = {
  name: "rest", group: "rest", duration: 4, loop: true,
  description: "Standing on the current letter like a mountain goat on a boulder.",
  tracks: {},
  oscillators: [{ target: "head.tilt", amp: 2.5, period: 4, wave: "sine" }],
};

const restWait: Scene = {
  name: "rest-wait", group: "rest", duration: 3, loop: true,
  description: "Waiting for the turn to start: taps a hoof, looks at the button.",
  tracks: { "eyes.look": [k(0, 0.6)], "ears.perk": [k(0, 0.3)], "eyes.up": [k(0, -0.5)] },
  oscillators: [{ target: "legFN.lift", amp: 2.4, period: 0.42, wave: "hop", from: 0.6, to: 1.9, fade: 0.05 }],
};

const sleep: Scene = {
  name: "sleep", group: "rest", duration: 4, loop: true,
  description: "Curled up on the letter, legs tucked, snoozing.",
  idle: { breathe: 2.2, blink: false, ears: false },
  tracks: {
    "body.drop": [k(0, 11)], "head.down": [k(0, 0.2)], "head.tilt": [k(0, 14)], "eyes.open": [k(0, 0)],
    "ears.perk": [k(0, -0.7)], "mouth.smile": [k(0, 0.5)], "face.blush": [k(0, 0.3)],
    "legFN.x": [k(0, 3)], "legFF.x": [k(0, 3)], "legBN.x": [k(0, -3)], "legBF.x": [k(0, -3)],
  },
  props: [{ id: "zz", type: "emitter", particle: "zzz", at: "goat", along: 10, alt: 22, rate: 0.9, life: 2.6, speed: 9, spread: 40, dir: 18, gravity: -2, size: 1.2 }],
};

const proud: Scene = {
  name: "proud", group: "rest", duration: 3, loop: true,
  description: "After a perfect game: chest out, tail going, confetti still falling.",
  tracks: { "mouth.smile": [k(0, 1)], "ears.perk": [k(0, 0.8)], "face.blush": [k(0, 0.5)], "tail.up": [k(0, 0.7)] },
  oscillators: [{ target: "tail.wag", amp: 22, period: 0.3 }],
  props: [{ id: "confetti", type: "emitter", particle: "confetti", at: "goat", alt: 60, rate: 6, life: 2.2, speed: 16, spread: 160, gravity: 26 }],
};

/* ---------------- Moving between letters ---------------- */

const hop: Scene = {
  name: "hop", group: "move", duration: 0.78,
  description: "One springy hop to the next letter.",
  tracks: {
    "cabra.travel": [k(0, 0), k(0.14, 0, "hold"), k(0.52, 1, "linear")],
    "cabra.alt": [k(0, 0), k(0.14, 0), k(0.33, 24, "easeOut"), k(0.52, 0, "easeIn")],
    "cabra.lean": [k(0, 0), k(0.12, 6), k(0.2, -12), k(0.42, 12), k(0.56, -4), k(0.7, 0)],
    "body.squash": [k(0, 1), k(0.12, 0.84), k(0.18, 1.14), k(0.3, 1), k(0.52, 1), k(0.56, 0.84), k(0.7, 1, "backOut")],
    "body.drop": [k(0, 0), k(0.12, 3.5), k(0.17, 0), k(0.52, 0), k(0.56, 3), k(0.72, 0)],
    "legs.tuck": [k(0, 0), k(0.18, 0), k(0.28, 0.7), k(0.42, 0.5), k(0.5, 0)],
    "legBN.x": [k(0, 0), k(0.16, -5), k(0.26, 0)], "legBF.x": [k(0, 0), k(0.16, -5), k(0.26, 0)],
    "legFN.x": [k(0.36, 0), k(0.46, 5), k(0.53, 0)], "legFF.x": [k(0.36, 0), k(0.46, 5), k(0.53, 0)],
    "ears.perk": [k(0, 0), k(0.2, 0.6), k(0.6, 0)],
    "eyes.look": [k(0, 0), k(0.1, 1), k(0.6, 0.4), k(0.78, 0)],
  },
  props: [
    dust("kick", "from", 0.15, { burst: 4, speed: 16, dir: -40, spread: 70 }),
    dust("land", "to", 0.52),
  ],
};

const pasaHop: Scene = {
  ...hop,
  name: "pasa-hop",
  description: "¡Pasalacabra! A quick hop to the next letter with a “¡Beee!” bubble (the game plays the bleat).",
  tracks: {
    ...hop.tracks,
    "jaw.open": [k(0, 0), k(0.06, 0.8), k(0.42, 0.7), k(0.52, 0)],
    "eyes.happy": [k(0, 0), k(0.05, 1, "hold"), k(0.5, 0, "hold")],
    "baa.grow": [k(0, 0), k(0.1, 1, "backOut"), k(0.62, 1), k(0.76, 0)],
  },
  props: [...(hop.props || []), { id: "baa", type: "bubble", at: "goat", alt: 50, text: "{baa}", grow: 0 }],
};

const hopSkip: Scene = {
  name: "hop-skip", group: "move", duration: 1.0,
  description: "A happy skip in two bounces, kicking its heels between them.",
  tracks: {
    "cabra.travel": [k(0, 0), k(0.12, 0, "hold"), k(0.4, 0.5, "linear"), k(0.48, 0.5, "hold"), k(0.76, 1, "linear")],
    "cabra.alt": [k(0, 0), k(0.12, 0), k(0.26, 13, "easeOut"), k(0.4, 0, "easeIn"), k(0.48, 0), k(0.62, 17, "easeOut"), k(0.76, 0, "easeIn")],
    "cabra.lean": [k(0, 0), k(0.2, -8), k(0.38, 8), k(0.48, 0), k(0.56, -8), k(0.74, 10), k(0.9, 0)],
    "body.squash": [k(0, 1), k(0.1, 0.86), k(0.16, 1.1), k(0.4, 1), k(0.44, 0.88), k(0.5, 1.1), k(0.76, 1), k(0.8, 0.86), k(0.95, 1, "backOut")],
    "legFN.x": [k(0.5, 0), k(0.6, 7), k(0.7, 0)], "legFF.x": [k(0.5, 0), k(0.6, 6), k(0.7, 0)],
    "legBN.x": [k(0.5, 0), k(0.6, -7), k(0.7, 0)], "legBF.x": [k(0.5, 0), k(0.6, -6), k(0.7, 0)],
    "legBN.lift": [k(0.5, 0), k(0.6, 3), k(0.7, 0)],
    "tail.up": [k(0, 0), k(0.3, 0.8), k(0.9, 0)],
    "mouth.smile": [k(0, 0.3), k(0.3, 0.9), k(0.9, 0.3)],
    "eyes.happy": [k(0, 0), k(0.55, 0, "hold"), k(0.56, 1, "hold"), k(0.72, 0, "hold")],
  },
  props: [dust("land", "to", 0.76, { burst: 6 })],
};

const pronk: Scene = {
  name: "pronk", group: "move", duration: 0.9,
  description: "A stiff-legged pronk: all four hooves leave the letter at once, like a startled kid.",
  tracks: {
    "cabra.travel": [k(0, 0), k(0.16, 0, "hold"), k(0.6, 1, "linear")],
    "cabra.alt": [k(0, 0), k(0.16, 0), k(0.38, 30, "easeOut"), k(0.6, 0, "easeIn")],
    "body.squash": [k(0, 1), k(0.14, 0.8), k(0.2, 1.18), k(0.36, 1.05), k(0.6, 1.05), k(0.64, 0.8), k(0.85, 1, "backOut")],
    "cabra.spin": [k(0.16, 0), k(0.38, -12), k(0.6, 0)],
    "ears.perk": [k(0, 0), k(0.2, 1), k(0.38, -0.6), k(0.6, 0.4), k(0.8, 0)],
    "eyes.open": [k(0, 1), k(0.2, 1.2), k(0.6, 1)],
    "tail.up": [k(0, 0), k(0.2, 1), k(0.7, 0)],
  },
  props: [dust("land", "to", 0.6, { burst: 8, speed: 26 })],
};

const mountain: Scene = {
  name: "mountain", group: "move", duration: 2.5, ride: "mtn",
  description: "A mountain rises over the letters in between; the goat bounds up, rears on the summit, and slides down the far side.",
  tracks: {
    "mtn.grow": [k(0, 0), k(0.5, 1, "backOut"), k(2.1, 1), k(2.45, 0, "easeIn")],
    "mtn.flag": [k(0, 0), k(1.18, 0), k(1.4, 1, "backOut"), k(2.1, 1), k(2.3, 0)],
    "cabra.ride": [k(0, 1)],
    "cabra.travel": [k(0, 0), k(0.42, 0, "hold"), k(1.18, 0.5, "easeInOut"), k(1.62, 0.5, "hold"), k(2.12, 1, "easeIn")],
    "cabra.alt": [k(0, 0)],
    "body.rear": [k(1.18, 0), k(1.32, 26, "backOut"), k(1.5, 26), k(1.62, 0, "easeIn")],
    "head.tilt": [k(1.18, 0), k(1.32, -18), k(1.5, -18), k(1.62, 0)],
    "jaw.open": [k(1.22, 0), k(1.3, 0.8), k(1.5, 0.8), k(1.58, 0)],
    "ears.perk": [k(0, 0), k(0.4, 0.8), k(1.2, 1), k(1.7, -0.5), k(2.2, 0.2), k(2.5, 0)],
    "body.drop": [k(1.62, 0), k(1.72, 3), k(2.1, 2), k(2.2, 3.5), k(2.4, 0)],
    "cabra.lean": [k(1.62, 0), k(1.75, 8), k(2.1, 8), k(2.22, -4), k(2.4, 0)],
    "eyes.look": [k(0, 0), k(0.4, 1), k(1.2, 0), k(1.62, 1), k(2.5, 0)],
    "legFN.x": [k(1.62, 0), k(1.72, 5), k(2.12, 5), k(2.3, 0)], "legFF.x": [k(1.62, 0), k(1.72, 5), k(2.12, 5), k(2.3, 0)],
    "legBN.x": [k(1.62, 0), k(1.72, -4), k(2.12, -4), k(2.3, 0)], "legBF.x": [k(1.62, 0), k(1.72, -4), k(2.12, -4), k(2.3, 0)],
  },
  oscillators: [
    { target: "cabra.alt", amp: 9, period: 0.26, wave: "hop", from: 0.44, to: 1.16, fade: 0.05 },
    { target: "legFN.x", amp: 4, period: 0.26, from: 0.44, to: 1.16 },
    { target: "legFF.x", amp: 4, period: 0.26, phase: 0.15, from: 0.44, to: 1.16 },
    { target: "legBN.x", amp: 4, period: 0.26, phase: 0.5, from: 0.44, to: 1.16 },
    { target: "legBF.x", amp: 4, period: 0.26, phase: 0.65, from: 0.44, to: 1.16 },
    { target: "body.squash", amp: 0.06, period: 0.26, from: 0.44, to: 1.16 },
  ],
  props: [
    { id: "mtn", type: "mountain", at: "from", z: "back", height: 60 },
    { id: "rumble", type: "emitter", particle: "dust", at: "from", t: 0.5, start: 0, end: 0.45, rate: 30, life: 0.6, speed: 26, spread: 150, gravity: 25, size: 1.2 },
    { id: "slide", type: "emitter", particle: "dust", at: "goat", along: -6, start: 1.66, end: 2.1, rate: 22, life: 0.45, speed: 12, spread: 90, dir: -60, gravity: 20 },
    { id: "cima", type: "bubble", at: "goat", alt: 50, text: "{ole}", grow: 0 },
    dust("land", "to", 2.12),
  ],
};
mountain.tracks!["cima.grow"] = [k(1.24, 0), k(1.38, 1, "backOut"), k(1.62, 1), k(1.74, 0)];

const leap: Scene = {
  name: "leap", group: "move", duration: 2.0,
  description: "A trampoline pops up; the goat bounces, cartwheels across the middle of the ring on a rainbow, and lands on the far letter.",
  tracks: {
    "tramp.grow": [k(0, 0), k(0.22, 1, "backOut"), k(0.9, 1), k(1.15, 0, "easeIn")],
    "tramp.squish": [k(0.3, 0), k(0.42, 1, "easeIn"), k(0.56, -0.5, "easeOut"), k(0.7, 0, "elastic")],
    // on the trampoline, then a long arc that bows in over the middle of the ring
    "cabra.alt": [k(0, 0), k(0.18, 0), k(0.26, 14, "easeOut"), k(0.3, 6, "easeIn"), k(0.42, 1, "easeIn"), k(0.5, 4), ...sineKeys(0.56, 1.48, -52)],
    "cabra.travel": [k(0, 0), k(0.56, 0, "hold"), k(1.48, 1, "linear")],
    "cabra.dive": [k(0, 0), k(0.56, 0, "hold"), k(0.6, 1), k(1.44, 1), k(1.48, 0)],
    "cabra.spin": [k(0.6, 0), k(1.36, 720, "easeInOut")],
    "legs.tuck": [k(0.56, 0), k(0.68, 1), k(1.26, 1), k(1.4, 0)],
    "body.squash": [k(0, 1), k(0.42, 0.78), k(0.56, 1.2), k(0.7, 1), k(1.48, 1), k(1.52, 0.8), k(1.72, 1, "backOut")],
    "ears.perk": [k(0, 0), k(0.5, 1), k(1.5, 1), k(1.9, 0)],
    "mouth.smile": [k(0, 0.3), k(0.5, 1), k(1.9, 0.4)],
    "eyes.happy": [k(0.56, 0), k(0.6, 1, "hold"), k(1.3, 0, "hold")],
    "rb.reveal": [k(0.56, 0), k(1.48, 1, "linear")],
    "rb.t": [k(0, 0), k(1.3, 0), k(1.9, 1, "easeIn")],
    "rb.opacity": [k(0, 0.92), k(1.6, 0.92), k(1.95, 0)],
    "ole.grow": [k(1.5, 0), k(1.62, 1, "backOut"), k(1.86, 1), k(1.98, 0)],
  },
  props: [
    { id: "rb", type: "rainbow", at: "from", alt: -48, width: 0.8, z: "back", dive: 1 },
    { id: "tramp", type: "trampoline", at: "from", z: "mid" },
    { id: "trail", type: "emitter", particle: "sparkle", at: "goat", alt: 24, start: 0.6, end: 1.4, rate: 26, life: 0.5, speed: 8, spread: 360, gravity: 0, size: 1.1 },
    { id: "ole", type: "text", at: "to", alt: 56, text: "{ole}", grow: 0 },
    dust("land", "to", 1.48, { burst: 9, speed: 28 }),
  ],
};

const fadeMove: Scene = {
  name: "fade-move", group: "move", duration: 0.7,
  description: "Reduced motion: fades out and back in on the next letter.",
  tracks: {
    "cabra.opacity": [k(0, 1), k(0.25, 0), k(0.4, 0), k(0.7, 1)],
    "cabra.travel": [k(0, 0), k(0.32, 0, "hold"), k(0.33, 1, "hold")],
  },
};

/* ---------------- Game events ---------------- */

const graze: Scene = {
  name: "graze", group: "event", duration: 2.0,
  description: "Correct! Grass sprouts on the letter and the goat munches it down to the roots.",
  tracks: {
    "grass.grow": [k(0, 0), k(0.35, 1, "backOut")],
    "grass.amount": [k(0, 1), k(0.72, 1), k(1.5, 0.02, "linear")],
    "head.down": [k(0, 0), k(0.3, 0), k(0.58, 1), k(1.5, 1), k(1.68, 0, "backOut")],
    "body.drop": [k(0, 0), k(0.5, 2.5), k(1.5, 2.5), k(1.66, 0)],
    "cabra.lean": [k(0, 0), k(0.55, 7), k(1.5, 7), k(1.66, 0)],
    "legFN.x": [k(0.3, 0), k(0.55, 2.5), k(1.5, 2.5), k(1.7, 0)],
    "legBN.x": [k(0.3, 0), k(0.55, -2.5), k(1.5, -2.5), k(1.7, 0)],
    "jaw.open": [k(0, 0), k(0.62, 0.35), k(1.5, 0.35), k(1.58, 0)],
    "eyes.open": [k(0, 1), k(0.62, 0.55), k(1.5, 0.55), k(1.6, 1)],
    "eyes.happy": [k(1.62, 0), k(1.63, 1, "hold"), k(1.95, 0, "hold")],
    "face.blush": [k(0, 0), k(0.9, 0.6), k(2.0, 0)],
    "ears.perk": [k(0, 0), k(0.3, 0.6), k(0.6, -0.2), k(1.6, 1), k(2.0, 0)],
    "cabra.alt": [k(1.62, 0), k(1.76, 9, "easeOut"), k(1.9, 0, "easeIn")],
    "body.squash": [k(1.6, 1), k(1.66, 1.1), k(1.9, 1), k(1.94, 0.88), k(2.0, 1)],
    "yum.grow": [k(1.48, 0), k(1.62, 1, "backOut"), k(1.86, 1), k(1.98, 0)],
  },
  oscillators: [
    { target: "jaw.open", amp: 0.35, period: 0.22, from: 0.66, to: 1.5 },
    { target: "head.tilt", amp: 4, period: 0.44, from: 0.66, to: 1.5 },
    { target: "tail.wag", amp: 28, period: 0.2, from: 0.7, to: 1.6 },
  ],
  props: [
    { id: "grass", type: "grass", at: "from", along: 15, alt: -4, z: "front" },
    { id: "bits", type: "emitter", particle: "grass", at: "from", along: 15, alt: 2, start: 0.75, end: 1.45, rate: 16, life: 0.55, speed: 24, spread: 80, gravity: 70 },
    { id: "hearts", type: "emitter", particle: "heart", at: "goat", alt: 30, start: 1.62, burst: 5, life: 0.9, speed: 26, spread: 110, gravity: -8, size: 1.2 },
    { id: "yum", type: "bubble", at: "goat", alt: 48, text: "{yum}", grow: 0 },
  ],
  cues: [{ t: 0.72, sound: "munch", gain: 0.6 }, { t: 1.12, sound: "munch", gain: 0.6 }, { t: 1.64, sound: "beh", pitch: 1.15, gain: 0.8 }],
};

const grazeFlower: Scene = {
  ...graze,
  name: "graze-flower", description: "Correct! A daisy pops up on the letter and the goat eats it petal by petal.",
  tracks: {
    ...graze.tracks,
    "flower.grow": [k(0, 0), k(0.35, 1, "backOut")],
    "flower.amount": [k(0, 1), k(0.72, 1), k(1.45, 0, "linear")],
  },
  props: [
    { id: "flower", type: "flower", at: "from", along: 15, alt: -4, z: "front" },
    { id: "bits", type: "emitter", particle: "grass", at: "from", along: 15, alt: 4, start: 0.75, end: 1.45, rate: 12, life: 0.55, speed: 22, spread: 80, gravity: 70 },
    { id: "hearts", type: "emitter", particle: "heart", at: "goat", alt: 30, start: 1.62, burst: 5, life: 0.9, speed: 26, spread: 110, gravity: -8, size: 1.2 },
    { id: "yum", type: "bubble", at: "goat", alt: 48, text: "{yum}", grow: 0 },
  ],
};
delete grazeFlower.tracks!["grass.grow"];
delete grazeFlower.tracks!["grass.amount"];

const oops: Scene = {
  name: "oops", group: "event", duration: 2.6,
  description: "Wrong: the goat jumps, a rain cloud parks over it, ears droop, and it shakes off the water.",
  tracks: {
    "cabra.alt": [k(0, 0), k(0.14, 10, "easeOut"), k(0.32, 0, "easeIn")],
    "body.squash": [k(0, 1), k(0.06, 1.15), k(0.32, 1), k(0.36, 0.86), k(0.5, 1)],
    "eyes.open": [k(0, 1), k(0.06, 1.25), k(0.4, 1.1), k(0.7, 0.75)],
    "ears.perk": [k(0, 0), k(0.08, 1.3), k(0.6, -1.2), k(2.2, -1.2), k(2.6, 0)],
    "brows.sad": [k(0, 0), k(0.6, 1), k(2.2, 1), k(2.6, 0)],
    "mouth.smile": [k(0, 0.3), k(0.4, -0.9), k(2.3, -0.9), k(2.6, 0.2)],
    "head.down": [k(0.4, 0), k(0.8, 0.28), k(2.2, 0.28), k(2.5, 0)],
    "body.drop": [k(0.4, 0), k(0.8, 3), k(1.8, 3), k(2.2, 0)],
    "tail.up": [k(0, 0), k(0.6, -1), k(2.3, -1), k(2.6, 0)],
    "eyes.up": [k(0.5, 0), k(0.9, 1), k(1.5, 1), k(1.8, 0)],
    "cloud.grow": [k(0, 0), k(0.22, 0), k(0.5, 1, "backOut"), k(2.1, 1), k(2.45, 0, "easeIn")],
    "cloud.rain": [k(0, 0), k(0.6, 0), k(0.8, 1), k(1.75, 1), k(1.9, 0)],
    "puddle.grow": [k(0, 0), k(0.9, 0), k(1.6, 1), k(2.2, 1), k(2.5, 0)],
    "ay.grow": [k(0, 0), k(0.1, 1, "backOut"), k(0.6, 1), k(0.72, 0)],
  },
  oscillators: [
    { target: "cabra.lean", amp: 7, period: 0.12, from: 1.85, to: 2.25, fade: 0.06 },
    { target: "ears.perk", amp: 0.8, period: 0.12, from: 1.85, to: 2.25, fade: 0.06 },
  ],
  props: [
    { id: "puddle", type: "puddle", at: "from", along: 2, alt: -1, z: "mid" },
    { id: "cloud", type: "cloud", at: "goat", alt: 54, dark: 0.75, size: 1.25, z: "front" },
    { id: "shake", type: "emitter", particle: "drop", at: "goat", alt: 20, start: 1.86, end: 2.2, rate: 30, life: 0.45, speed: 34, spread: 180, gravity: 40, size: 0.9 },
    { id: "ay", type: "bubble", at: "goat", alt: 34, along: 26, text: "{oops}", grow: 0 },
  ],
};

const pasaFlip: Scene = {
  name: "pasa-flip", group: "event", duration: 1.1,
  description: "¡Pasalacabra! A front flip and a big “Beee!” before it heads for the next letter.",
  tracks: {
    "cabra.alt": [k(0, 0), k(0.16, 0), k(0.46, 32, "easeOut"), k(0.8, 0, "easeIn")],
    "cabra.spin": [k(0.2, 0), k(0.74, 360, "easeInOut")],
    "body.squash": [k(0, 1), k(0.14, 0.82), k(0.2, 1.15), k(0.4, 1), k(0.8, 1), k(0.84, 0.84), k(1.05, 1, "backOut")],
    "body.drop": [k(0, 0), k(0.14, 4), k(0.2, 0), k(0.8, 0), k(0.84, 3), k(1.0, 0)],
    "legs.tuck": [k(0.18, 0), k(0.3, 1), k(0.62, 1), k(0.74, 0)],
    "jaw.open": [k(0, 0), k(0.06, 0.9), k(0.5, 0.8), k(0.6, 0)],
    "eyes.happy": [k(0, 0), k(0.05, 1, "hold"), k(0.6, 0, "hold")],
    "ears.perk": [k(0, 0), k(0.1, 1), k(0.9, 0.6), k(1.1, 0)],
    "tail.up": [k(0, 0), k(0.1, 1), k(1.0, 0)],
    "baa.grow": [k(0, 0), k(0.12, 1, "backOut"), k(0.88, 1), k(1.02, 0)],
  },
  props: [
    { id: "baa", type: "bubble", at: "from", alt: 74, text: "{baa}", size: 1.25, grow: 0 },
    { id: "stars", type: "emitter", particle: "star", at: "goat", alt: 20, start: 0.46, burst: 8, life: 0.7, speed: 34, spread: 360, gravity: 10 },
    dust("land", "from", 0.8),
  ],
  cues: [{ t: 0.2, sound: "whoosh", gain: 0.5 }],
};

const pasaDouble: Scene = {
  ...pasaFlip,
  name: "pasa-double", description: "¡Pasalacabra! A double front flip, higher, with a trail of stars.",
  duration: 1.35,
  tracks: {
    ...pasaFlip.tracks,
    "cabra.alt": [k(0, 0), k(0.16, 0), k(0.56, 46, "easeOut"), k(1.0, 0, "easeIn")],
    "cabra.spin": [k(0.2, 0), k(0.94, 720, "easeInOut")],
    "body.squash": [k(0, 1), k(0.14, 0.8), k(0.2, 1.18), k(0.4, 1), k(1.0, 1), k(1.04, 0.82), k(1.28, 1, "backOut")],
    "body.drop": [k(0, 0), k(0.14, 4.5), k(0.2, 0), k(1.0, 0), k(1.04, 3.5), k(1.22, 0)],
    "legs.tuck": [k(0.18, 0), k(0.3, 1), k(0.82, 1), k(0.94, 0)],
    "baa.grow": [k(0, 0), k(0.12, 1, "backOut"), k(1.1, 1), k(1.25, 0)],
  },
  props: [
    { id: "baa", type: "bubble", at: "from", alt: 84, text: "{baa}", size: 1.25, grow: 0 },
    { id: "trail", type: "emitter", particle: "star", at: "goat", alt: 22, start: 0.3, end: 0.95, rate: 18, life: 0.6, speed: 12, spread: 360, gravity: 0 },
    dust("land", "from", 1.0, { burst: 9 }),
  ],
  cues: [{ t: 0.2, sound: "whoosh", gain: 0.5 }, { t: 0.58, sound: "whoosh", pitch: 1.3, gain: 0.4 }],
};

const appear: Scene = {
  name: "appear", group: "event", duration: 0.8,
  description: "Pops into place in a puff of dust.",
  tracks: {
    "cabra.scale": [k(0, 0.01), k(0.12, 0.01), k(0.5, 1, "backOut")],
    "cabra.opacity": [k(0, 0), k(0.12, 0, "hold"), k(0.13, 1, "hold")],
    "cabra.alt": [k(0.12, 14), k(0.5, 0, "bounce")],
    "eyes.open": [k(0.3, 1.25), k(0.7, 1)],
    "ears.perk": [k(0.3, 1), k(0.8, 0)],
  },
  props: [
    dust("poof", "from", 0, { burst: 12, speed: 30, life: 0.6, size: 1.5, alt: 16 }),
    { id: "spark", type: "emitter", particle: "sparkle", at: "from", alt: 18, start: 0.05, burst: 6, life: 0.6, speed: 30, spread: 360, gravity: 0 },
  ],
  cues: [{ t: 0.1, sound: "pop" }],
};

const ready: Scene = {
  name: "ready", group: "event", duration: 0.9,
  description: "The turn starts: ears up, a little bounce, ready to go.",
  tracks: {
    "cabra.alt": [k(0, 0), k(0.14, 0), k(0.3, 12, "easeOut"), k(0.46, 0, "easeIn")],
    "body.squash": [k(0, 1), k(0.12, 0.86), k(0.18, 1.1), k(0.46, 1), k(0.5, 0.88), k(0.7, 1, "backOut")],
    "ears.perk": [k(0, 0), k(0.15, 1.2), k(0.9, 0.4)],
    "eyes.open": [k(0, 1), k(0.2, 1.2), k(0.9, 1)],
    "mouth.smile": [k(0, 0.3), k(0.2, 0.9), k(0.9, 0.5)],
    "tail.up": [k(0, 0), k(0.2, 1), k(0.9, 0.2)],
    "go.grow": [k(0, 0), k(0.14, 1, "backOut"), k(0.72, 1), k(0.86, 0)],
  },
  props: [{ id: "go", type: "bubble", at: "goat", alt: 48, text: "{go}", grow: 0 }],
};

const lieDown: Scene = {
  name: "lie-down", group: "event", duration: 1.8,
  description: "Turn over: turns round twice like a dog and settles down for a nap.",
  idle: { blink: false },
  tracks: {
    "cabra.face": [k(0, 1), k(0.2, 1), k(0.34, -1, "linear"), k(0.5, -1), k(0.64, 1, "linear")],
    "body.drop": [k(0, 0), k(0.7, 0), k(1.4, 11, "easeInOut")],
    "head.down": [k(1.0, 0), k(1.5, 0.2)],
    "head.tilt": [k(1.0, 0), k(1.5, 14)],
    "eyes.open": [k(0, 1), k(1.0, 1), k(1.2, 0.4), k(1.4, 0.5), k(1.7, 0)],
    "jaw.open": [k(0.8, 0), k(1.0, 1), k(1.3, 1), k(1.45, 0)],
    "ears.perk": [k(0, 0), k(1.6, -0.7)],
    "legFN.x": [k(0.8, 0), k(1.5, 3)], "legFF.x": [k(0.8, 0), k(1.5, 3)],
    "legBN.x": [k(0.8, 0), k(1.5, -3)], "legBF.x": [k(0.8, 0), k(1.5, -3)],
    "mouth.smile": [k(1.3, 0.3), k(1.8, 0.5)],
    "face.blush": [k(1.3, 0), k(1.8, 0.3)],
  },
};

const timeUp: Scene = {
  name: "time-up", group: "event", duration: 2.0,
  description: "¡Tiempo! The clock ran out: jaw drops, ears shoot up, then it flops down on the letter.",
  idle: { blink: false },
  tracks: {
    "cabra.alt": [k(0, 0), k(0.12, 9, "easeOut"), k(0.3, 0, "easeIn")],
    "body.squash": [k(0, 1), k(0.06, 1.16), k(0.3, 1), k(0.34, 0.86), k(0.48, 1)],
    "eyes.open": [k(0, 1), k(0.06, 1.3), k(1.0, 1.25), k(1.3, 0.6), k(1.7, 0)],
    "jaw.open": [k(0, 0), k(0.1, 1), k(0.9, 1), k(1.1, 0)],
    "ears.perk": [k(0, 0), k(0.08, 1.4), k(1.0, 1.2), k(1.6, -0.8)],
    "tail.up": [k(0, 0), k(0.1, 1), k(1.0, 1), k(1.5, -0.6)],
    "body.drop": [k(1.0, 0), k(1.6, 11, "bounce")],
    "head.down": [k(1.0, 0), k(1.6, 0.25)],
    "head.tilt": [k(1.0, 0), k(1.6, 14)],
    "brows.sad": [k(0.9, 0), k(1.4, 0.8)],
    "legFN.x": [k(1.0, 0), k(1.6, 3)], "legFF.x": [k(1.0, 0), k(1.6, 3)],
    "legBN.x": [k(1.0, 0), k(1.6, -3)], "legBF.x": [k(1.0, 0), k(1.6, -3)],
    "t.grow": [k(0, 0), k(0.12, 1, "backOut"), k(1.3, 1), k(1.45, 0)],
  },
  props: [
    { id: "t", type: "bubble", at: "goat", alt: 48, text: "{time}", size: 1.15, grow: 0 },
    dust("flop", "from", 1.45, { burst: 5, speed: 14 }),
  ],
};

const victory: Scene = {
  name: "victory", group: "event", duration: 3.6,
  description: "The whole ring is green: flips, a spin, bleats, fireworks and confetti everywhere.",
  tracks: {
    "cabra.alt": [k(0, 0), k(0.2, 0), k(0.6, 42, "easeOut"), k(1.0, 0, "easeIn"), k(1.3, 0), k(1.62, 26, "easeOut"), k(1.94, 0, "easeIn"), k(2.1, 0), k(2.62, 58, "easeOut"), k(3.14, 0, "easeIn")],
    "cabra.spin": [k(0.24, 0), k(0.94, 360, "easeInOut"), k(2.14, 360), k(3.06, 1440, "easeInOut")],
    "cabra.face": [k(1.3, 1), k(1.6, -1, "linear"), k(1.94, 1, "linear")],
    "legs.tuck": [k(0.22, 0), k(0.32, 1), k(0.82, 1), k(0.94, 0), k(2.16, 0), k(2.26, 1), k(2.96, 1), k(3.08, 0)],
    "body.squash": [k(0, 1), k(0.18, 0.8), k(0.24, 1.18), k(1.0, 1), k(1.04, 0.82), k(1.2, 1), k(1.94, 1), k(1.98, 0.84), k(2.08, 0.78), k(2.14, 1.2), k(3.14, 1), k(3.18, 0.8), k(3.45, 1, "backOut")],
    "jaw.open": [k(0.2, 0), k(0.3, 0.9), k(0.9, 0.9), k(1.0, 0), k(2.6, 0), k(2.7, 0.9), k(3.2, 0)],
    "eyes.happy": [k(0, 0), k(0.2, 1, "hold"), k(3.5, 0, "hold")],
    "mouth.smile": [k(0, 0.3), k(0.2, 1)],
    "face.blush": [k(0, 0), k(0.5, 0.8)],
    "ears.perk": [k(0, 0), k(0.2, 1.2)],
    "tail.up": [k(0, 0), k(0.2, 1)],
    "ole.grow": [k(0.2, 0), k(0.36, 1, "backOut"), k(3.3, 1), k(3.5, 0)],
  },
  oscillators: [{ target: "tail.wag", amp: 30, period: 0.18 }],
  props: [
    { id: "fw1", type: "emitter", particle: "sparkle", at: "goat", alt: 70, along: -34, start: 0.5, burst: 14, life: 0.9, speed: 46, spread: 360, gravity: 14, size: 1.2 },
    { id: "fw2", type: "emitter", particle: "star", at: "goat", alt: 84, along: 30, start: 1.2, burst: 14, life: 0.9, speed: 46, spread: 360, gravity: 14 },
    { id: "fw3", type: "emitter", particle: "heart", at: "goat", alt: 64, along: 4, start: 1.9, burst: 12, life: 1, speed: 40, spread: 360, gravity: 10 },
    { id: "confetti", type: "emitter", particle: "confetti", at: "goat", alt: 70, start: 0.2, end: 3.4, rate: 40, life: 2, speed: 40, spread: 200, gravity: 30, size: 1.2 },
    { id: "stars", type: "emitter", particle: "star", at: "goat", alt: 24, start: 2.62, burst: 12, life: 0.9, speed: 44, spread: 360, gravity: 10 },
    { id: "ole", type: "bubble", at: "goat", alt: 92, text: "{ole}", size: 1.4, grow: 0 },
  ],
  cues: [{ t: 0.05, sound: "ding" }, { t: 0.3, sound: "baa", pitch: 1.05 }, { t: 1.5, sound: "beh", pitch: 1.25 }, { t: 2.66, sound: "baa", pitch: 1.2 }],
};

const bow: Scene = {
  name: "bow", group: "event", duration: 2.0,
  description: "Game over: a polite bow, then it lies down.",
  idle: { blink: false },
  tracks: {
    "cabra.lean": [k(0, 0), k(0.4, 12), k(0.9, 12), k(1.1, 0)],
    "head.down": [k(0, 0), k(0.4, 0.55), k(0.9, 0.55), k(1.1, 0)],
    "legFN.x": [k(0, 0), k(0.4, 6), k(0.9, 6), k(1.1, 0)],
    "eyes.open": [k(0, 1), k(0.4, 0), k(0.9, 0), k(1.1, 1), k(1.7, 1), k(1.95, 0)],
    "body.drop": [k(1.1, 0), k(1.8, 11)],
    "head.tilt": [k(1.3, 0), k(1.8, 14)],
    "ears.perk": [k(1.1, 0), k(1.9, -0.7)],
  },
};

/* ---------------- Idle moments (silent: they play while questions are read) ---------------- */

const lookAround: Scene = {
  name: "look-around", group: "moment", duration: 2.6,
  description: "Glances back, turns all the way round, then turns back.",
  tracks: {
    "eyes.look": [k(0, 0), k(0.25, -1), k(0.7, -1), k(0.8, 0), k(1.6, 0), k(1.7, 1), k(2.3, 1), k(2.6, 0)],
    "head.tilt": [k(0, 0), k(0.3, -10), k(0.7, -10), k(0.85, 0)],
    "cabra.face": [k(0, 1), k(0.8, 1), k(0.96, -1, "linear"), k(1.7, -1), k(1.86, 1, "linear")],
    "ears.perk": [k(0, 0), k(0.3, 0.7), k(2.4, 0)],
  },
};

const scratch: Scene = {
  name: "scratch", group: "moment", duration: 2.2,
  description: "Scratches an itch with a hind hoof, eyes closed in bliss.",
  tracks: {
    "legBN.lift": [k(0, 0), k(0.3, 9), k(1.7, 9), k(1.95, 0)],
    "legBN.x": [k(0, 0), k(0.3, 7), k(1.7, 7), k(1.95, 0)],
    "cabra.lean": [k(0, 0), k(0.3, -5), k(1.7, -5), k(1.95, 0)],
    "head.tilt": [k(0, 0), k(0.35, 16), k(1.7, 16), k(1.95, 0)],
    "eyes.happy": [k(0.35, 0), k(0.36, 1, "hold"), k(1.75, 0, "hold")],
    "mouth.smile": [k(0, 0.3), k(0.4, 0.9), k(1.8, 0.3)],
    "tail.up": [k(0, 0), k(0.4, 0.6), k(1.8, 0)],
  },
  oscillators: [
    { target: "legBN.lift", amp: 2.4, period: 0.11, from: 0.35, to: 1.65 },
    { target: "tail.wag", amp: 20, period: 0.16, from: 0.4, to: 1.7 },
  ],
};

const chew: Scene = {
  name: "chew", group: "moment", duration: 2.6,
  description: "Chews the cud, eyes half shut, entirely unbothered.",
  tracks: {
    "eyes.open": [k(0, 1), k(0.3, 0.5), k(2.3, 0.5), k(2.6, 1)],
    "jaw.open": [k(0, 0), k(0.3, 0.22), k(2.3, 0.22), k(2.5, 0)],
    "ears.perk": [k(0, 0), k(0.4, -0.3), k(2.4, 0)],
    "head.tilt": [k(0, 0), k(0.4, 5), k(2.4, 0)],
  },
  oscillators: [
    { target: "jaw.open", amp: 0.2, period: 0.3, from: 0.3, to: 2.3 },
    { target: "head.tilt", amp: 2, period: 0.6, from: 0.3, to: 2.3 },
  ],
};

const sniff: Scene = {
  name: "sniff", group: "moment", duration: 2.0,
  description: "Sniffs the letter it’s standing on, then looks up, puzzled.",
  tracks: {
    "head.down": [k(0, 0), k(0.4, 0.75), k(1.2, 0.75), k(1.5, 0)],
    "head.tilt": [k(1.4, 0), k(1.6, -14), k(1.9, -14), k(2.0, 0)],
    "cabra.lean": [k(0, 0), k(0.4, 5), k(1.2, 5), k(1.5, 0)],
    "eyes.look": [k(0, 0), k(0.4, 0.6), k(1.4, 0), k(1.5, 0)],
    "eyes.up": [k(1.4, 0), k(1.6, 1), k(1.9, 1), k(2.0, 0)],
    "ears.perk": [k(1.4, 0), k(1.6, 1), k(2.0, 0)],
  },
  oscillators: [{ target: "head.tilt", amp: 3, period: 0.14, from: 0.45, to: 1.2 }],
};

const littleHop: Scene = {
  name: "little-hop", group: "moment", duration: 1.0,
  description: "A happy pronk straight up and down on the spot.",
  tracks: {
    "cabra.alt": [k(0, 0), k(0.16, 0), k(0.4, 20, "easeOut"), k(0.64, 0, "easeIn")],
    "body.squash": [k(0, 1), k(0.14, 0.82), k(0.2, 1.16), k(0.64, 1.05), k(0.68, 0.84), k(0.9, 1, "backOut")],
    "cabra.spin": [k(0.2, 0), k(0.4, -10), k(0.64, 0)],
    "ears.perk": [k(0, 0), k(0.2, 1), k(0.4, -0.4), k(0.7, 0.5), k(1.0, 0)],
    "tail.up": [k(0, 0), k(0.2, 1), k(0.9, 0)],
  },
  props: [dust("land", "from", 0.64, { burst: 5, speed: 16 })],
};

const stretch: Scene = {
  name: "stretch", group: "moment", duration: 2.6,
  description: "A long play-bow stretch and a yawn, then shakes it off.",
  tracks: {
    "legFN.x": [k(0, 0), k(0.4, 7), k(1.3, 7), k(1.6, 0)],
    "legFF.x": [k(0, 0), k(0.4, 7), k(1.3, 7), k(1.6, 0)],
    "cabra.lean": [k(0, 0), k(0.4, 10), k(1.3, 10), k(1.6, -6), k(1.9, 0)],
    "head.down": [k(0, 0), k(0.4, 0.25), k(1.3, 0.25), k(1.6, 0)],
    "head.tilt": [k(0.4, 0), k(0.7, -16), k(1.2, -16), k(1.5, 0)],
    "jaw.open": [k(0.5, 0), k(0.75, 1), k(1.15, 1), k(1.3, 0)],
    "eyes.open": [k(0.4, 1), k(0.6, 0), k(1.3, 0), k(1.45, 1)],
    "legBN.x": [k(1.3, 0), k(1.6, -7), k(2.0, -7), k(2.3, 0)],
    "legBF.x": [k(1.3, 0), k(1.6, -6), k(2.0, -6), k(2.3, 0)],
  },
  oscillators: [{ target: "cabra.lean", amp: 4, period: 0.1, from: 2.2, to: 2.55, fade: 0.05 }],
};

const headbutt: Scene = {
  name: "headbutt", group: "moment", duration: 1.8,
  description: "Rears up on its hind legs and butts the air with its horns.",
  tracks: {
    "body.rear": [k(0, 0), k(0.45, 30, "easeOut"), k(0.62, 30), k(0.78, -4, "easeIn"), k(1.0, 0)],
    "head.tilt": [k(0, 0), k(0.45, 20), k(0.7, 34), k(0.95, 30), k(1.3, 0)],
    "cabra.lean": [k(0.6, 0), k(0.8, 9), k(1.2, 0)],
    "brows.sad": [k(0, 0), k(0.4, -1), k(1.4, 0)],
    "eyes.open": [k(0, 1), k(0.4, 0.75), k(1.4, 1)],
    "ears.perk": [k(0, 0), k(0.4, 1), k(0.8, -0.5), k(1.4, 0)],
  },
  props: [
    { id: "bonk", type: "emitter", particle: "star", at: "from", along: 22, alt: 18, start: 0.8, burst: 5, life: 0.5, speed: 26, spread: 140, dir: 30, gravity: 10, size: 0.9 },
    dust("thud", "from", 0.78, { burst: 4, along: 8, speed: 14 }),
  ],
};

const tailWag: Scene = {
  name: "tail-wag", group: "moment", duration: 1.5,
  description: "Tail up and wagging like mad.",
  tracks: {
    "tail.up": [k(0, 0), k(0.2, 0.8), k(1.3, 0.8), k(1.5, 0)],
    "mouth.smile": [k(0, 0.3), k(0.2, 0.9), k(1.4, 0.3)],
    "ears.perk": [k(0, 0), k(0.2, 0.6), k(1.4, 0)],
    "eyes.look": [k(0, 0), k(0.3, -0.8), k(1.2, -0.8), k(1.4, 0)],
  },
  oscillators: [{ target: "tail.wag", amp: 34, period: 0.13, from: 0.15, to: 1.35 }],
};

const balance: Scene = {
  name: "balance", group: "moment", duration: 2.6,
  description: "Shows off: balances on its hind hooves on top of the letter, wobbling.",
  tracks: {
    "body.rear": [k(0, 0), k(0.5, 34, "easeOut"), k(2.0, 34), k(2.35, 0, "easeIn")],
    "legFN.x": [k(0, 0), k(0.5, 5), k(2.0, 5), k(2.3, 0)],
    "legFF.x": [k(0, 0), k(0.5, 3), k(2.0, 3), k(2.3, 0)],
    "head.tilt": [k(0, 0), k(0.5, 18), k(2.0, 18), k(2.3, 0)],
    "mouth.smile": [k(0, 0.3), k(0.5, 0.9), k(2.3, 0.3)],
    "eyes.look": [k(0, 0), k(0.6, 1), k(2.2, 1), k(2.6, 0)],
  },
  oscillators: [
    { target: "cabra.lean", amp: 6, period: 0.7, from: 0.5, to: 2.05 },
    { target: "ears.perk", amp: 0.5, period: 0.35, from: 0.5, to: 2.05 },
  ],
};

const snack: Scene = {
  ...grazeFlower,
  name: "snack", group: "moment",
  description: "Finds a daisy growing on the letter and quietly eats it.",
  props: grazeFlower.props!.filter((p) => p.id !== "yum" && p.id !== "hearts"),
  cues: [],
};

/* ---------------- Reactions (tap the goat) ---------------- */

const poke: Scene = {
  name: "poke", group: "reaction", duration: 1.1,
  description: "Tapped: jumps with a startled “Beee!” and a quick spin.",
  tracks: {
    "body.squash": [k(0, 1), k(0.08, 0.72), k(0.16, 1.2), k(0.3, 1), k(0.76, 1), k(0.8, 0.82), k(1.0, 1, "backOut")],
    "cabra.alt": [k(0, 0), k(0.12, 0), k(0.42, 26, "easeOut"), k(0.76, 0, "easeIn")],
    "cabra.spin": [k(0.16, 0), k(0.7, -360, "easeInOut")],
    "legs.tuck": [k(0.16, 0), k(0.26, 0.8), k(0.6, 0.8), k(0.7, 0)],
    "eyes.open": [k(0, 1), k(0.05, 1.3), k(0.6, 1.2), k(1.0, 1)],
    "jaw.open": [k(0, 0), k(0.08, 1), k(0.5, 0.9), k(0.6, 0)],
    "ears.perk": [k(0, 0), k(0.06, 1.4), k(1.0, 0)],
    "b.grow": [k(0, 0), k(0.1, 1, "backOut"), k(0.82, 1), k(0.96, 0)],
  },
  props: [{ id: "b", type: "bubble", at: "from", alt: 66, text: "{baa}", grow: 0 }, dust("land", "from", 0.76)],
  cues: [{ t: 0.06, sound: "baa", pitch: 1.1 }],
};

const giggle: Scene = {
  name: "giggle", group: "reaction", duration: 1.4,
  description: "Tapped: wiggles, blushes, hearts.",
  tracks: {
    "eyes.happy": [k(0, 0), k(0.05, 1, "hold"), k(1.2, 0, "hold")],
    "face.blush": [k(0, 0), k(0.2, 1), k(1.4, 0)],
    "mouth.smile": [k(0, 0.3), k(0.1, 1), k(1.3, 0.3)],
    "body.squash": [k(0, 1), k(0.08, 0.86), k(0.2, 1)],
    "ears.perk": [k(0, 0), k(0.1, 1), k(1.3, 0)],
    "tail.up": [k(0, 0), k(0.1, 1), k(1.3, 0)],
  },
  oscillators: [
    { target: "cabra.lean", amp: 5, period: 0.16, from: 0.1, to: 1.1 },
    { target: "tail.wag", amp: 30, period: 0.12, from: 0.1, to: 1.2 },
  ],
  props: [{ id: "hearts", type: "emitter", particle: "heart", at: "goat", alt: 30, start: 0.1, end: 0.9, rate: 8, life: 1, speed: 20, spread: 90, gravity: -10, size: 1.1 }],
  cues: [{ t: 0.1, sound: "beh", pitch: 1.35, gain: 0.8 }],
};

// In-game timing. The game never waits for the goat, so anything between two questions is
// tight: ✓ fits inside the narrator's "Sí" (~1.1 s), moves land quickly. ✗ keeps its length
// because the narrator reads out the right answer meanwhile.
const FAST: Record<string, number> = {
  hop: 0.8, "pasa-hop": 0.8, "hop-skip": 0.75, pronk: 0.78, mountain: 0.65, leap: 0.7,
  graze: 0.55, "graze-flower": 0.55, appear: 0.8, ready: 0.8,
};

export const SCENES: Scene[] = [
  rest, restWait, sleep, proud,
  hop, pasaHop, hopSkip, pronk, mountain, leap, fadeMove,
  graze, grazeFlower, oops, pasaFlip, pasaDouble, appear, ready, lieDown, timeUp, victory, bow,
  lookAround, scratch, chew, sniff, littleHop, stretch, headbutt, tailWag, balance, snack,
  poke, giggle,
].map((sc) => (FAST[sc.name] ? retime(sc, FAST[sc.name]) : sc));

/** Which scenes the director picks from for each game moment. Weighted by repetition. */
export const SLOTS: Record<string, string[]> = {
  rest: ["rest"],
  wait: ["rest-wait"],
  sleep: ["sleep"],
  proud: ["proud"],
  hop: ["hop", "hop", "hop-skip", "pronk"],
  mountain: ["mountain"],
  leap: ["leap"],
  correct: ["graze", "graze", "graze-flower"],
  wrong: ["oops"],
  // Pasalacabra itself plays no scene: the move that follows becomes a hop with a "¡Beee!".
  // (pasa-flip and pasa-double stay in the library for the studio.)
  pasaHop: ["pasa-hop"],
  appear: ["appear"],
  start: ["ready"],
  turnEnd: ["lie-down"],
  timeUp: ["time-up"],
  victory: ["victory"],
  gameOver: ["bow"],
  poke: ["poke", "giggle"],
  moment: ["look-around", "scratch", "chew", "sniff", "little-hop", "stretch", "headbutt", "tail-wag", "balance", "snack"],
  waitMoment: ["look-around", "little-hop", "stretch", "tail-wag", "chew"],
};
