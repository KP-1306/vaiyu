// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return new Response("ok", { status: 204, headers: CORS_HEADERS });
}

/* ------------------------------------------------------------------------- */
/* Supabase clients                                                          */
/* ------------------------------------------------------------------------- */

// Create an anon client that forwards the caller's Authorization header.
// Use this when you want RLS to evaluate with the end-user's JWT.
export function supabaseAnon(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}

// Service role client (bypasses RLS). Use carefully, for server-only checks.
export function supabaseService() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE")!;
  return createClient(supabaseUrl, serviceRole);
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
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anon, {
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
/* Simple per-IP + route rate limit using Postgres (rolling 1 min)           */
/* Requires table: api_hits(key text, ts timestamptz)                        */
/* ------------------------------------------------------------------------- */
export async function rateLimitOrThrow(
  svc: ReturnType<typeof createClient>,
  req: Request,
  keyHint: string,
  limit = 60
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  const now = new Date();

  const { error: insErr } = await (svc as any)
    .from("api_hits")
    .insert({ key, ts: now.toISOString() });
  if (insErr) console.error("rate-limit insert error", insErr);

  // Count rows in the last minute for this key
  const { data, error } = await (svc as any)
    .from("api_hits")
    .select("ts")
    .gte("ts", new Date(now.getTime() - 60_000).toISOString())
    .eq("key", key);

  if (error) {
    console.error("rate-limit count error", error);
    return; // if counting fails, don't block
  }

  const count = Array.isArray(data) ? data.length : 0;
  if (count > limit) {
    throw new Error("Rate limit exceeded. Try again in a minute.");
  }
}
