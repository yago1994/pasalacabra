// Results kept on the device.
//
// Everyone gets these, signed in or not — they are what the app shows before
// an account exists, and what gets pushed up the first time someone signs in.
// Snapshots (the photo) stay in the older `pasalacabra_daily` key; this store
// is small on purpose so it never fights the localStorage quota.
import type { GameResult } from "./types";

const RESULTS_KEY = "pasalacabra_results";
/** The pre-accounts key: a single object holding only today's game. */
const LEGACY_DAILY_KEY = "pasalacabra_daily";
const MAX_LOCAL_RESULTS = 60;

function readRaw(): GameResult[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GameResult[]) : [];
  } catch (err) {
    console.warn("Failed to read local results:", err);
    return [];
  }
}

function writeRaw(results: GameResult[]) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(results.slice(0, MAX_LOCAL_RESULTS)));
  } catch (err) {
    console.warn("Failed to write local results:", err);
  }
}

/**
 * Pull the single legacy daily record into the list, once. Without this, the
 * game someone played yesterday would vanish the day accounts ship.
 */
function migrateLegacyDaily(results: GameResult[]): GameResult[] {
  try {
    const raw = localStorage.getItem(LEGACY_DAILY_KEY);
    if (!raw) return results;
    const saved = JSON.parse(raw) as {
      gameNo?: number;
      completedAt?: string;
      statusByLetter?: GameResult["letters"];
      correctCount?: number;
      wrongCount?: number;
    };
    if (typeof saved.gameNo !== "number") return results;
    if (results.some((r) => r.gameNo === saved.gameNo && r.attempt === 1)) return results;

    const migrated: GameResult = {
      gameNo: saved.gameNo,
      attempt: 1,
      playedAt: saved.completedAt ?? new Date().toISOString(),
      setId: "set_01",
      difficulty: "medio",
      correctCount: saved.correctCount ?? 0,
      wrongCount: saved.wrongCount ?? 0,
      passedCount: 0,
      unansweredCount: 0,
      secondsUsed: null,
      letters: saved.statusByLetter ?? {},
    };
    const next = sortByGameNo([...results, migrated]);
    writeRaw(next);
    return next;
  } catch (err) {
    console.warn("Failed to migrate the legacy daily result:", err);
    return results;
  }
}

function sortByGameNo(results: GameResult[]): GameResult[] {
  return [...results].sort((a, b) => b.gameNo - a.gameNo || b.attempt - a.attempt);
}

export function listLocalResults(): GameResult[] {
  return migrateLegacyDaily(sortByGameNo(readRaw()));
}

/** Next attempt number for a rosco on this device (1 when never played). */
export function nextLocalAttempt(gameNo: number): number {
  const played = listLocalResults().filter((r) => r.gameNo === gameNo);
  return played.length === 0 ? 1 : Math.max(...played.map((r) => r.attempt)) + 1;
}

export function saveLocalResult(result: GameResult): GameResult[] {
  const existing = listLocalResults().filter(
    (r) => !(r.gameNo === result.gameNo && r.attempt === result.attempt)
  );
  const next = sortByGameNo([...existing, result]);
  writeRaw(next);
  return next;
}

export function clearLocalResults() {
  try {
    localStorage.removeItem(RESULTS_KEY);
  } catch (err) {
    console.warn("Failed to clear local results:", err);
  }
}
