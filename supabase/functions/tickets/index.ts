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
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const slug = body?.slug || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const { data: hotel } = await supabase
      .from("hotels").select("id").eq("slug", slug).single();
    if (!hotel) return json(400, { ok: false, error: "Unknown hotel" });

    const payload = {
      hotel_id: hotel.id,
      booking_code: body?.booking_code ?? null,
      service_key: body?.service_key,
      room: body?.room ?? null,
    };

    const { data, error } = await supabase
      .from("tickets").insert(payload).select().single();

    if (error) return json(400, { ok: false, error: error.message });
    return json(200, { ok: true, id: data.id });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
