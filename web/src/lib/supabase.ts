// web/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Keep the same strict behaviour you had before:
// if env vars are missing, fail fast so we don't run with a half-configured client.
if (!url || !anon) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, anon, {
  auth: {
    // same auth config as your last working version
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  // NEW: Realtime config (non-breaking)
  realtime: {
    params: {
      // keep this modest – enough for live tickets updates without being noisy
      eventsPerSecond: 2,
    },
  },
});
