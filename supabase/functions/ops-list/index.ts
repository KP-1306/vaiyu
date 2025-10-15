// supabase/functions/ops-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** JSON + CORS */
function J(status: number, body: unknown) {
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

/** anon client that forwards the caller's Authorization */
function supabaseAnon(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "GET") return J(405, { ok: false, error: "Method Not Allowed" });

  try {
    const anon = supabaseAnon(req);

    // 1) Require signed-in user
    const { data: me, error: meErr } = await anon.auth.getUser();
    if (meErr || !me?.user) return J(401, { ok: false, error: "Unauthorized" });

    // 2) Parse filters
    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1").trim();
    const status = (url.searchParams.get("status") || "open").toLowerCase(); // open|closed|all
    const orderStatus = url.searchParams.get("order_status") || "";
    const includeOrders = (url.searchParams.get("include_orders") || "1") !== "0";
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "100")));
    const lastHours = Number(url.searchParams.get("last_hours") || "168"); // 7 days default
    const sinceParam = url.searchParams.get("since");
    const sinceISO = sinceParam
      ? new Date(sinceParam).toISOString()
      : isFinite(lastHours)
      ? new Date(Date.now() - lastHours * 3600_000).toISOString()
      : new Date(Date.now() - 7 * 86400_000).toISOString();

    // 3) Resolve hotel and ensure membership (owner/staff/viewer)
    const { data: hotel, error: hErr } = await anon.from("hotels").select("id").eq("slug", slug).single();
    if (hErr || !hotel) return J(400, { ok: false, error: "Unknown hotel" });

    const { data: roleRow } = await anon
      .from("v_user_roles")
      .select("role")
      .eq("user_id", me.user.id)
      .eq("hotel_id", hotel.id)
      .maybeSingle();
    if (!roleRow) return J(403, { ok: false, error: "Forbidden" });

    // 4) Tickets (RLS-protected via anon client)
    let tQuery = anon
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status !== "all") tQuery = tQuery.eq("status", status);
    if (sinceISO) tQuery = tQuery.gte("created_at", sinceISO);

    const { data: tickets, error: tErr } = await tQuery;
    if (tErr) return J(400, { ok: false, error: tErr.message });

    // 5) Services map for enrichment (ensure SELECT policy on services)
    const { data: services, error: sErr } = await anon
      .from("services")
      .select("key, label, sla_minutes, active")
      .eq("hotel_id", hotel.id);
    if (sErr) {
      // not fatal; continue without enrichment
      console.warn("services fetch failed:", sErr);
    }
    const svcMap = new Map<string, { label?: string | null; sla_minutes?: number | null }>();
    for (const s of services ?? []) svcMap.set(s.key, { label: s.label, sla_minutes: s.sla_minutes });

    const items = (tickets ?? []).map((t) => ({
      id: t.id,
      service_key: t.service_key,
      label: svcMap.get(t.service_key)?.label ?? t.service_key,
      room: t.room,
      status: t.status,
      created_at: t.created_at,
      minutes_to_close: t.minutes_to_close,
      on_time: t.on_time,
      sla_minutes: svcMap.get(t.service_key)?.sla_minutes ?? null,
    }));

    // 6) Orders (optional)
    let orders: any[] = [];
    if (includeOrders) {
      let oQuery = anon
        .from("orders")
        .select("id, item_key, qty, price, status, created_at, closed_at, room, booking_code")
        .eq("hotel_id", hotel.id)
        .order("created_at", { ascending: false })
        .limit(Math.min(limit, 100));
      if (orderStatus && orderStatus !== "all") oQuery = oQuery.eq("status", orderStatus);
      if (sinceISO) oQuery = oQuery.gte("created_at", sinceISO);
      const { data: oData, error: oErr } = await oQuery;
      if (oErr) return J(400, { ok: false, error: oErr.message });
      orders = oData ?? [];
    }

    const totals = {
      open: (tickets ?? []).filter((x) => x.status === "open").length,
      closed: (tickets ?? []).filter((x) => x.status === "closed").length,
    };

    return J(200, { ok: true, items, orders, totals });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
