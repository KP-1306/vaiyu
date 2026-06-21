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
import type { Handler } from "@netlify/functions";

const SUPABASE_URL = process.env.SUPABASE_URL!;
// Service-role key (Netlify serverless env only). Fall back to the legacy var name
// some deploys use, so provisioning either works.
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
    if (!SERVICE_ROLE_KEY) {
      // Misconfiguration, not a client error — make it obvious in logs/monitoring.
      // TEMP DIAGNOSTIC (revert once confirmed): list the Supabase-ish env-var NAMES
      // (never values) the function runtime can actually see, so we can tell whether
      // the var is reaching functions vs a deploy-propagation issue. Names are not
      // secrets (they're in .env.example).
      const seen = Object.keys(process.env).filter(k => /SUPABASE|SERVICE_ROLE/i.test(k)).sort();
      return { statusCode: 500, body: `obs v2: SUPABASE_SERVICE_ROLE_KEY is not set. fn env keys seen: ${seen.join(",") || "(none)"}` };
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
