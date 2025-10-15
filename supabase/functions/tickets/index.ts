// supabase/functions/tickets/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

/** anon client (for rate-limiting table only) */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}

/** service-role client (Edge Function privileged) */
function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/** 60 req/min per IP per route by default */
async function rateLimitOrThrow(req: Request, keyHint: string, limit = 60) {
  const anon = supabaseAnon();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  await anon.from("api_hits").insert({ key }).select().limit(1);
  const { count } = await anon
    .from("api_hits")
    .select("ts", { count: "exact", head: true })
    .eq("key", key)
    .gte("ts", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > limit) throw new Error("Rate limit exceeded. Try again later.");
}

/** idempotency helpers */
async function idemGet(supabase: any, route: string, hotel_id: string | null, key: string) {
  const { data } = await supabase
    .from("va_idempotency_keys")
    .select("response")
    .eq("route", route)
    .eq("hotel_id", hotel_id)
    .eq("key", key)
    .maybeSingle();
  return data?.response ?? null;
}
async function idemSet(supabase: any, route: string, hotel_id: string | null, key: string, response: unknown) {
  await supabase.from("va_idempotency_keys").insert({ route, hotel_id, key, response }).catch(() => {});
}

/** audit helper (fire & forget) */
async function audit(supabase: any, row: {
  action: string;
  actor?: string | null;
  hotel_id?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  ip?: string | null;
  ua?: string | null;
  meta?: unknown;
}) {
  await supabase.from("va_audit_logs").insert({
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
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });

  // For audit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const supabase = supabaseService();

    // ---------- GET /tickets?id=... (deep link fetch) ----------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return j(req, 400, { ok: false, error: "id required" });

      const { data, error } = await supabase
        .from("tickets")
        .select("id, hotel_id, booking_code, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
        .eq("id", id)
        .single();
      if (error || !data) return j(req, 404, { ok: false, error: "not found" });

      // (Optional) audit read — usually not necessary; skip to avoid noise.
      return j(req, 200, { ok: true, ticket: data });
    }

    if (req.method !== "POST") return j(req, 405, { ok: false, error: "Method Not Allowed" });

    // ---------- POST /tickets (create) ----------
    await rateLimitOrThrow(req, "tickets-create", 60);

    const idemKey = req.headers.get("Idempotency-Key") || null;

    const body = await req.json().catch(() => ({} as any));
    const slug = String(body?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "TENANT1").trim();
    const service_key = String(body?.service_key ?? "").trim();
    const booking_code = body?.booking_code == null ? null : String(body.booking_code).trim();
    const room = body?.room == null ? null : String(body.room).trim();

    // Basic validation
    if (!slug || !service_key) return j(req, 400, { ok: false, error: "slug and service_key required" });
    if (room !== null && room.length > 50) return j(req, 400, { ok: false, error: "room too long" });
    if (booking_code !== null && booking_code.length > 80) return j(req, 400, { ok: false, error: "booking_code too long" });

    // Resolve hotel
    const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return j(req, 400, { ok: false, error: "Unknown hotel" });

    // If idempotency key present, short-circuit if we already saw it
    if (idemKey) {
      const hit = await idemGet(supabase, "tickets", hotel.id, idemKey);
      if (hit) return j(req, 200, hit);
    }

    // Active service check
    const { data: svc } = await supabase
      .from("services")
      .select("key, active")
      .eq("hotel_id", hotel.id)
      .eq("key", service_key)
      .eq("active", true)
      .single();
    if (!svc) return j(req, 400, { ok: false, error: "Service not available" });

    // De-dupe: any open ticket for same key/room/booking_code in last 5 minutes
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let dupQuery = supabase
      .from("tickets")
      .select("id, status, created_at")
      .eq("hotel_id", hotel.id)
      .eq("service_key", service_key)
      .eq("status", "open")
      .gte("created_at", since);
    room === null ? (dupQuery = dupQuery.is("room", null)) : (dupQuery = dupQuery.eq("room", room));
    booking_code === null
      ? (dupQuery = dupQuery.is("booking_code", null))
      : (dupQuery = dupQuery.eq("booking_code", booking_code));
    const { data: dup } = await dupQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (dup) {
      const response = { ok: true, id: dup.id, deduped: true };
      if (idemKey) await idemSet(supabase, "tickets", hotel.id, idemKey, response);
      await audit(supabase, {
        action: "ticket.create.dedup",
        hotel_id: hotel.id,
        entity: "ticket",
        entity_id: dup.id,
        ip, ua,
        meta: { slug, service_key, room, booking_code, since },
      });
      return j(req, 200, response);
    }

    // Create ticket
    const payload = {
      hotel_id: hotel.id,
      booking_code,
      service_key,
      room,
      status: "open" as const,
    };
    const { data, error } = await supabase.from("tickets").insert(payload).select("id").single();
    if (error) return j(req, 400, { ok: false, error: error.message });

    const response = { ok: true, id: data.id };
    if (idemKey) await idemSet(supabase, "tickets", hotel.id, idemKey, response);

    await audit(supabase, {
      action: "ticket.create",
      hotel_id: hotel.id,
      entity: "ticket",
      entity_id: data.id,
      ip, ua,
      meta: payload,
    });

    return j(req, 201, response);
  } catch (e) {
    return j(req, 500, { ok: false, error: String(e) });
  }
});
