// web/functions/admin-metrics.ts
//
// Data API for the platform-admin Operator Console (/admin/platform). Every panel
// is CROSS-TENANT, so all reads happen here with the SERVICE-ROLE key (server-side
// only) AFTER the caller is verified as an active platform admin. Per-panel role
// tiers are enforced via canSeePanel().
//
// Routes (via netlify.toml: /api/admin/* → this function):
//   /api/admin/me         → { role }                 (any admin)
//   /api/admin/fleet      → hotel fleet rollup        (any admin)
//   /api/admin/health     → infra telemetry + cron    (any admin)
//   /api/admin/tenants    → per-hotel table           (any admin)
//   /api/admin/payments   → cross-tenant GMV          (finance_admin / super)
//   /api/admin/onboarding → owner_applications funnel  (support_admin / super)
//   /api/admin/audit      → va_audit_logs tail         (super_admin)
import type { Handler } from "@netlify/functions";
import { getPlatformAdmin, canSeePanel, type AdminEnv } from "./_adminAuth";

const ENV: AdminEnv = {
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "",
  anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
};

const svcHeaders = { apikey: ENV.service, Authorization: `Bearer ${ENV.service}` };

async function svcGet<T = any>(path: string): Promise<T[]> {
  const r = await fetch(`${ENV.url}/rest/v1/${path}`, { headers: svcHeaders });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

async function svcCount(path: string): Promise<number> {
  const r = await fetch(`${ENV.url}/rest/v1/${path}`, {
    headers: { ...svcHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = r.headers.get("content-range"); // e.g. "0-0/123" or "*/0"
  const total = cr?.split("/")[1];
  return total && total !== "*" ? parseInt(total, 10) || 0 : 0;
}


async function svcRpc<T = any>(fn: string, body: Record<string, unknown> = {}): Promise<T[]> {
  const r = await fetch(`${ENV.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...svcHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rpc ${fn} -> ${r.status}`);
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [j];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const daysAgoISO = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
function tally<T extends string>(rows: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r?.[key] ?? "unknown") as T;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

async function fleet() {
  const rows = await svcGet("hotels?select=plan,plan_status,city,created_at");
  const new7 = daysAgoISO(7), new30 = daysAgoISO(30), new60 = daysAgoISO(60);
  const cityTally = tally(rows, "city");
  const topCities = Object.entries(cityTally)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([city, n]) => ({ city, n }));
  return {
    total: rows.length,
    byStatus: tally(rows, "plan_status"),
    byPlan: tally(rows, "plan"),
    new7d: rows.filter((r) => String(r.created_at) >= new7).length,
    new30d: rows.filter((r) => String(r.created_at) >= new30).length,
    // prior 30d window [60d, 30d) for the signups trend delta
    new30dPrev: rows.filter((r) => String(r.created_at) >= new60 && String(r.created_at) < new30).length,
    topCities,
  };
}

// One-glance platform status: turns raw signals into an actionable issue list.
async function summary() {
  const since24 = daysAgoISO(1);
  const [cron, err5xx, pastDue, failedPay, httpFail, alertState] = await Promise.all([
    svcRpc("va_admin_cron_health").catch(() => [] as any[]),
    svcCount(`api_hits?select=id&status=gte.500&at=gte.${since24}`),
    svcCount(`hotels?select=id&plan_status=eq.past_due`),
    svcCount(`payments?select=id&status=eq.FAILED&created_at=gte.${since24}`).catch(() => 0),
    svcRpc("va_admin_http_failures", { p_minutes: 60 }).catch(() => [] as any[]),
    svcGet("platform_alert_state?select=sent_at&kind=eq.watch&limit=1").catch(() => [] as any[]),
  ]);
  // "Failing" = broken RIGHT NOW (last run failed, or overdue), not "failed once
  // in 24h" — so a recovered blip clears the banner instead of nagging for a day.
  // overdue is computed in va_admin_cron_health (single source of truth).
  const cronFails = (cron as any[]).filter((c) => c.last_status === "failed" || c.overdue);
  const issues: { level: "warn" | "bad"; label: string; detail?: string; link?: string }[] = [];
  if (cronFails.length) issues.push({ level: "bad", label: `${cronFails.length} cron job(s) failing`, detail: cronFails.map((c) => c.jobname).join(", ") });
  if (err5xx > 0) issues.push({ level: err5xx >= 10 ? "bad" : "warn", label: `${err5xx} server error(s) (5xx) in 24h` });
  if (pastDue > 0) issues.push({ level: "warn", label: `${pastDue} hotel(s) past due` });
  if (failedPay > 0) issues.push({ level: "warn", label: `${failedPay} failed payment(s) in 24h` });
  // edge-function call failures (cron->fn) via pg_net — cron reports "succeeded"
  // while the HTTP call errors/times out, so cron health alone misses these. Mirrors
  // admin-alerts: ANY 4xx/5xx fires (real worker error); timeouts need >=3 (cold starts).
  const hf = ((httpFail as any[])[0] || {}) as { http_4xx?: number; http_5xx?: number; timeouts?: number };
  const httpErr = num(hf.http_4xx) + num(hf.http_5xx);
  const hfTimeouts = num(hf.timeouts);
  if (httpErr >= 1 || hfTimeouts >= 3) {
    const parts: string[] = [];
    if (num(hf.http_5xx)) parts.push(`${hf.http_5xx} HTTP 5xx`);
    if (num(hf.http_4xx)) parts.push(`${hf.http_4xx} HTTP 4xx`);
    if (hfTimeouts) parts.push(`${hfTimeouts} timeout`);
    issues.push({ level: "bad", label: "edge-function calls failing (cron->fn)", detail: `${parts.join(", ")} in 60m` });
  }
  const lastAlertAt = (alertState as any[])[0]?.sent_at || null;
  return { ok: issues.length === 0, issues, lastAlertAt };
}

// Windowed by ?hours= (the console's 24h / 7d toggle). Capped at 168h because
// api_hits retains 7 days — never serve a range the data can't honestly fill.
// Series/top-fns come from parameterized RPCs (the fixed 24h views stay for the
// owner card). Latency RPC is already windowed; cron + recent5xx are not windowed
// (cron health and the latest-errors feed are independent of the analytics range).
async function health(q: Record<string, string | undefined> = {}) {
  const hours = Math.min(168, Math.max(1, parseInt(String(q.hours ?? "24"), 10) || 24));
  const sinceISO = new Date(Date.now() - hours * 3600000).toISOString();
  const prevStartISO = new Date(Date.now() - 2 * hours * 3600000).toISOString();
  const [series, topFnsRaw, recent5xx, rateLimitHits, cron, prevCalls, latency] = await Promise.all([
    svcRpc("va_admin_api_series", { p_hours: hours }),
    svcRpc("va_admin_api_top_fns", { p_hours: hours }),
    svcGet("api_hits?select=fn,status,path,at&status=gte.500&order=at.desc&limit=15"),
    svcCount(`api_hits?select=id&fn=is.null&at=gte.${sinceISO}`),
    svcRpc("va_admin_cron_health").catch(() => []),
    // prior equal-length window [2w, w) for the trend delta (>7d falls past retention -> 0)
    svcCount(`api_hits?select=id&fn=not.is.null&at=gte.${prevStartISO}&at=lt.${sinceISO}`),
    svcRpc("va_admin_api_latency", { p_hours: hours }).catch(() => [] as any[]),
  ]);
  const calls = series.reduce((n, r) => n + num(r.calls), 0);
  const errors = series.reduce((n, r) => n + num(r.err_4xx) + num(r.err_5xx), 0);
  // avg/p95/p99 all come from the latency RPC (true aggregates over raw ms in the
  // window) — not an unweighted mean of per-bucket averages.
  const lat = (latency as any[])[0] || {};
  const topFns = topFnsRaw.map((r) => ({ fn: r.fn, calls: num(r.calls), avg_ms: num(r.avg_ms) }))
    .sort((a, b) => b.calls - a.calls);
  const slowest = [...topFns].sort((a, b) => b.avg_ms - a.avg_ms).slice(0, 5);
  return {
    hours,
    totals: { calls, avg_ms: num(lat.avg_ms), errors, p95_ms: num(lat.p95_ms), p99_ms: num(lat.p99_ms) },
    prevCalls,
    series: series.map((r) => ({ calls: num(r.calls), err_4xx: num(r.err_4xx), err_5xx: num(r.err_5xx) })),
    topFns: topFns.slice(0, 8), slowest,
    rateLimitHits, recent5xx, cron,
  };
}

// Fully server-side: search (name/slug/city) + plan/status filter + sort (incl.
// computed revenue_today) + pagination, all in va_admin_tenants so the result is
// correct past one page rather than only over the loaded set. ?offset,q,plan,
// status,sort,dir. The exact match total rides on each row; facets (distinct
// plan/status across the whole fleet) drive the filter dropdowns.
const TENANTS_PAGE = 50;
async function tenants(q: Record<string, string | undefined> = {}) {
  const offset = Math.max(0, parseInt(String(q.offset ?? "0"), 10) || 0);
  // default page size; a larger limit (capped server-side at 5000) backs CSV-all
  const limit = Math.min(5000, Math.max(1, parseInt(String(q.limit ?? TENANTS_PAGE), 10) || TENANTS_PAGE));
  const [rows, facets] = await Promise.all([
    svcRpc("va_admin_tenants", {
      p_offset: offset, p_limit: limit,
      p_q: q.q || null, p_plan: q.plan || null, p_status: q.status || null,
      p_sort: q.sort || "created_at", p_dir: q.dir === "asc" ? "asc" : "desc",
    }),
    svcRpc("va_admin_tenant_facets").catch(() => [] as any[]),
  ]);
  const total = rows.length ? num(rows[0].total) : 0;
  const nextOffset = offset + rows.length < total ? offset + rows.length : null;
  const f = (facets as any[])[0] || {};
  return {
    rows: rows.map((r) => ({
      slug: r.slug, name: r.name, city: r.city, plan: r.plan, plan_status: r.plan_status,
      created_at: r.created_at, revenueToday: num(r.revenue_today),
    })),
    total, nextOffset,
    plans: Array.isArray(f.plans) ? f.plans : [],
    statuses: Array.isArray(f.statuses) ? f.statuses : [],
  };
}

async function payments() {
  const [rows, prices, hotels] = await Promise.all([
    svcGet(`payments?select=amount,status,method,created_at&created_at=gte.${daysAgoISO(30)}`),
    svcGet("plan_prices?select=plan,monthly_inr"),
    svcGet("hotels?select=plan,plan_status,plan_renews_at"),
  ]);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const sumWhere = (pred: (r: any) => boolean) =>
    round2(rows.filter(pred).reduce((n, r) => n + num(r.amount), 0));
  const completed = (r: any) => String(r.status).toUpperCase() === "COMPLETED";
  const c24 = daysAgoISO(1), c7 = daysAgoISO(7), c14 = daysAgoISO(14);
  const byStatus: Record<string, { count: number; sum: number }> = {};
  const byMethod: Record<string, { count: number; sum: number }> = {};
  for (const r of rows) {
    const s = String(r.status || "UNKNOWN").toUpperCase();
    const m = String(r.method || "UNKNOWN").toUpperCase();
    (byStatus[s] ||= { count: 0, sum: 0 }); byStatus[s].count++; byStatus[s].sum += num(r.amount);
    (byMethod[m] ||= { count: 0, sum: 0 }); byMethod[m].count++; byMethod[m].sum += num(r.amount);
  }
  for (const k in byStatus) byStatus[k].sum = round2(byStatus[k].sum);
  for (const k in byMethod) byMethod[k].sum = round2(byMethod[k].sum);

  // ── MRR from editable plan_prices × active subscriptions ──────────────────
  const priceOf: Record<string, number> = {};
  for (const p of prices) priceOf[p.plan] = num(p.monthly_inr);
  const nowISO = new Date().toISOString();
  const in30ISO = new Date(Date.now() + 30 * 86400000).toISOString();
  let mrr = 0, mrrAtRisk = 0, renewals30dValue = 0;
  for (const h of hotels) {
    const pr = priceOf[h.plan] || 0;
    if (h.plan_status === "active") mrr += pr;
    else if (h.plan_status === "past_due") mrrAtRisk += pr;
    const rn = h.plan_renews_at;
    if (rn && String(rn) >= nowISO && String(rn) <= in30ISO) renewals30dValue += pr;
  }

  return {
    gmv24h: sumWhere((r) => completed(r) && String(r.created_at) >= c24),
    gmv7d: sumWhere((r) => completed(r) && String(r.created_at) >= c7),
    gmv7dPrev: sumWhere((r) => completed(r) && String(r.created_at) >= c14 && String(r.created_at) < c7),
    gmv30d: sumWhere(completed),
    txns30d: rows.length,
    byStatus, byMethod,
    mrr: round2(mrr), mrrAtRisk: round2(mrrAtRisk), renewals30dValue: round2(renewals30dValue),
    pricesSet: Object.values(priceOf).some((v) => v > 0),
  };
}

async function onboarding() {
  const apps = await svcGet("owner_applications?select=status,created_at");
  const recent = await svcGet(
    "owner_applications?select=hotel_name,city,contact_name,status,created_at&order=created_at.desc&limit=10",
  );
  const activated30d = await svcCount(`hotels?select=id&created_at=gte.${daysAgoISO(30)}`);
  return { total: apps.length, byStatus: tally(apps, "status"), recent, activated30d };
}

// Turn the audit row's meta jsonb (+ entity) into a human one-liner.
function summarizeMeta(meta: any, entity: string, entityId: string): string {
  const m = meta && typeof meta === "object" ? meta : {};
  const bits: string[] = [];
  if (m.document_type) bits.push(String(m.document_type).toUpperCase());
  if (m.context) bits.push(String(m.context).replace(/_/g, " "));
  if (m.band) bits.push(String(m.band));
  if (m.total_score != null) bits.push(`score ${m.total_score}`);
  if (m.trigger) bits.push(String(m.trigger).toLowerCase());
  if (m.status) bits.push(String(m.status));
  if (bits.length) return bits.join(" · ");
  return entity ? `${entity}${entityId ? ` ${String(entityId).slice(0, 8)}` : ""}` : "";
}

// Recent platform actions, enriched (actor + hotel resolved, meta summarized) with
// an action filter + id-cursor pagination. Query: ?action=&before=<id>&limit=.
async function audit(q: Record<string, string | undefined> = {}) {
  const action = (q.action || "").trim();
  const beforeId = q.before ? parseInt(q.before, 10) : null;
  const limit = Math.min(100, Math.max(10, parseInt(q.limit || "50", 10) || 50));

  let path = `va_audit_logs?select=id,at,action,actor,hotel_id,entity,entity_id,meta&order=id.desc&limit=${limit + 1}`;
  if (action) path += `&action=eq.${encodeURIComponent(action)}`;
  if (beforeId) path += `&id=lt.${beforeId}`;
  const raw = await svcGet(path);
  const hasMore = raw.length > limit;
  const page = raw.slice(0, limit);

  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s);
  const hotelIds = [...new Set(page.map((r) => r.hotel_id).filter(Boolean))];
  const actorIds = [...new Set(page.map((r) => r.actor).filter((a) => a && a !== "system" && isUuid(a)))];

  const hotelMap: Record<string, string> = {};
  if (hotelIds.length) {
    const hs = await svcGet(`hotels?select=id,name&id=in.(${hotelIds.join(",")})`).catch(() => []);
    for (const h of hs) hotelMap[h.id] = h.name;
  }
  const actorMap: Record<string, { name?: string; email?: string }> = {};
  if (actorIds.length) {
    const ps = await svcGet(`profiles?select=id,full_name,email&id=in.(${actorIds.join(",")})`).catch(() => []);
    for (const p of ps) actorMap[p.id] = { name: p.full_name, email: p.email };
  }

  const rows = page.map((r) => {
    const sys = r.actor === "system";
    const prof = !sys ? actorMap[r.actor] : undefined;
    return {
      at: r.at,
      action: r.action,
      actor: sys ? "system" : (prof?.name || prof?.email || (r.actor ? String(r.actor).slice(0, 8) : "—")),
      actorEmail: prof?.email,
      system: sys,
      hotel: r.hotel_id ? (hotelMap[r.hotel_id] || `${String(r.hotel_id).slice(0, 8)}…`) : null,
      entity: r.entity,
      detail: summarizeMeta(r.meta, r.entity, r.entity_id),
    };
  });

  // Distinct actions for the filter dropdown (table is small).
  const allActions = await svcGet("va_audit_logs?select=action&limit=2000").catch(() => []);
  const actions = [...new Set(allActions.map((a) => a.action).filter(Boolean))].sort();

  return { rows, actions, nextBefore: hasMore ? page[page.length - 1].id : null };
}

const PANELS: Record<string, (q: Record<string, string | undefined>) => Promise<unknown>> = {
  summary, fleet, health, tenants, payments, onboarding, audit,
};

export const handler: Handler = async (event) => {
  try {
    if (!ENV.url || !ENV.service) {
      return { statusCode: 500, body: "admin-metrics: missing SUPABASE_URL / SERVICE_ROLE_KEY" };
    }
    const authz = (event.headers?.authorization || event.headers?.Authorization || "") as string;
    const token = authz.replace(/^Bearer\s+/i, "").trim();
    if (!token) return { statusCode: 401, body: "unauthorized" };

    const ctx = await getPlatformAdmin(ENV, token);
    if (!ctx) return { statusCode: 403, body: "forbidden" };

    const panel = (event.path || "").split("/").pop() || "";
    if (panel === "me") {
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ role: ctx.role }) };
    }
    if (!(panel in PANELS)) return { statusCode: 404, body: "not found" };
    if (!canSeePanel(ctx.role, panel)) return { statusCode: 403, body: "forbidden" };

    const data = await PANELS[panel](event.queryStringParameters || {});
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "error" };
  }
};
