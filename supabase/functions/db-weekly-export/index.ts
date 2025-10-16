// supabase/functions/db-weekly-export/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Exports select tables to CSV and uploads to Storage (bucket: db-backups/weekly/YYYY-MM-DD/*.csv).
 * - Uses SERVICE_ROLE so it can read everything (RLS bypass).
 * - Keep bucket PRIVATE (recommended). You'll download as needed from the dashboard.
 *
 * ENV required in Function:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   EXPORT_TABLES: comma-separated list. Default: tickets,orders,services
 *   EXPORT_PREFIX: folder prefix inside bucket (default: weekly)
 *   EXPORT_BUCKET: bucket name (default: db-backups)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_TABLES = ["tickets", "orders", "services"];
const TABLES =
  (Deno.env.get("EXPORT_TABLES")?.split(",").map((s) => s.trim()).filter(Boolean)) ??
  DEFAULT_TABLES;

const BUCKET = Deno.env.get("EXPORT_BUCKET") ?? "db-backups";
const PREFIX = Deno.env.get("EXPORT_PREFIX") ?? "weekly";

type Row = Record<string, unknown>;

function toCsv(rows: Row[]): string {
  if (!rows?.length) return "";
  // union of keys across rows (keeps stable order)
  const columns = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>(Object.keys(rows[0])))
  );

  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    // stringify objects/arrays
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // CSV escape: wrap in quotes if contains comma/quote/newline; escape quotes by doubling
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(","));
  return [header, ...lines].join("\n");
}

serve(async (req) => {
  // CORS (allow dashboard/manual invocations)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // optional: accept override via body { tables?: string[], prefix?: string, bucket?: string }
    const override = await req.json().catch(() => ({} as any));
    const tables: string[] = Array.isArray(override?.tables) && override.tables.length
      ? override.tables
      : TABLES;

    const bucket = String(override?.bucket || BUCKET);
    const prefix = String(override?.prefix || PREFIX);

    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // fetch each table; if very large, add range pagination
    const results: Record<string, Row[] | null> = {};
    for (const t of tables) {
      const { data, error } = await supabase.from(t).select("*");
      if (error) throw new Error(`Select failed for ${t}: ${error.message}`);
      results[t] = data ?? [];
    }

    // upload each as CSV
    for (const [table, rows] of Object.entries(results)) {
      const csv = toCsv(rows || []);
      const path = `${prefix}/${stamp}/${table}.csv`;
      const res = await supabase.storage
        .from(bucket)
        .upload(path, new Blob([csv], { type: "text/csv" }), { upsert: true });
      if (res.error) throw new Error(`Upload failed for ${table}: ${res.error.message}`);
    }

    return new Response(JSON.stringify({ ok: true, bucket, prefix, date: stamp, tables }), {
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 500,
    });
  }
});
