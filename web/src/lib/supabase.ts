// web/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY } from "./supabaseKey";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// Keep the same strict behaviour you had before:
// if env vars are missing, fail fast so we don't run with a half-configured client.
if (!url || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY",
  );
}

export const supabase = createClient(url, SUPABASE_PUBLISHABLE_KEY, {
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

// ── Bound getSession() globally so the app can never hang on it ──────────────
// supabase-js getSession() can stall indefinitely on auth-lock contention or a
// stalled token refresh. ~36 call sites await it to gate "Loading…/Checking
// session" UIs, so a single stall freezes that screen forever. Wrap the public
// method once here: if it hasn't resolved in SESSION_TIMEOUT_MS, report "no
// session" so callers fall through to sign-in instead of spinning. A valid
// session reads from storage in a few ms, so the timeout only ever fires on the
// pathological hang. (Documented at the client so it's discoverable, not hidden.)
const SESSION_TIMEOUT_MS = 4000;
const _origGetSession = supabase.auth.getSession.bind(supabase.auth);
supabase.auth.getSession = ((...args: Parameters<typeof _origGetSession>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ data: { session: null }, error: null }),
      SESSION_TIMEOUT_MS,
    );
  });
  return Promise.race([_origGetSession(...args), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}) as typeof supabase.auth.getSession;
