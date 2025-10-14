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

async function handleAuto(body: any, supabase: any) {
  const slug = body?.slug || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";
  const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
  if (!hotel) return json(400, { ok: false, error: "Unknown hotel" });

  const rating = Math.min(Math.max(Number(body?.rating ?? 5), 1), 5);
  const insert = {
    hotel_id: hotel.id,
    booking_code: body?.booking_code ?? null,
    rating,
    title: body?.title ?? "Auto Draft",
    body: body?.body ?? "Auto generated draft review",
    status: "pending",
  };

  const { data, error } = await supabase.from("reviews").insert(insert).select().single();
  if (error) return json(400, { ok: false, error: error.message });
  return json(200, { ok: true, id: data.id });
}

async function handleApprove(body: any, supabase: any) {
  const id = body?.id;
  if (!id) return json(400, { ok: false, error: "id required" });
  const { error } = await supabase
    .from("reviews")
    .update({ status: "approved", published_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return json(400, { ok: false, error: error.message });
  return json(200, { ok: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  if (req.method === "POST" && url.pathname.endsWith("/auto")) return handleAuto(body, supabase);
  if (req.method === "POST" && url.pathname.endsWith("/approve")) return handleApprove(body, supabase);

  return json(404, { ok: false, error: "Unknown route" });
});
