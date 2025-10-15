import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function res(status: number, body: unknown) {
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

const ADMIN = Deno.env.get("VA_ADMIN_TOKEN") || "";

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}


serve(async (req) => {
  if (req.method === "OPTIONS") return res(200, { ok: true });

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      // service role so this works even before RLS is configured
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find hotel
    const { data: hotel, error: hErr } = await supabase
      .from("hotels")
      .select("id")
      .eq("slug", slug)
      .single();

    if (hErr || !hotel) return res(400, { ok: false, error: "Unknown hotel" });

    // Tickets (unchanged, for backward compatibility)
    const { data: tickets, error: tErr } = await supabase
      .from("tickets")
      .select("id, service_key, room, status, created_at, closed_at, minutes_to_close, on_time, hotel_id")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (tErr) return res(500, { ok: false, error: tErr.message });

    // Orders (unchanged, for backward compatibility)
    const { data: orders, error: oErr } = await supabase
      .from("orders")
      .select("id, item_key, qty, price, status, created_at, closed_at, hotel_id")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (oErr) return res(500, { ok: false, error: oErr.message });

    // Services → to decorate tickets with label + SLA
    const { data: services, error: sErr } = await supabase
      .from("services")
      .select("key, label, sla_minutes, active");

    if (sErr) return res(500, { ok: false, error: sErr.message });

    const slaByKey = new Map<string, number>();
    const labelByKey = new Map<string, string>();
    for (const s of services ?? []) {
      if (!s) continue;
      if (typeof s.sla_minutes === "number") slaByKey.set(s.key, s.sla_minutes);
      labelByKey.set(s.key, s.label ?? s.key);
    }

    // New "items" array used by the Admin UI
    const items = (tickets ?? []).map((t) => ({
      id: t.id,
      service_key: t.service_key,
      label: labelByKey.get(t.service_key) ?? t.service_key,
      room: t.room,
      status: t.status,
      created_at: t.created_at,
      minutes_to_close: t.minutes_to_close ?? null,
      on_time: t.on_time ?? null,
      sla_minutes: slaByKey.get(t.service_key) ?? null,
    }));

    return res(200, {
      ok: true,
      // New shape for the Admin UI:
      items,
      // Old fields kept for compatibility:
      tickets: tickets ?? [],
      orders: orders ?? [],
    });
  } catch (e) {
    return res(500, { ok: false, error: String(e) });
  }
});
