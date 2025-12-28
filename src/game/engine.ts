// src/game/engine.ts
// Pure game logic (no UI, no hardcoded question text)

import type { Letter } from "../data/sets";

export type LetterStatus = "pending" | "current" | "passed" | "correct" | "wrong";

// Session
export type Player = { id: string; name: string; setId: string };
export type DifficultyMode = "dificil" | "medio" | "facil";
export type GameSession = { players: Player[]; currentPlayerIndex: number; difficulty: DifficultyMode };

// Progress tracking (per player)
export type PlayerState = {
  statusByLetter: Record<Letter, LetterStatus>;
  currentIndex: number;
  timeLeft: number;
  revealed: boolean;
};

export type TurnEvent =
  | { type: "reveal" }
  | { type: "correct" }
  | { type: "wrong" }
  | { type: "pasalacabra" }
  | { type: "tick" };

export type TurnResult = {
  state: PlayerState;
  // If true, UI should end the current player's turn (e.g. wrong/pasalacabra/timeout).
  turnEnded: boolean;
};

export function createInitialStatusByLetter(letters: readonly Letter[]): Record<Letter, LetterStatus> {
  const initial = {} as Record<Letter, LetterStatus>;
  for (const l of letters) initial[l] = "pending";
  if (letters.length > 0) initial[letters[0]] = "current";
  return initial;
}

export function nextUnresolvedIndex(
  letters: readonly Letter[],
  statusByLetter: Record<Letter, LetterStatus>,
  startFrom: number
): number {
  for (let offset = 1; offset <= letters.length; offset++) {
    const idx = (startFrom + offset) % letters.length;
    const l = letters[idx];
    const st = statusByLetter[l];
    if (st === "pending" || st === "passed" || st === "current") return idx;
  }
  return -1;
}

export function ensureCurrentLetter(
  letters: readonly Letter[],
  statusByLetter: Record<Letter, LetterStatus>,
  currentIndex: number
): Record<Letter, LetterStatus> {
  const next = { ...statusByLetter };
  for (const l of letters) {
    if (next[l] === "current") next[l] = "pending";
  }
  const cur = letters[currentIndex];
  if (cur) {
    next[cur] = next[cur] === "correct" || next[cur] === "wrong" ? next[cur] : "current";
  }
  return next;
}

export function createInitialPlayerState(letters: readonly Letter[], turnSeconds: number): PlayerState {
  return {
    statusByLetter: createInitialStatusByLetter(letters),
    currentIndex: 0,
    timeLeft: turnSeconds,
    revealed: false,
  };
}

export function reduceTurn(
  state: PlayerState,
  letters: readonly Letter[],
  event: TurnEvent
): TurnResult {
  const curLetter = letters[state.currentIndex];
  const status = state.statusByLetter[curLetter];

  switch (event.type) {
    case "tick": {
      const timeLeft = Math.max(0, state.timeLeft - 1);
      return { state: { ...state, timeLeft }, turnEnded: timeLeft === 0 };
    }
    case "reveal":
      return { state: { ...state, revealed: true }, turnEnded: false };
    case "correct": {
      if (!curLetter) return { state, turnEnded: false };
      const statusByLetter = ensureCurrentLetter(letters, { ...state.statusByLetter, [curLetter]: "correct" }, state.currentIndex);
      const nextIdx = nextUnresolvedIndex(letters, statusByLetter, state.currentIndex);
      return {
        state: {
          ...state,
          statusByLetter,
          currentIndex: nextIdx === -1 ? state.currentIndex : nextIdx,
          revealed: false,
        },
        turnEnded: false,
      };
    }
    case "wrong": {
      if (!curLetter) return { state, turnEnded: true };
      const statusByLetter = ensureCurrentLetter(letters, { ...state.statusByLetter, [curLetter]: "wrong" }, state.currentIndex);
      const nextIdx = nextUnresolvedIndex(letters, statusByLetter, state.currentIndex);
      return {
        state: {
          ...state,
          statusByLetter,
          currentIndex: nextIdx === -1 ? state.currentIndex : nextIdx,
          revealed: false,
        },
        turnEnded: true,
      };
    }
    case "pasalacabra": {
      if (!curLetter) return { state, turnEnded: true };
      const nextStatus: LetterStatus = status === "current" || status === "pending" ? "passed" : status;
      const statusByLetter = ensureCurrentLetter(letters, { ...state.statusByLetter, [curLetter]: nextStatus }, state.currentIndex);
      const nextIdx = nextUnresolvedIndex(letters, statusByLetter, state.currentIndex);
      return {
        state: {
          ...state,
          statusByLetter,
          currentIndex: nextIdx === -1 ? state.currentIndex : nextIdx,
          revealed: false,
          // timer handling is a UI concern; if you want "pasalacabra stops timer", end the turn here.
        },
        turnEnded: true,
      };
    }
  }
}

export function startPlayerTurn(state: PlayerState, turnSeconds: number): PlayerState {
  return { ...state, timeLeft: turnSeconds, revealed: false };
}


