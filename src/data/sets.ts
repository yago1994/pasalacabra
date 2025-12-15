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

export type Letter = (typeof SPANISH_LETTERS)[number];

export type QA = {
  letter: Letter;
  question: string;
  answer: string;
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


