# Pasalacabra (browser game)

Browser game inspired by the Spanish TV show "Pasapalabra": a ring of letters ("rosco"), questions read out loud, and quick controls for **Pasalacabra**, **Reveal**, **✓ / ✗**, multi-player handoff, timer, and phone camera background.

## Run locally

### Requirements
- **Node**: `^20.19.0 || >=22.12.0` (Vite 7 requirement)

### Dev
```bash
npm install
npm run dev
```

### Build
```bash
npm run build
```

## Game flow

### Setup screen (before the game)
- Pick **number of players**: 2–6.
- Enter each player's **name**.
- Select **topics** for the game (at least one required).
- Optional: Enable **Test Mode** to use a fixed question set for testing.

### Available Topics
- 🌃 Astronomía
- 🌱 Biología
- 🎵 Música
- 🏆 Deporte
- 🔬 Ciencia
- 🎥 Cine
- 🗺️ Historia
- 🌍 Geografía
- 🎨 Arte
- ✨ Folklore

### Game screen
- **Camera**: runs behind the ring (mobile-friendly). Top-right **📷 ⟲** flips between front/rear camera when available.
- **Timer**: big at the top. Each player has a **single 2:00 time bank for the whole game** (paused while handing the phone).
- **Question reading**: questions are **spoken out loud** (no on-screen question text). On mobile, speech is triggered from the **Start** button to comply with browser gesture policies.

### Controls
- **Start**: starts/resumes the active player's turn (uses that player's remaining time).
- **Pasalacabra**:
  - **Single player**: passes to the next unresolved letter and continues the turn.
  - **Multi-player**: ends the turn and requires handoff.
  - After the first round (A-Z completed), can be used 1 second after question starts reading.
  - Plays the **goat** SFX.
- **Reveal**: shows the correct answer and reveals **✗ / ✓** buttons.
- **✗ / ✓**:
  - On **✓**: speaks **"Sí"**, then plays the correct SFX, then continues to next unresolved letter.
  - On **✗**: ends the turn immediately (stops timer), speaks **"No. La respuesta correcta es …"**, then plays the wrong SFX.
- **Siguiente: <nombre>**: appears when the turn ends. Rotates to the next player who still has time. If nobody has time, the game ends.

### Timer end behavior
- If there are **multiple players**: when time hits **0**, it automatically rotates to the **next player with time left** (idle handoff).
- If **no players** have time left: the game shows the **winner** based on most correct answers (ties broken by fewer mistakes).
- If there is **only 1 player**: the game ends when their time hits **0**.

## Data & architecture

### Question topics
Question files live in `src/questions/` with one file per topic:
- `astronomia.ts`, `biologia.ts`, `musica.ts`, `deporte.ts`, `ciencia.ts`, `cine.ts`, `historia.ts`, `geografia.ts`, `arte.ts`, `folklore.ts`

The question bank is dynamically generated at game start based on selected topics, ensuring:
- Each player gets unique questions (no duplicates across players)
- Similar topic distribution per player

### Legacy question sets (Test Mode)
Sets live in:
- `src/data/sets/set_01.json` … `src/data/sets/set_06.json`

Loaded via:
- `src/data/sets.ts` using Vite `import.meta.glob` (no `resolveJsonModule` needed).

JSON shape:
```json
{
  "id": "set_01",
  "title": "Optional title",
  "questions": [
    { "letter": "A", "question": "…", "answer": "…" }
  ]
}
```

### Engine scaffold (pure logic)
- `src/game/engine.ts` contains types + pure helpers for future refactors:
  - `Player`, `GameSession`
  - `PlayerState` (progress tracking)

## Audio on mobile (important)

Mobile browsers (especially iOS Safari) require **user gesture "unlocking"** for audio.
This app unlocks audio on the first tap and on key buttons, and uses **Web Audio** with prefetch + pre-decode for low latency.

## Using ngrok

If Vite blocks the host when using ngrok, add it to:
- `vite.config.ts` → `server.allowedHosts`

Example host from a previous run:
`erma-dogged-edmond.ngrok-free.dev`

## Recent Updates

- Refactored question files for consistency and maintainability
- Enhanced UI components and styling
- Improved game logic and component behavior

## Repo

GitHub: `https://github.com/yago1994/pasalacabra.git`
