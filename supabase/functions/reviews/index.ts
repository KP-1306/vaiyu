// supabase/functions/reviews/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function J(status: number, body: unknown) {
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

type Kpis = {
  window_days: number;
  tickets_total: number;
  tickets_closed: number;
  tickets_open: number;
  on_time_closed: number;
  late_closed: number;
  avg_minutes_to_close: number | null;
  on_time_pct: number | null;
};

async function getHotelId(supabase: SupabaseClient, slug: string) {
  const { data: hotel, error } = await supabase.from("hotels").select("id").eq("slug", slug).single();
  if (error || !hotel) throw new Error("Unknown hotel");
  return hotel.id as string;
}

async function computeKpis(
  supabase: SupabaseClient,
  hotelId: string,
  periodDays: number
): Promise<Kpis> {
  const since = new Date(Date.now() - periodDays * 86400_000).toISOString();

  const { data: tickets = [], error } = await supabase
    .from("tickets")
    .select("status, on_time, minutes_to_close")
    .eq("hotel_id", hotelId)
    .gte("created_at", since);

  if (error) throw new Error(error.message);

  const total = tickets.length;
  const closed = tickets.filter((t) => t.status === "closed");
  const ontime = closed.filter((t) => t.on_time === true).length;
  const late = closed.filter((t) => t.on_time === false).length;
  const avgMins =
    closed.length > 0
      ? Math.round(closed.reduce((s, t) => s + (t.minutes_to_close || 0), 0) / closed.length)
      : null;
  const ontimePct = closed.length > 0 ? Math.round((ontime / closed.length) * 100) : null;

  return {
    window_days: periodDays,
    tickets_total: total,
    tickets_closed: closed.length,
    tickets_open: total - closed.length,
    on_time_closed: ontime,
    late_closed: late,
    avg_minutes_to_close: avgMins,
    on_time_pct: ontimePct,
  };
}

function buildDraft(k: Kpis) {
  const bits: string[] = [];
  bits.push(`Stay period: last ${k.window_days} days.`);
  bits.push(
    `We handled ${k.tickets_closed}/${k.tickets_total || 0} requests; ${
      k.on_time_pct == null ? "no closures yet" : `${k.on_time_pct}% on time`
    }${k.avg_minutes_to_close ? ` (avg ${k.avg_minutes_to_close} mins)` : ""}.`
  );
  if (k.late_closed > 0) bits.push(`Late closures: ${k.late_closed}. We’re improving peak-hour flow.`);
  if (k.tickets_open > 0) bits.push(`Open items in progress: ${k.tickets_open}.`);
  return bits.join(" ");
}

/* ---------------------- Route handlers ---------------------- */

async function handleSummary(url: URL, supabase: SupabaseClient) {
  const slug = url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";
  const periodDays = Math.max(7, Math.min(90, Number(url.searchParams.get("period_days") || 30)));

  const hotelId = await getHotelId(supabase, slug);
  const kpis = await computeKpis(supabase, hotelId, periodDays);
  const draft = buildDraft(kpis);

  return J(200, { ok: true, kpis, draft });
}

async function handleAuto(body: any, supabase: SupabaseClient) {
  const slug = String(body?.slug || Deno.env.get("VA_TENANT_SLUG") || "TENANT1").trim();
  const periodDays = Math.max(7, Math.min(90, Number(body?.period_days || 30)));

  const hotelId = await getHotelId(supabase, slug);
  const kpis = await computeKpis(supabase, hotelId, periodDays);
  const autoDraft = buildDraft(kpis);

  const rating = Math.min(Math.max(Number(body?.rating ?? 5), 1), 5);
  const insert = {
    hotel_id: hotelId,
    booking_code: body?.booking_code ?? null,
    rating,
    title: body?.title ?? "Stay review draft",
    body: body?.body ?? autoDraft,
    status: "pending",
  };

  const { data, error } = await supabase.from("reviews").insert(insert).select("id").single();
  if (error) return J(400, { ok: false, error: error.message });

  return J(200, { ok: true, id: data.id, draft: insert.body, kpis });
}

async function handleApprove(body: any, supabase: SupabaseClient) {
  const id = body?.id;
  if (!id) return J(400, { ok: false, error: "id required" });

  const { error } = await supabase
    .from("reviews")
    .update({ status: "approved", published_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return J(400, { ok: false, error: error.message });
  return J(200, { ok: true });
}

/* ---------------------- Server ---------------------- */

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  try {
    if (req.method === "GET" && url.pathname.endsWith("/summary")) {
      return await handleSummary(url, supabase);
    }
    if (req.method === "POST" && url.pathname.endsWith("/auto")) {
      return await handleAuto(body, supabase);
    }
    if (req.method === "POST" && url.pathname.endsWith("/approve")) {
      return await handleApprove(body, supabase);
    }
    return J(404, { ok: false, error: "Unknown route" });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
