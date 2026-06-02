// web/src/lib/devAuth.ts
//
// DEVELOPMENT-ONLY auto sign-in for browser-agent / Playwright testing.
//
// This module produces a REAL Supabase session against a seeded test user.
// It does NOT bypass AuthGate, RLS, RPCs, or Edge Functions — every downstream
// layer behaves exactly as in production. The only friction removed is the
// magic-link / OTP step.
//
// Activation requires ALL THREE conditions:
//   1. import.meta.env.DEV === true        (false in `vite build` output)
//   2. VITE_DEV_AUTH_BYPASS === "true"     (per-developer opt-in)
//   3. VITE_SUPABASE_URL points to localhost / 127.0.0.1, OR matches the
//      explicit allow-listed project ref in VITE_DEV_AUTH_ALLOWED_PROJECT_REF
//
// If any check fails the function early-returns and does nothing. In a
// production build the whole module is statically dead and tree-shaken.

import { supabase } from "./supabase";
import { persistRole } from "./auth";

const BYPASS_MARKER = "[DEV AUTH BYPASS ACTIVE]";

type DevAuthEnv = {
  enabled: boolean;
  email: string;
  password: string;
  supabaseUrl: string;
  allowedProjectRef: string;
};

function readEnv(): DevAuthEnv {
  return {
    enabled: import.meta.env.VITE_DEV_AUTH_BYPASS === "true",
    email: (import.meta.env.VITE_DEV_AUTH_EMAIL as string) || "",
    password: (import.meta.env.VITE_DEV_AUTH_PASSWORD as string) || "",
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string) || "",
    allowedProjectRef:
      (import.meta.env.VITE_DEV_AUTH_ALLOWED_PROJECT_REF as string) || "",
  };
}

function isSupabaseUrlSafe(url: string, allowedProjectRef: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    if (!allowedProjectRef) return false;
    // Supabase cloud URLs look like https://<ref>.supabase.co
    return u.hostname === `${allowedProjectRef}.supabase.co`;
  } catch {
    return false;
  }
}

/**
 * Attempt a dev-only auto sign-in. Safe to call unconditionally on app boot:
 * it short-circuits in production builds and when the opt-in env is unset.
 * Resolves once the session is established (or immediately on a no-op).
 */
export async function tryDevAutoLogin(): Promise<void> {
  // Gate 1: compile-time DEV flag. In a `vite build` artifact this is the
  // literal `false`, so the whole body below is dead code and removed.
  if (!import.meta.env.DEV) return;

  const env = readEnv();

  // Gate 2: explicit opt-in env var
  if (!env.enabled) return;

  // Gate 3: URL allowlist — refuse to autologin against an unknown host
  if (!isSupabaseUrlSafe(env.supabaseUrl, env.allowedProjectRef)) {
    // eslint-disable-next-line no-console
    console.warn(
      `${BYPASS_MARKER} refused: VITE_SUPABASE_URL (${env.supabaseUrl}) is not local ` +
        `and not in VITE_DEV_AUTH_ALLOWED_PROJECT_REF. Refusing to auto sign-in.`,
    );
    return;
  }

  if (!env.email || !env.password) {
    // eslint-disable-next-line no-console
    console.warn(
      `${BYPASS_MARKER} refused: VITE_DEV_AUTH_EMAIL or VITE_DEV_AUTH_PASSWORD missing.`,
    );
    return;
  }

  // Already signed in? Nothing to do.
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user) return;
  } catch {
    // If getSession itself throws, fall through and attempt login anyway.
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: env.email,
    password: env.password,
  });

  if (error || !data?.session) {
    // eslint-disable-next-line no-console
    console.error(
      `${BYPASS_MARKER} sign-in failed: ${error?.message ?? "no session returned"}. ` +
        `Did you run supabase/seed-dev-auth.sql against the local Supabase?`,
    );
    return;
  }

  // Land the user directly on the owner dashboard for the seeded hotel.
  // HomeGate honours this persisted choice and navigates to /owner/<slug>.
  const slug =
    (import.meta.env.VITE_DEV_AUTH_HOTEL_SLUG as string) || "dev-hotel";
  persistRole({ role: "owner", hotelSlug: slug });

  // eslint-disable-next-line no-console
  console.warn(
    `${BYPASS_MARKER} signed in as ${env.email} → /owner/${slug}. ` +
      `Disable by setting VITE_DEV_AUTH_BYPASS=false.`,
  );
}
