import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,OPTIONS",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json(400, { ok: false, error: "id required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
      .eq("id", id)
      .single();

    if (error) return json(404, { ok: false, error: error.message });
    return json(200, { ok: true, ticket: data });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
});
