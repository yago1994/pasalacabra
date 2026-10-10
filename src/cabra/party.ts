// The end-of-game goat party: a pack of goats galloping side to side across the screen,
// hopping, front-flipping, turning at the edges and running up and over mountains that rise
// from the bottom. Drawn by the same rig as the goat on the ring; motion is procedural.

import type { Frame } from "./engine";
import { DEG, clamp, mountainShape, rng } from "./engine";
import { DEFAULTS } from "./scene";
import { buildGoat, el, renderGoat } from "./rig";
import type { GoatDom } from "./rig";

type Mountain = { x0: number; w: number; h: number; delay: number; path: SVGPathElement; snow: SVGPathElement };
type Goat = {
  G: GoatDom;
  x: number;
  dir: number;
  face: number;
  speed: number;
  hopPeriod: number;
  hopH: number;
  phase: number;
  jumpAt: number; // next big jump (party seconds)
  jumpStart: number;
  jumpDur: number;
  jumpH: number;
  flips: number;
  lastY: number;
  lastX: number;
};

const f2 = (n: number) => Math.round(n * 10) / 10;

export class GoatParty {
  private svg: SVGSVGElement;
  private root: SVGGElement;
  private goats: Goat[] = [];
  private mountains: Mountain[] = [];
  private raf = 0;
  private t0 = 0;
  private W = 0;
  private H = 0;
  private scale = 1;
  private ending = -1;
  private onDone?: () => void;

  constructor(svg: SVGSVGElement, opts: { count?: number; seed?: number } = {}) {
    this.svg = svg;
    this.root = el("g", {}, svg);
    this.measure();
    const R = rng(opts.seed ?? Math.floor(Math.random() * 1e9));
    // Mountains along the bottom edge, rising one after another.
    const nM = this.W > 700 ? 4 : 3;
    const back = el("g", {}, this.root);
    for (let i = 0; i < nM; i++) {
      const w = (this.W / nM) * (1.1 + R() * 0.5);
      const x0 = (this.W / nM) * i - w * 0.25 + R() * 30;
      const path = el("path", { fill: "#8C97B0", stroke: "#1B2033", "stroke-width": 3, "stroke-linejoin": "round" }, back);
      const snow = el("path", { fill: "#FFFFFF", stroke: "#1B2033", "stroke-width": 2, "stroke-linejoin": "round" }, back);
      this.mountains.push({ x0, w, h: this.H * (0.16 + R() * 0.14), delay: 0.15 * i + R() * 0.2, path, snow });
    }
    const count = opts.count ?? clamp(Math.round(this.W / 75), 6, 14);
    for (let i = 0; i < count; i++) {
      const dir = R() < 0.5 ? -1 : 1;
      this.goats.push({
        G: buildGoat(this.root),
        x: R() * this.W,
        dir,
        face: dir,
        speed: (110 + R() * 170) * this.scale,
        hopPeriod: 0.32 + R() * 0.2,
        hopH: (8 + R() * 22) * this.scale,
        phase: R(),
        jumpAt: 0.4 + R() * 2.2,
        jumpStart: -10,
        jumpDur: 0.9,
        jumpH: 0,
        flips: 1,
        lastX: 0,
        lastY: 0,
      });
    }
    for (const g of this.goats) {
      g.G.hit.remove();
      g.lastX = g.x;
      g.lastY = this.H;
    }
  }

  private measure() {
    this.W = Math.max(320, window.innerWidth);
    this.H = Math.max(320, window.innerHeight);
    this.svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
    this.scale = clamp(this.W / 330, 1.15, 2.1);
  }

  /** Height of the mountain range at screen x, at party time t. */
  private hill(x: number, t: number) {
    let h = 0;
    for (const m of this.mountains) {
      const grow = this.grow(m, t);
      if (grow <= 0) continue;
      h = Math.max(h, m.h * grow * mountainShape((x - m.x0) / m.w));
    }
    return h;
  }

  private grow(m: Mountain, t: number) {
    const up = clamp((t - m.delay) / 0.7, 0, 1);
    const eased = 1 + 2.70158 * Math.pow(up - 1, 3) + 1.70158 * Math.pow(up - 1, 2); // backOut
    const down = this.ending >= 0 ? clamp(1 - (t - this.ending) / 0.6, 0, 1) : 1;
    return up <= 0 ? 0 : eased * down;
  }

  private ground(x: number, t: number) {
    return this.H - this.hill(x, t);
  }

  start(onDone?: () => void) {
    this.onDone = onDone;
    this.t0 = performance.now();
    const tick = (now: number) => {
      this.step((now - this.t0) / 1000);
      if (this.ending >= 0 && (now - this.t0) / 1000 > this.ending + 0.8) {
        this.destroy();
        this.onDone?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Mountains sink and the goats fade; calls onDone when finished. */
  end() {
    if (this.ending < 0) this.ending = (performance.now() - this.t0) / 1000;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  private lastT = 0;
  private step(t: number) {
    const dt = clamp(t - this.lastT, 0, 0.05);
    this.lastT = t;
    // mountains
    for (const m of this.mountains) {
      const g = this.grow(m, t);
      if (g <= 0.01) {
        m.path.setAttribute("d", "");
        m.snow.setAttribute("d", "");
        continue;
      }
      let d = "", top = "", bot = "";
      for (let i = 0; i <= 40; i++) {
        const s = i / 40, x = m.x0 + s * m.w, h = m.h * g * mountainShape(s);
        d += `${i ? "L" : "M"}${f2(x)},${f2(this.H - h + 2)}`;
        if (h > m.h * g * 0.68) {
          top += `${top ? "L" : "M"}${f2(x)},${f2(this.H - h + 2)}`;
          bot = `L${f2(x)},${f2(this.H - m.h * g * 0.68 + (i % 2 ? 6 : -2))}` + bot;
        }
      }
      m.path.setAttribute("d", d + `L${f2(m.x0 + m.w)},${this.H + 4}L${f2(m.x0)},${this.H + 4}Z`);
      m.snow.setAttribute("d", top ? top + bot + "Z" : "");
    }
    const fade = this.ending >= 0 ? clamp(1 - (t - this.ending) / 0.6, 0, 1) : clamp(t / 0.3, 0, 1);

    for (const g of this.goats) {
      // run, turning round at the edges
      g.x += g.dir * g.speed * dt;
      const margin = 30 * this.scale;
      if (g.x > this.W - margin && g.dir > 0) g.dir = -1;
      if (g.x < margin && g.dir < 0) g.dir = 1;
      g.face += clamp(g.dir - g.face, -dt * 9, dt * 9); // a quick turn, through 0

      // hops, and every so often a big jump with flips
      if (t >= g.jumpAt && t > g.jumpStart + g.jumpDur) {
        g.jumpStart = t;
        g.jumpDur = 0.75 + Math.random() * 0.45;
        g.jumpH = (60 + Math.random() * 90) * this.scale;
        g.flips = Math.random() < 0.3 ? 2 : 1;
        g.jumpAt = t + g.jumpDur + 0.8 + Math.random() * 2.2;
      }
      const ju = (t - g.jumpStart) / g.jumpDur;
      const jumping = ju >= 0 && ju <= 1;
      const ph = (t / g.hopPeriod + g.phase) % 1;
      const hop = jumping ? g.jumpH * Math.sin(Math.PI * ju) : g.hopH * Math.abs(Math.sin(Math.PI * ph));
      const gy = this.ground(g.x, t);
      const y = gy - hop;
      const slope = Math.atan2(this.ground(g.x + 4, t) - this.ground(g.x - 4, t), 8) / DEG;
      const vy = (y - g.lastY) / Math.max(dt, 1e-3);
      g.lastY = y;
      g.lastX = g.x;

      const p: Record<string, number> = { ...DEFAULTS };
      const gal = Math.sin(ph * Math.PI * 2);
      p["legFN.x"] = 5 * gal;
      p["legFF.x"] = 5 * Math.sin(ph * Math.PI * 2 + 0.7);
      p["legBN.x"] = -5 * gal;
      p["legBF.x"] = -5 * Math.sin(ph * Math.PI * 2 + 0.7);
      p["legFN.lift"] = Math.max(0, gal) * 3;
      p["legBN.lift"] = Math.max(0, -gal) * 3;
      p["legs.tuck"] = jumping ? clamp(Math.sin(Math.PI * ju) * 1.6, 0, 1) : 0;
      const landing = jumping ? 0 : Math.max(0, 1 - ph / 0.12);
      p["body.squash"] = 1 - landing * 0.14 + (jumping ? 0.06 : 0);
      p["eyes.happy"] = 1;
      p["mouth.smile"] = 1;
      p["jaw.open"] = jumping ? 0.7 : 0;
      p["ears.perk"] = clamp(-vy / 400, -1, 1.2);
      p["tail.up"] = 1;
      p["tail.wag"] = 30 * Math.sin(t * 40 + g.phase * 9);
      p["face.blush"] = 0.5;
      p["cabra.face"] = Math.abs(g.face) < 0.15 ? 0.15 * Math.sign(g.face || 1) : g.face;
      p["cabra.opacity"] = fade;
      const fr: Frame = {
        t,
        p,
        place: { x: g.x, y, rot: jumping ? 0 : slope * 0.8 },
        spin: jumping ? 360 * g.flips * (ju < 0.12 ? 0 : ju > 0.88 ? 1 : (ju - 0.12) / 0.76) : 0,
        props: [],
        particles: [],
        lag: { ear: clamp(vy * 0.02, -30, 30), bell: -g.dir * 18 + 8 * Math.sin(t * 12), beard: -g.dir * 10, tail: 0 },
      };
      p["cabra.scale"] = this.scale;
      renderGoat(g.G, fr);
    }
  }
}
