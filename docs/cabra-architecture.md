# La cabra: mascot animation architecture

How the goat on the letter ring is built and animated. Read this before changing the goat,
adding scenes, or wiring it to new game events.

- **Lineage:** a web port of the Remi/Somni system in `~/GitHub/dreamjournal`
  (`docs/mascot-architecture.md` there), which is itself a port of Emi in `~/GitHub/late`.
- **Big difference from Remi:** pasalacabra is already a web app, so the game and the studio
  share **one** TypeScript engine. There is no Swift/JS pair to keep in sync.
- **Studio:** Cabra Studio, <https://claude.ai/artifact/CjmgkCXpKLPjXbfAVAmvqf> (private; share
  from its menu).

## Files

| File | Role |
|---|---|
| `src/cabra/scene.ts` | Scene format, eases, waves, rig parameter defaults, lenient parser |
| `src/cabra/engine.ts` | Pure evaluator `(scene, t, ctx) → frame`: ring geometry, placement, props, particles, follow-through |
| `src/cabra/rig.ts` | The goat drawn in SVG from ~40 parameters (IK legs, head, horns, ear, beard, bell) |
| `src/cabra/stage.ts` | Draws frames: goat, props, particle pool, two layers (under / over the letters) |
| `src/cabra/scenes.ts` | **The scene library** (source of truth) and `SLOTS` (which scenes play for which moment) |
| `src/cabra/director.ts` | State machine: game changes → queued actions, cross-fades, idle moments, sound gating |
| `src/cabra/sounds.ts` | Plays audio files by cue name (`SOUND_FILES`); unmapped cues are silent |
| `src/cabra/spec.ts` | The brief Claude gets in the studio (generated from the real defaults) |
| `src/cabra/useCabra.ts` | React hook: owns director + stage, runs the rAF loop outside React |
| `src/cabra/still.ts`, `CabraIcon.tsx` | The goat as a still picture in named poses: icons, background goats, end-of-game confetti, the share snapshot |
| `src/components/LetterRing.tsx` | Mounts the two goat layers around the letters |
| `tools/cabra-studio/` | Studio page (`index.html`, `studio.ts`), `build.mjs`, and a dev contact sheet |

## Core decisions

- **Procedural vector rig, not sprites.** Tiny, sharp at any size, every pose is data.
- **Scenes are JSON-shaped data**, parsed leniently (unknown tracks/props are dropped with a
  warning). Claude can write them in the studio; a studio scene pastes straight into `scenes.ts`.
- **Evaluation is pure.** Particles are seeded; only breathing/blinking/ear and tail flicks use
  the absolute clock. Follow-through (ears, beard, bell, tail) comes from looking back at the
  goat's own placement 1–2 frames earlier, so it needs numeric tracks only.
- **The ring is the world.** The goat stands on the outer edge of the current letter and "up"
  points away from the centre (so it is upside down at the bottom of the ring). Placement is
  `cabra.travel` (0 = `from` letter, 1 = `to` letter), `cabra.alt` (height), `cabra.along`,
  and `cabra.dive` (1 = straight line between letters, used for leaps across the middle).
  Props sit on letters (`at: "from" | "to"`, field `t` moves them along) or on the goat.
- **Every scene starts and ends standing**, and the director cross-fades 0.22 s between scenes;
  the old scene's props fade out.

## Behaviour (director)

Inputs from `LetterRing`: `n`, current `index`, per-letter `statuses`, `phase`, `gameOver`.

- The app flips the current letter between `"current"` and `"pending"` on every move, so the
  director normalises `"current"` → `"pending"` before diffing.
- One letter becomes **correct** → `graze` / `graze-flower` (grass or a daisy sprouts, the goat
  eats it, "¡Ñam!", hearts). **wrong** → `oops` (rain cloud, droopy ears, shakes off water).
  **passed** (Pasalacabra) plays no scene of its own: the hop that follows becomes `pasa-hop`
  (a quick hop with a "¡Beee!" bubble; the game plays its own bleat). `pasa-flip` and
  `pasa-double` stay in the library but the game doesn't use them (too much, per playtesting).
- The index moves → a **move**, chosen by forward distance: 1 = `hop` / `hop-skip` / `pronk`,
  2–4 = `mountain` (a mountain rises over the skipped letters; the goat bounds up, rears on
  the summit, slides down), 5+ = `leap` (trampoline, double spin across the middle on a rainbow).
- **Speed:** the game never waits for the goat, so in-game scenes are tightened with
  `retime()` (`FAST` in `scenes.ts`): ✓ fits inside the narrator's "Sí" (~1.1 s), hop ~0.6 s,
  mountain ~1.6 s, leap ~1.4 s. ✗ keeps ~2.6 s because the narrator reads the right answer.
- Moves wait for events (graze first, then hop), but an event with a move queued behind it
  plays 2× faster and can be cut after 75%. Events cut resting and idle moments. Queued moves
  merge, and a backlog plays 1.8× faster so the goat keeps up with fast play.
- A resolved letter going back to unresolved, or several letters resolving at once, means a
  new game or the next player's ring: the goat pops in (`appear`).
- Phase: idle → playing = `ready`. One closing scene per turn: whole ring green = `victory`,
  `playing → idle` (time ran out) = `time-up`, game over = `bow`, otherwise `lie-down`.
- Resting: `rest` while playing (idle moment every 4–9 s: look-around, scratch, chew, sniff,
  little-hop, stretch, headbutt, tail-wag, balance, snack), `rest-wait` before a turn,
  `sleep` after one, `proud` after a perfect game.
- **Streaks** (consecutive ✓ in a turn; ✗, Pasalacabra or a new ring reset it): 3 = `streak-3`
  (backflip, gold "¡x3!"), 5 = `streak-5` (double backflip, "¡En racha!", sunglasses on),
  9 = `streak-9` (sky-high triple flip, fireworks, crown), then every 3 from 12 = `streak-mega`.
  The sunglasses (from 5) and crown (from 9) stay on between scenes as an **outfit**: rest
  values the evaluator uses for anything a scene doesn't animate (`Ctx.outfit`).
- **Last 10 seconds** of a turn (`timeLeft` from the game): the rest loop becomes `antsy`
  (rapid hops, sweat, eyes on the clock) and idle moments stop.
- Tap the goat → `poke` / `giggle`, with a `cowbell` cue (always audible: it's the player's own tap).
  Until there's a cowbell recording, `cowbell` maps to the game's bleat.
- Any bubble saying `{baa}` ("¡Beee!") plays the game's real Pasalacabra bleat as it pops,
  except on the Pasalacabra hop, where the game already plays it.
- **Sound files:** `sounds.ts` maps cue names to audio files in `SOUND_FILES`. Right now only
  `pasalacabra` (the game's bleat) and `cowbell` (placeholder: also the bleat) have files; the other
  cue names in scenes (munch, ding, whoosh…) are silent until a file is mapped. The same file never
  starts twice within 0.5 s.
- **Sound:** the game reads questions aloud and listens for answers, so moves and idle
  moments are silent, and while a turn is playing only ✓ / ✗ / Pasalacabra scenes may make
  sound. The app's own goat SFX still plays on Pasalacabra; the goat adds a whoosh. Sounds use
  the game's AudioContext and only play once it is running.
- Reduced motion: moves become fades, flips become a giggle, idle moments become chewing.

## Outside the ring

- Every goat emoji on the site is now the rig: the home icon, profile and sign-in icons, the
  floating background goats (each in its own pose), the 🐐 in the end-of-ring message, and the
  goat in the share snapshot (rasterised once; falls back to the emoji if the browser would
  taint the canvas). Plain-text shares ("Pasala🐐") keep the emoji.
- The end-of-game falling confetti goats are still pictures of the new goat in a few poses.

## Workflows

**Preview while working:** `npm run dev`, then open `/tools/cabra-studio/index.html` (the studio,
live from source) or the contact sheet
`/tools/cabra-studio/sheet.html?scene=mountain&dist=3&n=12&w=200&cols=6` (n frames of one scene,
zoomed on the goat; `zoom=0` shows the whole ring).

**Add or change a scene:** edit `src/cabra/scenes.ts` (and `SLOTS` to make the director use it),
check it in the contact sheet, then rebuild and republish the studio.

**Change the rig or add a parameter/prop:** `DEFAULTS` / `PROP_FIELDS` in `scene.ts`, the drawing in
`rig.ts` or `stage.ts`, and the notes in `spec.ts` so Claude knows about it.

**Republish the studio:** `npm run studio:build` writes `tools/cabra-studio/dist/cabra-studio.html`;
publish that file to the same artifact URL (capabilities: sample, db, user, downloads).
Scenes saved in the studio live in its shared `scenes` collection; copy their JSON into
`scenes.ts` to ship them.

## Pitfalls already hit

- Closing the mountain polygon with a straight chord cuts a wedge into the ring; it closes along
  an arc hidden under the letters instead.
- A leap's arc must bow **inward** (negative `cabra.alt` with `dive` 1); outward it grazes the
  letters. For long jumps the "up" direction turns the short way round, or the path loops.
- A flight arc and its rainbow trail only line up if both follow the same curve
  (`sineKeys` in `scenes.ts`).
- In the browser pane a hidden tab pauses requestAnimationFrame; test the director headlessly
  by importing it and stepping `frame(now)` with a fake clock.
