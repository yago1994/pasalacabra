// Pure evaluator: (scene, t, context) → frame. No accumulated state, so the studio can
// scrub and loop and every frame can be checked on its own. Particles are seeded from the
// prop id and spawn index. Only breathing, blinking and ear/tail flicks use the absolute
// clock (ctx.clock), so they don't restart every time the scene changes.

import { DEFAULTS, EASE, WAVES, fieldDefaults } from "./scene";
import type { Key, NormalizedScene, Prop } from "./scene";

/* ---------------- Ring geometry (shared with LetterRing.tsx) ---------------- */

export const RING = { size: 400, cx: 200, cy: 200, ringR: 178, nodeR: 18 } as const;
/** Radius of the letters' outer edge: where hooves land. */
export const SURFACE_R = RING.ringR + RING.nodeR - 1;
const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function letterAngle(i: number, n: number) {
  return (i / n) * TAU - Math.PI / 2;
}
export function letterCenter(i: number, n: number) {
  const a = letterAngle(i, n);
  return { x: RING.cx + RING.ringR * Math.cos(a), y: RING.cy + RING.ringR * Math.sin(a) };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Blend two angles (radians) the short way round. */
export const lerpAngle = (a: number, b: number, u: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * u;
const frac = (x: number) => x - Math.floor(x);
export const hash01 = (n: number) => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};
export const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
export const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------------- Context and frame types ---------------- */

export type Ctx = {
  /** Number of letters on the ring. */
  n: number;
  /** Letter index the scene starts at, and the one it travels to (same as `from` if it stays). */
  from: number;
  to: number;
  /** Absolute seconds, for idle breathing and blinking. */
  clock: number;
  /** Localised bubble words. */
  words?: Record<string, string>;
  /** Rest values that replace the defaults for anything the scene doesn't animate (streak gear). */
  outfit?: Record<string, number>;
};

export type Place = { x: number; y: number; rot: number };

export type PropFrame = {
  key: string;
  prop: Prop;
  f: Record<string, number>;
  place: Place;
  /** Rainbow only: world path. */
  line?: [number, number][];
  /** Mountain only: world outline. */
  shape?: { pts: [number, number][]; snow: [number, number][]; summit: Place };
};

export type Particle = {
  kind: string;
  x: number;
  y: number;
  rot: number;
  size: number;
  opacity: number;
  hue: number;
};

export type Frame = {
  t: number;
  p: Record<string, number>;
  /** Hoof point in ring space and base rotation (degrees, includes lean). */
  place: Place;
  spin: number;
  props: PropFrame[];
  particles: Particle[];
  /** Secondary motion from the goat's own movement: ear flop, bell and beard swing. */
  lag: { ear: number; bell: number; beard: number; tail: number };
};

/* ---------------- Keyframes ---------------- */

function evalKeys(k: Key[], t: number) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b[0]) {
      const span = b[0] - a[0];
      if (span <= 0) return b[1];
      const u = EASE[b[2] || "easeInOut"]((t - a[0]) / span);
      return lerp(a[1], b[1], u);
    }
  }
  return k[k.length - 1][1];
}

function oscVal(o: NormalizedScene["oscillators"][number], t: number) {
  if (t < o.from || t > o.to) return 0;
  const env = o.fade > 0 ? clamp(Math.min((t - o.from) / o.fade, (o.to - t) / o.fade), 0, 1) : 1;
  return o.amp * WAVES[o.wave]((t - o.from) / o.period + o.phase) * env;
}

function value(scene: NormalizedScene, key: string, t: number, base: number) {
  const k = scene.tracks[key];
  let v = k ? evalKeys(k, t) : base;
  for (const o of scene.oscillators) if (o.target === key) v += oscVal(o, t);
  return v;
}

/* ---------------- Idle layer ---------------- */

function blinkAmt(t: number) {
  const P = 3.4, k = Math.floor(t / P);
  let v = 0;
  for (const kk of [k - 1, k]) {
    const start = kk * P + 0.5 + hash01(kk) * 1.9;
    for (const off of hash01(kk + 99) < 0.25 ? [0, 0.3] : [0]) {
      const u = (t - start - off) / 0.16;
      if (u >= 0 && u <= 1) v = Math.max(v, Math.sin(Math.PI * u));
    }
  }
  return v;
}
/** A quick twitch every few seconds (ears, tail). */
function flick(t: number, period: number, seed: number) {
  const k = Math.floor(t / period);
  const start = k * period + hash01(k + seed) * (period - 0.6);
  const u = (t - start) / 0.45;
  return u >= 0 && u <= 1 ? Math.sin(Math.PI * u) * Math.sin(3 * Math.PI * u) : 0;
}

/* ---------------- Mountain profile ---------------- */

/** Mountain height at fraction s (0 = from letter, 1 = to letter), before height/grow. */
export function mountainShape(s: number) {
  if (s <= 0 || s >= 1) return 0;
  const base = Math.pow(Math.sin(Math.PI * s), 1.35);
  // A shoulder on the way up and a crisp summit so it reads as a mountain, not a hill.
  const shoulder = 0.12 * Math.sin(2 * Math.PI * s) * Math.sin(Math.PI * s);
  const peak = 0.1 * Math.exp(-Math.pow((s - 0.5) / 0.06, 2));
  return Math.max(0, base * 0.9 + shoulder + peak);
}

/* ---------------- Evaluator ---------------- */

export class Evaluator {
  scene: NormalizedScene;
  ctx: Ctx;
  private dTheta: number;
  private propById = new Map<string, Prop>();
  private placeCache = new Map<number, Place & { spin: number }>();

  constructor(scene: NormalizedScene, ctx: Ctx) {
    this.scene = scene;
    this.ctx = ctx;
    const d = ((ctx.to - ctx.from) % ctx.n + ctx.n) % ctx.n;
    this.dTheta = (d * TAU) / ctx.n;
    for (const p of scene.props) this.propById.set(p.id, p);
  }

  /** Forward distance in letters between from and to. */
  get distance() {
    return Math.round((this.dTheta * this.ctx.n) / TAU);
  }

  param(key: string, t: number) {
    return value(this.scene, key, t, this.ctx.outfit?.[key] ?? DEFAULTS[key] ?? 0);
  }

  propField(prop: Prop, field: string, t: number) {
    const stat = prop[field];
    const base = typeof stat === "number" ? stat : fieldDefaults(prop.type)[field] ?? 0;
    return value(this.scene, `${prop.id}.${field}`, t, base);
  }

  /** Height of a mountain prop's surface above the ring at travel fraction s. */
  rideHeight(t: number, s: number) {
    const id = this.scene.ride;
    if (!id) return 0;
    const m = this.propById.get(id);
    if (!m) return 0;
    const t0 = this.propField(m, "t", t);
    const span = 1; // a mountain always spans from → to
    const local = (s - t0) / span;
    return this.propField(m, "height", t) * clamp(this.propField(m, "grow", t), 0, 1.5) * mountainShape(local);
  }

  /** World position on (or above) the ring for a travel fraction, with a straight-line blend. */
  ringPoint(travel: number, alt: number, along: number, dive: number): Place {
    const { n, from, to } = this.ctx;
    const th0 = letterAngle(from, n);
    const th = th0 + this.dTheta * travel + along / SURFACE_R;
    const ux = Math.cos(th), uy = Math.sin(th);
    let x = RING.cx + (SURFACE_R + alt) * ux;
    let y = RING.cy + (SURFACE_R + alt) * uy;
    if (dive > 0) {
      const a = letterAngle(from, n), b = letterAngle(to, n);
      const ax = RING.cx + SURFACE_R * Math.cos(a), ay = RING.cy + SURFACE_R * Math.sin(a);
      const bx = RING.cx + SURFACE_R * Math.cos(b), by = RING.cy + SURFACE_R * Math.sin(b);
      // On a straight line, "up" turns the short way round from one letter to the other.
      let dd = b - a;
      dd = Math.atan2(Math.sin(dd), Math.cos(dd));
      const tc = a + dd * travel;
      const cx = Math.cos(tc), cy = Math.sin(tc);
      const cxp = lerp(ax, bx, travel) + alt * cx - along * cy;
      const cyp = lerp(ay, by, travel) + alt * cy + along * cx;
      x = lerp(x, cxp, dive);
      y = lerp(y, cyp, dive);
      return { x, y, rot: lerpAngle(th, tc + along / SURFACE_R, dive) / DEG + 90 };
    }
    return { x, y, rot: th / DEG + 90 };
  }

  /** Goat placement only (cheap; used for look-back and particle origins). Numeric tracks only. */
  goatPlace(t: number): Place & { spin: number } {
    const key = Math.round(t * 1000);
    const hit = this.placeCache.get(key);
    if (hit) return hit;
    const travel = this.param("cabra.travel", t);
    const ride = clamp(this.param("cabra.ride", t), 0, 1);
    let alt = this.param("cabra.alt", t);
    let slope = 0;
    if (ride > 0 && this.scene.ride) {
      const h = this.rideHeight(t, travel);
      alt += ride * h;
      const ds = 0.01;
      const dh = this.rideHeight(t, travel + ds) - this.rideHeight(t, travel - ds);
      const arc = Math.max(1, this.dTheta * SURFACE_R * 2 * ds);
      slope = Math.atan2(-dh, arc) / DEG; // climbing tips the nose up (negative = backwards lean)
    }
    const pl = this.ringPoint(travel, alt, this.param("cabra.along", t), clamp(this.param("cabra.dive", t), 0, 1));
    pl.rot += this.param("cabra.lean", t) + ride * slope * 0.75;
    const out = { ...pl, spin: this.param("cabra.spin", t) };
    if (this.placeCache.size > 600) this.placeCache.clear();
    this.placeCache.set(key, out);
    return out;
  }

  propPlace(prop: Prop, t: number, f: Record<string, number>): Place {
    if (prop.at === "goat") {
      const g = this.goatPlace(t);
      const r = g.rot * DEG;
      // offset in the goat's own frame: along = forward, alt = up (outward)
      const fx = Math.cos(r), fy = Math.sin(r);
      const ux = Math.sin(r), uy = -Math.cos(r);
      const face = Math.sign(this.param("cabra.face", t)) || 1;
      return { x: g.x + f.along * face * fx + f.alt * ux, y: g.y + f.along * face * fy + f.alt * uy, rot: g.rot + f.rotation };
    }
    const base = prop.at === "to" ? 1 : 0;
    const pl = this.ringPoint(base + f.t, f.alt, f.along, 0);
    pl.rot += f.rotation;
    return pl;
  }

  frame(t: number): Frame {
    const sc = this.scene;
    const p: Record<string, number> = {};
    for (const k in DEFAULTS) p[k] = this.param(k, t);

    // Idle layer
    const clock = this.ctx.clock;
    p["body.squash"] += 0.018 * sc.idle.breathe * Math.sin((clock * 2 * Math.PI) / 2.6);
    if (sc.idle.blink) p["eyes.open"] *= 1 - 0.95 * blinkAmt(clock);
    if (sc.idle.ears) p["ears.perk"] += 0.5 * flick(clock, 4.3, 7);
    if (sc.idle.tail) p["tail.wag"] += 30 * flick(clock + 1.3, 3.1, 31);

    const place = this.goatPlace(t);

    // Secondary motion from the goat's own movement, seen in its local frame.
    const dt = 1 / 30;
    const a = this.goatPlace(Math.max(0, t - 2 * dt)), b = this.goatPlace(Math.max(0, t - dt)), c = place;
    const r = c.rot * DEG, cr = Math.cos(r), sr = Math.sin(r);
    const toLocal = (vx: number, vy: number) => [vx * cr + vy * sr, -vx * sr + vy * cr];
    const [v1x, v1y] = toLocal((c.x - b.x) / dt, (c.y - b.y) / dt);
    const [v0x, v0y] = toLocal((b.x - a.x) / dt, (b.y - a.y) / dt);
    const ax = (v1x - v0x) / dt, ay = (v1y - v0y) / dt;
    const spinRate = (c.spin - b.spin + (c.rot - b.rot)) / dt;
    const lag = {
      // Rising fast (negative local y velocity) flops ears down; falling lifts them.
      ear: clamp(v1y * 0.12 + ay * 0.004 + spinRate * 0.02, -40, 40),
      bell: clamp(-ax * 0.012 - v1x * 0.05 - spinRate * 0.05, -55, 55),
      beard: clamp(-ax * 0.008 - v1x * 0.03 + v1y * 0.03, -35, 35),
      tail: clamp(v1y * -0.08, -30, 30),
    };

    // Props
    const props: PropFrame[] = [];
    const particles: Particle[] = [];
    for (const prop of sc.props) {
      const f: Record<string, number> = {};
      for (const k in fieldDefaults(prop.type)) f[k] = this.propField(prop, k, t);
      if (prop.type === "emitter") {
        this.emit(prop, f, t, particles);
        continue;
      }
      const pf: PropFrame = { key: prop.id, prop, f, place: this.propPlace(prop, t, f) };
      if (prop.type === "mountain") pf.shape = this.mountainOutline(prop, f);
      if (prop.type === "rainbow") {
        const dive = typeof prop.dive === "number" ? prop.dive : 1;
        const line: [number, number][] = [];
        const reveal = clamp(f.reveal, 0, 1), start = clamp(f.t, 0, 1);
        for (let i = 0; i <= 32; i++) {
          const s = lerp(start, reveal, i / 32);
          const pl = this.ringPoint(s, f.alt * Math.sin(Math.PI * s) - 4, f.along, dive);
          line.push([pl.x, pl.y]);
        }
        pf.line = line;
      }
      props.push(pf);
    }

    return { t, p, place: { x: place.x, y: place.y, rot: place.rot }, spin: place.spin, props, particles, lag };
  }

  private mountainOutline(prop: Prop, f: Record<string, number>) {
    const pts: [number, number][] = [];
    const snow: [number, number][] = [];
    const H = f.height * clamp(f.grow, 0, 1.5);
    const N = 40;
    const base = (prop.at === "to" ? 1 : 0) + f.t;
    // Start a little inside the letters so the base tucks behind them.
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const h = H * mountainShape(s);
      const pl = this.ringPoint(base + s, h - 6 * Math.max(0, 1 - h / 10), f.along, 0);
      pts.push([pl.x, pl.y]);
    }
    // Close along an arc hidden under the letters (a straight chord would cut into the ring).
    for (let i = N; i >= 0; i -= 4) {
      const pl = this.ringPoint(base + i / N, -12, f.along, 0);
      pts.push([pl.x, pl.y]);
    }
    // Snow cap: the outline above the snow line, closed with a zigzag back along it.
    const line = H * 0.66;
    if (f.snow > 0 && H > 8) {
      const top: [number, number][] = [], bottom: [number, number][] = [];
      for (let i = 0; i <= N * 2; i++) {
        const s = i / (N * 2);
        const h = H * mountainShape(s);
        if (h < line) continue;
        const pl = this.ringPoint(base + s, h, f.along, 0);
        top.push([pl.x, pl.y]);
        const zig = (i % 6 < 3 ? 1 : -1) * 2.6 * f.snow;
        const b = this.ringPoint(base + s, line - 3 * f.snow + zig, f.along, 0);
        bottom.push([b.x, b.y]);
      }
      if (top.length > 2) snow.push(...top, ...bottom.reverse());
    }
    const summit = this.ringPoint(base + 0.5, H * mountainShape(0.5) - 0.5, f.along, 0);
    return { pts, snow, summit };
  }

  private emit(prop: Prop, f: Record<string, number>, t: number, out: Particle[]) {
    const start = typeof prop.start === "number" ? prop.start : 0;
    const end = typeof prop.end === "number" ? prop.end : this.scene.duration;
    const dir = typeof prop.dir === "number" ? prop.dir : 0;
    const kind = String(prop.particle || "sparkle");
    const life = Math.max(0.1, f.life);
    const burst = Math.round(f.burst);
    const seed = hashStr(prop.id + this.scene.name);
    const spawn = (k: number, tSpawn: number) => {
      const age = t - tSpawn;
      if (age < 0 || age > life) return;
      const R = rng(seed + k * 7919);
      const ff: Record<string, number> = {};
      for (const key of ["t", "along", "alt", "rotation"]) ff[key] = this.propField(prop, key, tSpawn);
      const origin = this.propPlace(prop, tSpawn, ff);
      const spread = f.spread * DEG;
      const ang = (origin.rot - 90 + dir) * DEG + (R() - 0.5) * spread;
      const sp = f.speed * (0.55 + 0.9 * R());
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
      // gravity pulls back toward the ring (opposite of the emitter's up)
      const up = (origin.rot - 90) * DEG;
      const gx = -Math.cos(up) * f.gravity, gy = -Math.sin(up) * f.gravity;
      const jitter = (R() - 0.5) * 8;
      const u = age / life;
      out.push({
        kind,
        x: origin.x + vx * age + 0.5 * gx * age * age + jitter * Math.cos(up + Math.PI / 2),
        y: origin.y + vy * age + 0.5 * gy * age * age + jitter * Math.sin(up + Math.PI / 2),
        rot: (R() - 0.5) * 60 + age * (R() - 0.5) * 400 + (kind === "zzz" || kind === "note" || kind === "heart" ? 0 : origin.rot),
        size: f.size * (0.7 + 0.6 * R()) * (kind === "dust" ? 0.6 + u * 0.9 : 1),
        opacity: f.opacity * (u < 0.15 ? u / 0.15 : 1 - Math.pow(Math.max(0, u - 0.55) / 0.45, 2)),
        hue: R(),
      });
    };
    if (burst > 0) {
      for (let k = 0; k < burst; k++) spawn(k, start + hash01(seed + k) * 0.06);
      return;
    }
    const rate = Math.max(0.1, f.rate);
    const k0 = Math.max(0, Math.floor((t - life - start) * rate));
    const k1 = Math.floor((Math.min(t, end) - start) * rate);
    for (let k = k0; k <= k1; k++) spawn(k, start + k / rate + frac(hash01(seed + k)) * 0.5 / rate);
  }
}
