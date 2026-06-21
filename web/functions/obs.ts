// web/functions/obs.ts
//
// Server-side observability endpoint for the owner ObservabilityCard. It reads the
// v_api_24h / v_api_top_fns_24h aggregate-telemetry views.
//
// These views are SECURITY INVOKER over api_hits (which is service_role-only), so
// this endpoint MUST authenticate with the SERVICE-ROLE key — never the anon key.
// Using the anon key here is what previously forced the views to be anon-readable
// SECURITY DEFINER (an information-disclosure hole). The service-role key lives only
// in the Netlify serverless env and is never shipped to the browser.
//
// Env note: this Netlify site configures Supabase as VITE_SUPABASE_URL (the VITE_
// prefix only affects client-bundle inlining; at function runtime it's a normal
// process.env entry). The service-role key is SUPABASE_SERVICE_ROLE_KEY, scoped to
// Functions. We read the canonical names first and fall back to the VITE_/legacy
// names so the endpoint works regardless of which the deploy provisions.
import type { Handler } from "@netlify/functions";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

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
      // Misconfiguration, not a client error — name exactly what's missing.
      const missing = [
        !SUPABASE_URL ? "SUPABASE_URL/VITE_SUPABASE_URL" : null,
        !SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter(Boolean).join(", ");
      return { statusCode: 500, body: `obs: missing env: ${missing}` };
    }
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
