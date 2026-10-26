#!/usr/bin/env node
/**
 * Pre-generates everything the game says for a daily set (Azure TTS, MP3), so
 * players don't need speechSynthesis or a live Azure call during the game.
 *
 *   SPEECH_KEY=… SPEECH_REGION=westeurope node scripts/generate_audio.mjs 2026-10-26 [more days…]
 *
 * Reads daily/es/<day>.json and writes audio-out/<set id>/: one MP3 per line,
 * named by a hash of its text, plus manifest.json ({ voice, files: { text: file } }).
 * The game looks lines up by exact text (src/speech/azureTts.ts), so the lines
 * here must match what src/App.tsx says, character for character.
 *
 * Audio is generated at normal speed; the game sets the playback speed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const VOICE = process.env.TTS_VOICE || "es-ES-XimenaNeural";
const OUT_DIR = process.env.AUDIO_OUT_DIR || "audio-out";
const SETS_DIR = process.env.SETS_DIR || "daily/es";
const KEY = process.env.SPEECH_KEY;
const REGION = process.env.SPEECH_REGION || "westeurope";
// Hash of this script: the workflow regenerates a day when it changes.
const GENERATOR = createHash("sha1")
  .update(await readFile(new URL(import.meta.url)))
  .digest("hex")
  .slice(0, 12);

// Same split as speakQuestion() in src/App.tsx: the "Empieza por X." intro and
// the clue are read as two lines.
const INTRO_RE = /^(Con\s+la|Empieza\s+por|Contiene\s+la)\s+([A-ZÑ])\s*:\s*(.+)$/i;

/** Every line the game can say during this set. */
function linesForSet(set) {
  const lines = new Set(["Sí", "Tieeeeeeeempoo!"]);
  for (const qa of set.questions) {
    const t = qa.question.trim();
    const m = t.match(INTRO_RE);
    if (m) lines.add(`${m[1]} ${m[2].toUpperCase()}.`);
    lines.add((m ? m[3] : t).trim());
    lines.add(`No. La respuesta correcta es: ${qa.answer}`.trim());
  }
  return [...lines].filter(Boolean);
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

async function synthesize(text, attempt = 1) {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES">` +
    `<voice name="${VOICE}"><lang xml:lang="es-ES">${escapeXml(text)}</lang></voice></speak>`;
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "pasalacabra-audio",
    },
    body: ssml,
  });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  // 429 (throttled) and 5xx are worth a retry.
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    return synthesize(text, attempt + 1);
  }
  throw new Error(`TTS ${res.status} for "${text.slice(0, 40)}": ${await res.text().catch(() => "")}`);
}

async function generateDay(day) {
  const set = JSON.parse(await readFile(path.join(SETS_DIR, `${day}.json`), "utf8"));
  const dir = path.join(OUT_DIR, set.id);
  await mkdir(dir, { recursive: true });
  const files = {};
  let bytes = 0;
  let chars = 0;
  for (const text of linesForSet(set)) {
    const name = createHash("sha1").update(`${VOICE}|${text}`).digest("hex").slice(0, 16) + ".mp3";
    const audio = await synthesize(text);
    await writeFile(path.join(dir, name), audio);
    files[text] = name;
    bytes += audio.length;
    chars += text.length;
  }
  const manifest = { set: set.id, voice: VOICE, generator: GENERATOR, generatedAt: new Date().toISOString(), files };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`${set.id}: ${Object.keys(files).length} lines, ${chars} chars, ${(bytes / 1024).toFixed(0)} KB`);
}

if (!KEY) {
  console.error("SPEECH_KEY is not set (GitHub: Settings → Secrets and variables → Actions → SPEECH_KEY).");
  process.exit(1);
}
const days = process.argv.slice(2);
if (!days.length) {
  console.error("usage: generate_audio.mjs YYYY-MM-DD [YYYY-MM-DD…]");
  process.exit(1);
}
for (const day of days) await generateDay(day);
