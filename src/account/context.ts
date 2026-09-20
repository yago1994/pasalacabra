import { createContext, useContext } from "react";
import type { GameResult, Profile } from "../stats/types";

export type NewGameResult = Omit<GameResult, "attempt">;

export type AccountValue = {
  /** Whether Supabase is wired up at all. False = the app runs account-less. */
  accountsEnabled: boolean;
  loading: boolean;
  signedIn: boolean;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  profile: Profile | null;
  /** Every game this person has played: from the cloud when signed in, from this device otherwise. */
  results: GameResult[];
  resultsLoading: boolean;
  isSubscriber: boolean;
  /** How many device games were just pulled into the account (for the welcome line). */
  justMigrated: number;
  /** True right after signing out: the games are in the account, not gone. */
  justSignedOut: boolean;
  /** True when the dev subscription switch is available (staging / local builds). */
  canStubSubscription: boolean;
  recordResult: (result: NewGameResult) => Promise<void>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  grantStubSubscription: (active: boolean) => Promise<void>;
};

export const AccountContext = createContext<AccountValue | null>(null);

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside <AccountProvider>");
  return value;
}
