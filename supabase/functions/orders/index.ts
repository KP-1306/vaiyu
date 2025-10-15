// supabase/functions/orders/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Read by id (optional, for deep links) -----------------------------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return J(400, { ok: false, error: "id required" });

      const { data, error } = await supabase
        .from("orders")
        .select("id, hotel_id, booking_code, room, item_key, qty, price, status, created_at, closed_at")
        .eq("id", id)
        .single();

      if (error || !data) return J(404, { ok: false, error: "not found" });
      return J(200, { ok: true, order: data });
    }

    // ---- Create order ------------------------------------------------------
    if (req.method !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });

    const b = await req.json().catch(() => ({} as any));

    const slug =
      String(b?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "").trim() || "TENANT1";
    const item_key = String(b?.item_key ?? "").trim();
    const qty = Math.max(1, Number(b?.qty ?? 1));
    const booking_code =
      b?.booking_code === undefined || b?.booking_code === null
        ? null
        : String(b.booking_code).trim();
    const room =
      b?.room === undefined || b?.room === null
        ? null
        : String(b.room).trim();

    if (!slug || !item_key) {
      return J(400, { ok: false, error: "slug and item_key required" });
    }

    // resolve hotel
    const { data: hotel } = await supabase
      .from("hotels")
      .select("id")
      .eq("slug", slug)
      .single();
    if (!hotel) return J(400, { ok: false, error: "Unknown hotel" });

    // validate item (active) + get price from catalog
    const { data: item } = await supabase
      .from("menu_items")
      .select("key, price, active")
      .eq("hotel_id", hotel.id)
      .eq("key", item_key)
      .eq("active", true)
      .single();
    if (!item) return J(400, { ok: false, error: "Item not available" });

    const payload = {
      hotel_id: hotel.id,
      booking_code,
      room,
      item_key,
      qty,
      price: item.price,     // authoritative unit price from catalog
      status: "open" as const,
    };

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

    if (error) return J(400, { ok: false, error: error.message });
    return J(201, { ok: true, id: data.id });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
