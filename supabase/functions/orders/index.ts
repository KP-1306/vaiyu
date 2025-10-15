// supabase/functions/orders/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

/** anon client for rate-limit bookkeeping */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}
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

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      // service role: allow public creation flow with RLS on
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // GET /orders?id=...
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

    if (req.method !== "POST") return j(req, 405, { ok: false, error: "Method Not Allowed" });

    // Rate-limit public order creation
    await rateLimitOrThrow(req, "orders-create", 60);

    const b = await req.json().catch(() => ({} as any));
    const slug = String(b?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "TENANT1").trim();
    const item_key = String(b?.item_key ?? "").trim();
    const qty = Math.max(1, Number(b?.qty ?? 1));
    const booking_code = b?.booking_code == null ? null : String(b.booking_code).trim();
    const room = b?.room == null ? null : String(b.room).trim();

    if (!slug || !item_key) return j(req, 400, { ok: false, error: "slug and item_key required" });

    // resolve hotel
    const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return j(req, 400, { ok: false, error: "Unknown hotel" });

    // validate menu item is active and priced
    const { data: item } = await supabase
      .from("menu_items")
      .select("item_key, price, base_price, active")
      .eq("hotel_id", hotel.id)
      .eq("item_key", item_key)
      .eq("active", true)
      .single();
    if (!item) return j(req, 400, { ok: false, error: "Item not available" });

    const unitPrice =
      typeof item.price === "number" ? item.price :
      typeof item.base_price === "number" ? item.base_price :
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

    return j(req, 201, { ok: true, id: data.id });
  } catch (e) {
    return j(req, 500, { ok: false, error: String(e) });
  }
});
