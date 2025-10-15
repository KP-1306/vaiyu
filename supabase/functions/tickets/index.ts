// supabase/functions/tickets/index.ts
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

    // ----- READ (for deep link /status pages) -----
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return J(400, { ok: false, error: "id required" });

      const { data, error } = await supabase
        .from("tickets")
        .select(
          "id, hotel_id, booking_code, service_key, room, status, created_at, closed_at, minutes_to_close, on_time"
        )
        .eq("id", id)
        .single();

      if (error || !data) return J(404, { ok: false, error: "not found" });
      return J(200, { ok: true, ticket: data });
    }

    // ----- CREATE -----
    if (req.method !== "POST") {
      return J(405, { ok: false, error: "Method Not Allowed" });
    }

    const body = await req.json().catch(() => ({} as any));

    const slug =
      String(body?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "").trim() || "TENANT1";
    const service_key = String(body?.service_key ?? "").trim();
    const booking_code =
      body?.booking_code === undefined || body?.booking_code === null
        ? null
        : String(body.booking_code).trim();
    const room =
      body?.room === undefined || body?.room === null
        ? null
        : String(body.room).trim();

    if (!slug || !service_key) {
      return J(400, { ok: false, error: "slug and service_key required" });
    }

    // Resolve hotel
    const { data: hotel } = await supabase
      .from("hotels")
      .select("id")
      .eq("slug", slug)
      .single();
    if (!hotel) return J(400, { ok: false, error: "Unknown hotel" });

    // Validate service exists & active for this hotel
    const { data: svc } = await supabase
      .from("services")
      .select("key, active")
      .eq("hotel_id", hotel.id)
      .eq("key", service_key)
      .eq("active", true)
      .single();
    if (!svc) return J(400, { ok: false, error: "Service not available" });

    // De-dupe: if an open ticket for same service/room/booking was created in last 5 minutes, reuse it
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let dupQuery = supabase
      .from("tickets")
      .select("id, status, created_at")
      .eq("hotel_id", hotel.id)
      .eq("service_key", service_key)
      .eq("status", "open")
      .gte("created_at", since);

    if (room !== null) dupQuery = dupQuery.eq("room", room);
    else dupQuery = dupQuery.is("room", null);

    if (booking_code !== null) dupQuery = dupQuery.eq("booking_code", booking_code);
    else dupQuery = dupQuery.is("booking_code", null);

    const { data: dup } = await dupQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dup) {
      return J(200, { ok: true, id: dup.id, deduped: true });
    }

    // Create new ticket
    const payload = {
      hotel_id: hotel.id,
      booking_code,
      service_key,
      room,
      status: "open" as const,
    };

    const { data, error } = await supabase
      .from("tickets")
      .insert(payload)
      .select("id")
      .single();

    if (error) return J(400, { ok: false, error: error.message });
    return J(201, { ok: true, id: data.id });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
