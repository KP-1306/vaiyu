// supabase/functions/reviews/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { j } from "../_shared/cors.ts";
import { alertError } from "../_shared/alert.ts";
import { logTokens } from "../_shared/ai.ts";

/** lightweight admin API key for publish */
function isAdmin(req: Request) {
  const need = Deno.env.get("VA_ADMIN_API_KEY") ?? "";
  const got = req.headers.get("x-api-key") ?? "";
  return !!need && got === need;
}

/** anon client (for rate-limit table only) */
function supabaseAnon() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon);
}

/** service-role client for privileged ops */
function supabaseService() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

// ... after you call the model and have usage:
const totalTokens = resp?.usage?.total_tokens ?? 0;   // adapt to your client
const modelName   = resp?.model ?? "gpt-4o-mini";     // adapt
// you already know hotel_id in your codepath (from auth/tenant)
await logTokens(supabase, hotelId, totalTokens, { model: modelName, func: "reviews/auto" });

/** naive rate limit */
async function rateLimitOrThrow(req: Request, keyHint: string, limit = 40) {
  const supa = supabaseAnon();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as any).cf?.connectingIP ||
    "0.0.0.0";
  const key = `${keyHint}:${ip}`;
  await supa.from("api_hits").insert({ key }).select().limit(1);
  const { count } = await supa
    .from("api_hits")
    .select("ts", { count: "exact", head: true })
    .eq("key", key)
    .gte("ts", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > limit) throw new Error("Rate limit exceeded. Try again later.");
}

/** idempotency helpers */
async function idemGet(svc: SupabaseClient, route: string, hotel_id: string | null, key: string) {
  const { data } = await svc
    .from("va_idempotency_keys")
    .select("response")
    .eq("route", route)
    .eq("hotel_id", hotel_id)
    .eq("key", key)
    .maybeSingle();
  return data?.response ?? null;
}
async function idemSet(svc: SupabaseClient, route: string, hotel_id: string | null, key: string, response: unknown) {
  await svc.from("va_idempotency_keys").insert({ route, hotel_id, key, response }).catch(() => {});
}

/** audit helper */
async function audit(svc: SupabaseClient, row: {
  action: string;
  actor?: string | null;
  hotel_id?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  ip?: string | null;
  ua?: string | null;
  meta?: unknown;
}) {
  await svc.from("va_audit_logs").insert({
    at: new Date().toISOString(),
    action: row.action,
    actor: row.actor ?? null,
    hotel_id: row.hotel_id ?? null,
    entity: row.entity ?? null,
    entity_id: row.entity_id ?? null,
    ip: row.ip ?? null,
    ua: row.ua ?? null,
    meta: row.meta ?? null,
  }).catch(() => {});
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

async function computeKpis(supabase: SupabaseClient, hotelId: string, periodDays: number): Promise<Kpis> {
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
async function handleSummary(url: URL, supabase: SupabaseClient, req: Request) {
  const slug = url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";
  const periodDays = Math.max(7, Math.min(90, Number(url.searchParams.get("period_days") || 30)));
  const hotelId = await getHotelId(supabase, slug);
  const kpis = await computeKpis(supabase, hotelId, periodDays);
  const draft = buildDraft(kpis);
  return j(req, 200, { ok: true, kpis, draft });
}

async function handleAuto(body: any, svc: SupabaseClient, req: Request) {
  await rateLimitOrThrow(req, "reviews-auto", 40);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const idemKey = req.headers.get("Idempotency-Key") || null;

  const slug = String(body?.slug || Deno.env.get("VA_TENANT_SLUG") || "TENANT1").trim();
  const periodDays = Math.max(7, Math.min(90, Number(body?.period_days || 30)));
  const hotelId = await getHotelId(svc, slug);

  // idempotency short-circuit
  if (idemKey) {
    const hit = await idemGet(svc, "reviews:auto", hotelId, idemKey);
    if (hit) return j(req, 200, hit);
  }

  const kpis = await computeKpis(svc, hotelId, periodDays);
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

  const { data, error } = await svc.from("reviews").insert(insert).select("id").single();
  if (error) return j(req, 400, { ok: false, error: error.message });

  const response = { ok: true, id: data.id, draft: insert.body, kpis };

  if (idemKey) await idemSet(svc, "reviews:auto", hotelId, idemKey, response);

  await audit(svc, {
    action: "review.auto",
    hotel_id: hotelId,
    entity: "review",
    entity_id: data.id,
    ip, ua,
    meta: { periodDays, rating },
  });

  return j(req, 200, response);
}

async function handleApprove(body: any, svc: SupabaseClient, req: Request) {
  if (!isAdmin(req)) return j(req, 401, { ok: false, error: "Unauthorized" });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const idemKey = req.headers.get("Idempotency-Key") || null;

  const id = body?.id as string | undefined;
  if (!id) return j(req, 400, { ok: false, error: "id required" });

  // fetch for hotel_id and current status
  const { data: r, error: rErr } = await svc
    .from("reviews")
    .select("id, hotel_id, status")
    .eq("id", id)
    .single();
  if (rErr || !r) return j(req, 404, { ok: false, error: "review not found" });

  // Idempotency: already approved?
  if (r.status === "approved") {
    const response = { ok: true, already_approved: true };
    if (idemKey) await idemSet(svc, "reviews:approve", r.hotel_id, idemKey, response);
    return j(req, 200, response);
  }
  if (idemKey) {
    const hit = await idemGet(svc, "reviews:approve", r.hotel_id, idemKey);
    if (hit) return j(req, 200, hit);
  }

  const { error } = await svc
    .from("reviews")
    .update({ status: "approved", published_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return j(req, 400, { ok: false, error: error.message });

  const response = { ok: true };
  if (idemKey) await idemSet(svc, "reviews:approve", r.hotel_id, idemKey, response);

  await audit(svc, {
    action: "review.approve",
    hotel_id: r.hotel_id,
    entity: "review",
    entity_id: id,
    ip, ua,
  });

  return j(req, 200, response);
}

/* ---------------------- Server ---------------------- */
serve(async (req) => {
  if (req.method === "OPTIONS") return j(req, 200, { ok: true });

  const svc = supabaseService();
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  try {
    if (req.method === "GET"  && url.pathname.endsWith("/summary")) return await handleSummary(url, svc, req);
    if (req.method === "POST" && url.pathname.endsWith("/auto"))    return await handleAuto(body, svc, req);
    if (req.method === "POST" && url.pathname.endsWith("/approve")) return await handleApprove(body, svc, req);
    return j(req, 404, { ok: false, error: "Unknown route" });
  } catch (e) {
    await alertError(Deno.env.get("WEBHOOK_ALERT_URL"), {
    fn: "tickets", // change per function
    message: String(e?.message || e),
    meta: { url: req.url, method: req.method },
  });

    return j(req, 500, { ok: false, error: String(e) });
  }
});
