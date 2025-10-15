// supabase/functions/ops-list/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const ADMIN = Deno.env.get("VA_ADMIN_TOKEN") || "";
function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,OPTIONS",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "GET") return J(405, { ok: false, error: "Method Not Allowed" });
  if (ADMIN && req.headers.get("x-admin") !== ADMIN) return unauthorized();

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || Deno.env.get("VA_TENANT_SLUG") || "TENANT1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve hotel
    const { data: hotel, error: hErr } = await supabase
      .from("hotels")
      .select("id")
      .eq("slug", slug)
      .single();

    if (hErr || !hotel) return J(400, { ok: false, error: "Unknown hotel" });

    // Pull services for label + SLA (one roundtrip)
    const { data: services = [] } = await supabase
      .from("services")
      .select("key,label,sla_minutes,active")
      .eq("hotel_id", hotel.id);

    const svcMap = new Map<string, { label: string | null; sla_minutes: number | null }>();
    for (const s of services) {
      svcMap.set(s.key, { label: s.label ?? s.key, sla_minutes: s.sla_minutes ?? null });
    }

    // Tickets
    const { data: tickets = [] } = await supabase
      .from("tickets")
      .select("id,service_key,room,status,created_at,minutes_to_close,on_time")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const items = tickets.map((t) => {
      const svc = svcMap.get(t.service_key) || { label: t.service_key, sla_minutes: null };
      return {
        id: t.id as string,
        service_key: t.service_key as string,
        label: svc.label,
        room: (t.room ?? null) as string | null,
        status: t.status as "open" | "closed" | string,
        created_at: t.created_at as string,
        minutes_to_close: (t.minutes_to_close ?? null) as number | null,
        on_time: (t.on_time ?? null) as boolean | null,
        sla_minutes: svc.sla_minutes,
      };
    });

    // Orders (for the lower table)
    const { data: orders = [] } = await supabase
      .from("orders")
      .select("id,item_key,qty,price,status,created_at,closed_at")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return J(200, { ok: true, items, orders });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
