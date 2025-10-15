import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function res(status: number, body: unknown) {
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
  if (req.method === "OPTIONS") return res(200, { ok: true });

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      // service role so this works even before RLS is configured
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return res(400, { ok: false, error: "Unknown hotel" });

    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: orders } = await supabase
      .from("orders")
      .select("id, item_key, qty, price, status, created_at, closed_at")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return res(200, { ok: true, tickets: tickets ?? [], orders: orders ?? [] });
  } catch (e) {
    return res(500, { ok: false, error: String(e) });
  }
});
