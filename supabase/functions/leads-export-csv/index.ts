import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const __serveObs = (h: (req: Request) => Response | Promise<Response>) => Deno.serve(__withObs("leads-export-csv", h));
// supabase/functions/leads-export-csv/index.ts
//
// Owner-side CSV export of leads. JWT-required, RLS-respected.
//
// Uses keyset cursor pagination (last_activity_at + id) internally to handle
// large exports without offset-pagination degradation at 50k+ rows.
//
// Returns text/csv with UTF-8 BOM + Content-Disposition attachment so Excel
// double-click opens cleanly with correct encoding.
//
// Telemetry: row_count, duration_ms, filter_summary logged to stdout (Sentry-
// equivalent in Edge Functions).

import {
  CORS_HEADERS,
  json,
  preflight,
  assertAuthed,
  supabaseAnon,
} from "../_shared/auth.ts";

interface ExportBody {
  hotel_id?: string;
  filters?: {
    status?: string[];
    source?: string[];
    search?: string;
    assignedTo?: string | null;
    includeDeleted?: boolean;
  };
}

const PAGE_SIZE = 1000;

const CSV_COLUMNS = [
  "id",
  "status",
  "source",
  "source_detail",
  "contact_name",
  "contact_phone",
  "contact_phone_normalized",
  "contact_email",
  "requested_check_in",
  "requested_check_out",
  "party_adults",
  "party_children",
  "room_count",
  "value_estimate",
  "status_reason",
  "assigned_to",
  "won_at",
  "converted_at",
  "converted_booking_id",
  "latest_note_preview",
  "tags",
  "created_at",
  "last_activity_at",
] as const;

type LeadRow = Record<(typeof CSV_COLUMNS)[number], unknown> & {
  last_activity_at: string;
  id: string;
};

/** RFC 4180 escape: wrap in quotes if contains comma/quote/newline; double internal quotes. */
function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (Array.isArray(v)) s = v.join(";");
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: LeadRow): string {
  return CSV_COLUMNS.map((col) => csvField((row as Record<string, unknown>)[col])).join(",");
}

__serveObs(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  const start = performance.now();

  // Auth — fail fast on missing/invalid JWT (assertAuthed returns Response on 401)
  const authed = await assertAuthed(req);
  if (authed instanceof Response) {
    return json(401, { ok: false, code: "NOT_AUTHENTICATED" });
  }
  const userId = authed.user.id;

  let body: ExportBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "malformed_json" });
  }

  const hotelId = body.hotel_id;
  if (!hotelId) {
    return json(400, { ok: false, code: "INVALID_REQUEST", detail: "hotel_id_missing" });
  }

  // Anon client carries user JWT — RLS naturally enforces hotel-member scope
  const svc = supabaseAnon(req);

  // Verify hotel membership via the existing helper
  const { data: memberCheck, error: memberErr } = await svc.rpc(
    "vaiyu_is_hotel_member",
    { p_hotel_id: hotelId },
  );
  if (memberErr) {
    console.error("[leads-export-csv] member check failed", memberErr);
    return json(500, { ok: false, code: "UNKNOWN_ERROR" });
  }
  if (memberCheck !== true) {
    return json(403, { ok: false, code: "NOT_AUTHORIZED" });
  }

  const filters = body.filters ?? {};
  const filterSummary = {
    status: filters.status ?? null,
    source: filters.source ?? null,
    search: filters.search ?? null,
    assignedTo: filters.assignedTo ?? "any",
    includeDeleted: !!filters.includeDeleted,
  };

  // Build common query factory — each page uses keyset cursor (lastSeenActivity, lastSeenId).
  // Order: last_activity_at DESC, id DESC. This matches the list view's stable order.
  const buildQuery = (cursor: { activity: string; id: string } | null) => {
    let q = svc.from("leads").select("*").eq("hotel_id", hotelId);
    if (!filters.includeDeleted) q = q.is("deleted_at", null);
    if (filters.status && filters.status.length > 0) q = q.in("status", filters.status);
    if (filters.source && filters.source.length > 0) q = q.in("source", filters.source);
    if (filters.assignedTo === null) q = q.is("assigned_to", null);
    else if (filters.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
    if (filters.search) {
      const term = `%${filters.search}%`;
      q = q.or(
        `contact_name.ilike.${term},contact_phone.ilike.${term},contact_phone_normalized.ilike.${term},contact_email.ilike.${term}`,
      );
    }
    if (cursor) {
      // Keyset cursor: rows older than the last seen activity, OR same activity
      // but smaller id (tie-breaker matches list view's secondary order).
      q = q.or(
        `last_activity_at.lt.${cursor.activity},and(last_activity_at.eq.${cursor.activity},id.lt.${cursor.id})`,
      );
    }
    q = q.order("last_activity_at", { ascending: false });
    q = q.order("id", { ascending: false });
    q = q.limit(PAGE_SIZE);
    return q;
  };

  // Accumulate CSV chunks. For v1 we build in memory; future-proof for streaming
  // when 100k+ rows arrive (trigger documented in plan).
  const chunks: string[] = ["﻿" + CSV_COLUMNS.join(",") + "\r\n"]; // UTF-8 BOM + header
  let totalRows = 0;
  let cursor: { activity: string; id: string } | null = null;
  let pageCount = 0;
  const MAX_PAGES = 200; // safety: 200 * 1000 = 200k rows hard cap

  while (pageCount < MAX_PAGES) {
    const { data, error } = await buildQuery(cursor);
    if (error) {
      console.error("[leads-export-csv] page query failed", {
        hotel_id: hotelId,
        page: pageCount,
        error,
      });
      return json(500, { ok: false, code: "UNKNOWN_ERROR" });
    }
    const rows = (data ?? []) as LeadRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      chunks.push(rowToCsv(row) + "\r\n");
    }
    totalRows += rows.length;
    pageCount += 1;

    if (rows.length < PAGE_SIZE) break;

    const last = rows[rows.length - 1];
    cursor = { activity: last.last_activity_at, id: last.id };
  }

  const duration_ms = Math.round(performance.now() - start);

  console.log("[leads-export-csv] ok", {
    hotel_id: hotelId,
    user_id: userId,
    row_count: totalRows,
    page_count: pageCount,
    duration_ms,
    filter_summary: filterSummary,
  });

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(chunks.join(""), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${hotelId}-${date}.csv"`,
    },
  });
});
