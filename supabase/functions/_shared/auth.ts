// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishableKey, secretKey } from "./keys.ts";

/* CORS helpers (reuse across handlers) */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "content-type": "application/json",
};

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

export function ok(body: unknown = { ok: true }) {
  return json(200, body);
}

export function preflight(): Response {
  // 204 forbids a response body. Deno 2.x rejects `new Response("ok", { status: 204 })`
  // with "Response with null body status cannot have body". Pass null body explicitly.
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* ------------------------------------------------------------------------- */
/* Supabase clients                                                          */
/* ------------------------------------------------------------------------- */

// Create an anon client that forwards the caller's Authorization header.
// Use this when you want RLS to evaluate with the end-user's JWT.
export function supabaseAnon(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // Publishable (anon-equivalent) key as the apikey; the caller's JWT rides on
  // Authorization so RLS evaluates as the end user. Resolves new sb_publishable_
  // key with legacy anon fallback during the key migration.
  const apiKey = publishableKey();
  return createClient(supabaseUrl, apiKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}

// Service role client (bypasses RLS). Use carefully, for server-only checks.
//
// Resolves the new sb_secret_ key (SUPABASE_SECRET_KEYS) with legacy
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE fallback during the migration.
export function supabaseService() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const key = secretKey();
  if (!key) {
    throw new Error(
      "supabaseService: missing secret key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) in environment",
    );
  }
  return createClient(supabaseUrl, key);
}

/* ------------------------------------------------------------------------- */
/* Auth helpers                                                              */
/* ------------------------------------------------------------------------- */

function getBearer(req: Request): string {
  return req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

/** Returns `{ user }` if authenticated, otherwise a 401 Response. */
export async function assertAuthed(
  req: Request
): Promise<{ user: { id: string; email?: string | null } } | Response> {
  const jwt = getBearer(req);
  if (!jwt) return json(401, { error: "Unauthorized" });

  const url = Deno.env.get("SUPABASE_URL")!;
  // Publishable/anon key as apikey; the caller's JWT goes on Authorization. getUser()
  // validates that JWT against the Auth server (resilient to signing-key rotation).
  const apiKey = publishableKey();
  const sb = createClient(url, apiKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return json(401, { error: "Unauthorized" });

  return { user: { id: data.user.id, email: data.user.email ?? null } };
}

/**
 * Strict admin gate.
 * Strategy:
 *   1) Validate the JWT (must be a real user).
 *   2) If env ADMIN_EMAILS is set (comma-separated), allow only those emails.
 *   3) Else try DB check via service role:
 *        - table: user_profiles (id uuid PK) with either:
 *            a) boolean column is_admin = true
 *           OR
 *            b) text column role = 'admin'
 *      If table/columns don't exist, deny by default.
 */
export async function assertAdmin(
  req: Request
): Promise<{ user: { id: string; email?: string | null } } | Response> {
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  // 2) Allowlist by email (optional)
  const allowlist = (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length && user.email && allowlist.includes(user.email.toLowerCase())) {
    return { user };
  }

  // 3) DB role/flag check via service role
  try {
    const svc = supabaseService();

    // Try is_admin first; if not present, try role = 'admin'
    let isAdmin = false;

    const { data: byFlag, error: flagErr } = await svc
      .from("user_profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!flagErr && byFlag && typeof (byFlag as any).is_admin === "boolean") {
      isAdmin = (byFlag as any).is_admin === true;
    } else {
      const { data: byRole, error: roleErr } = await svc
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!roleErr && byRole && typeof (byRole as any).role === "string") {
        isAdmin = String((byRole as any).role).toLowerCase() === "admin";
      }
    }

    if (isAdmin) return { user };
  } catch {
    // swallow; deny below
  }

  return json(403, { error: "Forbidden" });
}

/* ------------------------------------------------------------------------- */
/* Authorization helper for booking-scoped flows                              */
/* ------------------------------------------------------------------------- */

/**
 * Returns `true` if the authenticated user is allowed to act on
 * `booking_id`'s payments. Two ways to qualify:
 *
 *   1. Staff: user is a finance-manager-or-above on the booking's hotel,
 *      via the existing `vaiyu_is_hotel_finance_manager` RPC. (Walk-in,
 *      owner-side refunds.)
 *
 *   2. Guest: user is mapped to the booking's guest via `guest_user_map`,
 *      i.e. this is the guest themselves paying their own folio.
 *      (Guest checkout / clear-dues flow, food-order pay-now.)
 *
 * This consolidates the authz check so the same Edge Functions
 * (razorpay-create-order, razorpay-verify-payment) work for both surfaces
 * without forking into staff/guest variants.
 */
export async function canActOnBookingPayments(
  req: Request,
  bookingId: string,
): Promise<{ allowed: boolean; via: "staff" | "guest" | null; userId: string | null }> {
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return { allowed: false, via: null, userId: null };
  const { user } = authed;

  const svc = supabaseService();

  // Resolve booking → hotel + guest
  const { data: booking } = await svc
    .from("bookings")
    .select("hotel_id, guest_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { allowed: false, via: null, userId: user.id };

  // 1) Staff path — finance manager on this hotel
  const sbAnon = supabaseAnon(req);
  const { data: isFinance } = await sbAnon.rpc("vaiyu_is_hotel_finance_manager", {
    p_hotel_id: booking.hotel_id,
  });
  if (isFinance === true) {
    return { allowed: true, via: "staff", userId: user.id };
  }

  // 2) Guest path — user is mapped to this booking's guest
  if (booking.guest_id) {
    const { data: map } = await svc
      .from("guest_user_map")
      .select("guest_id")
      .eq("user_id", user.id)
      .eq("guest_id", booking.guest_id)
      .limit(1)
      .maybeSingle();
    if (map) {
      return { allowed: true, via: "guest", userId: user.id };
    }
  }

  return { allowed: false, via: null, userId: user.id };
}

/* ------------------------------------------------------------------------- */
/* Simple per-IP + route rate limit using Postgres (rolling 1 min)           */
/* Requires table: api_hits(key text, ts timestamptz)                        */
/* ------------------------------------------------------------------------- */
// `svc` is loosely-typed because `ReturnType<typeof createClient>` doesn't
// unify with what `createClient(url, key)` actually returns at the call site
// (TS generic-default inference quirk). The body casts to `any` anyway since
// we hit `api_hits` directly.
type AnySupabaseClient = ReturnType<typeof createClient> | any;

export async function rateLimitOrThrow(
  svc: AnySupabaseClient,
  req: Request,
  keyHint: string,
  limit = 60
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  // Rate-limit via the SECURITY DEFINER RPC so api_hits stays locked to
  // service_role/owner. Works whether `svc` is an anon or service_role client
  // (anon only needs EXECUTE on the RPC, not table access). Fail-open on error.
  const { data, error } = await (svc as any).rpc("va_rate_limit_hit", {
    p_key: key,
    p_window_seconds: 60,
    p_limit: limit,
  });
  if (error) {
    console.error("rate-limit rpc error", error);
    return; // if the limiter errors, don't block
  }
  if (data === false) {
    throw new Error("Rate limit exceeded. Try again in a minute.");
  }
}

/**
 * User-keyed rate limit (rolling 1-minute window). Prefer this for any
 * Edge Function that runs behind JWT auth — keys on `userId` rather than
 * IP, so users behind shared NATs aren't unfairly grouped, and a malicious
 * user can't rotate IPs to bypass.
 *
 * Returns `{ allowed: true }` on accept, `{ allowed: false, retryAfterSec }`
 * on throttle. Caller renders an honest 429. If the rate-limit table is
 * unreachable, fail-open (return allowed=true) — don't 500 a payment flow
 * just because the limiter had a hiccup.
 */
export async function rateLimitForUser(
  svc: AnySupabaseClient,
  userId: string,
  keyHint: string,
  limit = 30,
  windowSec = 60,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const key = `${keyHint}:user:${userId}`;
  // Rate-limit via the SECURITY DEFINER RPC (api_hits locked to service_role/owner).
  // Fail-open on RPC error — don't 500 a payment flow over a limiter hiccup.
  const { data, error } = await (svc as any).rpc("va_rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSec,
    p_limit: limit,
  });
  if (error) {
    console.error("[rateLimitForUser] rpc error — failing open", error);
    return { allowed: true };
  }
  if (data === false) {
    return { allowed: false, retryAfterSec: windowSec };
  }
  return { allowed: true };
}

/** Standardised 429 response with Retry-After header. */
export function tooManyRequests(retryAfterSec = 60): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded. Please slow down and try again.",
      code: "RATE_LIMIT",
    }),
    {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}
