// supabase/functions/me-stays/index.ts
//
// GET /me-stays?limit=10
//
// Returns recent stays (bookings) for the authenticated user, pulled
// directly from bookings (joined to hotels), including:
// - rows linked via bookings.guest_id = auth.uid()
// - rows where status is NULL (legacy) OR in ('claimed', 'ongoing', 'completed')
//
// Response:
//   { items: [ { id, booking_code, hotel, check_in, check_out, bill_total, room_type } ] }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";
import { publishableKey } from "../_shared/keys.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = publishableKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[me-stays] Missing Supabase env vars");
    return json({ error: "server_not_configured" }, 500);
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });

  // 1) Auth
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData?.user) {
    console.error("[me-stays] auth error", userError);
    return json({ error: "not_authenticated" }, 401);
  }

  const userId = userData.user.id;

  // Parse & clamp limit
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "10");
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.max(limitParam, 1), 50)
      : 10;

  // 2) Pull stays directly from bookings for this guest.
  //    Include status NULL + desired statuses.
  const { data: rows, error: staysError } = await client
    .from("bookings")
    .select(
      "*, hotel:hotels(id, name, slug, city, country, cover_url)",
    )
    .eq("guest_id", userId)
    .or("status.is.null,status.in.(claimed,ongoing,completed)")
    .order("check_in", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (staysError) {
    console.error("[me-stays] bookings query error", staysError);
    return json({ error: "stays_query_failed", items: [] }, 500);
  }

  const items =
    rows?.map((row: any) => {
      // Try multiple possible field names so we stay robust to schema/view changes
      const bookingCode = row.booking_code ?? row.code ?? row.id ?? null;
      const hotelName =
        row.hotel_name ??
        row.hotel?.name ??
        row.name ??
        "Unknown hotel";
      const city =
        row.city ??
        row.hotel_city ??
        row.hotel?.city ??
        null;
      const country =
        row.country ??
        row.hotel_country ??
        row.hotel?.country ??
        null;
      const coverUrl =
        row.cover_url ??
        row.hotel_cover_url ??
        row.hotel?.cover_url ??
        null;

      return {
        id: bookingCode || String(row.id),
        booking_code: bookingCode,
        hotel_id: row.hotel_id ?? row.hotel?.id ?? null,
        status: row.status ?? null,
        hotel: {
          name: hotelName,
          slug: row.hotel?.slug ?? row.slug ?? null,
          city,
          country,
          cover_url: coverUrl,
        },
        check_in: row.check_in,
        check_out: row.check_out,
        bill_total: row.bill_total ?? row.total_bill ?? null,
        room_type: row.room_type ?? row.room ?? null,
      };
    }) ?? [];

  return json({ items });
});
