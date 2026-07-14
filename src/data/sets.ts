// src/data/sets.ts
// - Types for question sets
// - Loader for JSON sets under src/data/sets/*.json (via Vite import.meta.glob)

export const SPANISH_LETTERS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "L",
  "M",
  "N",
  "Ñ",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "X",
  "Y",
  "Z",
] as const;

// English (Reddit daily feed) uses the 26-letter Latin alphabet (no Ñ).
export const ENGLISH_LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
] as const;

// `Letter` is widened to `string` so the same shared paths (statusByLetter maps,
// LetterRing, snapshot composer, engine) work for both the Spanish 27-letter ring
// and the English 26-letter ring. The ES-only custom-game banks still key on these
// values; they were only ever used as map keys / for iteration, never exhaustively.
export type Letter = string;

// `mode` and `alt` come from the English remote daily feed (daily/*.json).
// They are optional so the bundled Spanish sets remain valid.
export type QuestionMode = "starts" | "contains";

export type QA = {
  letter: Letter;
  question: string;
  answer: string;
  mode?: QuestionMode;
  alt?: string[];
};

export type SetDefinition = {
  id: string;
  title?: string;
  questions: QA[];
};

export type SetSummary = Pick<SetDefinition, "id" | "title">;

type SetModule = { default: SetDefinition };

// NOTE: We intentionally avoid direct JSON imports so we don't need `resolveJsonModule`.
const setModules = import.meta.glob("./sets/*.json", { eager: true }) as Record<string, SetModule>;

export function listSets(): SetSummary[] {
  return Object.values(setModules)
    .map((m) => ({ id: m.default.id, title: m.default.title }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getSet(setId: string): SetDefinition | undefined {
  for (const m of Object.values(setModules)) {
    if (m.default.id === setId) return m.default;
  }
  return undefined;
}

export function buildQuestionMap(set: SetDefinition): Map<Letter, QA> {
  const map = new Map<Letter, QA>();
  for (const qa of set.questions) map.set(qa.letter, qa);
  return map;
}

// ---------------------------------------------------------------------------
// English daily set (fetched at runtime from the Reddit content feed on `main`).
// The feed is committed nightly by scripts/generate_reddit_set.py and is
// CORS-open on raw.githubusercontent.com, so no redeploy is needed to update it.
// ---------------------------------------------------------------------------

const RAW_DAILY_BASE = "https://raw.githubusercontent.com/yago1994/pasalacabra/main/daily";

type RemoteQA = {
  letter: string;
  mode: QuestionMode;
  question: string;
  answer: string;
  alt?: string[];
};

type RemoteSet = {
  id: string;
  questions: RemoteQA[];
};

// Use the player's LOCAL calendar day so "today" matches what the player sees
// on their clock (and stays consistent with getDailyGameNo / the footer date,
// which are also local-day based). The feed files are named by date, so this
// resolves to that day's set regardless of the player's UTC offset.
function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function fetchRemoteSet(isoDate: string): Promise<SetDefinition | null> {
  const res = await fetch(`${RAW_DAILY_BASE}/${isoDate}.json`, { cache: "no-store" });
  if (!res.ok) return null;
  const raw = (await res.json()) as RemoteSet;
  if (!raw?.questions?.length) return null;
  return {
    id: raw.id ?? `set-${isoDate}`,
    questions: raw.questions.map((q) => ({
      letter: q.letter,
      question: q.question,
      answer: q.answer,
      mode: q.mode,
      alt: q.alt,
    })),
  };
}

/**
 * Load today's English daily set (by the player's local calendar day). If
 * today's file has not been committed yet (the generator runs at 01:30 UTC, so
 * players ahead of UTC may briefly be a day early), fall back to yesterday's
 * file so the game is always playable. Throws if neither is available.
 */
export async function loadEnglishDailySet(today: Date = new Date()): Promise<SetDefinition> {
  const todayIso = isoDateLocal(today);
  const todaySet = await fetchRemoteSet(todayIso);
  if (todaySet) return todaySet;

  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdaySet = await fetchRemoteSet(isoDateLocal(yesterday));
  if (yesterdaySet) return yesterdaySet;

  throw new Error(`No English daily set available for ${todayIso}`);
}


