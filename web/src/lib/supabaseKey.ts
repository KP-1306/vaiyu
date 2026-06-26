// web/src/lib/supabaseKey.ts
//
// Single source for the browser-side Supabase publishable (anon-equivalent) key.
// The legacy anon key was revoked (2026-06-26); the browser now uses ONLY the new
// publishable key (sb_publishable_…). It carries the same low privileges as the
// old anon key, so RLS behaves identically. Used by every browser Supabase client.
export const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
