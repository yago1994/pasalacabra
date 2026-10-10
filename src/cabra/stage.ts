// Draws frames into SVG: the goat, props and particles, split across two layers so
// mountains and rainbows sit behind the letters and everything else in front of them.

import type { Frame, Particle, PropFrame } from "./engine";
import { clamp, hash01, hashStr } from "./engine";
import { COLORS, buildGoat, el, renderGoat } from "./rig";
import type { GoatDom } from "./rig";

const C = COLORS;
const f2 = (n: number) => Math.round(n * 100) / 100;
const pts2d = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f2(x)},${f2(y)}`).join("");

export const WORDS: Record<string, Record<string, string>> = {
  es: { baa: "¡Beee!", hop: "¡Hop!", yum: "¡Ñam!", ole: "¡Olé!", oops: "¡Ay!", wow: "¡Toma ya!", top: "¡Cima!", zzz: "Zzz", boing: "¡Boing!", go: "¡Vamos!", hmm: "¿Mmm?", pasa: "¡Pasa!", time: "¡Tiempo!", hot: "¡En racha!", legend: "¡Leyenda!" },
  en: { baa: "Baa!", hop: "Hop!", yum: "Yum!", ole: "Olé!", oops: "Oops!", wow: "Wow!", top: "Summit!", zzz: "Zzz", boing: "Boing!", go: "Let’s go!", hmm: "Hmm?", pasa: "Pass!", time: "Time!", hot: "On fire!", legend: "Legend!" },
};
export function wordFor(text: string, words: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => words[k] ?? k);
}

/* ---------------- Particle shapes ---------------- */

const starD = (r: number, pts = 5, inner = 0.45) => {
  let d = "";
  for (let i = 0; i < pts * 2; i++) {
    const rr = i % 2 ? r * inner : r, a = -Math.PI / 2 + (i * Math.PI) / pts;
    d += (i ? "L" : "M") + f2(Math.cos(a) * rr) + "," + f2(Math.sin(a) * rr);
  }
  return d + "Z";
};
const sparkleD = (r: number) => {
  const a = r * 0.18;
  return `M0,${-r}C${a},${-a} ${a},${-a} ${r},0C${a},${a} ${a},${a} 0,${r}C${-a},${a} ${-a},${a} ${-r},0C${-a},${-a} ${-a},${-a} 0,${-r}Z`;
};
const heartD = "M0,3.2C-1.2,2.2 -3.4,0.8 -3.4,-1C-3.4,-2.4 -2.4,-3.2 -1.4,-3.2C-0.7,-3.2 -0.2,-2.8 0,-2.2C0.2,-2.8 0.7,-3.2 1.4,-3.2C2.4,-3.2 3.4,-2.4 3.4,-1C3.4,0.8 1.2,2.2 0,3.2Z";
const PARTICLE: Record<string, { d: string; fill: (h: number) => string; stroke?: string; sw?: number }> = {
  dust: { d: "M-2.6,0A2.6,2.6 0 1 0 2.6,0A2.6,2.6 0 1 0 -2.6,0Z", fill: () => "#EFE6D6", stroke: C.ink, sw: 0.6 },
  grass: { d: "M-0.7,2.4Q0.6,0 0.2,-2.8Q1.2,-0.4 0.9,2.4Z", fill: (h) => (h > 0.5 ? "#49B562" : "#2F8F4A"), stroke: C.ink, sw: 0.4 },
  sparkle: { d: sparkleD(3.4), fill: (h) => (h > 0.5 ? "#FFF6C2" : "#FFFFFF") },
  star: { d: starD(3.6), fill: () => "#FFD54A", stroke: C.ink, sw: 0.7 },
  heart: { d: heartD, fill: (h) => (h > 0.5 ? "#FF5C7A" : "#FF8FA3"), stroke: C.ink, sw: 0.6 },
  note: { d: "M-1.6,2.6A1.5,1.1 0 1 0 1.2,2.4V-3.2L3.4,-2.2V-0.9L1.2,-1.8V2.4", fill: () => "#FFFFFF", stroke: C.ink, sw: 0.7 },
  confetti: { d: "M-1.8,-0.9H1.8V0.9H-1.8Z", fill: (h) => ["#FF5C7A", "#FFD54A", "#4F8DFF", "#2BB673", "#00D4FF", "#FF8A3D"][Math.floor(h * 6)] },
  zzz: { d: "M-2.4,-2.6H2.4L-1,1.6H2.6V2.8H-2.6L0.8,-1.4H-2.4Z", fill: () => "#FFFFFF", stroke: C.ink, sw: 0.6 },
  drop: { d: "M0,-3C1,-1.4 2,-0.2 2,1C2,2.2 1.1,3 0,3C-1.1,3 -2,2.2 -2,1C-2,-0.2 -1,-1.4 0,-3Z", fill: () => "#6EC1FF", stroke: C.ink, sw: 0.5 },
};

/* ---------------- Props ---------------- */

type PropDom = { g: SVGGElement; type: string; refs: Record<string, Element | Element[]>; z: string; seen: boolean };

function buildProp(type: string, parent: SVGGElement): PropDom {
  const g = el("g", {}, parent);
  const refs: PropDom["refs"] = {};
  switch (type) {
    case "grass": {
      const blades: SVGPathElement[] = [];
      for (let i = 0; i < 9; i++) blades.push(el("path", { fill: i % 3 === 1 ? "#2F8F4A" : "#49B562", stroke: C.ink, "stroke-width": 0.8, "stroke-linejoin": "round" }, g));
      refs.blades = blades;
      break;
    }
    case "flower": {
      refs.stem = el("path", { fill: "none", stroke: "#2F8F4A", "stroke-width": 1.6, "stroke-linecap": "round" }, g);
      refs.leaf = el("path", { d: "M0,0C2,-2.4 5,-2.4 6,-0.6C4,0.6 2,0.6 0,0Z", fill: "#49B562", stroke: C.ink, "stroke-width": 0.6 }, g);
      const head = el("g", {}, g);
      const petals: SVGEllipseElement[] = [];
      for (let i = 0; i < 7; i++) petals.push(el("ellipse", { cx: 0, cy: -3.2, rx: 1.7, ry: 3, fill: "#FFFFFF", stroke: C.ink, "stroke-width": 0.6, transform: `rotate(${(i * 360) / 7})` }, head));
      el("circle", { r: 2.1, fill: "#FFD54A", stroke: C.ink, "stroke-width": 0.6 }, head);
      refs.head = head;
      refs.petals = petals;
      break;
    }
    case "mountain": {
      refs.body = el("path", { fill: "#8C97B0", stroke: C.ink, "stroke-width": 2, "stroke-linejoin": "round" }, g);
      refs.shade = el("path", { fill: "none", stroke: "#6B7590", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9 }, g);
      refs.snow = el("path", { fill: "#FFFFFF", stroke: C.ink, "stroke-width": 1.2, "stroke-linejoin": "round" }, g);
      const flag = el("g", {}, g);
      el("path", { d: "M0,0V-14", stroke: C.ink, "stroke-width": 1.4, "stroke-linecap": "round" }, flag);
      refs.pennant = el("path", { d: "M0.4,-14L10,-11L0.4,-8Z", fill: C.collar, stroke: C.ink, "stroke-width": 0.9, "stroke-linejoin": "round" }, flag);
      el("path", { d: "M0.4,-12.2L5.6,-11L0.4,-9.8Z", fill: "#F6C744" }, flag);
      refs.flag = flag;
      break;
    }
    case "cloud": {
      const puffs = [[-8, -2, 6], [0, -6.5, 8], [8.5, -2.5, 6.2], [3, 0, 5.5], [-4, 0, 5.5]];
      const drops: SVGPathElement[] = [];
      for (let i = 0; i < 5; i++) drops.push(el("path", { d: PARTICLE.drop.d, fill: "#6EC1FF", stroke: C.ink, "stroke-width": 0.5 }, g));
      refs.drops = drops;
      const body = el("g", {}, g);
      for (const [x, y, r] of puffs) el("circle", { cx: x, cy: y, r, fill: C.ink, stroke: C.ink, "stroke-width": 2.2 }, body);
      const fill = el("g", {}, body);
      for (const [x, y, r] of puffs) el("circle", { cx: x, cy: y, r, fill: "#FFFFFF" }, fill);
      const dark = el("g", { opacity: 0 }, body);
      for (const [x, y, r] of puffs) el("circle", { cx: x, cy: y, r, fill: "#97A1B6" }, dark);
      refs.body = body;
      refs.dark = dark;
      break;
    }
    case "bubble": {
      refs.tail = el("path", { fill: "#FFFFFF", stroke: C.ink, "stroke-width": 1.6, "stroke-linejoin": "round" }, g);
      refs.box = el("rect", { fill: "#FFFFFF", stroke: C.ink, "stroke-width": 1.6, rx: 7 }, g);
      refs.tailCover = el("path", { fill: "#FFFFFF" }, g);
      refs.text = el("text", { "text-anchor": "middle", "dominant-baseline": "central", fill: C.ink, "font-size": 10, "font-weight": 900, "font-family": "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" }, g);
      break;
    }
    case "text": {
      refs.text = el("text", { "text-anchor": "middle", "dominant-baseline": "central", fill: "#FFE066", stroke: C.ink, "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round", "font-size": 13, "font-weight": 900, "font-family": "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" }, g);
      break;
    }
    case "trampoline": {
      el("path", { d: "M-9,-5L-11,0M9,-5L11,0M-3,-5L-4,0M3,-5L4,0", stroke: C.ink, "stroke-width": 1.6, "stroke-linecap": "round" }, g);
      refs.bed = el("path", { fill: "#4F8DFF", stroke: C.ink, "stroke-width": 1.4, "stroke-linejoin": "round" }, g);
      refs.rim = el("path", { fill: "none", stroke: C.collar, "stroke-width": 2.4, "stroke-linecap": "round" }, g);
      break;
    }
    case "rainbow": {
      const bands: SVGPathElement[] = [];
      for (const c of [C.ink, "#FF5C5C", "#FF9F40", "#FFD54A", "#49B562", "#4F8DFF", "#9B6BFF"]) bands.push(el("path", { fill: "none", stroke: c, "stroke-linecap": "round", "stroke-linejoin": "round" }, g));
      refs.bands = bands;
      break;
    }
    case "puddle": {
      refs.pool = el("ellipse", { cx: 0, cy: -0.6, fill: "#5DA9F6", stroke: C.ink, "stroke-width": 1, opacity: 0.9 }, g);
      refs.shine = el("path", { fill: "none", stroke: "#fff", "stroke-width": 0.8, "stroke-linecap": "round", opacity: 0.8 }, g);
      break;
    }
  }
  return { g, type, refs, z: "mid", seen: true };
}

function updateProp(d: PropDom, pf: PropFrame, alpha: number, goat: Frame, clock: number, words: Record<string, string>) {
  const { f, place, prop } = pf;
  const grow = clamp(f.grow, 0, 2);
  const op = clamp(f.opacity, 0, 1) * alpha;
  d.g.setAttribute("opacity", String(f2(op)));
  d.g.setAttribute("visibility", op < 0.01 || grow < 0.01 ? "hidden" : "visible");
  const upright = d.type === "bubble" || d.type === "text";
  const sc = f.scale * (upright || d.type === "mountain" || d.type === "rainbow" ? 1 : grow);
  if (d.type !== "mountain" && d.type !== "rainbow")
    d.g.setAttribute("transform", upright ? `translate(${f2(place.x)} ${f2(place.y)}) scale(${f2(sc * grow)})` : `translate(${f2(place.x)} ${f2(place.y)}) rotate(${f2(place.rot)}) scale(${f2(sc)})`);
  const seed = hash01(hashStr(prop.id));
  switch (d.type) {
    case "grass": {
      const blades = d.refs.blades as SVGPathElement[];
      const amount = clamp(f.amount, 0, 1);
      blades.forEach((b, i) => {
        const rank = hash01(i * 3.1 + seed * 10); // order they get eaten
        const x = -11 + i * 2.75 + (hash01(i + seed) - 0.5) * 1.4;
        const h = (9 + hash01(i * 7 + seed) * 7 - Math.abs(i - 4) * 0.6) * clamp(amount * 1.6 - rank * 0.6, 0, 1);
        const tip = (hash01(i * 13) - 0.5) * 3 + Math.sin(clock * 2.4 + i * 0.9) * 1.1 * f.sway;
        b.setAttribute("d", h < 0.4 ? "" : `M${f2(x - 1.7)},1Q${f2(x + tip * 0.4)},${f2(-h * 0.6)} ${f2(x + tip)},${f2(-h)}Q${f2(x + 0.6)},${f2(-h * 0.45)} ${f2(x + 1.7)},1Z`);
      });
      break;
    }
    case "flower": {
      const a = clamp(f.amount, 0, 1);
      const h = 12 * clamp(a * 2, 0.15, 1);
      const sw = Math.sin(clock * 2 + seed * 9) * 1.2 * f.sway;
      (d.refs.stem as Element).setAttribute("d", `M0,1Q${f2(sw * 0.3)},${f2(-h * 0.5)} ${f2(sw)},${f2(-h)}`);
      (d.refs.leaf as Element).setAttribute("transform", `translate(${f2(sw * 0.2)} ${f2(-h * 0.35)}) rotate(-20) scale(${f2(Math.min(1, a * 2))})`);
      (d.refs.head as Element).setAttribute("transform", `translate(${f2(sw)} ${f2(-h)}) rotate(${f2(sw * 6)})`);
      (d.refs.head as Element).setAttribute("visibility", a > 0.12 ? "visible" : "hidden");
      (d.refs.petals as Element[]).forEach((p, i) => p.setAttribute("visibility", a > 0.2 + (i / 7) * 0.75 ? "visible" : "hidden"));
      break;
    }
    case "mountain": {
      const sh = pf.shape;
      if (!sh) break;
      (d.refs.body as Element).setAttribute("d", pts2d(sh.pts) + "Z");
      const N = 40; // top outline points (see Evaluator.mountainOutline)
      // ridge lines down the shaded (far) slope
      const ridge = [sh.pts[Math.round(N * 0.5)], sh.pts[Math.round(N * 0.62)], sh.pts[Math.round(N * 0.74)]];
      const mid = (a: [number, number], b: [number, number], u: number): [number, number] => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      const foot = mid(sh.pts[Math.round(N * 0.82)], sh.pts[Math.round(N * 0.5)], 0.35);
      (d.refs.shade as Element).setAttribute("d", sh.pts.length > 4 ? `M${f2(ridge[0][0])},${f2(ridge[0][1])}L${f2(mid(ridge[1], foot, 0.25)[0])},${f2(mid(ridge[1], foot, 0.25)[1])}L${f2(foot[0])},${f2(foot[1])}` : "");
      (d.refs.snow as Element).setAttribute("d", sh.snow.length > 2 ? pts2d(sh.snow) + "Z" : "");
      const fl = clamp(f.flag, 0, 1);
      (d.refs.flag as Element).setAttribute("transform", `translate(${f2(sh.summit.x)} ${f2(sh.summit.y)}) rotate(${f2(sh.summit.rot)}) scale(${f2(fl)})`);
      (d.refs.flag as Element).setAttribute("visibility", fl > 0.02 ? "visible" : "hidden");
      (d.refs.pennant as Element).setAttribute("transform", `skewY(${f2(Math.sin(clock * 7) * 6)})`);
      break;
    }
    case "cloud": {
      (d.refs.dark as Element).setAttribute("opacity", String(f2(clamp(f.dark, 0, 1))));
      (d.refs.body as Element).setAttribute("transform", `scale(${f2(f.size)})`);
      const rain = clamp(f.rain, 0, 1);
      (d.refs.drops as Element[]).forEach((dr, j) => {
        const ph = (clock * 1.7 + j * 0.37 + seed) % 1;
        dr.setAttribute("transform", `translate(${f2((-9 + j * 4.5) * f.size)} ${f2(5 + ph * 20)}) scale(0.8)`);
        dr.setAttribute("opacity", String(f2(rain * (1 - ph))));
      });
      break;
    }
    case "bubble": {
      const txt = wordFor(String(prop.text ?? "{baa}"), words);
      const t = d.refs.text as SVGTextElement;
      if (t.textContent !== txt) t.textContent = txt;
      const w = 10 + 6.1 * [...txt].length * f.size, h = 15 * f.size;
      t.setAttribute("font-size", String(f2(10 * f.size)));
      const box = d.refs.box as Element;
      box.setAttribute("x", String(f2(-w / 2)));
      box.setAttribute("y", String(f2(-h / 2)));
      box.setAttribute("width", String(f2(w)));
      box.setAttribute("height", String(f2(h)));
      // tail points at the goat
      let dx = goat.place.x - place.x, dy = goat.place.y - place.y;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m;
      dy /= m;
      const k = Math.min(w / 2 / (Math.abs(dx) || 1e-6), h / 2 / (Math.abs(dy) || 1e-6));
      const bx = dx * k, by = dy * k;
      const nx = -dy * 3.4, ny = dx * 3.4;
      const tx = bx + dx * 8, ty = by + dy * 8;
      const tail = `M${f2(bx * 0.82 + nx)},${f2(by * 0.82 + ny)}L${f2(tx)},${f2(ty)}L${f2(bx * 0.82 - nx)},${f2(by * 0.82 - ny)}Z`;
      (d.refs.tail as Element).setAttribute("d", tail);
      (d.refs.tailCover as Element).setAttribute("d", `M${f2(bx * 0.7 + nx * 0.7)},${f2(by * 0.7 + ny * 0.7)}L${f2(bx * 0.7 + dx * 2.2)},${f2(by * 0.7 + dy * 2.2)}L${f2(bx * 0.7 - nx * 0.7)},${f2(by * 0.7 - ny * 0.7)}Z`);
      break;
    }
    case "text": {
      const txt = wordFor(String(prop.text ?? "{hop}"), words);
      const t = d.refs.text as SVGTextElement;
      if (t.textContent !== txt) t.textContent = txt;
      t.setAttribute("font-size", String(f2(13 * f.size)));
      if (typeof prop.color === "string") t.setAttribute("fill", prop.color);
      break;
    }
    case "trampoline": {
      const sq = clamp(f.squish, -1, 1.5);
      const y = -5.5;
      (d.refs.bed as Element).setAttribute("d", `M-11,${y}Q0,${f2(y + 1.5 + sq * 6)} 11,${y}Q0,${f2(y - 1.6 + sq * 3)} -11,${y}Z`);
      (d.refs.rim as Element).setAttribute("d", `M-11,${y}Q0,${f2(y - 1.6 + sq * 3)} 11,${y}`);
      break;
    }
    case "rainbow": {
      const line = pf.line;
      const dd = line && line.length > 1 ? pts2d(line) : "";
      const W = 13 * f.width;
      (d.refs.bands as Element[]).forEach((b, i) => {
        b.setAttribute("d", dd);
        b.setAttribute("stroke-width", String(f2(i === 0 ? W + 2 : W * (1 - (i - 1) / 6))));
      });
      break;
    }
    case "puddle": {
      const s = f.size;
      const pool = d.refs.pool as Element;
      pool.setAttribute("rx", String(f2(9 * s)));
      pool.setAttribute("ry", String(f2(2.2 * Math.min(1.3, s))));
      (d.refs.shine as Element).setAttribute("d", `M${f2(-5 * s)},-1.2Q${f2(-3 * s)},-2 ${f2(-1 * s)},-1.6`);
      break;
    }
  }
}

/* ---------------- Stage ---------------- */

export type ExtraSet = { frame: Frame; alpha: number; key: string };

export class CabraStage {
  back: SVGGElement;
  mid: SVGGElement;
  goatLayer: SVGGElement;
  front: SVGGElement;
  fx: SVGGElement;
  goat: GoatDom;
  private props = new Map<string, PropDom>();
  private pool: SVGPathElement[] = [];

  constructor(backParent: Element, frontParent: Element) {
    this.back = el("g", { class: "cabra-back", "pointer-events": "none" }, backParent);
    this.mid = el("g", { class: "cabra-mid", "pointer-events": "none" }, frontParent);
    this.goatLayer = el("g", { class: "cabra-goat-layer" }, frontParent);
    this.front = el("g", { class: "cabra-front", "pointer-events": "none" }, frontParent);
    this.fx = el("g", { class: "cabra-fx", "pointer-events": "none" }, frontParent);
    this.goat = buildGoat(this.goatLayer);
  }

  destroy() {
    for (const g of [this.back, this.mid, this.goatLayer, this.front, this.fx]) g.remove();
  }

  render(goat: Frame, sets: ExtraSet[], clock: number, words: Record<string, string>) {
    renderGoat(this.goat, goat);
    for (const d of this.props.values()) d.seen = false;
    const particles: { p: Particle; a: number }[] = [];
    for (const set of sets) {
      for (const pf of set.frame.props) {
        const key = set.key + ":" + pf.key + ":" + pf.prop.type;
        let d = this.props.get(key);
        if (!d) {
          const parent = pf.prop.z === "back" ? this.back : pf.prop.z === "front" ? this.front : this.mid;
          d = buildProp(pf.prop.type, parent);
          this.props.set(key, d);
        }
        d.seen = true;
        updateProp(d, pf, set.alpha, goat, clock, words);
      }
      for (const p of set.frame.particles) particles.push({ p, a: set.alpha });
    }
    for (const [k, d] of this.props) if (!d.seen) {
      d.g.remove();
      this.props.delete(k);
    }
    // particles from a pool of paths
    while (this.pool.length < particles.length) this.pool.push(el("path", {}, this.fx));
    this.pool.forEach((node, i) => {
      const it = particles[i];
      if (!it) {
        if (node.getAttribute("visibility") !== "hidden") node.setAttribute("visibility", "hidden");
        return;
      }
      const { p, a } = it;
      const spec = PARTICLE[p.kind] || PARTICLE.sparkle;
      node.setAttribute("visibility", "visible");
      node.setAttribute("d", spec.d);
      node.setAttribute("fill", spec.fill(p.hue));
      if (spec.stroke) {
        node.setAttribute("stroke", spec.stroke);
        node.setAttribute("stroke-width", String((spec.sw || 0.6) / Math.max(0.3, p.size)));
      } else node.removeAttribute("stroke");
      node.setAttribute("opacity", String(f2(clamp(p.opacity * a, 0, 1))));
      node.setAttribute("transform", `translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(p.rot)}) scale(${f2(p.size)})`);
    });
  }
}
