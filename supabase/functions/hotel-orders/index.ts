// supabase/functions/hotel-orders/index.ts
//
// Staff-side: list orders for a hotel (used by Desk / OpsBoard / Orders / Kitchen
// as a fallback to the direct-RLS read).
// AuthZ: caller must be authenticated AND a member of the requested hotel.
//
// Previously this ran service-role with NO auth + verify_jwt=false, so anyone with
// the public key could read ANY hotel's orders (GET) AND create orders for any hotel
// (POST). The POST had no frontend caller (the app uses /orders for creates), so it
// is dropped here; the GET is now membership-gated.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  assertAuthed,
  supabaseAnon,
  supabaseService,
  json,
  preflight,
} from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const url = new URL(req.url);
  const hotelId =
    url.searchParams.get("hotel_id") ?? url.searchParams.get("hotelId");
  if (!hotelId) return json(400, { ok: false, error: "hotel_id required" });

  // AuthN: valid user JWT.
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;

  // AuthZ: caller must be a member of this hotel (evaluated with the caller's JWT).
  const { data: isMember, error: mErr } = await supabaseAnon(req)
    .rpc("vaiyu_is_hotel_member", { p_hotel_id: hotelId });
  if (mErr) return json(500, { ok: false, error: mErr.message });
  if (isMember !== true) return json(403, { ok: false, error: "Forbidden" });

  const status = url.searchParams.get("status") || "open";
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, Math.trunc(limitRaw)), 500)
    : 100;

  // Service role is safe now that membership is enforced above.
  const svc = supabaseService();
  let query = svc
    .from("orders")
    .select(
      "id, hotel_id, booking_code, room, item_key, qty, price, status, created_at, closed_at",
    )
    .eq("hotel_id", hotelId);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return json(400, { ok: false, error: error.message });

  return json(200, { ok: true, hotel_id: hotelId, status, orders: data ?? [] });
});
