// src/data/sets.ts
// - Types for question sets
// - Loader for JSON sets under src/data/sets/*.json (via Vite import.meta.glob)

import type { Topic } from "../questions/types";

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

export type Letter = (typeof SPANISH_LETTERS)[number];

export type QA = {
  letter: Letter;
  question: string;
  answer: string;
  /**
   * Which topic the question came from. Optional because the sets generated
   * before the daily generator started emitting it have no topic.
   */
  topic?: Topic;
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

// The daily games, one file per day: daily/es/YYYY-MM-DD.json. Lazy, so each
// day is its own small chunk fetched on demand instead of the whole history
// landing in the main bundle.
const dailyLoaders = import.meta.glob<SetDefinition>("/daily/es/*.json", { import: "default" });

/** The days that have a set, oldest first ("YYYY-MM-DD"). */
export const DAILY_SET_DAYS: string[] = Object.keys(dailyLoaders)
  .map((path) => path.slice(path.lastIndexOf("/") + 1, -".json".length))
  .sort();

// Daily sets already fetched, so getSet() can find them by id.
const loadedSets = new Map<string, SetDefinition>();

export function getSet(setId: string): SetDefinition | undefined {
  const loaded = loadedSets.get(setId);
  if (loaded) return loaded;
  for (const m of Object.values(setModules)) {
    if (m.default.id === setId) return m.default;
  }
  return undefined;
}

/** Local calendar day as "YYYY-MM-DD" — the day a daily game is played. */
export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The daily set for a day. Falls back to the latest earlier day if that day's
 * file is missing (e.g. the generator failed), and to undefined if there are
 * no daily sets at all. Once loaded, the set is also reachable via getSet().
 */
export async function loadDailySet(d: Date): Promise<SetDefinition | undefined> {
  const wanted = localDayKey(d);
  let day: string | undefined;
  for (const candidate of DAILY_SET_DAYS) {
    if (candidate > wanted) break;
    day = candidate;
  }
  if (!day) return undefined;
  const set = await dailyLoaders[`/daily/es/${day}.json`]();
  loadedSets.set(set.id, set);
  return set;
}

export function buildQuestionMap(set: SetDefinition): Map<Letter, QA> {
  const map = new Map<Letter, QA>();
  for (const qa of set.questions) map.set(qa.letter, qa);
  return map;
}


