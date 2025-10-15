// supabase/functions/ops-update/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { alertError } from "../_shared/alert.ts";

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

/** service-role client for privileged writes/lookups */
function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/** naive per-IP rate limit (rolling 60s) — requires public.api_hits table */
async function rateLimitOrThrow(supa: ReturnType<typeof createClient>, req: Request, keyHint: string, limit = 150) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  await supa.from("api_hits").insert({ key }).select().limit(1);
  const { count } = await supa
    .from("api_hits")
    .select("ts", { count: "exact", head: true })
    .eq("key", key)
    .gte("ts", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > limit) throw new Error("Rate limit exceeded. Try again later.");
}

/** idempotency helpers (va_idempotency_keys) */
async function idemGet(svc: ReturnType<typeof createClient>, route: string, hotel_id: string | null, key: string) {
  const { data } = await svc
    .from("va_idempotency_keys")
    .select("response")
    .eq("route", route)
    .eq("hotel_id", hotel_id)
    .eq("key", key)
    .maybeSingle();
  return data?.response ?? null;
}
async function idemSet(svc: ReturnType<typeof createClient>, route: string, hotel_id: string | null, key: string, response: unknown) {
  await svc.from("va_idempotency_keys").insert({ route, hotel_id, key, response }).catch(() => {});
}

/** audit helper (va_audit_logs) */
async function audit(svc: ReturnType<typeof createClient>, row: {
  action: string;
  actor?: string | null;
  hotel_id?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  ip?: string | null;
  ua?: string | null;
  meta?: unknown;
}) {
  await svc.from("va_audit_logs").insert({
    at: new Date().toISOString(),
    action: row.action,
    actor: row.actor ?? null,
    hotel_id: row.hotel_id ?? null,
    entity: row.entity ?? null,
    entity_id: row.entity_id ?? null,
    ip: row.ip ?? null,
    ua: row.ua ?? null,
    meta: row.meta ?? null,
  }).catch(() => {});
}

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "POST")    return J(405, { ok: false, error: "Method Not Allowed" });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const idemKey = req.headers.get("Idempotency-Key") || null;

  try {
    // 1) Require a signed-in user (staff/owner)
    const anon = supabaseAnon(req);
    const { data: me, error: meErr } = await anon.auth.getUser();
    if (meErr || !me?.user) return J(401, { ok: false, error: "Unauthorized" });
    const actor = me.user.email ?? me.user.id ?? null;

    // 2) Rate limit the caller
    await rateLimitOrThrow(anon, req, "ops-update", 150);

    // 3) Service client for minimal cross-table work
    const svc = supabaseService();

    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "");

    /* -------- CLOSE TICKET -------- */
    if (action === "close" || action === "closeTicket") {
      const id = body?.id as string | undefined;
      if (!id) return J(400, { ok: false, error: "id required" });

      // fetch ticket
      const { data: t, error: tErr } = await svc
        .from("tickets")
        .select("id, hotel_id, service_key, created_at, status, minutes_to_close, on_time")
        .eq("id", id)
        .single();
      if (tErr || !t) return J(404, { ok: false, error: "ticket not found" });

      // idempotency (if already closed, or if key provided & recorded)
      if (t.status === "closed") {
        const response = { ok: true, minutes_to_close: t.minutes_to_close, on_time: t.on_time, already_closed: true };
        if (idemKey) await idemSet(svc, "ops-update:closeTicket", t.hotel_id, idemKey, response);
        return J(200, response);
      }
      if (idemKey) {
        const hit = await idemGet(svc, "ops-update:closeTicket", t.hotel_id, idemKey);
        if (hit) return J(200, hit);
      }

      // SLA lookup
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

      const response = { ok: true, minutes_to_close: minutes, on_time: onTime };
      if (idemKey) await idemSet(svc, "ops-update:closeTicket", t.hotel_id, idemKey, response);

      await audit(svc, {
        action: "ticket.close",
        actor,
        hotel_id: t.hotel_id,
        entity: "ticket",
        entity_id: t.id,
        ip, ua,
        meta: { minutes_to_close: minutes, on_time: onTime, sla },
      });

      return J(200, response);
    }

    /* -------- SET ORDER STATUS -------- */
    if (action === "setOrderStatus") {
      const id = body?.id as string | undefined;
      const status = body?.status as "preparing" | "delivered" | "cancelled" | undefined;
      if (!id || !status) return J(400, { ok: false, error: "id and status required" });

      // Pull order for hotel_id (for idempotency/audit)
      const { data: o, error: oErr } = await svc
        .from("orders")
        .select("id, hotel_id, status")
        .eq("id", id)
        .single();
      if (oErr || !o) return J(404, { ok: false, error: "order not found" });

      // Idempotency: same status already? treat as success
      if (o.status === status) {
        const response = { ok: true, already_applied: true };
        if (idemKey) await idemSet(svc, "ops-update:setOrderStatus", o.hotel_id, idemKey, response);
        return J(200, response);
      }
      if (idemKey) {
        const hit = await idemGet(svc, "ops-update:setOrderStatus", o.hotel_id, idemKey);
        if (hit) return J(200, hit);
      }

      const patch: Record<string, unknown> = { status };
      if (status === "delivered" || status === "cancelled") patch.closed_at = new Date().toISOString();

      const { error } = await svc.from("orders").update(patch).eq("id", id);
      if (error) return J(400, { ok: false, error: error.message });

      const response = { ok: true };
      if (idemKey) await idemSet(svc, "ops-update:setOrderStatus", o.hotel_id, idemKey, response);

      await audit(svc, {
        action: "order.status",
        actor,
        hotel_id: o.hotel_id,
        entity: "order",
        entity_id: id,
        ip, ua,
        meta: { status },
      });

      return J(200, response);
    }

    return J(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    await alertError(Deno.env.get("WEBHOOK_ALERT_URL"), {
    fn: "tickets", // change per function
    message: String(e?.message || e),
    meta: { url: req.url, method: req.method },
  });
    return J(500, { ok: false, error: String(e) });
  }
});
