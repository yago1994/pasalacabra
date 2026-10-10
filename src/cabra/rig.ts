// The goat, drawn in code: about 40 named parameters → SVG paths, every frame.
// Side view facing +x (clockwise round the ring). Local units: hooves at y = 0, up is −y,
// about 44 wide and 46 tall at scale 1, so it reads at ring size (~50 px on a phone).
//
// Outlines use the "silhouette" trick: each part is drawn once as a fat dark stroke and
// again as a plain fill on top, so overlapping shapes read as one outlined form.

import type { Frame } from "./engine";
import { DEG, clamp, lerp } from "./engine";

const NS = "http://www.w3.org/2000/svg";
export const COLORS = {
  ink: "#1B2033",
  fur: "#FFFDF7",
  shade: "#E6DDCC",
  patch: "#C98A4B",
  horn: "#E0CDA3",
  hornRidge: "#A88D5E",
  hoof: "#3A3340",
  pink: "#F2A9A0",
  iris: "#E9B645",
  collar: "#E2483D",
  bell: "#F6C744",
};
const OUT = 2.2; // outline width (each side ≈ 1.1)

const f2 = (n: number) => Math.round(n * 100) / 100;
export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

/* ---------------- Geometry ---------------- */

const BODY_D =
  "M-13,-30.5C-6,-33.6 6,-33.4 11.5,-30.8C16.2,-28.6 17.2,-20.5 14.2,-16.4C10.5,-13 -8,-12.8 -13,-14.8C-17.4,-16.8 -17.6,-28.4 -13,-30.5Z";
const PATCH_D = "M-10.5,-31.8C-4,-34.4 4.5,-34 8.6,-31.6C7.2,-27.4 1.6,-25.6 -3.4,-26.4C-7.4,-27 -10,-29 -10.5,-31.8Z";
const PIVOT_BACK = [-10, -17] as const; // rearing pivot (back hip)
const NECK_BASE = [9.5, -27] as const;
const BELLY = [0, -23] as const; // spin pivot

type LegDef = { hip: [number, number]; spread: number; front: boolean; near: boolean; L1: number; L2: number; w: [number, number, number] };
const LEGS: Record<string, LegDef> = {
  legFF: { hip: [7, -18], spread: 2.2, front: true, near: false, L1: 8.2, L2: 9.4, w: [5.6, 3.8, 3.3] },
  legBF: { hip: [-12, -18], spread: -2, front: false, near: false, L1: 8.4, L2: 9.6, w: [6.4, 3.9, 3.3] },
  legFN: { hip: [9.5, -17.5], spread: 0, front: true, near: true, L1: 8.2, L2: 9.4, w: [6, 4, 3.5] },
  legBN: { hip: [-9.6, -17.5], spread: 0, front: false, near: true, L1: 8.4, L2: 9.6, w: [6.8, 4.1, 3.5] },
};

function ik(hx: number, hy: number, tx: number, ty: number, L1: number, L2: number, side: number) {
  let dx = tx - hx, dy = ty - hy;
  let d = Math.hypot(dx, dy) || 0.001;
  const dc = clamp(d, Math.abs(L1 - L2) + 0.05, L1 + L2 - 0.05);
  dx = (dx / d) * dc;
  dy = (dy / d) * dc;
  d = dc;
  const al = Math.atan2(dy, dx);
  const a1 = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const ang = al + side * a1;
  const kx = hx + L1 * Math.cos(ang), ky = hy + L1 * Math.sin(ang);
  return { hx, hy, kx, ky, fx: hx + dx, fy: hy + dy };
}

/** Tapered two-segment limb as one closed path. */
function limbD(g: ReturnType<typeof ik>, w: [number, number, number]) {
  const a1 = Math.atan2(g.ky - g.hy, g.kx - g.hx), a2 = Math.atan2(g.fy - g.ky, g.fx - g.kx);
  const n1 = [-Math.sin(a1), Math.cos(a1)], n2 = [-Math.sin(a2), Math.cos(a2)];
  let ne = [n1[0] + n2[0], n1[1] + n2[1]];
  const m = Math.hypot(ne[0], ne[1]) || 1;
  ne = [ne[0] / m, ne[1] / m];
  const P = (x: number, y: number) => `${f2(x)},${f2(y)}`;
  const side = (s: number) => {
    const S = [g.hx + (s * n1[0] * w[0]) / 2, g.hy + (s * n1[1] * w[0]) / 2];
    const E = [g.kx + (s * ne[0] * w[1]) / 2, g.ky + (s * ne[1] * w[1]) / 2];
    const W = [g.fx + (s * n2[0] * w[2]) / 2, g.fy + (s * n2[1] * w[2]) / 2];
    const C = [2 * E[0] - (S[0] + W[0]) / 2, 2 * E[1] - (S[1] + W[1]) / 2];
    return { S, C, W };
  };
  const a = side(1), b = side(-1);
  return `M${P(a.S[0], a.S[1])}Q${P(a.C[0], a.C[1])} ${P(a.W[0], a.W[1])}L${P(b.W[0], b.W[1])}Q${P(b.C[0], b.C[1])} ${P(b.S[0], b.S[1])}Z`;
}

/* ---------------- DOM ---------------- */

type LegDom = { o: SVGPathElement; f: SVGPathElement; hoof: SVGGElement };
export type GoatDom = {
  root: SVGGElement;
  inner: SVGGElement; // spin + face scale
  legs: Record<string, LegDom>;
  body: SVGGElement;
  neckO: SVGPathElement;
  neckF: SVGPathElement;
  tail: SVGGElement;
  collar: SVGGElement;
  bell: SVGGElement;
  head: SVGGElement;
  jawO: SVGPathElement;
  jawF: SVGPathElement;
  mouth: SVGPathElement;
  eyeOpen: SVGGElement;
  eyeLid: SVGPathElement;
  eyeClosed: SVGPathElement;
  pupil: SVGRectElement;
  glint: SVGCircleElement;
  brow: SVGPathElement;
  blush: SVGEllipseElement;
  ear: SVGGElement;
  beard: SVGGElement;
  shades: SVGGElement;
  crown: SVGGElement;
  hit: SVGEllipseElement;
};

let uid = 0;

export function buildGoat(parent: Element): GoatDom {
  const id = `cabra${++uid}`;
  const root = el("g", { class: "cabra-goat" }, parent);
  const inner = el("g", {}, root);
  const C = COLORS;

  const leg = (color: string) => {
    const g = el("g", {}, inner);
    const o = el("path", { fill: C.ink, stroke: C.ink, "stroke-width": OUT, "stroke-linejoin": "round" }, g);
    const f = el("path", { fill: color }, g);
    const hoof = el("g", {}, g);
    el("path", { d: "M-2.3,-1.4L2.3,-1.4L2.6,1.6Q0,2.4 -2.6,1.6Z", fill: C.hoof, stroke: C.ink, "stroke-width": 0.9, "stroke-linejoin": "round" }, hoof);
    return { o, f, hoof } as LegDom;
  };
  const legs: Record<string, LegDom> = {};
  legs.legBF = leg(C.shade);
  legs.legFF = leg(C.shade);

  // Body (barrel + neck as one silhouette), tail behind it
  const body = el("g", {}, inner);
  const tail = el("g", {}, body);
  const tailD = "M0.6,0C-1.4,-2 -3.6,-5.6 -2.6,-9C-0.6,-7.6 1.6,-4.4 2.2,-0.6Z";
  el("path", { d: tailD, fill: C.ink, stroke: C.ink, "stroke-width": OUT, "stroke-linejoin": "round" }, tail);
  el("path", { d: tailD, fill: C.fur }, tail);
  const neckO = el("path", { fill: "none", stroke: C.ink, "stroke-width": 9.6 + OUT, "stroke-linecap": "round" }, body);
  el("path", { d: BODY_D, fill: C.ink, stroke: C.ink, "stroke-width": OUT, "stroke-linejoin": "round" }, body);
  el("path", { d: BODY_D, fill: C.fur }, body);
  const clip = el("clipPath", { id: id + "-body" }, body);
  el("path", { d: BODY_D }, clip);
  el("path", { d: PATCH_D, fill: C.patch, "clip-path": `url(#${id}-body)` }, body);
  el("path", { d: "M-12,-17C-4,-14.8 6,-14.8 12.6,-17.2", fill: "none", stroke: C.shade, "stroke-width": 2.4, "stroke-linecap": "round", opacity: 0.9 }, body);
  const neckF = el("path", { fill: "none", stroke: C.fur, "stroke-width": 9.6, "stroke-linecap": "round" }, body);

  legs.legBN = leg(C.fur);
  legs.legFN = leg(C.fur);

  // Collar and bell (positioned on the neck each frame)
  const collar = el("g", {}, inner);
  el("path", { d: "M0,-5.6L0,5.6", stroke: C.ink, "stroke-width": 3.6, "stroke-linecap": "round" }, collar);
  el("path", { d: "M0,-4.8L0,4.8", stroke: C.collar, "stroke-width": 2, "stroke-linecap": "round" }, collar);
  const bell = el("g", {}, collar);
  el("path", { d: "M-2.2,1.2C-2.2,-1.4 2.2,-1.4 2.2,1.2L2.9,4.4Q0,5.4 -2.9,4.4Z", fill: C.bell, stroke: C.ink, "stroke-width": 1, "stroke-linejoin": "round" }, bell);
  el("circle", { cx: 0, cy: 5.2, r: 0.9, fill: C.ink }, bell);
  el("path", { d: "M-1,0.2Q-0.6,-0.6 0.2,-0.7", fill: "none", stroke: "#fff", "stroke-width": 0.6, "stroke-linecap": "round", opacity: 0.8 }, bell);

  // Head (origin at the top of the neck)
  const head = el("g", {}, inner);
  const hornD = "M-3.2,-4.6C-4.6,-11.4 -9.4,-15.8 -14.6,-14.4C-13.4,-13.2 -12,-12.6 -10.6,-12.4C-6.4,-11.6 -3.4,-8.6 2.4,-5.4Z";
  const farHorn = el("g", { transform: "translate(2.4 -0.4)" }, head);
  el("path", { d: hornD, fill: C.hornRidge, stroke: C.ink, "stroke-width": 1.2, "stroke-linejoin": "round" }, farHorn);
  const skullD = "M-5.6,-1.6C-5.6,-6.4 -1.6,-7.6 1.4,-7.4C5.2,-7.2 7.4,-5 8.6,-2.2C10.4,-1.4 12.6,-0.2 12.6,2.2C12.6,4 11,5 8.8,4.8C6,4.6 3,4.4 0.6,3.6C-3.2,2.6 -5.6,1.6 -5.6,-1.6Z";
  const jawD = "M1.6,2.4C4.4,4.4 8,5.6 10.4,4.6C10.6,6.2 8.8,7.4 6.4,7.2C3.8,6.9 1.8,5.2 1.6,2.4Z";
  el("path", { d: skullD, fill: C.ink, stroke: C.ink, "stroke-width": OUT, "stroke-linejoin": "round" }, head);
  const jawO = el("path", { d: jawD, fill: C.ink, stroke: C.ink, "stroke-width": OUT, "stroke-linejoin": "round" }, head);
  el("path", { d: skullD, fill: C.fur }, head);
  const jawF = el("path", { d: jawD, fill: C.fur }, head);
  el("path", { d: "M9.6,-0.6C11.2,-0.6 12.4,0.6 12.4,2.2C12.4,3.6 11.2,4.4 9.8,4.2Z", fill: C.pink, opacity: 0.85 }, head);
  el("ellipse", { cx: 11.2, cy: 0.9, rx: 0.8, ry: 0.55, fill: C.ink, transform: "rotate(-20 11.2 0.9)" }, head);
  const mouth = el("path", { fill: "none", stroke: C.ink, "stroke-width": 0.9, "stroke-linecap": "round" }, head);
  const blush = el("ellipse", { cx: 5.6, cy: 1.2, rx: 2.2, ry: 1.2, fill: C.pink, opacity: 0 }, head);
  // Eye: gold iris with the horizontal goat pupil
  const eyeG = el("g", { transform: "translate(2.6 -2.4)" }, head);
  const eyeOpen = el("g", {}, eyeG);
  el("circle", { cx: 0, cy: 0, r: 2.75, fill: C.iris, stroke: C.ink, "stroke-width": 0.9 }, eyeOpen);
  const pupil = el("rect", { x: -1.7, y: -0.6, width: 3.4, height: 1.2, rx: 0.5, fill: C.ink }, eyeOpen);
  const glint = el("circle", { cx: 0.9, cy: -1.1, r: 0.6, fill: "#fff" }, eyeOpen);
  const eyeLid = el("path", { fill: C.fur, stroke: C.ink, "stroke-width": 0.9 }, eyeG);
  const eyeClosed = el("path", { fill: "none", stroke: C.ink, "stroke-width": 1.1, "stroke-linecap": "round" }, eyeG);
  const brow = el("path", { fill: "none", stroke: C.ink, "stroke-width": 1, "stroke-linecap": "round" }, head);
  const nearHorn = el("g", {}, head);
  el("path", { d: hornD, fill: C.horn, stroke: C.ink, "stroke-width": 1.2, "stroke-linejoin": "round" }, nearHorn);
  el("path", { d: "M-3.4,-8.2L-0.6,-6.8M-5.8,-10.8L-3.6,-9.2M-8.8,-12.6L-7.2,-11", fill: "none", stroke: C.hornRidge, "stroke-width": 0.9, "stroke-linecap": "round" }, nearHorn);
  const ear = el("g", {}, head);
  const earD = "M0,0C-3,-2.8 -7.4,-2.6 -9.4,-0.4C-7,1.4 -3.2,1.8 0,0.9Z";
  el("path", { d: earD, fill: C.fur, stroke: C.ink, "stroke-width": 1.1, "stroke-linejoin": "round" }, ear);
  el("path", { d: "M-1.4,0.2C-3.4,-0.9 -5.8,-0.9 -7.6,-0.2", fill: "none", stroke: C.pink, "stroke-width": 1, "stroke-linecap": "round" }, ear);
  const beard = el("g", {}, head);
  const beardD = "M0,0C1.4,2.4 1,5.2 -0.6,7.2C-1.4,5 -2.2,2.6 -1.6,0.2Z";
  el("path", { d: beardD, fill: C.shade, stroke: C.ink, "stroke-width": 1, "stroke-linejoin": "round" }, beard);

  // Streak gear: sunglasses over the eye (5 in a row) and a little gold crown (9 in a row).
  const shades = el("g", { visibility: "hidden" }, head);
  el("path", { d: "M-2.2,-3.6L6.4,-4.2M-2.2,-3.6L-4.8,-2.6", stroke: C.ink, "stroke-width": 1.1, "stroke-linecap": "round" }, shades);
  el("path", { d: "M-0.6,-4.4H6.6Q6.8,0.2 3.2,0.6Q-0.4,0.6 -0.6,-4.4Z", fill: "#1B2033", stroke: C.ink, "stroke-width": 0.8, "stroke-linejoin": "round" }, shades);
  el("path", { d: "M0.6,-3.4L2.2,-3.4M0.8,-2.2L1.6,-2.2", stroke: "#8FB4FF", "stroke-width": 0.8, "stroke-linecap": "round" }, shades);
  const crown = el("g", { visibility: "hidden" }, head);
  el("path", { d: "M-4,-7.2L-4.6,-12.4L-1.8,-9.8L0.4,-13.6L2.4,-9.8L5,-12.2L4.6,-7.2Z", fill: C.bell, stroke: C.ink, "stroke-width": 0.9, "stroke-linejoin": "round" }, crown);
  el("circle", { cx: 0.4, cy: -8.6, r: 0.9, fill: C.collar }, crown);
  el("circle", { cx: 0.4, cy: -13.8, r: 0.7, fill: "#fff", stroke: C.ink, "stroke-width": 0.5 }, crown);

  const hit = el("ellipse", { cx: 0, cy: -24, rx: 26, ry: 26, fill: "transparent" }, root);

  return { root, inner, legs, body, neckO, neckF, tail, collar, bell, head, jawO, jawF, mouth, eyeOpen, eyeLid, eyeClosed, pupil, glint, brow, blush, ear, beard, shades, crown, hit };
}

/* ---------------- Per-frame update ---------------- */

export function renderGoat(G: GoatDom, fr: Frame) {
  const p = fr.p;
  const s = p["cabra.scale"], face = p["cabra.face"];
  G.root.setAttribute("transform", `translate(${f2(fr.place.x)} ${f2(fr.place.y)}) rotate(${f2(fr.place.rot)}) scale(${f2(s)})`);
  G.root.setAttribute("opacity", String(f2(clamp(p["cabra.opacity"], 0, 1))));
  G.inner.setAttribute(
    "transform",
    `translate(0 ${BELLY[1]}) rotate(${f2(fr.spin * Math.sign(face || 1))}) translate(0 ${-BELLY[1]}) scale(${f2(face)} 1)`,
  );

  // Body transform: squash about the hooves, drop, rear about the back hip.
  const q = Math.max(0.4, p["body.squash"]), sx = 1 / Math.sqrt(q);
  const drop = p["body.drop"], rear = -p["body.rear"] * DEG;
  const cr = Math.cos(rear), sr = Math.sin(rear);
  const pv = [PIVOT_BACK[0] * sx, PIVOT_BACK[1] * q + drop];
  const B = (x: number, y: number) => {
    const X = x * sx, Y = y * q + drop;
    return [pv[0] + (X - pv[0]) * cr - (Y - pv[1]) * sr, pv[1] + (X - pv[0]) * sr + (Y - pv[1]) * cr];
  };
  // SVG matrix for B
  const m = [sx * cr, sx * sr, -q * sr, q * cr];
  const e = pv[0] - pv[0] * cr + (drop - pv[1]) * -sr + 0;
  const fy = pv[1] - pv[0] * sr + (drop - pv[1]) * cr;
  G.body.setAttribute("transform", `matrix(${f2(m[0])} ${f2(m[1])} ${f2(m[2])} ${f2(m[3])} ${f2(e)} ${f2(fy)})`);

  // Legs
  const tuck = clamp(p["legs.tuck"], 0, 1);
  for (const name in LEGS) {
    const L = LEGS[name];
    const [hx, hy] = B(L.hip[0], L.hip[1]);
    // Hooves gather toward the middle: a mountain goat balanced on a boulder.
    let tx = L.hip[0] + L.spread + (L.front ? -3 : 3.5) + p[name + ".x"], ty = -p[name + ".lift"];
    if (L.front && rear !== 0) {
      // front hooves rise with the body when rearing
      const dx = tx - pv[0], dy = ty - pv[1];
      const u = clamp(p["body.rear"] / 25, 0, 1);
      tx = lerp(tx, pv[0] + dx * cr - dy * sr, u);
      ty = lerp(ty, pv[1] + dx * sr + dy * cr, u);
    }
    tx = lerp(tx, hx + (L.front ? -2.5 : 3), tuck);
    ty = lerp(ty, hy + 6.5, tuck);
    const g = ik(hx, hy, tx, ty, L.L1, L.L2, L.front ? -1 : 1);
    const d = limbD(g, L.w);
    const dom = G.legs[name];
    dom.o.setAttribute("d", d);
    dom.f.setAttribute("d", d);
    const shin = Math.atan2(g.fy - g.ky, g.fx - g.kx) / DEG - 90;
    dom.hoof.setAttribute("transform", `translate(${f2(g.fx)} ${f2(g.fy)}) rotate(${f2(shin * 0.6)})`);
  }

  // Tail
  G.tail.setAttribute("transform", `translate(-15.6 -29) rotate(${f2(-15 - p["tail.up"] * 30 + p["tail.wag"] + fr.lag.tail)})`);

  // Neck: from the base on the body toward the head, swinging down to graze.
  const down = clamp(p["head.down"], -0.3, 1.2);
  const neckAng = lerp(-64, 62, down) * DEG;
  const neckLen = lerp(8.5, 12.5, clamp(down, 0, 1));
  const [nbx, nby] = B(NECK_BASE[0], NECK_BASE[1]);
  // body rotation from rearing also tilts the neck
  const na = neckAng + rear;
  const ntx = nbx + neckLen * Math.cos(na), nty = nby + neckLen * Math.sin(na);
  // The neck lives in body space for the silhouette; convert back through the inverse body transform.
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = (x: number, y: number) => {
    const X = x - e, Y = y - fy;
    return [(m[3] * X - m[2] * Y) / det, (-m[1] * X + m[0] * Y) / det];
  };
  const [a0x, a0y] = inv(nbx - 1.5 * Math.cos(na), nby - 1.5 * Math.sin(na));
  const [a1x, a1y] = inv(ntx, nty);
  const nd = `M${f2(a0x)},${f2(a0y)}L${f2(a1x)},${f2(a1y)}`;
  G.neckO.setAttribute("d", nd);
  G.neckF.setAttribute("d", nd);

  // Collar a third of the way up the neck, bell swinging from momentum.
  const cx = lerp(nbx, ntx, 0.38), cy = lerp(nby, nty, 0.38);
  G.collar.setAttribute("transform", `translate(${f2(cx)} ${f2(cy)}) rotate(${f2(na / DEG + 90)})`);
  const bellRot = -(na / DEG + 90) + fr.lag.bell + Math.sin(fr.t * 9) * 2 * Math.min(1, Math.abs(fr.lag.bell) / 20);
  G.bell.setAttribute("transform", `translate(0 4.6) rotate(${f2(bellRot)}) translate(0 0.2)`);

  // Head
  const headRot = p["head.tilt"] + down * 78 + rear / DEG;
  G.head.setAttribute("transform", `translate(${f2(ntx)} ${f2(nty)}) rotate(${f2(headRot)}) scale(1.22)`);
  const jaw = clamp(p["jaw.open"], 0, 1) * 26;
  const jt = `rotate(${f2(jaw)} 1.8 2.6)`;
  G.jawO.setAttribute("transform", jt);
  G.jawF.setAttribute("transform", jt);
  const sm = clamp(p["mouth.smile"], -1, 1);
  G.mouth.setAttribute("d", `M7.2,${f2(3.8 + sm * 0.2)}Q9.4,${f2(4.4 + sm * 1.6)} 11,${f2(3.6 - sm * 0.6)}`);
  G.mouth.setAttribute("opacity", jaw > 8 ? "0" : "1");
  G.blush.setAttribute("opacity", String(f2(clamp(p["face.blush"], 0, 1) * 0.8)));

  const open = clamp(p["eyes.open"], 0, 1.2), happy = clamp(p["eyes.happy"], 0, 1);
  const closed = open < 0.18 || happy > 0.5;
  G.eyeOpen.setAttribute("visibility", closed ? "hidden" : "visible");
  G.eyeClosed.setAttribute("visibility", closed ? "visible" : "hidden");
  G.eyeClosed.setAttribute("d", happy > 0.5 ? "M-2.4,0.8Q0,-2.2 2.4,0.8" : "M-2.4,-0.2Q0,1.8 2.4,-0.2");
  const look = clamp(p["eyes.look"], -1, 1), up = clamp(p["eyes.up"], -1, 1);
  G.pupil.setAttribute("x", String(f2(-1.7 + look * 0.8)));
  G.pupil.setAttribute("y", String(f2(-0.6 - up * 0.8)));
  G.glint.setAttribute("cx", String(f2(0.9 + look * 0.5)));
  // upper lid comes down as eyes.open drops; sad brows push it down too
  const lid = closed ? 0 : clamp(1 - open + p["brows.sad"] * 0.25, 0, 1);
  if (lid > 0.04) {
    const yb = -2.9 + lid * 5;
    G.eyeLid.setAttribute("d", `M-3,-0.4C-3,-3.4 3,-3.4 3,-0.4L3,${f2(Math.min(0, yb))}Q0,${f2(yb + 0.8)} -3,${f2(Math.min(0, yb))}Z`);
    G.eyeLid.setAttribute("visibility", "visible");
  } else G.eyeLid.setAttribute("visibility", "hidden");
  const sad = clamp(p["brows.sad"], -1, 1);
  G.brow.setAttribute("d", `M0.6,${f2(-6.6 + sad * 1.2)}Q2.6,${f2(-7.4 - sad * 0.2)} 4.8,${f2(-6.8 - sad * 1)}`);

  const perk = clamp(p["ears.perk"], -1.5, 1.5);
  G.ear.setAttribute("transform", `translate(-2.6 -2.6) rotate(${f2(perk * 32 - fr.lag.ear - Math.max(0, -perk) * 10)})`);
  G.beard.setAttribute("transform", `translate(6.4 6.2) rotate(${f2(fr.lag.beard + jaw * 0.6)})`);
  const gear = (g: SVGGElement, v: number, dy: number) => {
    const u = clamp(v, 0, 1);
    g.setAttribute("visibility", u > 0.02 ? "visible" : "hidden");
    // drops into place from above as it appears
    g.setAttribute("transform", `translate(0 ${f2((1 - u) * dy)})`);
    g.setAttribute("opacity", String(f2(Math.min(1, u * 2))));
  };
  gear(G.shades, p["gear.shades"], -14);
  gear(G.crown, p["gear.crown"], -18);
}
