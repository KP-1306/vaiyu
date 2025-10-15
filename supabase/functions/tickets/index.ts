// supabase/functions/tickets/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

/** create anon client (used for rate-limiting table) */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}

async function rateLimitOrThrow(req: Request, keyHint: string, limit = 100) {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });

  try {
    // Service-role client to allow public ticket create (guest use-case) while RLS is on
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // GET /tickets?id=...  (used by deep link)
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
      return j(req, 200, { ok: true, ticket: data });
    }

    if (req.method !== "POST") return j(req, 405, { ok: false, error: "Method Not Allowed" });

    // Rate limit public creation
    await rateLimitOrThrow(req, "tickets-create", 60);

    const body = await req.json().catch(() => ({} as any));

    const slug = String(body?.slug ?? Deno.env.get("VA_TENANT_SLUG") ?? "TENANT1").trim();
    const service_key = String(body?.service_key ?? "").trim();
    const booking_code = body?.booking_code == null ? null : String(body.booking_code).trim();
    const room = body?.room == null ? null : String(body.room).trim();

    if (!slug || !service_key) return j(req, 400, { ok: false, error: "slug and service_key required" });

    // resolve hotel
    const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return j(req, 400, { ok: false, error: "Unknown hotel" });

    // active service check
    const { data: svc } = await supabase
      .from("services")
      .select("key, active")
      .eq("hotel_id", hotel.id)
      .eq("key", service_key)
      .eq("active", true)
      .single();
    if (!svc) return j(req, 400, { ok: false, error: "Service not available" });

    // de-dupe open ticket in last 5 mins
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
    if (dup) return j(req, 200, { ok: true, id: dup.id, deduped: true });

    // create ticket
    const payload = {
      hotel_id: hotel.id,
      booking_code,
      service_key,
      room,
      status: "open" as const,
    };
    const { data, error } = await supabase.from("tickets").insert(payload).select("id").single();
    if (error) return j(req, 400, { ok: false, error: error.message });

    return j(req, 201, { ok: true, id: data.id });
  } catch (e) {
    return j(req, 500, { ok: false, error: String(e) });
  }
});
