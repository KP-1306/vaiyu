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

serve(async (req) => {
  if (req.method === "OPTIONS") return J(200, { ok: true });
  if (req.method !== "POST") return J(405, { ok: false, error: "Method Not Allowed" });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "closeTicket") {
      const id = body?.id;
      if (!id) return J(400, { ok: false, error: "id required" });

      // fetch ticket + SLA
      const { data: t } = await supabase
        .from("tickets")
        .select("id, hotel_id, service_key, created_at")
        .eq("id", id)
        .single();

      if (!t) return J(404, { ok: false, error: "ticket not found" });

      const { data: svc } = await supabase
        .from("services")
        .select("sla_minutes")
        .eq("hotel_id", t.hotel_id)
        .eq("key", t.service_key)
        .single();

      const closedAt = new Date();
      const minutes =
        Math.round((closedAt.getTime() - new Date(t.created_at).getTime()) / 60000);

      const onTime = svc ? minutes <= (svc.sla_minutes ?? 30) : true;

      const { error } = await supabase
        .from("tickets")
        .update({ status: "closed", closed_at: closedAt.toISOString(), minutes_to_close: minutes, on_time: onTime })
        .eq("id", id);

      if (error) return J(400, { ok: false, error: error.message });
      return J(200, { ok: true, minutes_to_close: minutes, on_time: onTime });
    }

    if (action === "setOrderStatus") {
      const id = body?.id;
      const status = body?.status; // 'preparing' | 'delivered' | 'cancelled'
      if (!id || !status) return J(400, { ok: false, error: "id and status required" });

      const patch: any = { status };
      if (status === "delivered") patch.closed_at = new Date().toISOString();

      const { error } = await supabase.from("orders").update(patch).eq("id", id);
      if (error) return J(400, { ok: false, error: error.message });
      return J(200, { ok: true });
    }

    return J(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    return J(500, { ok: false, error: String(e) });
  }
});
