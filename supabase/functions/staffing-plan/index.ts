// supabase/functions/staffing-plan/index.ts
//
// Owner-dashboard staffing plan for a given day.
// AuthZ: caller must be authenticated AND a member of the requested hotel.
// (Previously this ran service-role with NO auth + verify_jwt=false — fixed.)
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
  const dateStr = url.searchParams.get("date"); // e.g. "2026-06-27"
  if (!hotelId || !dateStr) {
    return json(400, {
      error: "Missing required query params 'hotelId' and/or 'date'",
    });
  }

  // AuthN: valid user JWT.
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;

  // AuthZ: caller must be a member of this hotel (evaluated with the caller's JWT).
  const { data: isMember, error: mErr } = await supabaseAnon(req)
    .rpc("vaiyu_is_hotel_member", { p_hotel_id: hotelId });
  if (mErr) return json(500, { error: mErr.message });
  if (isMember !== true) return json(403, { error: "Forbidden" });

  // Service role is safe now that membership is enforced above.
  const svc = supabaseService();
  const { data, error } = await svc.rpc("staffing_plan_for_day", {
    p_hotel_id: hotelId,
    p_date: dateStr,
  });
  if (error) {
    console.error("staffing-plan error", error);
    return json(500, { error: error.message });
  }
  return json(200, data ?? []);
});
