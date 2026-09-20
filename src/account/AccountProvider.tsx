import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getAuthRedirectUrl, getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { isStagingMode } from "../env/getSpeechTokenUrl";
import { listLocalResults, saveLocalResult } from "../stats/localResults";
import { fetchProfile, fetchResults, pushLocalResults, saveResult, setSubscriptionStub } from "../stats/api";
import type { GameResult, Profile } from "../stats/types";
import { AccountContext, type AccountValue, type NewGameResult } from "./context";

function nextAttempt(results: GameResult[], gameNo: number): number {
  const played = results.filter((r) => r.gameNo === gameNo);
  return played.length === 0 ? 1 : Math.max(...played.map((r) => r.attempt)) + 1;
}

export default function AccountProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabase(), []);
  const accountsEnabled = isSupabaseConfigured();

  const [user, setUser] = useState<User | null>(null);
  // Cloud state is only meaningful while signed in; the device list is what
  // everyone else sees. Both are kept apart so signing out needs no cleanup
  // pass over state that React can derive.
  const [cloudProfile, setCloudProfile] = useState<Profile | null>(null);
  const [cloudResults, setCloudResults] = useState<GameResult[]>([]);
  const [deviceResults, setDeviceResults] = useState<GameResult[]>(() => listLocalResults());
  const [loading, setLoading] = useState<boolean>(accountsEnabled);
  const [resultsLoading, setResultsLoading] = useState<boolean>(false);
  const [justMigrated, setJustMigrated] = useState<number>(0);

  // Session: restore on load, then follow sign-in / sign-out / token refresh.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Signing in moves this device's games into the account, then we read the
  // account back. Signed out, `results` falls back to the device list below.
  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;

    (async () => {
      setResultsLoading(true);
      const migrated = await pushLocalResults(user.id);
      if (cancelled) return;
      if (migrated > 0) {
        setJustMigrated(migrated);
        setDeviceResults([]);
      }

      const [nextProfile, nextResults] = await Promise.all([
        fetchProfile(user.id),
        fetchResults(user.id),
      ]);
      if (cancelled) return;
      setCloudProfile(nextProfile);
      setCloudResults(nextResults);
      setResultsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  const profile = user ? cloudProfile : null;
  const results = user ? cloudResults : deviceResults;

  const recordResult = useCallback(
    async (draft: NewGameResult) => {
      const result: GameResult = { ...draft, attempt: nextAttempt(results, draft.gameNo) };
      if (user) {
        const saved = await saveResult(user.id, result);
        if (saved) setCloudResults((prev) => [saved, ...prev]);
        return;
      }
      setDeviceResults(saveLocalResult(result));
    },
    [results, user]
  );

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return { error: "Las cuentas no están configuradas." };
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getAuthRedirectUrl() },
    });
    return { error: error?.message ?? null };
  }, [supabase]);

  const signInWithEmail = useCallback(
    async (email: string) => {
      if (!supabase) return { error: "Las cuentas no están configuradas." };
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setCloudProfile(null);
    setCloudResults([]);
    setJustMigrated(0);
    setDeviceResults(listLocalResults());
  }, [supabase]);

  const grantStubSubscription = useCallback(
    async (active: boolean) => {
      if (!user) return;
      const ok = await setSubscriptionStub(active);
      if (!ok) return;
      setCloudProfile(await fetchProfile(user.id));
    },
    [user]
  );

  const value: AccountValue = useMemo(
    () => ({
      accountsEnabled,
      loading,
      signedIn: Boolean(user),
      userId: user?.id ?? null,
      email: user?.email ?? null,
      displayName:
        profile?.displayName ??
        (user?.user_metadata?.full_name as string | undefined) ??
        user?.email?.split("@")[0] ??
        null,
      profile,
      results,
      resultsLoading,
      isSubscriber: profile?.isSubscriber ?? false,
      justMigrated,
      // The stub only exists off production so nobody can hand themselves a
      // subscription on pasalacabra.com before Stripe is wired.
      canStubSubscription: Boolean(user) && (isStagingMode() || import.meta.env.VITE_ALLOW_SUB_STUB === "true"),
      recordResult,
      signInWithGoogle,
      signInWithEmail,
      signOut,
      grantStubSubscription,
    }),
    [
      accountsEnabled,
      loading,
      user,
      profile,
      results,
      resultsLoading,
      justMigrated,
      recordResult,
      signInWithGoogle,
      signInWithEmail,
      signOut,
      grantStubSubscription,
    ]
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
