// Cabra Studio: the game's own goat engine, director and scenes, in a workbench.
// Built into one self-contained HTML file by build.mjs.
// The claude.ai capability objects (sample, db, user, downloads) are untyped here.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Director } from "../../src/cabra/director";
import type { GameInputs, Phase } from "../../src/cabra/director";
import { Evaluator, RING, letterCenter } from "../../src/cabra/engine";
import { normalizeScene, sceneToJSON } from "../../src/cabra/scene";
import type { NormalizedScene, Scene } from "../../src/cabra/scene";
import { SCENES, SLOTS } from "../../src/cabra/scenes";
import { SPEC } from "../../src/cabra/spec";
import { playSound } from "../../src/cabra/sounds";
import { CabraStage, WORDS } from "../../src/cabra/stage";
import { buildGoat, el, renderGoat } from "../../src/cabra/rig";

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<any> };
  }
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", "N", "Ñ", "O", "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z"];
const N = LETTERS.length;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

/* ---------------- Sound and language ---------------- */

let lang = store.get("cabra-studio:lang") === "en" ? "en" : "es";
let audio: AudioContext | null = null;
let soundOn = false;
function sound(name: string, opts: { pitch?: number; gain?: number } = {}) {
  if (!soundOn || !audio) return;
  playSound(audio, name, opts);
}
$("soundBtn").onclick = () => {
  soundOn = !soundOn;
  if (soundOn && !audio) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio = Ctx ? new Ctx() : null;
  }
  void audio?.resume();
  $("soundBtn").textContent = soundOn ? "Sound on" : "Sound off";
  $("soundBtn").setAttribute("aria-pressed", String(soundOn));
  if (soundOn) sound("pasalacabra");
};
function syncLang() {
  document.querySelectorAll<HTMLButtonElement>("#langSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
}
document.querySelectorAll<HTMLButtonElement>("#langSeg button").forEach((b) => (b.onclick = () => {
  lang = b.dataset.lang === "en" ? "en" : "es";
  store.set("cabra-studio:lang", lang);
  syncLang();
}));
syncLang();

/* ---------------- Stage ---------------- */


const stage = new CabraStage($("ringBack"), $("ringFront"));
const letterNodes = LETTERS.map((L, i) => {
  const { x, y } = letterCenter(i, N);
  const g = el("g", { style: "cursor:pointer" }, $("letters"));
  const c = el("circle", { cx: x, cy: y, r: RING.nodeR, opacity: 0.95 }, g);
  const o = el("circle", { cx: x, cy: y, r: RING.nodeR, fill: "transparent", "stroke-width": 2 }, g);
  const t = el("text", { x, y: y + 6, "text-anchor": "middle", "font-size": 16, "font-weight": 800, fill: "rgba(255,255,255,0.98)", "font-family": "system-ui, sans-serif" }, g);
  t.textContent = L;
  g.addEventListener("click", () => onLetterClick(i));
  return { c, o };
});
const FILL: Record<string, string> = { pending: "#4f8dff", current: "#00d4ff", passed: "#4f8dff", correct: "#2bb673", wrong: "#ff4d4d" };
function drawLetters(statuses: readonly string[], current: number) {
  letterNodes.forEach((n, i) => {
    const st = i === current && (statuses[i] === "pending" || statuses[i] === "passed" || statuses[i] === "current") ? "current" : statuses[i];
    n.c.setAttribute("fill", FILL[st] || FILL.pending);
    n.o.setAttribute("stroke", st === "current" ? "#fff" : "rgba(255,255,255,0.35)");
  });
}
stage.goat.root.style.cursor = "pointer";
stage.goat.hit.addEventListener("click", (e) => {
  e.stopPropagation();
  if (mode === "game") {
    director.poke();
    logLine("poke");
  }
});

/* Header mark: a still goat drawn by the same rig. */
(() => {
  const m = $("markSvg") as unknown as SVGSVGElement;
  const G = buildGoat(m);
  const { scene } = normalizeScene({ name: "mark", duration: 1, idle: { breathe: 0, blink: false, ears: false, tail: false }, tracks: { "mouth.smile": [[0, 0.8]], "ears.perk": [[0, 0.4]], "tail.up": [[0, 0.6]] } });
  const fr = new Evaluator(scene, { n: N, from: 0, to: 0, clock: 0 }).frame(0);
  fr.place = { x: 1, y: 6, rot: 0 };
  renderGoat(G, fr);
})();

/* ---------------- Director (game mode) ---------------- */

const director = new Director();
director.reducedMotion = reduced;
director.onSound = (name, opts) => sound(name, opts);

const sim = {
  statuses: LETTERS.map(() => "pending"),
  index: 0,
  phase: "idle" as Phase,
  gameOver: false,
  timeLeft: 240,
  timers: [] as number[],
};
function nextUnresolved(from: number) {
  for (let o = 1; o <= N; o++) {
    const i = (from + o) % N;
    if (sim.statuses[i] === "pending" || sim.statuses[i] === "passed" || sim.statuses[i] === "current") return i;
  }
  return -1;
}
function push() {
  // Mirror the app: exactly one "current".
  sim.statuses = sim.statuses.map((s, i) => (s === "current" && i !== sim.index ? "pending" : s));
  if (sim.statuses[sim.index] !== "correct" && sim.statuses[sim.index] !== "wrong") sim.statuses[sim.index] = "current";
  const inp: GameInputs = { n: N, index: sim.index, statuses: [...sim.statuses], phase: sim.phase, gameOver: sim.gameOver, timeLeft: sim.timeLeft };
  director.update(inp);
  if (mode === "game") drawLetters(sim.statuses, sim.index);
  syncGameButtons();
}
const later = (ms: number, fn: () => void) => sim.timers.push(window.setTimeout(fn, ms));
function ensurePlaying() {
  if (sim.phase !== "playing" && !sim.gameOver) {
    sim.phase = "playing";
    push();
  }
}
function logLine(s: string) {
  $("gLog").textContent = s;
}
function finish() {
  sim.phase = "ended";
  sim.gameOver = true;
  push();
}
$("gStart").onclick = () => {
  if (sim.gameOver) return;
  sim.phase = "playing";
  push();
};
$("gCorrect").onclick = () => {
  if (sim.gameOver) return;
  ensurePlaying();
  const i = sim.index;
  sim.statuses[i] = "correct";
  push();
  later(2100, () => {
    const nx = nextUnresolved(i);
    if (nx === -1) return finish();
    sim.index = nx;
    push();
  });
};
$("gWrong").onclick = () => {
  if (sim.gameOver) return;
  ensurePlaying();
  const i = sim.index;
  sim.statuses[i] = "wrong";
  push();
  const multi = ($("gMulti") as HTMLInputElement).checked;
  later(multi ? 2600 : 3200, () => {
    const nx = nextUnresolved(i);
    if (nx === -1) return finish();
    sim.index = nx;
    if (multi) sim.phase = "ended";
    push();
  });
};
$("gPasa").onclick = () => {
  if (sim.gameOver) return;
  ensurePlaying();
  const i = sim.index;
  sim.statuses[i] = "passed";
  const nx = nextUnresolved(i);
  if (nx !== -1) sim.index = nx;
  if (($("gMulti") as HTMLInputElement).checked) sim.phase = "ended";
  push();
};
$("gEnd").onclick = () => {
  if (sim.phase !== "playing") return;
  sim.phase = "ended";
  push();
};
$("gNew").onclick = () => {
  sim.timers.forEach(clearTimeout);
  sim.timers = [];
  sim.statuses = LETTERS.map(() => "pending");
  sim.index = 0;
  sim.phase = "idle";
  sim.gameOver = false;
  sim.timeLeft = 240;
  push();
};
let lastSecond = -1;
$("gLast10").onclick = () => {
  if (sim.gameOver) return;
  sim.timeLeft = Math.min(sim.timeLeft, 12);
  ensurePlaying();
  push();
};
$("gAlmost").onclick = () => {
  if (sim.gameOver) return;
  sim.statuses = sim.statuses.map((_, i) => (i === sim.index ? "current" : "correct"));
  push();
};
function onLetterClick(i: number) {
  if (mode === "scene") {
    ($("startLetter") as HTMLSelectElement).value = String(i);
    loadPlayer();
    return;
  }
  if (sim.gameOver || i === sim.index) return;
  sim.index = i;
  push();
}
function syncGameButtons() {
  const over = sim.gameOver;
  for (const id of ["gCorrect", "gWrong", "gPasa", "gAlmost"]) ($(id) as HTMLButtonElement).disabled = over;
  ($("gStart") as HTMLButtonElement).disabled = over || sim.phase === "playing";
  ($("gEnd") as HTMLButtonElement).disabled = sim.phase !== "playing";
}

/* ---------------- Scene player ---------------- */

let mode: "game" | "scene" = "game";
type Source = { kind: "app" | "draft" | "saved" | "edit"; id: string };
const player = {
  scene: null as NormalizedScene | null,
  source: null as Source | null,
  warnings: [] as string[],
  t: 0,
  playing: !reduced,
  speed: 1,
  ev: null as Evaluator | null,
  evId: 0,
  lastCue: -1,
};

function setMode(m: "game" | "scene") {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  $("gamePane").hidden = m !== "game";
  $("scenePane").hidden = m !== "scene";
  if (m === "game") {
    drawLetters(sim.statuses, sim.index);
    push();
  } else loadPlayer();
}
document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode === "scene" ? "scene" : "game")));

const startSel = $("startLetter") as HTMLSelectElement;
LETTERS.forEach((L, i) => startSel.add(new Option(L, String(i))));
startSel.value = "0";
startSel.onchange = () => loadPlayer();

function defaultDistance(s: NormalizedScene) {
  if (s.group !== "move") return 0;
  if (s.name.includes("mountain")) return 3;
  if (s.name.includes("pasa")) return 1;
  if (s.name.includes("leap")) return 9;
  return 1;
}

/** (Re)build the evaluator for the scene in the player with the chosen letters. */
function loadPlayer() {
  const s = player.scene;
  if (!s) return;
  const from = +startSel.value;
  const dist = +($("dist") as HTMLInputElement).value;
  const to = (from + dist) % N;
  player.ev = new Evaluator(s, { n: N, from, to, clock: 0 });
  player.evId++;
  ($("scrub") as HTMLInputElement).max = String(s.duration);
  $("distVal").textContent = String(dist);
  if (mode === "scene") {
    // Letters the goat skips over read as already answered, like in a real game.
    const st = LETTERS.map((_, i) => {
      const d = (i - from + N) % N;
      return d > 0 && d < dist ? (i % 4 === 1 ? "wrong" : "correct") : "pending";
    });
    drawLetters(st, from);
  }
  $("nowName").textContent = s.name;
  $("nowDesc").textContent = s.description;
}

function loadScene(raw: unknown, source: Source | null, opts: { distance?: number } = {}) {
  let res;
  try {
    res = normalizeScene(raw);
  } catch (e) {
    showJsonNote((e as Error).message, true);
    return false;
  }
  player.scene = res.scene;
  player.warnings = res.warnings;
  player.source = source;
  player.t = 0;
  player.lastCue = -1;
  ($("dist") as HTMLInputElement).value = String(opts.distance ?? defaultDistance(res.scene));
  ($("jsonBox") as HTMLTextAreaElement).value = JSON.stringify(sceneToJSON(res.scene), null, 2);
  const wl = $("warnList");
  wl.innerHTML = "";
  wl.hidden = !res.warnings.length;
  res.warnings.forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    wl.appendChild(li);
  });
  ($("saveName") as HTMLInputElement).value = res.scene.name;
  store.set("cabra-studio:current:v1", JSON.stringify(sceneToJSON(res.scene)));
  if (mode !== "scene") setMode("scene");
  else loadPlayer();
  renderLibrary();
  syncTransport();
  return true;
}
$("dist").addEventListener("input", () => {
  player.t = 0;
  player.lastCue = -1;
  loadPlayer();
});

const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>';
function syncTransport() {
  $("playBtn").innerHTML = player.playing ? ICON_PAUSE : ICON_PLAY;
  $("playBtn").setAttribute("aria-label", player.playing ? "Pause" : "Play");
}
$("playBtn").onclick = () => {
  const s = player.scene;
  if (s && !player.playing && player.t >= s.duration - 0.01) {
    player.t = 0;
    player.lastCue = -1;
  }
  player.playing = !player.playing;
  syncTransport();
};
$("scrub").addEventListener("input", () => {
  player.t = +($("scrub") as HTMLInputElement).value;
  player.lastCue = player.t;
  player.playing = false;
  syncTransport();
});
document.querySelectorAll<HTMLButtonElement>("#speedSeg button").forEach((b) => (b.onclick = () => {
  player.speed = +(b.dataset.speed || 1);
  document.querySelectorAll<HTMLButtonElement>("#speedSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));

/* ---------------- Main loop ---------------- */

let last = performance.now();
let clock = 0;
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  const words = WORDS[lang];
  if (mode === "game") {
    const { goat, sets } = director.frame(now / 1000);
    stage.render(goat, sets, clock, { ...words, ...director.words });
    if (sim.phase === "playing" && sim.timeLeft > 0) sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    const tl = Math.ceil(sim.timeLeft);
    if (tl !== lastSecond) {
      lastSecond = tl;
      if (sim.phase === "playing" && tl === 0) sim.phase = "idle"; // ¡Tiempo!, like the app
      push();
    }
    $("timer").textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, "0")}`;
    const st = director.status;
    if (st) {
      const nm = $("nowName"), ds = $("nowDesc");
      if (nm.textContent !== st.scene) {
        nm.textContent = st.scene;
        ds.textContent = director.library.get(st.scene)?.description || "";
      }
      const q = st.queue.length ? `  ·  next: ${st.queue.join(" → ")}` : "";
      const where = st.from === st.to ? LETTERS[st.from] : `${LETTERS[st.from]} → ${LETTERS[st.to]}`;
      const streak = director.streak >= 2 ? `  ·  streak ${director.streak}` : "";
      logLine(`${st.kind} · ${st.scene} at ${where}${q}${streak}`);
    }
  } else if (player.scene && player.ev) {
    const s = player.scene;
    if (player.playing) {
      player.t += dt * player.speed;
      if (player.t >= s.duration) {
        if (($("repeat") as HTMLInputElement).checked || s.loop) {
          player.t = 0;
          player.lastCue = -1;
        } else {
          player.t = s.duration;
          player.playing = false;
          syncTransport();
        }
      }
    }
    for (const c of s.cues) if (player.playing && c.t > player.lastCue && c.t <= player.t) sound(c.sound, { pitch: c.pitch, gain: c.gain });
    player.lastCue = player.t;
    player.ev.ctx.clock = clock;
    const fr = player.ev.frame(player.t);
    stage.render(fr, [{ frame: fr, alpha: 1, key: "p" + player.evId }], clock, { ...words, streak: "5" });
    ($("scrub") as HTMLInputElement).value = String(player.t);
    $("timeLbl").textContent = `${player.t.toFixed(2)} / ${s.duration.toFixed(2)} s`;
  }
  requestAnimationFrame(tick);
}

/* ---------------- Library ---------------- */

const state = { drafts: [] as { id: string; scene: Scene; prompt: string }[], saved: [] as { id: string; scene: Scene; prompt: string }[], savedLoaded: false };
const slotsOf = (name: string) => Object.entries(SLOTS).filter(([, v]) => v.includes(name)).map(([k]) => k);
const SLOT_LABEL: Record<string, string> = {
  rest: "resting", wait: "waiting to start", sleep: "turn over", proud: "after a perfect game", hop: "1 letter", mountain: "2–4 letters",
  leap: "5+ letters", correct: "✓", wrong: "✗", pasaHop: "Pasalacabra", appear: "new game", start: "Empezar", turnEnd: "end of turn", antsy: "last 10 seconds", streak3: "3 in a row", streak5: "5 in a row",
  streak9: "9 in a row", streakMega: "12, 15, 18… in a row", timeUp: "time’s up",
  victory: "perfect game", gameOver: "game over", poke: "tap", moment: "idle", waitMoment: "idle before start",
};
function sceneRow(item: { id: string; scene: Scene; prompt?: string }, kind: Source["kind"]) {
  const row = document.createElement(kind === "saved" ? "div" : "button");
  row.className = "scene-row";
  if (kind === "saved") {
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
  }
  const cur = player.source && player.source.kind === kind && player.source.id === item.id;
  row.setAttribute("aria-current", String(!!cur));
  const left = document.createElement("div");
  left.style.minWidth = "0";
  const nm = document.createElement("div");
  nm.className = "nm";
  nm.textContent = item.scene.name;
  const ds = document.createElement("div");
  ds.className = "ds";
  ds.textContent = item.scene.description || item.prompt || "";
  left.append(nm, ds);
  const meta = document.createElement("div");
  meta.className = "meta";
  if (kind === "app") for (const s of slotsOf(item.scene.name).slice(0, 2)) {
    const sp = document.createElement("span");
    sp.className = "slot";
    sp.textContent = SLOT_LABEL[s] || s;
    meta.appendChild(sp);
  }
  const dur = document.createElement("span");
  dur.textContent = `${(+item.scene.duration || 0).toFixed(1)}s`;
  meta.appendChild(dur);
  row.append(left, meta);
  const open = () => loadScene(item.scene, { kind, id: item.id });
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") open();
  });
  if (kind === "saved" && canWrite && db) {
    const del = document.createElement("button");
    del.className = "btn small";
    del.textContent = "Delete";
    let armed = false;
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        del.textContent = "Confirm delete";
        setTimeout(() => { armed = false; del.textContent = "Delete"; }, 4000);
        return;
      }
      del.disabled = true;
      try { await db.collection("scenes").doc(item.id).delete(); } catch { del.disabled = false; del.textContent = "Couldn’t delete"; }
    };
    meta.appendChild(del);
  }
  return row;
}
const GROUPS: [string, string][] = [["Game events and streaks", "event"], ["Moving between letters", "move"], ["Idle moments", "moment"], ["Resting", "rest"], ["Tapped", "reaction"]];
function renderLibrary() {
  const al = $("appList");
  al.innerHTML = "";
  for (const [title, g] of GROUPS) {
    const items = SCENES.filter((s) => s.group === g);
    if (!items.length) continue;
    const h = document.createElement("div");
    h.className = "lib-group";
    h.textContent = title;
    al.appendChild(h);
    items.forEach((s) => al.appendChild(sceneRow({ id: s.name, scene: s }, "app")));
  }
  const dl = $("draftList");
  dl.innerHTML = "";
  if (!state.drafts.length) dl.innerHTML = '<div class="empty">Scenes you generate appear here until you save them.</div>';
  else state.drafts.slice().reverse().forEach((d) => dl.appendChild(sceneRow(d, "draft")));
  const sl = $("savedList");
  sl.innerHTML = "";
  if (!db) sl.innerHTML = '<div class="empty">Saving needs the shared library, which isn’t available in this view.</div>';
  else if (!state.savedLoaded) sl.innerHTML = '<div class="empty">Loading saved scenes…</div>';
  else if (!state.saved.length) sl.innerHTML = '<div class="empty">Nothing saved yet. Generate or edit a scene, name it above and press Save.</div>';
  else state.saved.forEach((s) => sl.appendChild(sceneRow(s, "saved")));
}

/* ---------------- Tabs, JSON, spec ---------------- */

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
}));
function showJsonNote(msg: string, bad = false) {
  const n = $("jsonNote");
  n.textContent = msg;
  n.style.color = bad ? "var(--bad)" : "";
}
$("applyBtn").onclick = () => {
  let raw;
  try { raw = JSON.parse(($("jsonBox") as HTMLTextAreaElement).value); } catch (e) { showJsonNote("That isn’t valid JSON: " + (e as Error).message, true); return; }
  if (loadScene(raw, player.source ? { ...player.source } : { kind: "edit", id: "edit" }, { distance: +($("dist") as HTMLInputElement).value }))
    showJsonNote(player.warnings.length ? `Applied with ${player.warnings.length} note${player.warnings.length > 1 ? "s" : ""}.` : "Applied.");
};
async function copyText(text: string, done: (m: string) => void, fallback?: HTMLTextAreaElement) {
  try { await navigator.clipboard.writeText(text); done("Copied."); }
  catch { if (fallback) { fallback.focus(); fallback.select(); } done("Copy was blocked. The text is selected, so press ⌘C."); }
}
$("copyBtn").onclick = () => player.scene && copyText(JSON.stringify(sceneToJSON(player.scene), null, 2), showJsonNote, $("jsonBox") as HTMLTextAreaElement);
$("specText").textContent = SPEC;
$("copySpecBtn").onclick = () => copyText(SPEC, (m) => ($("copySpecBtn").textContent = m === "Copied." ? "Copied" : "Copy spec"));

const slotSel = $("slotSel") as HTMLSelectElement;
for (const s of ["correct", "streak3", "streak5", "streak9", "streakMega", "wrong", "pasaHop", "hop", "mountain", "leap", "antsy", "start", "turnEnd", "timeUp", "victory", "poke", "moment"]) slotSel.add(new Option(SLOT_LABEL[s], s));
$("slotBtn").onclick = () => {
  if (!player.scene) return;
  const scene = director.addScene(sceneToJSON(player.scene));
  director.overrides[slotSel.value] = scene.name;
  $("slotNote").textContent = `The game now plays “${scene.name}” for ${SLOT_LABEL[slotSel.value]}. Switch to Play the game to try it.`;
};

/* ---------------- Claude ---------------- */

let sample: any = null, db: any = null, user: any = null, downloads: any = null, canWrite = false;
let ctl: AbortController | null = null;
let genMode: "new" | "revise" = "new";
const HINT: Record<string, string> = {
  quick: "Fast usually answers in about 10 seconds; scenes come out simpler.",
  default: "Balanced usually takes 20–60 seconds.",
  complex: "Best thinks longest and can take a couple of minutes.",
};
function setStatus(kind: "busy" | "ok" | "warn" | "idle", text: string) {
  const s = $("genStatus");
  s.innerHTML = "";
  if (kind === "busy") { const d = document.createElement("span"); d.className = "dot"; s.appendChild(d); }
  const p = document.createElement("span");
  p.className = "pill " + (kind === "idle" ? "" : kind);
  p.textContent = { busy: "Working", ok: "Done", warn: "Problem", idle: "Ready" }[kind];
  const tx = document.createElement("span");
  tx.textContent = text;
  s.append(p, tx);
}
($("tier") as HTMLSelectElement).onchange = () => { if (!ctl) setStatus("idle", HINT[($("tier") as HTMLSelectElement).value]); };
document.querySelectorAll<HTMLButtonElement>("#genModeSeg button").forEach((b) => (b.onclick = () => {
  genMode = b.dataset.mode === "revise" ? "revise" : "new";
  document.querySelectorAll<HTMLButtonElement>("#genModeSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
const CHIPS = [
  "On ✓ the goat headbutts the letter, which bounces, then it eats a carrot that pops out",
  "Pasalacabra: a backflip off the letter with a cape that flutters",
  "Idle: the goat rings its own bell with a hind hoof and listens to it",
  "Move to the next letter on a pogo stick",
  "Wrong answer: it slips on a banana peel and lands on its back",
  "Idle: yodels from the top of a tiny mountain that pops up under it",
];
CHIPS.forEach((c) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = c;
  b.onclick = () => { ($("prompt") as HTMLTextAreaElement).value = c; };
  $("chips").appendChild(b);
});
function buildPrompt(instruction: string) {
  const ref = SCENES.find((s) => s.name === "graze");
  const ref2 = SCENES.find((s) => s.name === "mountain");
  let out = SPEC + "\n\nEXAMPLE SCENES (format and quality reference):\n" + JSON.stringify(ref) + "\n" + JSON.stringify(ref2);
  if (genMode === "revise" && player.scene) out += "\n\nCURRENT SCENE:\n" + JSON.stringify(sceneToJSON(player.scene)) + "\n\nRevise the current scene as requested below. Keep everything the request doesn’t mention. Return the complete revised scene.\nREQUEST: " + instruction;
  else out += "\n\nREQUEST: " + instruction;
  return out;
}
const ERR: Record<string, string> = {
  rate_limited: "Too many requests right now. Wait a minute, then try again.",
  invalid_json: "Claude’s reply wasn’t a valid scene. The raw reply is in the JSON tab; try again or simplify the request.",
  refused: "Claude declined this request. Try rewording it.",
  session_expired: "Your session expired. Sign in again to keep generating.",
  empty_completion: "Claude returned nothing. Try a simpler request.",
  prompt_too_large: "The current scene is too large to revise. Start a new scene instead.",
};
function disableGeneration() {
  sample = null;
  ($("genBtn") as HTMLButtonElement).disabled = true;
  $("noClaude").hidden = false;
  setStatus("idle", "Generation unavailable.");
}
async function generate() {
  const instruction = ($("prompt") as HTMLTextAreaElement).value.trim();
  if (!instruction) { setStatus("warn", "Describe the scene first."); $("prompt").focus(); return; }
  if (!sample) return;
  ctl = new AbortController();
  ($("genBtn") as HTMLButtonElement).disabled = true;
  $("stopBtn").hidden = false;
  setStatus("busy", "Thinking through the choreography…");
  try {
    const tier = ($("tier") as HTMLSelectElement).value;
    const raw = await sample.json(buildPrompt(instruction), {
      signal: ctl.signal, modelTier: tier, cache: false,
      onText: ({ text }: { text: string }) => setStatus("busy", `Writing the scene · ${text.length.toLocaleString()} characters`),
    });
    const id = "d" + Date.now();
    if (loadScene(raw, { kind: "draft", id })) {
      state.drafts.push({ id, scene: sceneToJSON(player.scene!), prompt: instruction });
      renderLibrary();
      player.playing = true;
      syncTransport();
      const n = player.warnings.length;
      setStatus(n ? "warn" : "ok", n ? `Loaded “${player.scene!.name}” with ${n} note${n > 1 ? "s" : ""}. See the JSON tab.` : `Loaded “${player.scene!.name}”. It’s in Drafts until you save it.`);
    } else setStatus("warn", "Claude’s reply couldn’t be read as a scene. Try again.");
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "cancelled") setStatus("idle", "Stopped.");
    else if (code && ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) disableGeneration();
    else {
      const text = (e as { text?: string })?.text;
      if (code === "invalid_json" && text) ($("jsonBox") as HTMLTextAreaElement).value = text;
      setStatus("warn", (code && ERR[code]) || "Something went wrong reaching Claude. Try again.");
    }
  } finally {
    ctl = null;
    ($("genBtn") as HTMLButtonElement).disabled = !sample;
    $("stopBtn").hidden = true;
  }
}
$("genBtn").onclick = generate;
$("stopBtn").onclick = () => ctl?.abort();
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); });

$("saveBtn").onclick = async () => {
  if (!db || !player.scene) return;
  const name = ($("saveName") as HTMLInputElement).value.trim() || player.scene.name;
  const s = sceneToJSON(player.scene);
  s.name = name;
  ($("saveBtn") as HTMLButtonElement).disabled = true;
  $("saveNote").textContent = "Saving…";
  try {
    const draft = player.source?.kind === "draft" ? state.drafts.find((d) => d.id === player.source!.id) : null;
    const ref = await db.collection("scenes").add({ name, scene: s, prompt: draft ? draft.prompt : "", createdAt: Date.now() });
    if (draft) state.drafts = state.drafts.filter((d) => d !== draft);
    player.scene.name = name;
    player.source = { kind: "saved", id: ref.id };
    $("saveNote").textContent = `Saved “${name}”.`;
    renderLibrary();
  } catch (e) {
    $("saveNote").textContent = (e as { code?: string })?.code === "quota_exceeded" ? "The library is full. Delete a few scenes, then save again." : "Couldn’t save. Try again.";
  } finally {
    ($("saveBtn") as HTMLButtonElement).disabled = false;
  }
};
$("dlBtn").onclick = async () => {
  if (!downloads || !player.scene) return;
  const slug = (player.scene.name || "cabra-scene").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cabra-scene";
  try {
    await downloads.save({ filename: `${slug}.json`, data: JSON.stringify(sceneToJSON(player.scene), null, 2) });
    showJsonNote("Downloaded.");
  } catch (e) {
    if ((e as { code?: string })?.code !== "declined") showJsonNote("Download isn’t available here. Use Copy JSON instead.", true);
  }
};

async function initCapabilities() {
  const c = window.claude;
  if (!c || typeof c.use !== "function") { disableGeneration(); renderLibrary(); return; }
  const [s, d, u, dl] = await Promise.all(["sample", "db", "user", "downloads"].map((n) => Promise.resolve(c.use(n)).catch(() => null)));
  sample = s; db = d; user = u; downloads = dl;
  if (!sample) disableGeneration();
  else { ($("genBtn") as HTMLButtonElement).disabled = false; setStatus("idle", HINT[($("tier") as HTMLSelectElement).value]); }
  $("dlBtn").hidden = !downloads;
  if (db) {
    let w: boolean | null = null;
    try { w = user ? await user.can("data.write") : null; } catch { /* unknown */ }
    canWrite = w !== false;
    $("saveBox").hidden = !canWrite;
    db.collection("scenes").orderBy("createdAt", "desc").limit(200).onSnapshot(
      (snap: { docs: { id: string; data: () => any }[] }) => {
        state.saved = snap.docs
          .map((doc) => { const v = doc.data() || {}; return { id: doc.id, scene: v.scene || {}, prompt: v.prompt || "" }; })
          .filter((x) => x.scene && typeof x.scene === "object");
        state.savedLoaded = true;
        renderLibrary();
      },
      () => { state.savedLoaded = true; renderLibrary(); },
    );
  }
  renderLibrary();
}

/* ---------------- Boot ---------------- */

const stored = store.get("cabra-studio:current:v1");
let initial: unknown = SCENES.find((s) => s.name === "mountain");
try { if (stored) initial = JSON.parse(stored); } catch { /* ignore */ }
// Load into the player without leaving game mode.
{
  const res = (() => { try { return normalizeScene(initial); } catch { return normalizeScene(SCENES[0]); } })();
  player.scene = res.scene;
  player.source = SCENES.some((s) => s.name === res.scene.name) ? { kind: "app", id: res.scene.name } : { kind: "edit", id: "edit" };
  ($("dist") as HTMLInputElement).value = String(defaultDistance(res.scene));
  ($("jsonBox") as HTMLTextAreaElement).value = JSON.stringify(sceneToJSON(res.scene), null, 2);
}
syncTransport();
renderLibrary();
push();
requestAnimationFrame(tick);
initCapabilities();
