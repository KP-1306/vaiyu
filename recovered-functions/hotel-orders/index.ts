// supabase/functions/hotel-orders/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Lightweight Supabase clients
 */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}

function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/**
 * Simple JSON + CORS helper (local copy of j())
 */
function j(req: Request, status: number, body: unknown) {
  const origin = req.headers.get("origin") ?? "*";

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  });

  // For preflight requests we just send back the headers
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

/**
 * Fire-and-forget error webhook (optional; safe if WEBHOOK_ALERT_URL is unset)
 */
async function alertError(url: string | undefined | null, payload: unknown) {
  try {
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_e) {
    // Never throw from alert hook
  }
}

/**
 * Basic rate limit per IP + keyHint using api_hits table
 */
async function rateLimitOrThrow(
  req: Request,
  keyHint: string,
  limit = 60,
): Promise<void> {
  const supa = supabaseAnon();
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    // @ts-ignore - cf is available in edge envs but not in TS types
    (req as any).cf?.connectingIP ||
    "0.0.0.0";

  const key = `${keyHint}:${ip}`;

  // Record hit
  await supa.from("api_hits")
    .insert({ key })
    .select()
    .limit(1)
    .single()
    .catch(() => {});

  // Count hits in the last 60s
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supa.from("api_hits")
    .select("ts", { count: "exact", head: true })
    .eq("key", key)
    .gte("ts", since);

  if ((count ?? 0) > limit) {
    throw new Error("Rate limit exceeded. Try again later.");
  }
}

/**
 * Idempotency helpers using va_idempotency_keys table
 */
async function idemGet(
  supabase: any,
  route: string,
  hotel_id: string,
  key: string,
) {
  const { data } = await supabase.from("va_idempotency_keys")
    .select("response")
    .eq("route", route)
    .eq("hotel_id", hotel_id)
    .eq("key", key)
    .maybeSingle();

  return data?.response ?? null;
}

async function idemSet(
  supabase: any,
  route: string,
  hotel_id: string,
  key: string,
  response: unknown,
) {
  await supabase.from("va_idempotency_keys")
    .insert({ route, hotel_id, key, response })
    .catch(() => {});
}

/**
 * Simple audit logger into va_audit_logs
 */
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
  await supabase.from("va_audit_logs")
    .insert({
      at: new Date().toISOString(),
      action: row.action,
      actor: row.actor ?? null,
      hotel_id: row.hotel_id ?? null,
      entity: row.entity ?? null,
      entity_id: row.entity_id ?? null,
      ip: row.ip ?? null,
      ua: row.ua ?? null,
      meta: row.meta ?? null,
    })
    .catch(() => {});
}

/**
 * Main handler
 *
 * GET  /functions/v1/hotel-orders?hotel_id=…&status=open|closed|all&limit=50
 * POST /functions/v1/hotel-orders  (create a new order for a hotel)
 */
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return j(req, 200, { ok: true });
  }

  const url = new URL(req.url);
  const hotelIdFromQuery =
    url.searchParams.get("hotel_id") ?? url.searchParams.get("hotelId");

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  const supabase = supabaseService();

  try {
    // -------------------------------
    // GET: list orders for a hotel
    // -------------------------------
    if (req.method === "GET") {
      if (!hotelIdFromQuery) {
        return j(req, 400, {
          ok: false,
          error: "hotel_id required",
        });
      }

      const status = url.searchParams.get("status") || "open";
      const limitRaw = Number(url.searchParams.get("limit") ?? "100");
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(1, Math.trunc(limitRaw)), 500)
        : 100;

      let query = supabase.from("orders")
        .select(
          "id, hotel_id, booking_code, room, item_key, qty, price, status, created_at, closed_at",
        )
        .eq("hotel_id", hotelIdFromQuery);

      if (status !== "all") {
        query = query.eq("status", status);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return j(req, 400, { ok: false, error: error.message });
      }

      return j(req, 200, {
        ok: true,
        hotel_id: hotelIdFromQuery,
        status,
        orders: data ?? [],
      });
    }

    // -------------------------------
    // POST: create a new order
    // -------------------------------
    if (req.method === "POST") {
      await rateLimitOrThrow(req, "hotel-orders-create", 60);

      const idemKey = req.headers.get("Idempotency-Key") || null;
      const body = await req.json().catch(() => ({} as any));

      const hotel_id =
        String((body as any).hotel_id ?? hotelIdFromQuery ?? "").trim();
      const item_key = String((body as any).item_key ?? "").trim();
      const qtyRaw = Number((body as any).qty ?? 1);
      const qty = Number.isFinite(qtyRaw)
        ? Math.min(Math.max(1, Math.trunc(qtyRaw)), 50)
        : 1;

      const booking_code =
        (body as any).booking_code == null
          ? null
          : String((body as any).booking_code).trim();
      const room =
        (body as any).room == null
          ? null
          : String((body as any).room).trim();

      if (!hotel_id || !item_key) {
        return j(req, 400, {
          ok: false,
          error: "hotel_id and item_key required",
        });
      }

      if (room !== null && room.length > 50) {
        return j(req, 400, { ok: false, error: "room too long" });
      }

      if (booking_code !== null && booking_code.length > 80) {
        return j(req, 400, { ok: false, error: "booking_code too long" });
      }

      // If we have an idempotency key, check for an existing response
      if (idemKey) {
        const hit = await idemGet(
          supabase,
          "hotel-orders",
          hotel_id,
          idemKey,
        );
        if (hit) {
          return j(req, 200, hit);
        }
      }

      // Look up menu item & price
      const { data: item } = await supabase.from("menu_items")
        .select("item_key, price, base_price, active")
        .eq("hotel_id", hotel_id)
        .eq("item_key", item_key)
        .eq("active", true)
        .single();

      if (!item) {
        return j(req, 400, {
          ok: false,
          error: "Item not available",
        });
      }

      const unitPrice =
        typeof (item as any).price === "number"
          ? (item as any).price
          : typeof (item as any).base_price === "number"
          ? (item as any).base_price
          : null;

      if (unitPrice == null) {
        return j(req, 400, {
          ok: false,
          error: "Item price unavailable",
        });
      }

      const payload = {
        hotel_id,
        booking_code,
        room,
        item_key,
        qty,
        price: unitPrice,
        status: "open",
      };

      const { data, error } = await supabase.from("orders")
        .insert(payload)
        .select("id")
        .single();

      if (error || !data) {
        return j(req, 400, {
          ok: false,
          error: error?.message ?? "Insert failed",
        });
      }

      const responseBody = { ok: true, id: (data as any).id };

      // Persist idempotent response if needed
      if (idemKey) {
        await idemSet(
          supabase,
          "hotel-orders",
          hotel_id,
          idemKey,
          responseBody,
        );
      }

      // Audit log (best-effort)
      await audit(supabase, {
        action: "order.create",
        hotel_id,
        entity: "order",
        entity_id: (data as any).id,
        ip,
        ua,
        meta: payload,
      });

      return j(req, 201, responseBody);
    }

    // Any other method
    return j(req, 405, {
      ok: false,
      error: "Method Not Allowed",
    });
  } catch (e: any) {
    await alertError(Deno.env.get("WEBHOOK_ALERT_URL"), {
      fn: "hotel-orders",
      message: String(e?.message ?? e),
      meta: {
        url: req.url,
        method: req.method,
      },
    });

    return j(req, 500, {
      ok: false,
      error: String(e?.message ?? e),
    });
  }
});
