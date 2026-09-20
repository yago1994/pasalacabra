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

### Home page (entry screen)
- **Juego de hoy**: Launch a single-player daily game using the predefined `set_01.json` question set. Starts immediately with medium difficulty (4 minutes).
- **Crea tu proprio juego**: Navigate to the game setup screen to customize your own game.
- Expandable sections for **Cómo Jugar** (How to Play) and **¿Y esto de dónde ha salido?** (About) with full game instructions and project background.

### Setup screen (custom game)
Accessible via "Crea tu proprio juego" button:
- Pick **number of players**: 1–4.
- Enter each player's **name**.
- Select **difficulty mode**: Difícil (3 mins), Media (4 mins), or Fácil (5 mins).
- Select **topics** for the game (at least one required, unless Test Mode is enabled).
- Optional: Enable **Test Mode** to use a fixed question set for testing.
- Back button to return to the home page.

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
- 📚 Cultura General

### Game screen
Accessed from either:
- **Daily game** (`Juego de hoy`): Single-player game using `set_01.json` with medium difficulty (4 minutes)
- **Custom game**: After setup, launches with your selected players, topics, and difficulty

Features:
- **Camera**: runs behind the ring (mobile-friendly). Top-right **📷 ⟲** flips between front/rear camera when available.
- **Timer**: big at the top. Each player has a **single time bank for the whole game** based on difficulty mode (paused while handing the phone).
  - **Difícil**: 3 minutes (180 seconds)
  - **Media**: 4 minutes (240 seconds) 
  - **Fácil**: 5 minutes (300 seconds)
- **Question reading**: questions are **spoken out loud** (no on-screen question text). On mobile, speech is triggered from the **Start** button to comply with browser gesture policies.
- **Question source**: 
  - Daily game: Uses predefined set (`set_01.json`)
  - Custom game: Uses topic-based generated questions or test mode sets

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
- When a player's timer hits **0**, the game automatically **captures a snapshot** of their final game state (camera + letter ring with all correct/wrong/passed letters).
- If there are **multiple players**: when time hits **0**, it automatically rotates to the **next player with time left** (idle handoff).
- If **no players** have time left: the game shows the **winner** based on most correct answers (ties broken by fewer mistakes).
- If there is **only 1 player**: the game ends when their time hits **0**.

### End of game slideshow
- After the game ends, a **slideshow animation** automatically plays showing each player's snapshot.
- Each player's photo is displayed for 4 seconds with their name, score (✓ correct / ✗ wrong), and a **🏆 ¡Ganador!** badge for the winner(s).
- The slideshow loops continuously until manually closed.
- **Video recording**: The slideshow is automatically recorded at 30fps when it starts.
- A **💾 Download** button appears in the slideshow overlay to save the recorded video (`.webm` format) for sharing on social media.
- **📱 Share results** (single-player only): Share your game results in a Wordle-like emoji format. Displays a circular ring pattern (11x10 grid) with emojis representing correct (🟢), wrong (🔴), and skipped (🔵) letters, along with your score summary. Uses the Web Share API when available, or copies to clipboard as fallback.

## Data & architecture

### Question topics
Question files live in `src/questions/` with one file per topic:
- `astronomia.ts`, `biologia.ts`, `musica.ts`, `deporte.ts`, `ciencia.ts`, `cine.ts`, `historia.ts`, `geografia.ts`, `arte.ts`, `folklore.ts`, `cultura.ts`

The question bank is dynamically generated at game start based on selected topics, ensuring:
- Each player gets unique questions (no duplicates across players)
- Similar topic distribution per player

Note: The `cultura.ts` file provides questions for the "Cultura General" topic (mapped as `culturageneral` in the code).

### Question sets
Predefined question sets live in:
- `src/data/sets/set_01.json` … `src/data/sets/set_06.json`

Loaded via:
- `src/data/sets.ts` using Vite `import.meta.glob` (no `resolveJsonModule` needed).

**Daily Game** (`Juego de hoy`): Uses `set_01.json` for a quick single-player game with medium difficulty.

**Test Mode**: In the setup screen (staging only), enables using a fixed question set instead of topic-based questions.

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

### Daily set generation
The daily set can be generated with OpenAI and stored in `src/data/sets/set_01.json`.

Local run:
```bash
OPENAI_KEY=... python3 scripts/generate_daily_set.py
```

Rules enforced by the generator:
- Exactly one valid answer (no ambiguity)
- Answer is not contained in the question
- Letter constraint enforced ("Empieza por" / "Contiene la")
- Every question carries a `topic` slug (`cine`, `historia`, `culturageneral`…),
  matching the `Topic` union in `src/questions/types.ts`. The generator forces it
  to be one of the day's 3 topics and the AI validation pass re-checks that the
  label actually matches the question.
- Questions are drawn from 3 randomly selected topics:
  Astronomía, Biología, Música, Deporte, Ciencia, Cine, Historia, Geografía, Arte, Folklore, Cultura
- Mixed difficulty with at least 3 hard (university-level) questions
- Secondary AI validation pass verifies/fixes output

Workflow:
- Run **Generate Daily Set** manually in GitHub Actions.
- It creates a review branch named `tomorrow-YYYY-MM-DD` with the updated `set_01.json`.
- Merging that branch into `main` triggers the deploy workflow and rebuilds the Vite app.
Required secret: `OPENAI_KEY`.

### Engine scaffold (pure logic)
- `src/game/engine.ts` contains types + pure helpers for future refactors:
  - `Player`, `GameSession`
  - `PlayerState` (progress tracking)

## Accounts, stats and subscriptions

Optional: with no Supabase env vars the app behaves exactly as before — results
live in `localStorage` and the sign-in entry points hide themselves.

### Setup
Full walkthrough — project, schema, Google + magic-link sign-in, redirect URLs,
env vars, verification and troubleshooting: **[`supabase/SETUP.md`](supabase/SETUP.md)**.

The short version: create a project, run [`supabase/schema.sql`](supabase/schema.sql)
in the SQL editor, enable the Google and Email providers, add the redirect URLs,
then put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`
locally and in the repository *variables* for deploys. The anon key is meant to
be public; row-level security is what protects the data.

### What gets stored
One row per game played (`game_results`): the game number, the per-letter
outcome, counts, the difficulty and how long it took. `attempt` is 1 for the
first play of a game and grows on replays; **stats only ever count attempt 1**,
so replaying an old game cannot inflate an average.

Everything the screens show (media de aciertos, distribución, porcentaje por
letra, marcas personales) is derived in the client from those rows —
`src/stats/aggregate.ts`. There are no aggregate tables to keep in sync.

Games played while signed out are kept on the device and pushed into the
account the first time someone signs in (`pushLocalResults`), which is what the
sign-in sheet promises.

Not stored yet: per-topic results. Daily sets started carrying a `topic` on each
question (see the generator above), so from the first set generated after that
change the game can tally aciertos by topic — it needs a `topics` column on
`game_results`, the tally at game over, and a "Por tema" block on the profile.
Older sets have no topic, so that breakdown only ever covers games from then on.

### Screens
- `StatsSheet` — after the daily game, and from "Tus estadísticas" on the home page.
- `ProfilePage` — the game painted by how often each letter is answered right.
- `ArchivePage` — past games, with the paywall.
- `SignInSheet` — the account gate.

### Subscriptions (stubbed)
`$3.99/month` gates playing past games; today's game is always free.
Stripe is **not** wired yet: `profiles.is_subscriber` is the only gate, and the
browser cannot write it (the `UPDATE` grant covers `display_name` only). On
staging/local (`VITE_ALLOW_SUB_STUB=true`) the paywall button calls
`set_subscription_stub()` so the flow can be tested end to end. Replace both
with a Stripe webhook writing `is_subscriber`, then drop that function.

### Not done yet
Past games are listed but not playable: only today's set ships in the build.
The older sets live in the git history of `src/data/sets/set_01.json` (113
versions so far) and need restoring into dated set files before the archive's
"Jugar" does anything.

## Audio on mobile (important)

Mobile browsers (especially iOS Safari) require **user gesture "unlocking"** for audio.
This app unlocks audio on the first tap and on key buttons, and uses **Web Audio** with prefetch + pre-decode for low latency.

## Using ngrok

If Vite blocks the host when using ngrok, add it to:
- `vite.config.ts` → `server.allowedHosts`

Example host from a previous run:
`erma-dogged-edmond.ngrok-free.dev`

## Recent Updates

- **Home page**: New entry screen with beautiful UI matching the game's blue background and goat decorations
  - **Juego de hoy**: Quick-start daily game using `set_01.json` (single-player, medium difficulty)
  - **Crea tu proprio juego**: Navigate to custom game setup
  - Expandable "Cómo Jugar" and "¿Y esto de dónde ha salido?" sections
- **Game setup improvements**: 
  - Back button to return to home page
  - Difficulty mode selection (Difícil, Media, Fácil) with different time limits
  - Better organized UI with clear sections
- **Component refactoring**: 
  - Separated HomePage and GameDetails into dedicated components
  - Improved code organization and maintainability
- **Emoji share feature**: Share single-player game results in Wordle-like format with a circular ring pattern (11x10 grid)
- **Single-player mode**: Added support for 1-player games with dedicated share functionality
- **Snapshot capture**: Automatically captures player photos when timer runs out, showing their final letter ring state
- **End-of-game slideshow**: Beautiful animated slideshow displaying all player snapshots with scores and winner badges
- **Video recording**: Automatic recording of the slideshow animation for easy sharing (30fps, WebM format)
- **Enhanced UI**: Improved letter ring rendering with exact game proportions and better visual consistency

## Repo

GitHub: `https://github.com/yago1994/pasalacabra.git`
