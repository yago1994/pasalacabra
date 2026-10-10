// Decides what the goat plays now. It watches the game (current letter, letter statuses,
// phase) and turns changes into actions: graze on ✓, rain cloud on ✗, a flip on
// Pasalacabra, then a hop, mountain or leap to wherever the game moves next.
//
// Rules:
// - Events (✓ / ✗ / Pasalacabra) cut resting and idle moments, but wait for a move to land.
// - Moves wait for events, so the goat grazes first and then hops on.
// - When actions pile up (fast play), the current one speeds up so the goat catches up.
// - Every switch cross-fades the pose over 0.22 s; the old scene's props fade out.

import { Evaluator, clamp, lerp } from "./engine";
import type { Frame } from "./engine";
import { normalizeScene } from "./scene";
import type { NormalizedScene, Scene } from "./scene";
import { SCENES, SLOTS } from "./scenes";
import type { ExtraSet } from "./stage";

export type Phase = "idle" | "playing" | "ended";
export type GameInputs = {
  n: number;
  index: number;
  statuses: readonly string[];
  phase: Phase;
  gameOver: boolean;
  /** Seconds left on the active player's clock: the goat gets antsy in the last 10. */
  timeLeft?: number;
};

type Kind = "rest" | "moment" | "event" | "move";
type Action = { slot: string; scene: string; from: number; to: number; kind: Kind };
type Playing = Action & { ev: Evaluator; local: number; scale: number; id: number; lastCue: number; bleated: Set<string> };

const BLEND = 0.22;
const pick = <T,>(arr: T[], avoid?: T) => {
  const pool = arr.length > 1 && avoid !== undefined ? arr.filter((x) => x !== avoid) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
};

export class Director {
  library = new Map<string, NormalizedScene>();
  /** Studio only: force a slot to a specific scene name. */
  overrides: Record<string, string> = {};
  onSound: ((name: string, opts: { pitch?: number; gain?: number }) => void) | null = null;
  reducedMotion = false;

  private cur: Playing | null = null;
  private queue: Action[] = [];
  private prev: GameInputs | null = null;
  private inputs: GameInputs | null = null;
  private clock = 0;
  private lastNow = -1;
  private nextMoment = 0;
  private lastMoment = "";
  private turnClosed = false;
  private pasaNext = false;
  /** Consecutive ✓ this turn; 3, 5, 9, then every 3 from 12 get a special move. */
  streak = 0;
  private seq = 0;
  private lastFrame: Frame | null = null;
  private fading: { frame: Frame; start: number; key: string } | null = null;

  constructor(extra: Scene[] = []) {
    for (const s of [...SCENES, ...extra]) this.addScene(s);
  }

  addScene(raw: Scene) {
    const { scene } = normalizeScene(raw);
    this.library.set(scene.name, scene);
    return scene;
  }

  /** Streak gear that stays on between scenes: sunglasses from 5 in a row, a crown from 9. */
  private get outfit(): Record<string, number> {
    return { "gear.shades": this.streak >= 5 ? 1 : 0, "gear.crown": this.streak >= 9 ? 1 : 0 };
  }

  /** Words the director fills in for bubbles ({streak}). Merge with the language's words. */
  get words(): Record<string, string> {
    return { streak: String(this.streak) };
  }

  /** Where the goat is, or will be once everything queued has played. */
  private get tail() {
    const last = this.queue[this.queue.length - 1];
    if (last) return last.to;
    if (this.cur) return this.cur.to;
    return this.inputs ? Math.max(0, this.inputs.index) : 0;
  }

  private sceneFor(slot: string, avoid?: string) {
    const o = this.overrides[slot];
    if (o && this.library.has(o)) return o;
    let name = pick(SLOTS[slot] || [slot], avoid);
    if (this.reducedMotion) {
      if (slot === "hop" || slot === "pasaHop" || slot === "mountain" || slot === "leap") name = "fade-move";
      if (slot === "victory" || slot === "poke") name = "giggle";
      if (slot === "moment" || slot === "waitMoment") name = "chew";
    }
    return this.library.has(name) ? name : "rest";
  }

  private restSlot() {
    const inp = this.inputs;
    if (!inp) return "rest";
    if (inp.phase === "ended" || inp.gameOver) {
      const allGreen = inp.statuses.length > 0 && inp.statuses.every((s) => s === "correct");
      return allGreen ? "proud" : "sleep";
    }
    if (inp.phase === "idle") return "wait";
    return inp.timeLeft !== undefined && inp.timeLeft > 0 && inp.timeLeft <= 10 ? "antsy" : "rest";
  }

  /** Which scene a ✓ plays, by streak length. */
  private correctSlot() {
    const n = this.streak;
    if (n === 3) return "streak3";
    if (n === 5) return "streak5";
    if (n === 9) return "streak9";
    if (n >= 12 && n % 3 === 0) return "streakMega";
    return "correct";
  }

  private enqueue(slot: string, kind: Kind, from: number, to = from) {
    if (kind === "move") {
      if (from === to) return;
      // Merge with a move already waiting: go straight to the newest target.
      const last = this.queue[this.queue.length - 1];
      if (last && last.kind === "move") {
        this.queue.pop();
        from = last.from;
        if (from === to) return;
      }
      const n = this.inputs?.n ?? 25;
      const d = ((to - from) % n + n) % n;
      slot = d === 1 ? (this.pasaNext ? "pasaHop" : "hop") : d <= 4 ? "mountain" : "leap";
      this.pasaNext = false;
    }
    this.queue.push({ slot, scene: this.sceneFor(slot), from, to, kind });
  }

  /** Feed the latest game state. Cheap to call every render. */
  update(inp: GameInputs) {
    const prev = this.prev;
    this.inputs = inp;
    this.prev = { ...inp, statuses: [...inp.statuses] };
    if (!prev) {
      this.enqueue("appear", "event", Math.max(0, inp.index));
      return;
    }

    // The game marks the current letter "current" and flips it back to "pending" on every
    // move; only real outcomes count here.
    const norm = (v: string | undefined) => (v === "current" ? "pending" : v ?? "pending");
    const resolved = (v: string) => v === "correct" || v === "wrong" || v === "passed";
    const changed: number[] = [];
    let reset = inp.n !== prev.n;
    for (let i = 0; i < inp.n; i++) {
      const a = norm(prev.statuses[i]), b = norm(inp.statuses[i]);
      if (a === b) continue;
      if (resolved(b)) changed.push(i);
      else if (a === "correct" || a === "wrong") reset = true;
    }
    if (changed.length > 1) reset = true;

    if (reset) {
      // New game or the next player's ring: pop in where the game now is.
      this.queue = [];
      this.cur = null;
      this.turnClosed = false;
      this.streak = 0;
      this.enqueue("appear", "event", Math.max(0, inp.index));
    } else {
      if (changed.length === 1) {
        const st = norm(inp.statuses[changed[0]]);
        // Pasalacabra has no scene of its own: it flavours the hop that follows.
        if (st === "correct") {
          this.streak++;
          this.enqueue(this.correctSlot(), "event", this.tail);
        } else {
          this.streak = 0; // ✗ and Pasalacabra both end a streak
          if (st === "passed") this.pasaNext = true;
          else this.enqueue("wrong", "event", this.tail);
        }
      }
      if (inp.index !== prev.index && inp.index >= 0) this.enqueue("move", "move", this.tail, inp.index);
      this.pasaNext = false; // only flavours a move that arrives in the same update
    }

    if (prev.phase !== inp.phase || prev.gameOver !== inp.gameOver) {
      const allGreen = inp.statuses.length > 0 && inp.statuses.every((s) => s === "correct");
      const turnOver = prev.phase === "playing" && inp.phase !== "playing";
      if (inp.phase === "playing" && prev.phase !== "playing") {
        this.turnClosed = false;
        if (prev.phase === "ended" || prev.gameOver) this.streak = 0;
        this.enqueue("start", "event", this.tail);
      } else if ((turnOver || (inp.gameOver && !prev.gameOver)) && !this.turnClosed) {
        // One closing scene per turn: a perfect ring, time running out, the game ending, or a plain end of turn.
        this.turnClosed = true;
        const slot = allGreen ? "victory" : inp.phase === "idle" ? "timeUp" : inp.gameOver ? "gameOver" : "turnEnd";
        this.enqueue(slot, "event", this.tail);
      }
    }
  }

  /** The player tapped the goat. */
  poke() {
    if (!this.cur || this.cur.kind === "rest" || this.cur.kind === "moment") {
      if (this.queue.length) return;
      this.enqueue("poke", "event", this.tail);
    }
  }

  /** Play one scene right away (studio). */
  play(name: string, from: number, to: number) {
    this.queue = [];
    const kind: Kind = from !== to ? "move" : "event";
    this.queue.push({ slot: "studio", scene: this.library.has(name) ? name : "rest", from, to, kind });
    this.switchTo(this.queue.shift()!);
  }

  private switchTo(a: Action) {
    if (this.lastFrame) {
      this.fading = { frame: this.lastFrame, start: this.clock, key: "f" + this.cur?.id };
    }
    const scene = this.library.get(a.scene)!;
    const n = this.inputs?.n ?? 25;
    this.cur = { ...a, ev: new Evaluator(scene, { n, from: a.from, to: a.to, clock: this.clock, outfit: this.outfit }), local: 0, scale: 1, id: ++this.seq, lastCue: -1, bleated: new Set() };
    if (a.kind === "rest") this.nextMoment = this.clock + 4 + Math.random() * 5;
  }

  private canInterrupt(next: Action) {
    const c = this.cur;
    if (!c) return true;
    if (c.kind === "rest" || c.kind === "moment") return true;
    const dur = c.ev.scene.duration;
    // let an event's tail be cut once its main beat has played
    if (c.kind === "event" && next.kind === "move") return c.local >= dur * 0.75;
    return false;
  }

  /** Advance to `now` (seconds) and return what to draw. */
  frame(now: number): { goat: Frame; sets: ExtraSet[] } {
    const dt = this.lastNow < 0 ? 0 : clamp(now - this.lastNow, 0, 0.1);
    this.lastNow = now;
    this.clock += dt;

    // Advance the current action
    if (this.cur) {
      // The game never waits for the goat: an event with a move queued behind it hurries
      // through its ending, and a backlog of moves plays fast.
      const next = this.queue[0];
      this.cur.scale =
        this.queue.length >= 2 ? 1.8
        : next && next.kind === "move" && this.cur.kind === "event" ? 2
        : next && this.cur.kind !== "rest" && this.cur.kind !== "moment" ? 1.25
        : 1;
      this.cur.local += dt * this.cur.scale;
    }
    const c = this.cur;
    const done = c && !c.ev.scene.loop && c.local >= c.ev.scene.duration;
    if (!c || done || (this.queue.length && this.canInterrupt(this.queue[0]))) {
      const next = this.queue.shift();
      if (next) this.switchTo(next);
      else if (!c || done) {
        const at = c ? c.to : Math.max(0, this.inputs?.index ?? 0);
        const slot = this.restSlot();
        this.switchTo({ slot, scene: this.sceneFor(slot), from: at, to: at, kind: "rest" });
      }
    }

    // The resting loop follows the game: antsy in the last 10 seconds, asleep after the turn…
    const want = this.restSlot();
    const r = this.cur!;
    if (!this.queue.length && ((r.kind === "rest" && r.slot !== want) || (r.kind === "moment" && want === "antsy"))) {
      this.switchTo({ slot: want, scene: this.sceneFor(want), from: r.to, to: r.to, kind: "rest" });
    }

    // Idle moments while resting
    const cur = this.cur!;
    if (cur.kind === "rest" && this.clock >= this.nextMoment && !this.queue.length) {
      const slot = cur.slot === "rest" ? "moment" : cur.slot === "wait" ? "waitMoment" : "";
      if (slot) {
        const name = this.sceneFor(slot, this.lastMoment);
        this.lastMoment = name;
        this.switchTo({ slot, scene: name, from: cur.to, to: cur.to, kind: "moment" });
      } else this.nextMoment = this.clock + 8;
    }

    const p = this.cur!;
    const sc = p.ev.scene;
    const t = sc.loop ? p.local % sc.duration : Math.min(p.local, sc.duration);
    p.ev.ctx.clock = this.clock;
    let fr = p.ev.frame(t);

    // Sound cues crossed this tick
    // While a question is being read or answered, only the game's own events make sound.
    // Taps are the player's own doing, so the cowbell always rings.
    const quiet = this.inputs?.phase === "playing" && p.slot !== "poke" && (p.kind !== "event" || p.slot === "start");
    if (this.onSound && !sc.loop && !quiet) {
      for (const cue of sc.cues) {
        if (cue.t > p.lastCue && cue.t <= t) this.onSound(cue.sound, { pitch: cue.pitch, gain: cue.gain });
      }
      // A "¡Beee!" bubble plays the game's real Pasalacabra bleat as it pops up (the game
      // already plays it for the Pasalacabra hop itself).
      if (p.slot !== "pasaHop") {
        for (const pf of fr.props) {
          if (pf.prop.type !== "bubble" || !String(pf.prop.text ?? "").includes("{baa}") || p.bleated.has(pf.key)) continue;
          if (pf.f.grow >= 0.5 && pf.f.opacity > 0.1) {
            p.bleated.add(pf.key);
            this.onSound("pasalacabra", {});
          }
        }
      }
    }
    p.lastCue = t;

    const sets: ExtraSet[] = [{ frame: fr, alpha: 1, key: "s" + p.id }];
    if (this.fading) {
      const u = (this.clock - this.fading.start) / BLEND;
      if (u >= 1) this.fading = null;
      else {
        fr = blendFrames(this.fading.frame, fr, u * u * (3 - 2 * u));
        sets.push({ frame: this.fading.frame, alpha: 1 - u, key: this.fading.key });
      }
    }
    this.lastFrame = fr;
    return { goat: fr, sets };
  }

  /** What is playing (studio readout). */
  get status() {
    const c = this.cur;
    return c ? { scene: c.scene, kind: c.kind, from: c.from, to: c.to, t: c.local, queue: this.queue.map((q) => q.scene) } : null;
  }
}

function blendFrames(a: Frame, b: Frame, u: number): Frame {
  const p: Record<string, number> = {};
  for (const k in b.p) p[k] = lerp(a.p[k] ?? b.p[k], b.p[k], u);
  let dr = b.place.rot - a.place.rot;
  dr = ((dr + 540) % 360) - 180;
  let ds = b.spin - a.spin;
  ds = ((ds + 540) % 360) - 180;
  return {
    ...b,
    p,
    place: { x: lerp(a.place.x, b.place.x, u), y: lerp(a.place.y, b.place.y, u), rot: a.place.rot + dr * u },
    spin: a.spin + ds * u,
    lag: {
      ear: lerp(a.lag.ear, b.lag.ear, u),
      bell: lerp(a.lag.bell, b.lag.bell, u),
      beard: lerp(a.lag.beard, b.lag.beard, u),
      tail: lerp(a.lag.tail, b.lag.tail, u),
    },
  };
}
