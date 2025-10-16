import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK      = Deno.env.get("WEBHOOK_ALERT_URL")!;

async function postAlert(title: string, text: string, meta?: unknown) {
  if (!WEBHOOK) return;
  await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, text, meta }),
  }).catch(() => {});
}

serve(async () => {
  const s = createClient(SUPABASE_URL, SERVICE_KEY);
  const today = new Date();
  const since = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // 1) AI usage nearing budget
  const { data: usage } = await s
    .from("ai_usage")
    .select("hotel_id, month_utc, used_tokens, budget_tokens");

  const alerts: string[] = [];
  (usage || []).forEach((u) => {
    const pct = u.budget_tokens ? (100 * u.used_tokens) / u.budget_tokens : 0;
    if (pct >= 80) {
      alerts.push(
        `AI usage ${pct.toFixed(1)}% of budget (hotel ${u.hotel_id}, month ${u.month_utc}).`
      );
    }
  });

  // 2) Late closures ratio in last 24h
  const { data: tix } = await s
    .from("tickets")
    .select("hotel_id, on_time, closed_at")
    .gte("closed_at", since);

  if (tix?.length) {
    const byHotel: Record<string, { c: number; late: number }> = {};
    for (const t of tix) {
      const h = String(t.hotel_id);
      byHotel[h] ??= { c: 0, late: 0 };
      if (t.closed_at) {
        byHotel[h].c++;
        if (t.on_time === false) byHotel[h].late++;
      }
    }
    for (const [h, v] of Object.entries(byHotel)) {
      if (v.c >= 10) {
        const pctLate = (100 * v.late) / v.c;
        if (pctLate >= 25) alerts.push(`Late closures ${pctLate.toFixed(0)}% in last 24h (hotel ${h}).`);
      }
    }
  }

  if (alerts.length) {
    await postAlert("VAiyu Ops Monitor", alerts.join("\n"), { count: alerts.length });
  }

  return new Response(JSON.stringify({ ok: true, alerts }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
});
