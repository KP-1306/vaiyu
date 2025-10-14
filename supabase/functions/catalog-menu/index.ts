import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, body: unknown) {
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
  if (req.method === "OPTIONS") return json(200, { ok: true });

  try {
    const url = new URL(req.url);
    const slug = url.pathname.split("/").pop() || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: hotel, error: hErr } = await supabase
      .from("hotels").select("id").eq("slug", slug).single();
    if (hErr || !hotel) return json(200, { items: [] });

    const { data, error } = await supabase
      .from("menu_items")
      .select("item_key,name,base_price,active")
      .eq("hotel_id", hotel.id)
      .eq("active", true);

    if (error) return json(200, { items: [] });
    return json(200, { items: data ?? [] });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
