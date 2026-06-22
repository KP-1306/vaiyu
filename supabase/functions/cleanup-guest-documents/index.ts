// supabase/functions/cleanup-guest-documents/index.ts
//
// Guest ID-document retention (hospitality standard: 365 days after last checkout).
// Storage deletion cannot be done in SQL (Supabase's storage.protect_delete trigger),
// so this runs the Storage API: for each eligible doc it DELETES the ID images from
// the private guest-documents bucket, then REDACTS the DB row to a non-sensitive
// tombstone (mark_guest_doc_purged) — preserving "collected/verified/purged on X"
// proof without keeping the scan.
//
// Invoked ONLY by pg_cron via public.va_invoke_cleanup_guest_documents (service-role
// bearer). Eligibility lives in guest_docs_due_for_purge so the retention rule has one
// source of truth.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withObs } from "../_shared/http-telemetry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE") ?? "";
const BUCKET = "guest-documents";

const j = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");

  // AuthZ: cron/service-role only.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) return j(403, { error: "forbidden" });

  let retentionDays = 365;
  try {
    const b = await req.json();
    if (b?.retention_days) retentionDays = Number(b.retention_days) || 365;
  } catch { /* default */ }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: due, error: listErr } = await svc.rpc("guest_docs_due_for_purge", { p_retention_days: retentionDays });
  if (listErr) return j(500, { ok: false, code: "LIST_FAILED", detail: listErr.message });

  let purged = 0, filesRemoved = 0, errors = 0;
  for (const doc of (due ?? []) as { id: string; front_image_url: string | null; back_image_url: string | null }[]) {
    const paths = [doc.front_image_url, doc.back_image_url].filter((p): p is string => !!p);
    try {
      if (paths.length) {
        // Storage remove is idempotent (missing objects don't error). On a real
        // failure, skip — leave the row unpurged so the next run retries it.
        const { error: rmErr } = await svc.storage.from(BUCKET).remove(paths);
        if (rmErr) { errors++; continue; }
        filesRemoved += paths.length;
      }
      const { error: redErr } = await svc.rpc("mark_guest_doc_purged", { p_id: doc.id });
      if (redErr) { errors++; continue; }
      purged++;
    } catch {
      errors++;
    }
  }

  return j(200, { ok: true, retention_days: retentionDays, due: (due ?? []).length, purged, files_removed: filesRemoved, errors });
}

Deno.serve(withObs("cleanup-guest-documents", handler));
