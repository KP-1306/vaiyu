// supabase/functions/staffing-plan/index.ts
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
  const dateStr = url.searchParams.get("date"); // e.g. "2025-11-26"

  if (!hotelId || !dateStr) {
    return new Response(
      JSON.stringify({
        error: "Missing required query params 'hotelId' and/or 'date'",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Supabase RPC expects parameters matching function args
  const { data, error } = await supabase.rpc("staffing_plan_for_day", {
    p_hotel_id: hotelId,
    p_date: dateStr,
  });

  if (error) {
    console.error("staffing-plan error", error);
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
