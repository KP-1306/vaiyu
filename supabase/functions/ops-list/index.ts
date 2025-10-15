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

/** simple base64 cursor helpers: `${created_at}::${id}` */
function encCursor(dt: string, id: string) {
  return btoa(`${dt}::${id}`);
}
function decCursor(c?: string | null): { dt?: string; id?: string } {
  if (!c) return {};
  try {
    const [dt, id] = atob(c).split("::");
    if (dt && id) return { dt, id };
  } catch {}
  return {};
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

    // page sizes
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "100")));
    const ordersLimit = Math.min(limit, Math.max(1, Number(url.searchParams.get("orders_limit") || String(Math.min(limit, 100)))));

    // time window
    const lastHours = Number(url.searchParams.get("last_hours") || "168"); // default 7 days
    const sinceParam = url.searchParams.get("since");
    const sinceISO = sinceParam
      ? new Date(sinceParam).toISOString()
      : isFinite(lastHours)
      ? new Date(Date.now() - lastHours * 3600_000).toISOString()
      : new Date(Date.now() - 7 * 86400_000).toISOString();

    // cursors (keyset)
    const itemsCursorIn = url.searchParams.get("cursor");            // for tickets/items
    const ordersCursorIn = url.searchParams.get("orders_cursor");    // optional, for orders list
    const { dt: itemsCursorDt, id: itemsCursorId } = decCursor(itemsCursorIn);
    const { dt: ordersCursorDt, id: ordersCursorId } = decCursor(ordersCursorIn);

    // 3) Resolve hotel and ensure membership
    const { data: hotel, error: hErr } = await anon.from("hotels").select("id").eq("slug", slug).single();
    if (hErr || !hotel) return J(400, { ok: false, error: "Unknown hotel" });

    const { data: roleRow } = await anon
      .from("v_user_roles")
      .select("role")
      .eq("user_id", me.user.id)
      .eq("hotel_id", hotel.id)
      .maybeSingle();
    if (!roleRow) return J(403, { ok: false, error: "Forbidden" });

    // 4) Tickets (RLS-protected via anon client) — ORDER: created_at DESC, id DESC
    let tQuery = anon
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1); // fetch one extra to detect next page

    if (status !== "all") tQuery = tQuery.eq("status", status);
    if (sinceISO) tQuery = tQuery.gte("created_at", sinceISO);

    // keyset pagination for tickets (created_at DESC, id DESC)
    if (itemsCursorDt && itemsCursorId) {
      // all rows strictly before the (created_at, id) pair
      // Note: postgrest lacks multi-col lt(), so approximate:
      //  (created_at < cursor_dt) OR (created_at = cursor_dt AND id < cursor_id)
      tQuery = tQuery.or(
        `created_at.lt.${itemsCursorDt},and(created_at.eq.${itemsCursorDt},id.lt.${itemsCursorId})`
      );
    }

    const { data: tickets, error: tErr } = await tQuery;
    if (tErr) return J(400, { ok: false, error: tErr.message });

    // 5) Services map for enrichment
    const { data: services, error: sErr } = await anon
      .from("services")
      .select("key, label, sla_minutes, active")
      .eq("hotel_id", hotel.id);
    if (sErr) {
      console.warn("services fetch failed:", sErr);
    }
    const svcMap = new Map<string, { label?: string | null; sla_minutes?: number | null }>();
    for (const s of services ?? []) svcMap.set(s.key, { label: s.label, sla_minutes: s.sla_minutes });

    // Prepare ticket page and next cursor
    let hasMoreItems = false;
    let pageItems = tickets ?? [];
    if (pageItems.length > limit) {
      hasMoreItems = true;
      pageItems = pageItems.slice(0, limit);
    }
    const items = pageItems.map((t) => ({
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
    const itemsNextCursor =
      items.length > 0
        ? encCursor(items[items.length - 1].created_at, items[items.length - 1].id)
        : null;

    // 6) Orders (optional) with its own pagination
    let orders: any[] = [];
    let ordersHasMore = false;
    let ordersNextCursor: string | null = null;

    if (includeOrders) {
      let oQuery = anon
        .from("orders")
        .select("id, item_key, qty, price, status, created_at, closed_at, room, booking_code")
        .eq("hotel_id", hotel.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(ordersLimit + 1);

      if (orderStatus && orderStatus !== "all") oQuery = oQuery.eq("status", orderStatus);
      if (sinceISO) oQuery = oQuery.gte("created_at", sinceISO);

      if (ordersCursorDt && ordersCursorId) {
        oQuery = oQuery.or(
          `created_at.lt.${ordersCursorDt},and(created_at.eq.${ordersCursorDt},id.lt.${ordersCursorId})`
        );
      }

      const { data: oData, error: oErr } = await oQuery;
      if (oErr) return J(400, { ok: false, error: oErr.message });

      let oPage = oData ?? [];
      if (oPage.length > ordersLimit) {
        ordersHasMore = true;
        oPage = oPage.slice(0, ordersLimit);
      }
      orders = oPage;
      ordersNextCursor =
        orders.length > 0
          ? encCursor(orders[orders.length - 1].created_at, orders[orders.length - 1].id)
          : null;
    }

    // Totals on the current ticket page (kept lightweight; not global counts)
    const totals = {
      open: (pageItems ?? []).filter((x) => x.status === "open").length,
      closed: (pageItems ?? []).filter((x) => x.status === "closed").length,
    };

    return J(200, {
      ok: true,
      items,
      items_next_cursor: hasMoreItems ? itemsNextCursor : null,
      orders,
      orders_next_cursor: ordersHasMore ? ordersNextCursor : null,
      totals,
    });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
