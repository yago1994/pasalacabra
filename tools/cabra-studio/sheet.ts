// Dev-only contact sheet: ?scene=hop&dist=1&from=0&n=12&zoom=1&cols=6&w=160
// Renders n frames of a scene side by side so a whole sequence fits in one screenshot.
import { Evaluator, RING, letterCenter } from "../../src/cabra/engine";
import { normalizeScene } from "../../src/cabra/scene";
import { SCENES } from "../../src/cabra/scenes";
import { CabraStage, WORDS } from "../../src/cabra/stage";
import { el } from "../../src/cabra/rig";

const q = new URLSearchParams(location.search);
const name = q.get("scene") || "rest";
const N = 25;
const from = +(q.get("from") || 0);
const dist = +(q.get("dist") || 0);
const count = +(q.get("n") || 12);
const zoom = q.get("zoom") !== "0";
const w = +(q.get("w") || 150);
document.documentElement.style.setProperty("--cols", q.get("cols") || "6");
const raw = SCENES.find((s) => s.name === name) || SCENES[0];
const { scene } = normalizeScene(raw);
const grid = document.getElementById("grid")!;
for (let i = 0; i < count; i++) {
  const t = count === 1 ? +(q.get("t") || 0) : (scene.duration * i) / (count - 1);
  const ev = new Evaluator(scene, { n: N, from, to: (from + dist) % N, clock: 1.7 });
  const fr = ev.frame(t);
  const cell = document.createElement("div");
  cell.className = "cell";
  const svg = el("svg", {}, cell);
  const back = el("g", {}, svg), letters = el("g", {}, svg), front = el("g", {}, svg);
  for (let k = 0; k < N; k++) {
    const c = letterCenter(k, N);
    el("circle", { cx: c.x, cy: c.y, r: RING.nodeR, fill: k === from ? "#00d4ff" : "#4f8dff" }, letters);
  }
  const st = new CabraStage(back, front);
  st.render(fr, [{ frame: fr, alpha: 1, key: "k" }], 1.7, WORDS.es);
  const cx = zoom ? fr.place.x : 200, cy = zoom ? fr.place.y : 200;
  const r = zoom ? w / 2 : 260;
  svg.setAttribute("viewBox", `${cx - r} ${cy - r - (zoom ? 18 : 0)} ${2 * r} ${2 * r}`);
  const lab = document.createElement("span");
  lab.textContent = `${name} ${t.toFixed(2)}s`;
  cell.appendChild(lab);
  grid.appendChild(cell);
}
