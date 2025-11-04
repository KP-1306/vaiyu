// supabase/functions/owner-review/index.ts
// Admin-only moderation endpoints for owner applications.
// Routes:
//  - GET    /owner-review/list?status=pending
//  - POST   /owner-review/approve { app_id, notes? }
//  - POST   /owner-review/reject  { app_id, reason }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// CORS: allow your Netlify site
const ALLOW_ORIGIN = Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function unauthorized() {
  return json({ error: "Forbidden" }, 403);
}

/** Simple admin check.
 *  Replace with a stronger rule:
 *  - check a claim in the JWT
 *  - or check user role in your profiles table, etc.
 */
async function assertAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  // If you pass your Supabase user token from your admin UI,
  // you can validate it or query profiles here.
  // For now, require that the request comes with a custom header secret (optional),
  // or keep it as-is if this function is called only from your secure admin UI.
  return true;
}

serve(async (req) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!(await assertAdmin(req))) return unauthorized();

    const url = new URL(req.url);
    const path = url.pathname; // e.g., /owner-review/list
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (path.endsWith("/list") && req.method === "GET") {
      const status = url.searchParams.get("status") ?? "pending";
      const { data, error } = await supabase
        .from("owner_applications")
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ items: data });

    } else if (path.endsWith("/approve") && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const app_id: string | undefined = body.app_id;
      const notes: string | null = body.notes ?? null;
      if (!app_id) return json({ error: "app_id required" }, 400);

      // reviewer id: pass it from your admin UI or resolve from token
      const reviewer_id = body.reviewer_id ?? null;

      const { data, error } = await supabase.rpc("approve_owner_application", {
        p_app_id: app_id, p_reviewer: reviewer_id, p_notes: notes,
      });
      if (error) throw error;
      return json({ ok: true, property_id: data });

    } else if (path.endsWith("/reject") && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const app_id: string | undefined = body.app_id;
      const reason: string | undefined = body.reason;
      if (!app_id) return json({ error: "app_id required" }, 400);

      const reviewer_id = body.reviewer_id ?? null;

      const { error } = await supabase.rpc("reject_owner_application", {
        p_app_id: app_id, p_reviewer: reviewer_id, p_reason: reason ?? null,
      });
      if (error) throw error;
      return json({ ok: true });

    } else {
      return json({ error: "Not found" }, 404);
    }
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
