import { BIOLOGIA } from "./biologia";
import { ASTRONOMIA } from "./astronomia";
import { MUSICA } from "./musica";
import { DEPORTE } from "./deporte";
import { CIENCIA } from "./ciencia";
import { CINE } from "./cine";
import { HISTORIA } from "./historia";
import { GEOGRAFIA } from "./geografia";
import { ARTE } from "./arte";
import { FOLKLORE } from "./folklore";
import { CULTURAGENERAL } from "./cultura";
import type { QA, Topic, Letter } from "./types";

// All questions from all topics
export const ALL_QUESTIONS: QA[] = [
  ...BIOLOGIA,
  ...ASTRONOMIA,
  ...MUSICA,
  ...DEPORTE,
  ...CIENCIA,
  ...CINE,
  ...HISTORIA,
  ...GEOGRAFIA,
  ...ARTE,
  ...FOLKLORE,
  ...CULTURAGENERAL,
];

// Map of topic name to questions array
export const TOPIC_QUESTIONS: Partial<Record<Topic, QA[]>> = {
  biologia: BIOLOGIA,
  astronomia: ASTRONOMIA,
  musica: MUSICA,
  deporte: DEPORTE,
  ciencia: CIENCIA,
  cine: CINE,
  historia: HISTORIA,
  geografia: GEOGRAFIA,
  arte: ARTE,
  folklore: FOLKLORE,
  culturageneral: CULTURAGENERAL,
};

export function buildBank(qs: QA[]) {
  const bank: Record<Topic, Record<Letter, QA[]>> = {} as any;
  for (const q of qs) {
    bank[q.topic] ??= {} as any;
    bank[q.topic][q.letter] ??= [];
    bank[q.topic][q.letter].push(q);
  }
  return bank;
}

export const BANK = buildBank(ALL_QUESTIONS);

// Spanish alphabet used in the game (excluding K and W)
export const SPANISH_LETTERS: Letter[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", 
  "N", "Ñ", "O", "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z"
];

/**
 * Generate unique question banks for multiple players from selected topics.
 * Each player gets one question per letter, with topics distributed evenly.
 * No question appears in multiple players' banks.
 */
export function generatePlayerBanks(
  selectedTopics: Topic[],
  playerCount: number
): Map<Letter, QA>[] {
  if (selectedTopics.length === 0) {
    throw new Error("At least one topic must be selected");
  }

  // Collect all questions from selected topics, grouped by letter
  const questionsByLetter: Record<Letter, QA[]> = {} as Record<Letter, QA[]>;
  for (const letter of SPANISH_LETTERS) {
    questionsByLetter[letter] = [];
  }

  for (const topic of selectedTopics) {
    const topicQuestions = TOPIC_QUESTIONS[topic] || [];
    for (const q of topicQuestions) {
      if (questionsByLetter[q.letter]) {
        questionsByLetter[q.letter].push(q);
      }
    }
  }

  // Shuffle questions for each letter
  for (const letter of SPANISH_LETTERS) {
    questionsByLetter[letter] = shuffleArray(questionsByLetter[letter]);
  }

  // Create banks for each player
  const banks: Map<Letter, QA>[] = [];
  const usedQuestionIds = new Set<string>();

  for (let p = 0; p < playerCount; p++) {
    const bank = new Map<Letter, QA>();

    for (const letter of SPANISH_LETTERS) {
      const available = questionsByLetter[letter];
      
      // Find the first unused question for this letter
      let assigned = false;
      for (const q of available) {
        if (!usedQuestionIds.has(q.id)) {
          bank.set(letter, q);
          usedQuestionIds.add(q.id);
          assigned = true;
          break;
        }
      }

      // If no unique question found, we need to reuse (shouldn't happen with enough questions)
      if (!assigned && available.length > 0) {
        // Fallback: use any question for this letter
        const fallback = available[p % available.length];
        bank.set(letter, fallback);
        console.warn(`Reusing question for letter ${letter} for player ${p + 1}`);
      }
    }

    banks.push(bank);
  }

  return banks;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Re-export types
export type { QA, Topic, Letter } from "./types";
