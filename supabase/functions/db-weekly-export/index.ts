// supabase/functions/db-weekly-export/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Pull data you care about (use pagination if huge)
  const [tickets, orders, services] = await Promise.all([
    supabase.from("tickets").select("*"),
    supabase.from("orders").select("*"),
    supabase.from("services").select("*"),
  ]);

  // 2) Serialize as CSV (very basic)
  const toCsv = (rows: any[]) => {
    if (!rows?.length) return "";
    const headers = Object.keys(rows[0]);
    const lines = rows.map(r => headers.map(h => JSON.stringify(r[h] ?? "")).join(","));
    return headers.join(",") + "\n" + lines.join("\n");
  };

  const now = new Date();
  const stamp = now.toISOString().slice(0,10); // YYYY-MM-DD

  // 3) Upload to Storage (create a "db-backups" bucket once)
  const upload = async (name: string, rows: any[]|undefined) => {
    const content = toCsv(rows || []);
    const path = `weekly/${stamp}/${name}.csv`;
    await supabase.storage.from("db-backups").upload(path, new Blob([content], { type: "text/csv" }), { upsert: true });
  };

  await upload("tickets", tickets.data);
  await upload("orders", orders.data);
  await upload("services", services.data);

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" }});
});
