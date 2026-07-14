// src/locale/config.ts
// Locale selection + per-language configuration.
//
// The app is a Spanish voice "rosco" game. `?lang=en` switches it to an English
// daily game that reuses the same engine, timers, canvas and snapshot layer but
// swaps out the language-specific seams: alphabet, speech language + voice,
// answer normalization/matching, phrase hints, the "pass" wake word, the TTS
// question prefix, date formatting, the localStorage key and all UI strings.
//
// Locale is chosen once at startup from the URL and exposed as a module-level
// singleton via `getConfig()`. A singleton (rather than React context) avoids
// threading a value through the hundreds of ref-based async callbacks in App.tsx.

import {
  SPANISH_LETTERS,
  ENGLISH_LETTERS,
  loadEnglishDailySet,
  getSet,
  type QA,
  type SetDefinition,
} from "../data/sets";
import { formatDateLongES } from "../lib/dailyIssue";

export type Locale = "es" | "en";

export interface LocaleStrings {
  // HomePage
  tagline: string;
  playToday: string;
  createGame: string;
  createGameHint: string;
  howToPlayLabel: string;
  aboutLabel: string;
  // Player name prefix, used as `${playerName} 1`
  playerName: string;
  // In-game controls
  startButton: string;
  pasalacabraButton: string; // the "skip"/pass button
  overrideCorrect: string; // "that was actually correct" button
  micPermissionDenied: string;
  listening: string;
  micReady: string;
  sttUnsupportedShort: string;
  sttUnsupportedPlaceholder: string;
  noticePrefix: string; // prefixes an STT error message
  answerLabel: string; // "Answer:" before the revealed answer
  // In-game / endgame TTS
  ttsYes: string;
  ttsTimeUp: string; // spoken aloud when the timer runs out
  ttsCorrectAnswerPrefix: string; // spoken before the revealed answer on a wrong guess
  // Endgame banners
  finishedWheel: string;
  gameOver: string; // spoken/logged "game over" (with leading emoji)
  gameOverBanner: string; // endgame heading, e.g. "🎮 Game over!"
  gameOverPlain: string; // plain fallback, e.g. "Game over."
  timeUp: string; // shown when the timer runs out
  // Endgame buttons
  shareButton: string;
  showAnswers: string;
  hideAnswers: string;
  sharePhotos: string;
  recordAndSharePhotos: string;
  resultsButton: string;
  // Errors
  dailyLoadError: string;
}

export interface LocaleConfig {
  locale: Locale;
  letters: readonly string[];
  /** Azure STT recognition language, e.g. "es-ES" / "en-US". */
  sttLang: string;
  /** SpeechSynthesis language tag used as a fallback when no voice matches. */
  ttsLang: string;
  /** localStorage key for the "already played today" record. */
  dailyStorageKey: string;

  /** Pick the preferred TTS voice for this locale from the available voices. */
  pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null;
  /** Normalize a string for answer comparison. */
  normalizeForCompare(raw: string): string;
  /** True if `spoken` matches the expected answer (or one of its alternates). */
  isAnswerCorrect(spoken: string, qa: Pick<QA, "answer" | "alt">): boolean;
  /** Azure phrase-list hints biasing recognition toward the expected answer + commands. */
  buildHints(qa: Pick<QA, "answer" | "alt">): string[];
  /** True if the spoken text is the "pass"/"pasalacabra" wake command. */
  isWakeCommand(text: string): boolean;
  /** Split a question into a normal-speed intro (prefix) and the clue body for TTS. */
  splitQuestionForTts(qa: QA): { intro: string; body: string };
  /** The clue text to show in the answers panel (without the letter prefix). */
  displayQuestion(qa: QA): string;
  /** Share caption for the results snapshot. */
  shareCaption(correct: number, wrong: number, missing: number): string;
  /** Long date formatting for footers/snapshots. */
  formatDateLong(d: Date): string;
  /** Load today's daily set. */
  loadDailySet(today?: Date): Promise<SetDefinition>;
  /** All user-facing UI strings for this locale. */
  strings: LocaleStrings;
}

// ---------------------------------------------------------------------------
// Shared normalization helpers
// ---------------------------------------------------------------------------

function removeDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function baseNormalize(raw: string): string {
  return removeDiacritics(raw)
    .toLowerCase()
    .replace(/[¡!¿?.,;:()[\]{}"“”'’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  const maxLen = Math.max(n, m);
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return 1 - prev[m] / maxLen;
}

// Core fuzzy equality shared by both locales (diacritics/ñ folding, small
// plural tolerance, single-word Levenshtein for minor phoneme confusions).
function fuzzyEqual(sNorm: string, eNorm: string): boolean {
  if (!sNorm || !eNorm) return false;
  if (sNorm === eNorm) return true;
  // "La respuesta es X" / "It's X" style: spoken contains the expected answer.
  if (sNorm.includes(eNorm)) return true;

  const sN = sNorm.replace(/ñ/g, "n");
  const eN = eNorm.replace(/ñ/g, "n");
  if (sN === eN) return true;

  if (sNorm === `${eNorm}s` || eNorm === `${sNorm}s`) return true;
  if (sNorm === `${eNorm}es` || eNorm === `${sNorm}es`) return true;

  const sOneWord = !/\s/.test(sN);
  const eOneWord = !/\s/.test(eN);
  if (sOneWord && eOneWord && sN.length >= 4 && eN.length >= 4) {
    if (levenshteinRatio(sN, eN) >= 0.6) return true;
  }
  return false;
}

function uniqueNonEmpty(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const t = v.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spanish voice picking (ported from App.getSpanishVoice — prefers Mónica).
// ---------------------------------------------------------------------------

function pickSpanishVoice(vs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (vs.length === 0) return null;
  const userAgent = navigator.userAgent.toLowerCase();
  const defaultVoice = (() => {
    const es = vs.filter((v) => v.lang?.toLowerCase().startsWith("es"));
    const esES = es.find((v) => v.lang?.toLowerCase() === "es-es");
    return esES ?? es[0] ?? vs[0] ?? null;
  })();

  const findMonicaVoice = () => {
    const macosVoice = vs.find(
      (v) => v.voiceURI === "com.apple.voice.super-compact.es-ES.Monica"
    );
    if (macosVoice) return macosVoice;
    const uriMatch = vs.find(
      (v) =>
        v.voiceURI.toLowerCase().includes("monica") ||
        v.voiceURI.toLowerCase().includes("mónica")
    );
    if (uriMatch) return uriMatch;
    const nameMatch = vs.find(
      (v) =>
        v.name.toLowerCase().includes("monica") || v.name.toLowerCase().includes("mónica")
    );
    if (nameMatch) return nameMatch;
    return null;
  };

  if (userAgent.includes("firefox")) {
    const firefoxVoice = vs.find(
      (v) => v.voiceURI === "urn:moz-tts:osx:com.apple.voice.compact.es-ES.Monica"
    );
    return firefoxVoice ?? defaultVoice;
  }
  if (userAgent.includes("chrome") && !userAgent.includes("edg")) {
    const chromeVoice = vs.find((v) => v.voiceURI === "Mónica");
    return chromeVoice ?? defaultVoice;
  }
  if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
    return findMonicaVoice() ?? defaultVoice;
  }
  return defaultVoice;
}

function pickEnglishVoice(vs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (vs.length === 0) return null;
  const en = vs.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const enUS = en.filter((v) => v.lang?.toLowerCase() === "en-us");
  const pool = enUS.length ? enUS : en;
  // Prefer well-known natural voices, then a local (non-network) voice.
  const preferredNames = ["samantha", "google us english", "microsoft", "aria", "jenny"];
  for (const name of preferredNames) {
    const match = pool.find((v) => v.name.toLowerCase().includes(name));
    if (match) return match;
  }
  const local = pool.find((v) => v.localService);
  return local ?? pool[0] ?? vs[0] ?? null;
}

// ---------------------------------------------------------------------------
// Spanish config
// ---------------------------------------------------------------------------

function normalizeES(raw: string): string {
  // Strip common Spanish leading articles / contractions (helps with STT).
  return baseNormalize(raw)
    .replace(/^(el|la|los|las|un|una|unos|unas|al|del)\s+/i, "")
    .trim();
}

function buildSpanishPhraseHints(answer: string): string[] {
  const a = answer.trim();
  const aNoDiacritics = removeDiacritics(a);
  const aNtildeToN = a.replace(/[ñÑ]/g, (m) => (m === "Ñ" ? "N" : "n"));
  const aNoDiacriticsNtildeToN = removeDiacritics(aNtildeToN);
  const lower = a.toLowerCase();
  const pluralS = lower.endsWith("s") ? a.slice(0, -1) : `${a}s`;
  const pluralEs = lower.endsWith("s") ? a : `${a}es`;
  return uniqueNonEmpty([
    a,
    aNoDiacritics,
    aNtildeToN,
    aNoDiacriticsNtildeToN,
    pluralS,
    removeDiacritics(pluralS),
    pluralEs,
    removeDiacritics(pluralEs),
    `el ${a}`,
    `la ${a}`,
  ]).slice(0, 10);
}

// The "skip" wake command. "pasalacabra" / "pasa la cabra" is the trigger in
// both locales; English additionally accepts the plain word "pass".
const WAKE_JOINED = ["pasalacabra", "pasapalabra"];
const WAKE_TOKENS = ["pasa", "cabra"];
// Phrase-list hints so the recognizer is biased toward the wake command.
const WAKE_HINTS_ES = ["pasalacabra", "pasapalabra", "pasa", "cabra"];
const WAKE_HINTS_EN = ["pass", "pasa la cabra", "pasalacabra"];

// Shared wake-command detector. `extraTokens` lets a locale accept additional
// single-word triggers (e.g. English "pass").
function detectWakeCommand(normalized: string, extraTokens: string[] = []): boolean {
  const joined = normalized.replace(/\s+/g, "");
  if (!joined) return false;
  if (WAKE_JOINED.some((w) => joined.includes(w))) return true;
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  return WAKE_TOKENS.some((t) => tokens.includes(t)) || extraTokens.some((t) => tokens.includes(t));
}

const ES_STRINGS: LocaleStrings = {
  tagline: "Conoces este juego 😉. Intenta terminar la rueda diaria antes de que se acabe el tiempo.",
  playToday: "Juego de hoy",
  createGame: "Crea tu proprio juego",
  createGameHint: "O personaliza tu propio juego para jugar en familia o amigos o solo.",
  howToPlayLabel: "📖  Cómo Jugar",
  aboutLabel: "❓ ¿Y esto de dónde ha salido?",
  playerName: "Jugador",
  ttsTimeUp: "Tieeeeeeeempoo!",
  startButton: "Empezar",
  pasalacabraButton: "Pasalacabra",
  overrideCorrect: "Oye! La respuesta era correcta",
  micPermissionDenied:
    "⚠️ Para poder jugar tienes que dar acceso al micrófono de tu teléfono para responder a las preguntas. Cierra la página y vuelve a abrirla para dar acceso y volver a intentarlo.",
  listening: "Escuchando…",
  micReady: "Micrófono listo",
  sttUnsupportedShort: "Intenta jugar con otro navegador",
  sttUnsupportedPlaceholder:
    "Tu navegador no soporta reconocimiento de voz: prueba a usar otro buscador",
  noticePrefix: "Aviso: ",
  answerLabel: "Respuesta: ",
  ttsYes: "Sí",
  ttsCorrectAnswerPrefix: "No. La respuesta correcta es: ",
  finishedWheel: "🎉 ¡Increíble! Has acabado toda la rueda, las cabras están muy impresionadas 🐐.",
  gameOver: "🎮 Fin del juego.",
  gameOverBanner: "🎮 Fin del juego!",
  gameOverPlain: "Fin del juego.",
  timeUp: "⏱️ Tiempo. Fin del juego.",
  shareButton: "📤 Compartir",
  showAnswers: "📋 Mostrar Respuestas",
  hideAnswers: "🔼 Ocultar Respuestas",
  sharePhotos: "📤 Compartir fotos",
  recordAndSharePhotos: "🎥 Grabar y compartir fotos",
  resultsButton: "📸 Resultados",
  dailyLoadError: "No se pudo cargar el juego de hoy.",
};

export const ES_CONFIG: LocaleConfig = {
  locale: "es",
  letters: SPANISH_LETTERS,
  sttLang: "es-ES",
  ttsLang: "es-ES",
  dailyStorageKey: "pasalacabra_daily",
  pickVoice: pickSpanishVoice,
  normalizeForCompare: normalizeES,
  isAnswerCorrect(spoken, qa) {
    const s = normalizeES(spoken);
    const candidates = [qa.answer, ...(qa.alt ?? [])];
    return candidates.some((c) => fuzzyEqual(s, normalizeES(c)));
  },
  buildHints(qa) {
    return [...buildSpanishPhraseHints(qa.answer), ...(qa.alt ?? []), ...WAKE_HINTS_ES];
  },
  isWakeCommand(text) {
    return detectWakeCommand(normalizeES(text));
  },
  splitQuestionForTts(qa) {
    const t = qa.question.trim();
    const m = t.match(/^(Con\s+la|Empieza\s+por|Contiene\s+la)\s+([A-ZÑ])\s*:\s*(.+)$/i);
    if (m) return { intro: `${m[1]} ${m[2].toUpperCase()}.`, body: m[3].trim() };
    return { intro: "", body: t };
  },
  displayQuestion(qa) {
    const empieza = new RegExp(`^Empieza por ${qa.letter}:\\s*`, "i");
    const contiene = new RegExp(`^Contiene ${qa.letter}:\\s*`, "i");
    return qa.question.replace(empieza, "").replace(contiene, "");
  },
  shareCaption(correct, wrong, missing) {
    return `Mira mi puntuación!\n🟢 ${correct} · 🔴 ${wrong} · 🔵 ${missing}\nJuega y comparte la tuya en https://pasalacabra.com`;
  },
  formatDateLong: formatDateLongES,
  loadDailySet() {
    const set = getSet("set_01");
    if (!set) throw new Error("Spanish daily set (set_01) not found");
    return Promise.resolve(set);
  },
  strings: ES_STRINGS,
};

// ---------------------------------------------------------------------------
// English config
// ---------------------------------------------------------------------------

function normalizeEN(raw: string): string {
  return baseNormalize(raw)
    .replace(/^(the|a|an)\s+/i, "")
    .trim();
}

const EN_STRINGS: LocaleStrings = {
  tagline: "You know this game 😉. Try to finish the daily wheel before time runs out.",
  playToday: "Today's game",
  createGame: "Create your own game",
  createGameHint: "",
  howToPlayLabel: "📖  How to play",
  aboutLabel: "❓ What is this?",
  playerName: "Player",
  ttsTimeUp: "Ahnd that's Time!",
  startButton: "Start",
  pasalacabraButton: "Pasalacabra",
  overrideCorrect: "Hey! That was correct",
  micPermissionDenied:
    "⚠️ To play you need to grant microphone access so you can answer the questions out loud. Close the page and reopen it to grant access and try again.",
  listening: "Listening…",
  micReady: "Mic ready",
  sttUnsupportedShort: "Try a different browser",
  sttUnsupportedPlaceholder:
    "Your browser doesn't support speech recognition: try a different browser",
  noticePrefix: "Notice: ",
  answerLabel: "Answer: ",
  ttsYes: "Yes",
  ttsCorrectAnswerPrefix: "No. The correct answer is: ",
  finishedWheel: "🎉 Amazing! You finished the whole wheel, the goats are very impressed 🐐.",
  gameOver: "🎮 Game over.",
  gameOverBanner: "🎮 Game over!",
  gameOverPlain: "Game over.",
  timeUp: "⏱️ Time's up. Game over.",
  shareButton: "📤 Share",
  showAnswers: "📋 Show answers",
  hideAnswers: "🔼 Hide answers",
  sharePhotos: "📤 Share photos",
  recordAndSharePhotos: "🎥 Record and share photos",
  resultsButton: "📸 Results",
  dailyLoadError: "Couldn't load today's game.",
};

function englishPrefix(qa: QA): string {
  const mode = qa.mode ?? "starts";
  return mode === "contains" ? `Contains ${qa.letter}` : `Starts with ${qa.letter}`;
}

export const EN_CONFIG: LocaleConfig = {
  locale: "en",
  letters: ENGLISH_LETTERS,
  sttLang: "en-US",
  ttsLang: "en-US",
  dailyStorageKey: "pasalacabra_daily_en",
  pickVoice: pickEnglishVoice,
  normalizeForCompare: normalizeEN,
  isAnswerCorrect(spoken, qa) {
    const s = normalizeEN(spoken);
    const candidates = [qa.answer, ...(qa.alt ?? [])];
    return candidates.some((c) => fuzzyEqual(s, normalizeEN(c)));
  },
  buildHints(qa) {
    // Bias toward the answer, its alternates, and the wake command
    // ("pass" / "pasa la cabra" / "pasalacabra").
    return uniqueNonEmpty([qa.answer, ...(qa.alt ?? []), ...WAKE_HINTS_EN]).slice(0, 10);
  },
  isWakeCommand(text) {
    // Accept the English "pass" as well as the "pasa la cabra" family.
    return detectWakeCommand(normalizeEN(text), ["pass"]);
  },
  splitQuestionForTts(qa) {
    // English feed clues are plain; the prefix comes from `mode`.
    return { intro: `${englishPrefix(qa)}.`, body: qa.question.trim() };
  },
  displayQuestion(qa) {
    // English clues are already plain (no baked-in prefix).
    return qa.question;
  },
  shareCaption(correct, wrong, missing) {
    return `Check out my score!\n🟢 ${correct} · 🔴 ${wrong} · 🔵 ${missing}\nPlay and share yours at https://pasalacabra.com`;
  },
  formatDateLong(d) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  },
  loadDailySet(today) {
    return loadEnglishDailySet(today);
  },
  strings: EN_STRINGS,
};

// ---------------------------------------------------------------------------
// Locale selection (module singleton)
// ---------------------------------------------------------------------------

let cachedLocale: Locale | null = null;
let cachedConfig: LocaleConfig | null = null;

export function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  let locale: Locale = "es";
  try {
    const param = new URLSearchParams(window.location.search).get("lang");
    if (param?.toLowerCase() === "en") locale = "en";
  } catch {
    // Non-browser context; default to Spanish.
  }
  cachedLocale = locale;
  return locale;
}

export function getConfig(): LocaleConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = getLocale() === "en" ? EN_CONFIG : ES_CONFIG;
  return cachedConfig;
}
