import type { Letter } from "../data/sets";
import type { DifficultyMode, LetterStatus } from "../game/engine";

/** What happened to each letter of a game. Missing letter = never reached. */
export type LettersMap = Partial<Record<Letter, LetterStatus>>;

/** One game played, in app-facing shape (camelCase, ISO dates). */
export type GameResult = {
  gameNo: number;
  /** 1 = the first time this user played this game. Only attempt 1 counts for stats. */
  attempt: number;
  playedAt: string;
  setId: string;
  difficulty: DifficultyMode;
  correctCount: number;
  wrongCount: number;
  passedCount: number;
  unansweredCount: number;
  secondsUsed: number | null;
  letters: LettersMap;
};

export type Profile = {
  id: string;
  displayName: string | null;
  createdAt: string;
  isSubscriber: boolean;
  subscriptionSource: "none" | "stub" | "stripe";
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
};

export const LETTERS_PER_GAME = 25;
