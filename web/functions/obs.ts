// web/functions/obs.ts
import type { Handler } from "@netlify/functions";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!; // serverless env on Netlify

async function fetchView(view: "v_api_24h" | "v_api_top_fns_24h") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) throw new Error(`${view} -> ${r.status}`);
  return r.text();
}

export const handler: Handler = async (event) => {
  try {
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
