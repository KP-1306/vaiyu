// supabase/functions/ops-heatmap/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  const from = url.searchParams.get("from"); // ISO timestamp optional
  const to = url.searchParams.get("to");     // ISO timestamp optional

  if (!hotelId) {
    return new Response(
      JSON.stringify({ error: "Missing required query param 'hotelId'" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let query = supabase
    .from("ops_ticket_heatmap")
    .select("*")
    .eq("hotel_id", hotelId)
    .order("hour_bucket", { ascending: true });

  if (from) query = query.gte("hour_bucket", from);
  if (to) query = query.lt("hour_bucket", to);

  const { data, error } = await query;

  if (error) {
    console.error("ops-heatmap error", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify(data ?? []),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
