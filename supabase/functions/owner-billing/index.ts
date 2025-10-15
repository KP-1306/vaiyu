import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";
import { alertError } from "../_shared/alert.ts";

function supabaseAnon(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }
  );
}
function supabaseService() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });
  const webhook = Deno.env.get("WEBHOOK_ALERT_URL");

  try {
    const anon = supabaseAnon(req);
    const svc  = supabaseService();

    // must be signed-in
    const { data: u } = await anon.auth.getUser();
    if (!u?.user) return j(req, 401, { ok: false, error: "Unauthorized" });

    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1").trim();

    const { data: hotel } = await anon.from("hotels").select("id, slug, name, plan, plan_status, plan_renews_at, plan_notes").eq("slug", slug).single();
    if (!hotel) return j(req, 400, { ok: false, error: "Unknown hotel" });

    const { data: role } = await anon.from("v_user_roles")
      .select("role").eq("user_id", u.user.id).eq("hotel_id", hotel.id).maybeSingle();
    if (!role || !["owner","admin"].includes(String(role.role))) {
      return j(req, 403, { ok: false, error: "Forbidden" });
    }

    if (req.method === "GET") {
      // Recent metering (last 30d)
      const since = new Date(Date.now() - 30*86400_000).toISOString();
      const { data: usage } = await anon
        .from("billing_events")
        .select("kind, qty, at")
        .eq("hotel_id", hotel.id)
        .gte("at", since)
        .order("at", { ascending: false })
        .limit(200);

      return j(req, 200, { ok: true, hotel, usage: usage ?? [] });
    }

    if (req.method === "POST") {
      // body: { plan?, plan_status?, plan_renews_at?, plan_notes? }
      const body = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (["free","starter","pro","enterprise"].includes(body?.plan)) patch.plan = body.plan;
      if (["trial","active","past_due","canceled"].includes(body?.plan_status)) patch.plan_status = body.plan_status;
      if (body?.plan_renews_at) patch.plan_renews_at = new Date(body.plan_renews_at).toISOString();
      if (typeof body?.plan_notes === "string") patch.plan_notes = body.plan_notes;

      if (Object.keys(patch).length === 0) return j(req, 400, { ok: false, error: "No valid fields" });

      const { error } = await svc.from("hotels").update(patch).eq("id", hotel.id);
      if (error) return j(req, 400, { ok: false, error: error.message });

      return j(req, 200, { ok: true });
    }

    return j(req, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    await alertError(webhook, { fn: "owner-billing", message: String(e) });
    return j(req, 500, { ok: false, error: String(e) });
  }
});
