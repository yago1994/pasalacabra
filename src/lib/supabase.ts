// Supabase client.
//
// Both env vars are optional on purpose: a build without them behaves exactly
// like the app did before accounts existed (everything stays in localStorage
// and the sign-in entry points hide themselves).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

// Where Supabase sends people back after a magic link / OAuth round trip.
// Keeps the base path so GitHub Pages staging builds come back to /staging/.
export function getAuthRedirectUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${location.origin}${base}`.replace(/\/+$/, "/");
}
