// supabase/functions/catalog-services/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });
  if (req.method !== "GET") return j(req, 405, { ok: false, error: "Method Not Allowed" });

  try {
    const url = new URL(req.url);
    const slug = url.pathname.split("/").pop() || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: hotel, error: hErr } = await supabase
      .from("hotels").select("id").eq("slug", slug).single();
    if (hErr || !hotel) return j(req, 200, { items: [] });

    const { data, error } = await supabase
      .from("services")
      .select("key,label,sla_minutes,active")
      .eq("hotel_id", hotel.id)
      .eq("active", true);

    if (error) return j(req, 200, { items: [] });
    return j(req, 200, { items: data ?? [] });
  } catch (e) {
    return j(req, 500, { ok: false, error: String(e) });
  }
});
