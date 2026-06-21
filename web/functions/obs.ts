// web/functions/obs.ts
//
// Server-side observability endpoint for the owner ObservabilityCard. It reads the
// v_api_24h / v_api_top_fns_24h aggregate-telemetry views (security_invoker,
// service-role only) and returns them to a hotel OWNER or MANAGER.
//
// Security model:
//   • The views are not anon-readable; this function reads them with the SERVICE-
//     ROLE key (server-side only, never shipped to the browser).
//   • BUT the endpoint itself is authn/authz-gated: the caller must present a valid
//     Supabase access token (Authorization: Bearer <jwt>) AND be an owner/manager of
//     at least one hotel — the SAME predicate that gates the owner console where this
//     telemetry is surfaced (OwnerDashboard). Without this gate, service-role + an
//     open endpoint would just relocate the original anon-read hole to /api/obs.
//
// Env note: this Netlify site defines Supabase as VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY (the VITE_ prefix only affects client-bundle inlining; at
// function runtime they're normal process.env entries). SUPABASE_SERVICE_ROLE_KEY
// is scoped to Functions. We read canonical names first with VITE_/legacy fallback.
import type { Handler } from "@netlify/functions";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

// Owner/Manager role codes. MUST stay in sync with OWNER_MANAGER_CODES in
// web/src/routes/OwnerDashboard.tsx — that is the gate deciding who can view the
// owner console (where this telemetry is surfaced), so the endpoint and the UI must
// accept exactly the same people. We accept BOTH the M2M source of truth
// (hotel_member_roles → hotel_roles.code) AND the legacy hotel_members.role, both
// case-insensitively, so legacy-only owners are not locked out (commit 493f5bd,
// "unblock legacy-role owners").
const OWNER_MANAGER_CODES = [
  "OWNER", "OWNER_0", "HOTEL_OWNER",
  "ADMIN", "ADMINISTRATOR",
  "MANAGER", "GENERAL_MANAGER", "OPS_MANAGER",
];

/** Verify the caller's JWT and confirm they are an OWNER or MANAGER of at least one
 *  hotel — the same predicate that gates the owner console (OwnerDashboard). Fails
 *  closed: any error, missing data, or non-owner/manager role → false (→ 403). */
async function isOwnerOrManager(token: string): Promise<boolean> {
  // 1. Resolve the token → user id. apikey is just the project key; the bearer
  //    token is what identifies the user.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY || SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json().catch(() => null);
  const uid = user?.id;
  if (!uid) return false;

  // 2. Active memberships + their legacy role (service-role read; RLS-bypassing).
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hotel_members?select=id,role&user_id=eq.${encodeURIComponent(uid)}&is_active=eq.true`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!memRes.ok) return false;
  const members = await memRes.json().catch(() => null);
  if (!Array.isArray(members) || members.length === 0) return false;

  // 2a. Legacy path: hotel_members.role (case-insensitive).
  const legacyAccess = members.some((m: any) =>
    OWNER_MANAGER_CODES.includes(String(m?.role ?? "").toUpperCase()),
  );
  if (legacyAccess) return true;

  // 2b. M2M source of truth: hotel_member_roles → hotel_roles.code (case-insensitive).
  const ids = members.map((m: any) => m?.id).filter(Boolean);
  if (ids.length === 0) return false;
  const rolesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/hotel_member_roles?select=hotel_roles(code)&hotel_member_id=in.(${ids.join(",")})`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!rolesRes.ok) return false;
  const roles = await rolesRes.json().catch(() => null);
  if (!Array.isArray(roles)) return false;
  return roles.some((r: any) =>
    OWNER_MANAGER_CODES.includes(String(r?.hotel_roles?.code ?? "").toUpperCase()),
  );
}

async function fetchView(view: "v_api_24h" | "v_api_top_fns_24h") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`${view} -> ${r.status}`);
  return r.text();
}

export const handler: Handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      const missing = [
        !SUPABASE_URL ? "SUPABASE_URL/VITE_SUPABASE_URL" : null,
        !SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter(Boolean).join(", ");
      return { statusCode: 500, body: `obs: missing env: ${missing}` };
    }

    // AuthN + AuthZ: valid Supabase JWT belonging to an owner/manager of some hotel.
    const authz = (event.headers?.authorization || event.headers?.Authorization || "") as string;
    const token = authz.replace(/^Bearer\s+/i, "").trim();
    if (!token) return { statusCode: 401, body: "unauthorized" };
    if (!(await isOwnerOrManager(token))) return { statusCode: 403, body: "forbidden" };

    const last = (event.path || "").split("/").pop() || "";
    if (last === "v_api_24h" || last === "v_api_top_fns_24h") {
      const body = await fetchView(last as any);
      return { statusCode: 200, body, headers: { "content-type": "application/json" } };
    }
    return { statusCode: 404, body: "not found" };
  } catch (e:any) {
    return { statusCode: 500, body: e.message || "error" };
  }
};
