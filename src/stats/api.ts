// Reads and writes against Supabase. Every function is a no-op that resolves
// to null/[] when Supabase is not configured, so callers never need to branch.
import { getSupabase } from "../lib/supabase";
import { clearLocalResults, listLocalResults } from "./localResults";
import type { GameResult, LettersMap, Profile } from "./types";
import type { DifficultyMode } from "../game/engine";

/** Postgres unique-violation: this rosco+attempt is already stored. */
const UNIQUE_VIOLATION = "23505";

type GameResultRow = {
  game_no: number;
  attempt: number;
  played_at: string;
  set_id: string;
  difficulty: string;
  correct_count: number;
  wrong_count: number;
  passed_count: number;
  unanswered_count: number;
  seconds_used: number | null;
  letters: LettersMap;
};

function toRow(userId: string, result: GameResult) {
  return {
    user_id: userId,
    game_no: result.gameNo,
    attempt: result.attempt,
    played_at: result.playedAt,
    set_id: result.setId,
    difficulty: result.difficulty,
    correct_count: result.correctCount,
    wrong_count: result.wrongCount,
    passed_count: result.passedCount,
    unanswered_count: result.unansweredCount,
    seconds_used: result.secondsUsed,
    letters: result.letters,
  };
}

function fromRow(row: GameResultRow): GameResult {
  return {
    gameNo: row.game_no,
    attempt: row.attempt,
    playedAt: row.played_at,
    setId: row.set_id,
    difficulty: row.difficulty as DifficultyMode,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    passedCount: row.passed_count,
    unansweredCount: row.unanswered_count,
    secondsUsed: row.seconds_used,
    letters: row.letters ?? {},
  };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, created_at, is_subscriber, subscription_source, subscription_status, subscription_period_end")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn("Failed to load profile:", error.message);
    return null;
  }
  return {
    id: data.id,
    displayName: data.display_name,
    createdAt: data.created_at,
    isSubscriber: data.is_subscriber,
    subscriptionSource: data.subscription_source,
    subscriptionStatus: data.subscription_status,
    subscriptionPeriodEnd: data.subscription_period_end,
  };
}

export async function fetchResults(userId: string): Promise<GameResult[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("game_results")
    .select("game_no, attempt, played_at, set_id, difficulty, correct_count, wrong_count, passed_count, unanswered_count, seconds_used, letters")
    .eq("user_id", userId)
    .order("game_no", { ascending: false })
    .limit(500);
  if (error || !data) {
    if (error) console.warn("Failed to load results:", error.message);
    return [];
  }
  return (data as GameResultRow[]).map(fromRow);
}

/**
 * Store one played rosco. If that attempt number is taken (two devices, same
 * rosco) we walk the attempt up rather than losing the game.
 */
export async function saveResult(userId: string, result: GameResult): Promise<GameResult | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  for (let attempt = result.attempt; attempt < result.attempt + 5; attempt++) {
    const candidate = { ...result, attempt };
    const { error } = await supabase.from("game_results").insert(toRow(userId, candidate));
    if (!error) return candidate;
    if (error.code !== UNIQUE_VIOLATION) {
      console.warn("Failed to save result:", error.message);
      return null;
    }
  }
  return null;
}

/**
 * Move whatever this device has into the account, then forget it locally.
 * Duplicates are skipped, so signing in on a device twice is harmless.
 * Returns how many games were added.
 */
export async function pushLocalResults(userId: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const local = listLocalResults();
  if (local.length === 0) return 0;

  let added = 0;
  for (const result of local) {
    const { error } = await supabase.from("game_results").insert(toRow(userId, result));
    if (!error) {
      added++;
    } else if (error.code !== UNIQUE_VIOLATION) {
      // Something other than "already there" — keep the local copy and stop,
      // so nothing is dropped on a flaky connection.
      console.warn("Failed to migrate a local result:", error.message);
      return added;
    }
  }
  clearLocalResults();
  return added;
}

/** Dev-only subscription switch. Real Stripe wiring replaces this. */
export async function setSubscriptionStub(active: boolean): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.rpc("set_subscription_stub", { active });
  if (error) {
    console.warn("Failed to set the subscription stub:", error.message);
    return false;
  }
  return true;
}
