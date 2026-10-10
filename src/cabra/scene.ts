// The Cabra scene format: keyframe tracks on rig parameters and prop fields, oscillators
// layered on top, props and particle emitters, and sound cues. Scenes are plain JSON so
// they can be written by hand (scenes.ts), or by Claude in Cabra Studio, and parsed
// leniently: anything unknown is dropped with a warning instead of breaking the scene.

export type EaseName =
  | "linear" | "easeIn" | "easeOut" | "easeInOut" | "backOut" | "backIn"
  | "elastic" | "bounce" | "hold";

export type Key = [t: number, v: number, ease?: EaseName];

export type WaveName = "sine" | "triangle" | "square" | "saw" | "hop";

export type Oscillator = {
  target: string;
  amp: number;
  period: number;
  phase?: number;
  wave?: WaveName;
  from?: number;
  to?: number;
  fade?: number;
};

export type PropAt = "from" | "to" | "goat";

export type Prop = {
  id: string;
  type: string;
  /** Where the prop lives: at a letter ("from"/"to", interpolated by `t`) or on the goat. */
  at?: PropAt;
  /** "back" = behind the letters, "mid" = over letters but behind the goat, "front" = over the goat. */
  z?: "back" | "mid" | "front";
  /** Static values for any field; tracks named "<id>.<field>" animate them. */
  [field: string]: unknown;
};

export type Cue = { t: number; sound: string; pitch?: number; gain?: number };

export type Scene = {
  name: string;
  description?: string;
  group?: string;
  duration: number;
  loop?: boolean;
  /** Prop id whose surface the goat stands on while `cabra.ride` > 0 (a mountain). */
  ride?: string;
  idle?: { breathe?: number; blink?: boolean; ears?: boolean; tail?: boolean };
  props?: Prop[];
  tracks?: Record<string, Key[]>;
  oscillators?: Oscillator[];
  cues?: Cue[];
};

/* ---------------- Easing and waves ---------------- */

export const EASE: Record<EaseName, (u: number) => number> = {
  linear: (u) => u,
  easeIn: (u) => u * u * u,
  easeOut: (u) => 1 - Math.pow(1 - u, 3),
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  backOut: (u) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
  },
  backIn: (u) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * u * u * u - c1 * u * u;
  },
  elastic: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  bounce: (u) => {
    const n1 = 7.5625, d1 = 2.75;
    if (u < 1 / d1) return n1 * u * u;
    if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
    if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
    return n1 * (u -= 2.625 / d1) * u + 0.984375;
  },
  hold: () => 0,
};

const frac = (x: number) => x - Math.floor(x);
export const WAVES: Record<WaveName, (x: number) => number> = {
  sine: (x) => Math.sin(2 * Math.PI * x),
  triangle: (x) => 1 - 2 * Math.abs(2 * frac(x + 0.25) - 1),
  square: (x) => (Math.sin(2 * Math.PI * x) >= 0 ? 1 : -1),
  saw: (x) => 2 * frac(x) - 1,
  hop: (x) => Math.abs(Math.sin(Math.PI * x)),
};

/* ---------------- Rig parameters ---------------- */

/** Every animatable rig parameter and its rest value. Units are goat units (~1 SVG unit in the ring). */
export const DEFAULTS: Record<string, number> = {
  // Placement on the ring
  "cabra.travel": 0, // 0 = at the `from` letter, 1 = at the `to` letter
  "cabra.alt": 0, // height above the letter (outward from the ring)
  "cabra.along": 0, // sideways offset along the ring
  "cabra.dive": 0, // 0 = travel along the ring, 1 = straight line between letters (across the middle)
  "cabra.ride": 0, // 1 = stand on the scene's `ride` prop (a mountain)
  "cabra.lean": 0, // tilt around the hooves, degrees (+ = forward)
  "cabra.spin": 0, // rotation around the belly, degrees (+360 = front flip)
  "cabra.scale": 1,
  "cabra.face": 1, // 1 = faces clockwise (the way the game moves), -1 = turned around
  "cabra.opacity": 1,
  // Body
  "body.squash": 1, // <1 squash, >1 stretch (pivot at the hooves)
  "body.drop": 0, // lowers the body toward the hooves; legs fold (12 = lying down)
  "body.rear": 0, // rears up on the hind legs, degrees
  // Head and face
  "head.down": 0, // 0 = head up, 1 = muzzle at the ground (grazing)
  "head.tilt": 0,
  "jaw.open": 0,
  "mouth.smile": 0.3,
  "eyes.open": 1,
  "eyes.look": 0, // -1 back … 1 forward
  "eyes.up": 0, // -1 down … 1 up
  "eyes.happy": 0, // 1 = closed happy ^ ^ eyes
  "brows.sad": 0,
  "face.blush": 0,
  "ears.perk": 0, // -1 droopy … 1 perked up
  "tail.wag": 0,
  "tail.up": 0,
  // Legs: hoof offsets from standing (x forward, lift up), plus tuck (fold into a ball)
  "legFN.x": 0, "legFN.lift": 0, "legFF.x": 0, "legFF.lift": 0,
  "legBN.x": 0, "legBN.lift": 0, "legBF.x": 0, "legBF.lift": 0,
  "legs.tuck": 0,
};

export const PROP_TYPES = [
  "grass", "flower", "mountain", "cloud", "bubble", "text", "trampoline", "rainbow", "puddle", "emitter",
] as const;
export const PARTICLES = ["dust", "grass", "sparkle", "star", "heart", "note", "confetti", "zzz", "drop"] as const;
export const SOUNDS = ["baa", "beh", "meh", "munch", "boing", "pop", "whoosh", "ding", "rumble", "yawn"] as const;

/** Fields every prop has (besides its type-specific ones). */
export const PROP_COMMON: Record<string, number> = {
  t: 0, along: 0, alt: 0, rotation: 0, scale: 1, opacity: 1, grow: 1,
};
/** Type-specific animatable fields and defaults. */
export const PROP_FIELDS: Record<string, Record<string, number>> = {
  grass: { amount: 1, sway: 1 },
  flower: { amount: 1, sway: 1 },
  mountain: { height: 58, snow: 1, flag: 0 },
  cloud: { rain: 0, size: 1, dark: 0 },
  bubble: { size: 1 },
  text: { size: 1 },
  trampoline: { squish: 0 },
  rainbow: { reveal: 1, width: 1 },
  puddle: { size: 1 },
  emitter: { rate: 10, life: 1, speed: 40, spread: 50, gravity: 60, size: 1, burst: 0 },
};

/* ---------------- Lenient parser ---------------- */

export type NormalizedScene = Required<Pick<Scene, "name" | "duration" | "loop">> &
  Omit<Scene, "name" | "duration" | "loop"> & {
    description: string;
    group: string;
    idle: { breathe: number; blink: boolean; ears: boolean; tail: boolean };
    props: Prop[];
    tracks: Record<string, Key[]>;
    oscillators: Required<Oscillator>[];
    cues: Cue[];
  };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const num = (v: unknown, d: number) => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
};

export function fieldDefaults(type: string): Record<string, number> {
  return { ...PROP_COMMON, ...(PROP_FIELDS[type] || {}) };
}

export function normalizeScene(raw: unknown): { scene: NormalizedScene; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A scene must be a JSON object.");
  const r = raw as Record<string, unknown>;
  const idleRaw = (r.idle && typeof r.idle === "object" ? r.idle : {}) as Record<string, unknown>;
  const s: NormalizedScene = {
    name: String(r.name || "untitled").slice(0, 80),
    description: String(r.description || "").slice(0, 300),
    group: String(r.group || ""),
    duration: clamp(num(r.duration, 2), 0.2, 30),
    loop: r.loop === true,
    ride: typeof r.ride === "string" ? r.ride : undefined,
    idle: {
      breathe: num(idleRaw.breathe, 1),
      blink: idleRaw.blink !== false,
      ears: idleRaw.ears !== false,
      tail: idleRaw.tail !== false,
    },
    props: [],
    tracks: {},
    oscillators: [],
    cues: [],
  };

  const ids = new Set<string>();
  (Array.isArray(r.props) ? r.props : []).forEach((p, i) => {
    if (!p || typeof p !== "object") return;
    const q = { ...(p as Prop) };
    q.id = String(q.id || `${q.type || "prop"}${i + 1}`).replace(/[^\w-]/g, "_");
    if (ids.has(q.id) || q.id in { cabra: 1, body: 1, head: 1 }) q.id += "_" + i;
    if (!(PROP_TYPES as readonly string[]).includes(q.type)) {
      warnings.push(`Unknown prop type “${q.type}” on ${q.id}; drawn as a sparkle emitter.`);
      q.type = "emitter";
      q.particle = "sparkle";
    }
    if (q.type === "emitter" && !(PARTICLES as readonly string[]).includes(String(q.particle))) {
      if (q.particle) warnings.push(`Unknown particle “${String(q.particle)}” on ${q.id}; using sparkle.`);
      q.particle = "sparkle";
    }
    if (q.at !== "to" && q.at !== "goat") q.at = "from";
    if (q.z !== "back" && q.z !== "front") q.z = q.type === "mountain" || q.type === "rainbow" ? "back" : q.z === "mid" ? "mid" : q.type === "bubble" || q.type === "text" || q.type === "emitter" || q.type === "cloud" ? "front" : "mid";
    ids.add(q.id);
    s.props.push(q);
  });
  if (s.ride && !ids.has(s.ride)) {
    warnings.push(`“ride” names ${s.ride}, which isn’t a prop; ignored.`);
    s.ride = undefined;
  }

  const propType = (id: string) => s.props.find((p) => p.id === id)?.type;
  const knownTarget = (key: string) => {
    if (key in DEFAULTS) return true;
    const dot = key.indexOf(".");
    const owner = key.slice(0, dot), field = key.slice(dot + 1);
    const type = propType(owner);
    return !!type && field in fieldDefaults(type);
  };

  const tracks = (r.tracks && typeof r.tracks === "object" ? r.tracks : {}) as Record<string, unknown>;
  for (const key in tracks) {
    if (!knownTarget(key)) {
      warnings.push(`Track “${key}” doesn’t match a rig part or prop field; ignored.`);
      continue;
    }
    const kfs = normalizeKeys(tracks[key]);
    if (!kfs.length) {
      warnings.push(`Track “${key}” has no usable keyframes.`);
      continue;
    }
    s.tracks[key] = kfs;
  }

  (Array.isArray(r.oscillators) ? r.oscillators : []).forEach((o) => {
    if (!o || typeof o !== "object") return;
    const q = o as Record<string, unknown>;
    const target = String(q.target || "");
    if (!knownTarget(target)) {
      warnings.push(`Oscillator target “${target}” is unknown; ignored.`);
      return;
    }
    s.oscillators.push({
      target,
      amp: num(q.amp, 0),
      period: Math.max(0.05, num(q.period, 1)),
      phase: num(q.phase, 0),
      wave: (q.wave as WaveName) in WAVES ? (q.wave as WaveName) : "sine",
      from: num(q.from, 0),
      to: num(q.to, s.duration),
      fade: Math.max(0, num(q.fade, 0.15)),
    });
  });

  (Array.isArray(r.cues) ? r.cues : []).forEach((c) => {
    if (!c || typeof c !== "object") return;
    const q = c as Record<string, unknown>;
    const sound = String(q.sound || "");
    if (!(SOUNDS as readonly string[]).includes(sound)) {
      warnings.push(`Unknown sound “${sound}”; ignored.`);
      return;
    }
    s.cues.push({ t: clamp(num(q.t, 0), 0, s.duration), sound, pitch: num(q.pitch, 1), gain: num(q.gain, 1) });
  });
  s.cues.sort((a, b) => a.t - b.t);
  return { scene: s, warnings };
}

function normalizeKeys(arr: unknown): Key[] {
  if (!Array.isArray(arr)) return [];
  const out: Key[] = [];
  for (const k of arr) {
    let t: unknown, v: unknown, e: unknown;
    if (Array.isArray(k)) [t, v, e] = k;
    else if (k && typeof k === "object") ({ t, v, ease: e } = k as Record<string, unknown>);
    const tn = num(t, NaN), vn = num(v, NaN);
    if (!Number.isFinite(tn) || !Number.isFinite(vn)) continue;
    out.push([tn, vn, (e as EaseName) in EASE ? (e as EaseName) : "easeInOut"]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** A scene as clean JSON (for the studio's JSON tab and for exporting). */
export function sceneToJSON(s: NormalizedScene): Scene {
  const out: Scene = { name: s.name, description: s.description || undefined, group: s.group || undefined, duration: s.duration };
  if (s.loop) out.loop = true;
  if (s.ride) out.ride = s.ride;
  const idle: Scene["idle"] = {};
  if (s.idle.breathe !== 1) idle.breathe = s.idle.breathe;
  if (!s.idle.blink) idle.blink = false;
  if (!s.idle.ears) idle.ears = false;
  if (!s.idle.tail) idle.tail = false;
  if (Object.keys(idle).length) out.idle = idle;
  if (s.props.length) out.props = s.props;
  out.tracks = s.tracks;
  if (s.oscillators.length) out.oscillators = s.oscillators;
  if (s.cues.length) out.cues = s.cues;
  return out;
}
