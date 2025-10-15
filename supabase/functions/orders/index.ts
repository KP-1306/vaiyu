// supabase/functions/orders/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";
import { alertError } from "../_shared/alert.ts";

/** anon client for rate-limit bookkeeping */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}

/** service-role client for privileged ops */
function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/** 60 req/min per IP per route (default) */
async function rateLimitOrThrow(req: Request, keyHint: string, limit = 60) {
  const supa = supabaseAnon();
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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const supabase = supabaseService();

    // ---------- GET /orders?id=... ----------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return j(req, 400, { ok: false, error: "id required" });

      const { data, error } = await supabase
        .from("orders")
        .select("id, hotel_id, booking_code, room, item_key, qty, price, status, created_at, closed_at")
        .eq("id", id)
        .single();
      if (error || !data) return j(req, 404, { ok: false, error: "not found" });
      return j(req, 200, { ok: true, order: data });
    }

    // ---------- POST /orders (create) ----------
    if (req.method !== "POST") return j(req, 405, { ok: false, error: "Method Not Allowed" });

    await rateLimitOrThrow(req, "orders-create", 60);

    const idemKey = req.headers.get("Idempotency-Key") || null;

    const b = await req.json().catch(() => ({} as any));
    const slug = String(b?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "TENANT1").trim();
    const item_key = String(b?.item_key ?? "").trim();
    const qtyRaw = Number(b?.qty ?? 1);
    const qty = Number.isFinite(qtyRaw) ? Math.min(Math.max(1, Math.trunc(qtyRaw)), 50) : 1;
    const booking_code = b?.booking_code == null ? null : String(b.booking_code).trim();
    const room = b?.room == null ? null : String(b.room).trim();

    // Basic validation
    if (!slug || !item_key) return j(req, 400, { ok: false, error: "slug and item_key required" });
    if (room !== null && room.length > 50) return j(req, 400, { ok: false, error: "room too long" });
    if (booking_code !== null && booking_code.length > 80) return j(req, 400, { ok: false, error: "booking_code too long" });

    // Resolve hotel
    const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return j(req, 400, { ok: false, error: "Unknown hotel" });

    // If idempotency key present, short-circuit if already stored
    if (idemKey) {
      const hit = await idemGet(supabase, "orders", hotel.id, idemKey);
      if (hit) return j(req, 200, hit);
    }

    // Validate item availability & price
    const { data: item } = await supabase
      .from("menu_items")
      .select("item_key, price, base_price, active")
      .eq("hotel_id", hotel.id)
      .eq("item_key", item_key)
      .eq("active", true)
      .single();
    if (!item) return j(req, 400, { ok: false, error: "Item not available" });

    const unitPrice =
      typeof item?.price === "number" ? item.price :
      typeof item?.base_price === "number" ? item.base_price :
      null;
    if (unitPrice == null) return j(req, 400, { ok: false, error: "Item price unavailable" });

    const payload = {
      hotel_id: hotel.id,
      booking_code,
      room,
      item_key,
      qty,
      price: unitPrice,
      status: "open" as const,
    };

    const { data, error } = await supabase.from("orders").insert(payload).select("id").single();
    if (error) return j(req, 400, { ok: false, error: error.message });

    const response = { ok: true, id: data.id };

    // Persist idempotent response (if provided)
    if (idemKey) await idemSet(supabase, "orders", hotel.id, idemKey, response);

    // Audit
    await audit(supabase, {
      action: "order.create",
      hotel_id: hotel.id,
      entity: "order",
      entity_id: data.id,
      ip, ua,
      meta: payload,
    });

    return j(req, 201, response);
  } catch (e) {
    await alertError(Deno.env.get("WEBHOOK_ALERT_URL"), {
    fn: "tickets", // change per function
    message: String(e?.message || e),
    meta: { url: req.url, method: req.method },
  });
    return j(req, 500, { ok: false, error: String(e) });
  }
});
