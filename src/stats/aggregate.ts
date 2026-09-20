// Turns a list of played games into the numbers the stats screens show.
// Everything is derived in the client: a few hundred rows is nothing, and it
// keeps the database to two plain tables.
import { SPANISH_LETTERS, type Letter } from "../data/sets";
import { LETTERS_PER_GAME, type GameResult } from "./types";

export type DistributionBucket = {
  label: string;
  min: number;
  max: number;
  count: number;
};

export type LetterStat = {
  letter: Letter;
  /** How many games where this letter was answered one way or the other. */
  seen: number;
  correct: number;
  /** null until the letter has been seen at least once. */
  pct: number | null;
};

export type Stats = {
  played: number;
  averageCorrect: number;
  averagePct: number;
  perfectCount: number;
  bestScore: number;
  /** Daily game number of the best score; newest wins on a tie. */
  bestScoreGameNo: number | null;
  fastestSeconds: number | null;
  distribution: DistributionBucket[];
  letters: LetterStat[];
  bestLetter: LetterStat | null;
  worstLetter: LetterStat | null;
};

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "0–4", min: 0, max: 4 },
  { label: "5–9", min: 5, max: 9 },
  { label: "10–14", min: 10, max: 14 },
  { label: "15–19", min: 15, max: 19 },
  { label: "20–24", min: 20, max: 24 },
  { label: "25", min: 25, max: 25 },
];

/** A letter needs this many plays before it can be called your best or worst. */
const MIN_LETTER_SAMPLES = 3;

export function bucketIndexFor(correctCount: number): number {
  const index = BUCKETS.findIndex((b) => correctCount >= b.min && correctCount <= b.max);
  return index === -1 ? 0 : index;
}

/** Only first attempts count, so replaying an old game can't inflate stats. */
export function firstAttempts(results: GameResult[]): GameResult[] {
  return results.filter((r) => r.attempt === 1);
}

export function computeStats(results: GameResult[]): Stats {
  const games = firstAttempts(results);

  const distribution: DistributionBucket[] = BUCKETS.map((b) => ({ ...b, count: 0 }));
  const seen = new Map<Letter, number>();
  const correct = new Map<Letter, number>();

  let totalCorrect = 0;
  let perfectCount = 0;
  let bestScore = 0;
  let bestScoreGameNo: number | null = null;
  let fastestSeconds: number | null = null;

  for (const game of games) {
    totalCorrect += game.correctCount;
    if (game.correctCount === LETTERS_PER_GAME) perfectCount++;
    if (
      game.correctCount > bestScore ||
      (game.correctCount === bestScore &&
        (bestScoreGameNo === null || game.gameNo > bestScoreGameNo))
    ) {
      bestScore = game.correctCount;
      bestScoreGameNo = game.gameNo;
    }
    if (
      game.secondsUsed != null &&
      game.correctCount === LETTERS_PER_GAME &&
      (fastestSeconds === null || game.secondsUsed < fastestSeconds)
    ) {
      fastestSeconds = game.secondsUsed;
    }
    distribution[bucketIndexFor(game.correctCount)].count++;

    for (const letter of SPANISH_LETTERS) {
      const status = game.letters[letter];
      if (status !== "correct" && status !== "wrong") continue;
      seen.set(letter, (seen.get(letter) ?? 0) + 1);
      if (status === "correct") correct.set(letter, (correct.get(letter) ?? 0) + 1);
    }
  }

  const letters: LetterStat[] = SPANISH_LETTERS.map((letter) => {
    const letterSeen = seen.get(letter) ?? 0;
    const letterCorrect = correct.get(letter) ?? 0;
    return {
      letter,
      seen: letterSeen,
      correct: letterCorrect,
      pct: letterSeen === 0 ? null : Math.round((letterCorrect / letterSeen) * 100),
    };
  });

  const ranked = letters
    .filter((l) => l.seen >= MIN_LETTER_SAMPLES && l.pct !== null)
    .sort((a, b) => (b.pct as number) - (a.pct as number) || b.seen - a.seen);

  const played = games.length;

  return {
    played,
    averageCorrect: played === 0 ? 0 : totalCorrect / played,
    averagePct: played === 0 ? 0 : Math.round((totalCorrect / (played * LETTERS_PER_GAME)) * 100),
    perfectCount,
    bestScore,
    bestScoreGameNo,
    fastestSeconds,
    distribution,
    letters,
    bestLetter: ranked.length > 0 ? ranked[0] : null,
    worstLetter: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  };
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
