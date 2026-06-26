// supabase/functions/ops-heatmap/index.ts
//
// Owner-dashboard ops ticket heatmap.
// AuthZ: caller must be authenticated AND a member of the requested hotel.
// (Previously this ran service-role with NO auth + verify_jwt=false, so anyone
//  with the public key could read any hotel's ops data cross-tenant — fixed.)
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
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  if (!hotelId) {
    return json(400, { error: "Missing required query param 'hotelId'" });
  }

  // AuthN: valid user JWT.
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;

  // AuthZ: caller must be a member of this hotel (evaluated with the caller's JWT).
  const { data: isMember, error: mErr } = await supabaseAnon(req)
    .rpc("vaiyu_is_hotel_member", { p_hotel_id: hotelId });
  if (mErr) return json(500, { error: mErr.message });
  if (isMember !== true) return json(403, { error: "Forbidden" });

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Service role is safe now that membership is enforced above.
  const svc = supabaseService();
  let query = svc
    .from("ops_ticket_heatmap")
    .select("*")
    .eq("hotel_id", hotelId)
    .order("hour_bucket", { ascending: true });
  if (from) query = query.gte("hour_bucket", from);
  if (to) query = query.lt("hour_bucket", to);

  const { data, error } = await query;
  if (error) {
    console.error("ops-heatmap error", error);
    return json(500, { error: error.message });
  }
  return json(200, data ?? []);
});
