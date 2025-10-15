// supabase/functions/ops-update/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** JSON helper with permissive CORS */
function J(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

/** Create an anon client that forwards the caller's Authorization header */
function supabaseAnon(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}

/** naive per-IP rate limit (rolling 60s) — requires public.api_hits table */
async function rateLimitOrThrow(supa: ReturnType<typeof createClient>, req: Request, keyHint: string, limit = 100) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  // record hit
  await supa.from("api_hits").insert({ key }).select().limit(1);
  // count last minute
  const { count } = await supa
    .from("api_hits")
    .select("ts", { count: "exact", head: true })
    .eq("key", key)
    .gte("ts", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > limit) throw new Error("Rate limit exceeded. Try again later.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });

  try {
    // 1) Require a signed-in user (staff/owner) — JWT must be in Authorization header
    const anon = supabaseAnon(req);
    const { data: me, error: meErr } = await anon.auth.getUser();
    if (meErr || !me?.user) return J(401, { ok: false, error: "Unauthorized" });

    // 2) Rate limit the caller
    await rateLimitOrThrow(anon, req, "ops-update", 150);

    // 3) Use service role for cross-table lookups/updates (keep minimal)
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    /* -------- CLOSE TICKET -------- */
    if (action === "close" || action === "closeTicket") {
      const id = body?.id as string | undefined;
      if (!id) return J(400, { ok: false, error: "id required" });

      const { data: t, error: tErr } = await svc
        .from("tickets")
        .select("id, hotel_id, service_key, created_at, status, minutes_to_close, on_time")
        .eq("id", id)
        .single();
      if (tErr || !t) return J(404, { ok: false, error: "ticket not found" });
      if (t.status === "closed") return J(200, { ok: true, minutes_to_close: t.minutes_to_close, on_time: t.on_time });

      const { data: svcRow } = await svc
        .from("services")
        .select("sla_minutes")
        .eq("hotel_id", t.hotel_id)
        .eq("key", t.service_key)
        .single();

      const now = new Date();
      const minutes = Math.max(0, Math.round((now.getTime() - new Date(t.created_at).getTime()) / 60000));
      const sla = typeof svcRow?.sla_minutes === "number" ? svcRow.sla_minutes : 30;
      const onTime = minutes <= sla;

      const { error: uErr } = await svc
        .from("tickets")
        .update({
          status: "closed",
          closed_at: now.toISOString(),
          minutes_to_close: minutes,
          on_time: onTime,
        })
        .eq("id", id);
      if (uErr) return J(400, { ok: false, error: uErr.message });

      return J(200, { ok: true, minutes_to_close: minutes, on_time: onTime });
    }

    /* -------- SET ORDER STATUS -------- */
    if (action === "setOrderStatus") {
      const id = body?.id as string | undefined;
      const status = body?.status as "preparing" | "delivered" | "cancelled" | undefined;
      if (!id || !status) return J(400, { ok: false, error: "id and status required" });

      const patch: Record<string, unknown> = { status };
      if (status === "delivered" || status === "cancelled") patch.closed_at = new Date().toISOString();

      const { error } = await svc.from("orders").update(patch).eq("id", id);
      if (error) return J(400, { ok: false, error: error.message });

      return J(200, { ok: true });
    }

    return J(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
