// supabase/functions/ticket-get/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });
  if (req.method !== "GET") return j(req, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return j(req, 400, { ok: false, error: "id required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      // service role to read any ticket (even if RLS blocks anon)
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
      .eq("id", id)
      .single();

    if (error || !data) return j(req, 404, { ok: false, error: "not found" });
    return j(req, 200, { ok: true, ticket: data });
  } catch (e) {
    return j(req, 500, { ok: false, error: String(e) });
  }
});
