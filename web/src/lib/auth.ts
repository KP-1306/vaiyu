// web/src/lib/auth.ts
import { supabase } from "./supabase";

/** ---------- Types ---------- */

export type VaRole = "guest" | "staff" | "manager" | "owner";

export type Membership = {
  hotelId: string;
  hotelSlug: string | null;
  hotelName: string | null;
  role: "viewer" | "staff" | "manager" | "owner";
};

export type PersistedRole = {
  role: VaRole;
  hotelSlug?: string | null;
};

/** ---------- User / Session ---------- */

/** Returns the current Supabase user (or null). */
export async function getCurrentUser() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/** Returns the current session (or null). */
export async function getCurrentSession() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/** ---------- Memberships (Owner/Manager/Staff) ---------- */

/**
 * Load the hotels this user belongs to (active only).
 * Works with either:
 *   - a view named `hotel_members_for_user` exposing (user_id, slug, name, role, active)
 *   - or a direct join on hotel_members + hotels
 */
export async function getMyMemberships(): Promise<Membership[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  // Prefer the view if present (cleaner & faster)
  const tryView = await supabase
    .from("hotel_members_for_user")
    .select("user_id, slug, name, role, active")
    .eq("user_id", user.id)
    .eq("active", true);

  if (!tryView.error && Array.isArray(tryView.data)) {
    return tryView.data.map((r: any) => ({
      hotelId: "", // not exposed by that view; usually not needed for routing
      hotelSlug: r.slug ?? null,
      hotelName: r.name ?? null,
      role: r.role,
    }));
  }

  // Fallback: direct join
  const joined = await supabase
    .from("hotel_members")
    .select("hotel_id, role, active, hotels!inner(id, slug, name)")
    .eq("user_id", user.id)
    .eq("active", true);

  if (joined.error || !Array.isArray(joined.data)) return [];

  return joined.data.map((r: any) => ({
    hotelId: r.hotel_id,
    hotelSlug: r.hotels?.slug ?? null,
    hotelName: r.hotels?.name ?? null,
    role: r.role,
  }));
}

/** ---------- Role persistence (tiny helpers) ---------- */

const ROLE_KEY = "va:role";

/** Save the currently selected role workspace to localStorage. */
export function persistRole(state: PersistedRole) {
  try {
    localStorage.setItem(ROLE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Read the last selected role workspace from localStorage. */
export function loadPersistedRole(): PersistedRole | null {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.role === "guest" ||
        parsed.role === "staff" ||
        parsed.role === "manager" ||
        parsed.role === "owner")
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Clear only the app’s role selection. */
export function clearPersistedRole() {
  try {
    localStorage.removeItem(ROLE_KEY);
  } catch {
    /* ignore */
  }
}

/** ---------- Sign-out (global + local cleanup) ---------- */

/**
 * Best-effort global sign-out with robust local cleanup.
 * Use this from your /logout route or any sign-out UI.
 */
export async function signOutEverywhere() {
  // 1) Attempt global sign-out (invalidates refresh tokens on all devices)
  try {
    // @ts-expect-error: scope is supported in newer supabase-js versions
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    // Fallback to regular signOut if scope isn't supported
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
  }

  // 2) Local safety clear
  clearPersistedRole();
  safeClearAuthCaches();
}

/** Clears Supabase auth tokens & app caches from storage (best effort). */
export function safeClearAuthCaches() {
  try {
    // Remove Supabase auth tokens
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
      .forEach((k) => localStorage.removeItem(k));

    // Our own keys that may be present
    localStorage.removeItem("va:guest");
    localStorage.removeItem("owner:slug");
    localStorage.removeItem("staff:slug");

    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/** ---------- Magic link / OAuth callback consumption (v2-safe) ---------- */

/**
 * Consume tokens from the current URL and establish a session.
 * Handles:
 *  - Hash tokens (#access_token & #refresh_token)
 *  - OAuth PKCE code (?code=...)
 *  - Query tokens (?access_token & ?refresh_token)
 * Returns true if a session was established; false otherwise.
 */
export async function consumeAuthFromUrl(): Promise<boolean> {
  try {
    const url = new URL(window.location.href);

    // 1) Hash-style tokens: #access_token=...&refresh_token=...
    const hash = url.hash?.startsWith("#") ? url.hash.slice(1) : "";
    if (hash) {
      const h = new URLSearchParams(hash);
      const at = h.get("access_token");
      const rt = h.get("refresh_token");
      if (at && rt) {
        await supabase.auth.setSession({ access_token: at, refresh_token: rt });
        history.replaceState({}, "", url.pathname + url.search); // clean hash
        return true;
      }
    }

    // 2) OAuth / PKCE code: ?code=...
    const code = url.searchParams.get("code");
    if (code && (supabase.auth as any).exchangeCodeForSession) {
      try {
        // Some versions accept a URL string, others accept { code }
        await (supabase.auth as any).exchangeCodeForSession(window.location.href);
      } catch {
        await (supabase.auth as any).exchangeCodeForSession({ code });
      }
      url.searchParams.delete("code");
      history.replaceState({}, "", url.pathname + (url.search ? `?${url.searchParams}` : ""));
      return true;
    }

    // 3) Query-style tokens: ?access_token=...&refresh_token=...
    const qat = url.searchParams.get("access_token");
    const qrt = url.searchParams.get("refresh_token");
    if (qat && qrt) {
      await supabase.auth.setSession({ access_token: qat, refresh_token: qrt });
      url.searchParams.delete("access_token");
      url.searchParams.delete("refresh_token");
      history.replaceState({}, "", url.pathname + (url.search ? `?${url.searchParams}` : ""));
      return true;
    }
  } catch {
    // swallow; return false for caller to handle
  }
  return false;
}

/** ---------- Helper for email link redirect targets ---------- */

/**
 * Build a safe redirect URL used by supabase.auth.signInWithOtp({ options.emailRedirectTo }).
 * Example:
 *   emailRedirectTo: buildEmailRedirectUrl("/auth/callback", { intent: "signin", redirect: "/guest" })
 */
export function buildEmailRedirectUrl(
  callbackPath = "/auth/callback",
  params: Record<string, string | number | undefined> = {},
) {
  const u = new URL(callbackPath, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  return u.toString();
}
