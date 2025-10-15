// supabase/functions/ops-update/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function J(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST,OPTIONS",
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
      "access-control-allow-methods": "POST,OPTIONS",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });
  if (ADMIN && req.headers.get("x-admin") !== ADMIN) return unauthorized();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // -------- CLOSE TICKET --------
    if (action === "closeTicket" || action === "close") {
      const id = body?.id as string | undefined;
      if (!id) return J(400, { ok: false, error: "id required" });

      const { data: t, error: tErr } = await supabase
        .from("tickets")
        .select("id, hotel_id, service_key, created_at, status, minutes_to_close, on_time, closed_at")
        .eq("id", id)
        .single();
      if (tErr || !t) return J(404, { ok: false, error: "ticket not found" });

      if (t.status === "closed") {
        return J(200, { ok: true, ticket: t, minutes_to_close: t.minutes_to_close, on_time: t.on_time });
      }

      const { data: svc } = await supabase
        .from("services")
        .select("sla_minutes")
        .eq("hotel_id", t.hotel_id)
        .eq("key", t.service_key)
        .single();

      const now = new Date();
      const start = new Date(t.created_at);
      const minutes = Math.max(0, Math.round((now.getTime() - start.getTime()) / 60000));
      const sla = typeof svc?.sla_minutes === "number" ? svc.sla_minutes : 30;
      const onTime = minutes <= sla;

      const { data: updated, error: uErr } = await supabase
        .from("tickets")
        .update({
          status: "closed",
          closed_at: now.toISOString(),
          minutes_to_close: minutes,
          on_time: onTime,
        })
        .eq("id", id)
        .select()
        .single();
      if (uErr) return J(400, { ok: false, error: uErr.message });

      return J(200, { ok: true, ticket: updated, minutes_to_close: minutes, on_time: onTime });
    }

    // -------- SET ORDER STATUS --------
    if (action === "setOrderStatus") {
      const id = body?.id as string | undefined;
      const status = body?.status as "preparing" | "delivered" | "cancelled" | undefined;
      if (!id || !status) return J(400, { ok: false, error: "id and status required" });

      const patch: Record<string, unknown> = { status };
      if (status === "delivered" || status === "cancelled") {
        patch.closed_at = new Date().toISOString();
      }

      const { data: updated, error } = await supabase
        .from("orders")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) return J(400, { ok: false, error: error.message });

      return J(200, { ok: true, order: updated });
    }

    return J(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
