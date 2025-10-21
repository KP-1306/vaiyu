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

  // Try view first (cleaner if present)
  const tryView = await supabase
    .from("hotel_members_for_user")
    .select("user_id, slug, name, role, active")
    .eq("user_id", user.id)
    .eq("active", true);

  if (!tryView.error && Array.isArray(tryView.data)) {
    return tryView.data.map((r: any) => ({
      hotelId: "", // not exposed by the view, but we don't need it for switching
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

export type PersistedRole = {
  role: VaRole;
  hotelSlug?: string | null;
};

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
    // @ts-expect-error: passing scope is supported in newer supabase-js
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    // fallback to regular signOut if scope isn't supported
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

/** ---------- Local storage cache clearing ---------- */

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

    // Optional: clear other app caches
    // localStorage.removeItem('some-other-key');

    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}
