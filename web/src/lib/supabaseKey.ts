// web/src/lib/supabaseKey.ts
//
// Single source for the browser-side Supabase publishable (anon-equivalent) key,
// during the legacy → new-key migration. Prefers the new publishable key
// (sb_publishable_…); falls back to the legacy anon key so nothing breaks before
// the new key is set. The publishable key carries the same low privileges as anon,
// so RLS behaves identically. Used by every browser Supabase client.
export const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  "";
