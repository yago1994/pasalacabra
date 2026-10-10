// The goat as a still picture: for icons, the background goats and the share snapshot.
// A pose is a frame of one of the scenes, drawn by the same rig, standing at (0, 0).

import { Evaluator } from "./engine";
import { normalizeScene } from "./scene";
import { SCENES } from "./scenes";
import { buildGoat, renderGoat } from "./rig";

/** Named poses: [scene, time] plus optional fixed parameters. */
export const POSES: Record<string, { scene: string; t: number; set?: Record<string, number> }> = {
  happy: { scene: "rest", t: 0, set: { "mouth.smile": 0.9, "ears.perk": 0.5, "tail.up": 0.6 } },
  graze: { scene: "graze", t: 0.6 },
  rear: { scene: "balance", t: 1.0 },
  jump: { scene: "pronk", t: 0.3 },
  flip: { scene: "streak-3", t: 0.45 },
  sleep: { scene: "sleep", t: 0 },
  scratch: { scene: "scratch", t: 0.9 },
  stretch: { scene: "stretch", t: 0.75 },
  headbutt: { scene: "headbutt", t: 0.45 },
  cool: { scene: "rest", t: 0, set: { "gear.shades": 1, "mouth.smile": 1, "ears.perk": 0.6 } },
  king: { scene: "rest", t: 0, set: { "gear.shades": 1, "gear.crown": 1, "mouth.smile": 1, "ears.perk": 0.8 } },
};

/** The box a standing goat fits in (rig units). */
export const STILL_VIEWBOX = "-30 -62 64 66";

const cache = new Map<string, ReturnType<typeof normalizeScene>["scene"]>();
function sceneNamed(name: string) {
  let s = cache.get(name);
  if (!s) {
    s = normalizeScene(SCENES.find((x) => x.name === name) || SCENES[0]).scene;
    cache.set(name, s);
  }
  return s;
}

/** Draws a still goat into `parent` (an <svg> or <g>), replacing what was there. */
export function drawStill(parent: Element, pose = "happy") {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  const P = POSES[pose] || POSES.happy;
  const ev = new Evaluator(sceneNamed(P.scene), { n: 25, from: 0, to: 0, clock: 1.7 });
  const fr = ev.frame(P.t);
  for (const k in P.set || {}) fr.p[k] = P.set![k];
  fr.p["cabra.opacity"] = 1;
  fr.p["cabra.scale"] = 1;
  // stand at the origin; keep the pose's own height and lean
  fr.place = { x: 0, y: -Math.max(0, fr.p["cabra.alt"]) * 0.6, rot: fr.p["cabra.lean"] };
  fr.lag = { ear: 0, bell: 6, beard: 0, tail: 0 };
  const G = buildGoat(parent);
  renderGoat(G, fr);
  G.hit.remove();
  return G;
}

/** A still goat as a standalone SVG document string (for canvas drawing). */
export function stillSvgString(pose = "happy") {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", STILL_VIEWBOX);
  svg.setAttribute("width", "256");
  svg.setAttribute("height", "264");
  drawStill(svg, pose);
  return new XMLSerializer().serializeToString(svg);
}

let snapshotImg: HTMLImageElement | null = null;
let snapshotCanvas: HTMLCanvasElement | null = null;
let snapshotOk = false;
/**
 * The goat for canvas snapshots, rasterised ahead of time so drawing stays synchronous.
 * Returns null until it is ready, or if this browser would taint the snapshot canvas with it
 * (callers fall back to the emoji).
 */
export function snapshotGoat(): CanvasImageSource | null {
  if (typeof document === "undefined") return null;
  if (!snapshotImg) {
    snapshotImg = new Image();
    snapshotImg.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 264;
        c.getContext("2d")!.drawImage(snapshotImg!, 0, 0, 256, 264);
        c.toDataURL(); // throws if the SVG tainted the canvas
        snapshotCanvas = c;
        snapshotOk = true;
      } catch {
        snapshotOk = false;
      }
    };
    snapshotImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(stillSvgString("happy"));
  }
  return snapshotOk ? snapshotCanvas : null;
}
