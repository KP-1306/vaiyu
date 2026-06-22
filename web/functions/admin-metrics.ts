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
function istDayStartISO(): string {
  const IST = 5.5 * 3600 * 1000;
  const ist = new Date(Date.now() + IST);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST).toISOString();
}
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
  const [cron, err5xx, pastDue, failedPay, httpFail] = await Promise.all([
    svcRpc("va_admin_cron_health").catch(() => [] as any[]),
    svcCount(`api_hits?select=id&status=gte.500&at=gte.${since24}`),
    svcCount(`hotels?select=id&plan_status=eq.past_due`),
    svcCount(`payments?select=id&status=eq.FAILED&created_at=gte.${since24}`).catch(() => 0),
    svcRpc("va_admin_http_failures", { p_minutes: 60 }).catch(() => [] as any[]),
  ]);
  const cronFails = (cron as any[]).filter((c) => num(c.fails_24h) > 0);
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
  return { ok: issues.length === 0, issues };
}

async function health() {
  const [series, topFnsRaw, recent5xx, rateLimitHits24h, cron, prevCalls] = await Promise.all([
    svcGet("v_api_24h?select=*&order=hour_bucket.asc"),
    svcGet("v_api_top_fns_24h?select=*"),
    svcGet("api_hits?select=fn,status,path,at&status=gte.500&order=at.desc&limit=15"),
    svcCount(`api_hits?select=id&fn=is.null&at=gte.${daysAgoISO(1)}`),
    svcRpc("va_admin_cron_health").catch(() => []),
    // prior 24h call volume [48h,24h) for the trend delta (api_hits keeps 7d)
    svcCount(`api_hits?select=id&fn=not.is.null&at=gte.${daysAgoISO(2)}&at=lt.${daysAgoISO(1)}`),
  ]);
  const calls = series.reduce((n, r) => n + num(r.calls), 0);
  const avg = series.length ? Math.round(series.reduce((n, r) => n + num(r.avg_ms), 0) / series.length) : 0;
  const errors = series.reduce((n, r) => n + num(r.err_4xx) + num(r.err_5xx), 0);
  const topFns = topFnsRaw.map((r) => ({ fn: r.fn, calls: num(r.calls), avg_ms: num(r.avg_ms) }))
    .sort((a, b) => b.calls - a.calls);
  const slowest = [...topFns].sort((a, b) => b.avg_ms - a.avg_ms).slice(0, 5);
  return {
    totals: { calls, avg_ms: avg, errors },
    prevCalls,
    series, topFns: topFns.slice(0, 8), slowest,
    rateLimitHits24h, recent5xx, cron,
  };
}

async function tenants() {
  const rows = await svcGet(
    "hotels?select=id,slug,name,city,plan,plan_status,created_at,updated_at&order=created_at.desc&limit=100",
  );
  const pays = await svcGet(
    `payments?select=hotel_id,amount&status=eq.COMPLETED&created_at=gte.${istDayStartISO()}`,
  );
  const revByHotel: Record<string, number> = {};
  for (const p of pays) revByHotel[p.hotel_id] = (revByHotel[p.hotel_id] || 0) + num(p.amount);
  return {
    rows: rows.map((h) => ({
      slug: h.slug, name: h.name, city: h.city, plan: h.plan, plan_status: h.plan_status,
      created_at: h.created_at, revenueToday: Math.round((revByHotel[h.id] || 0) * 100) / 100,
    })),
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

async function audit() {
  const rows = await svcGet(
    "va_audit_logs?select=at,action,actor,hotel_id,entity,entity_id&order=at.desc&limit=50",
  );
  return { rows };
}

const PANELS: Record<string, () => Promise<unknown>> = {
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

    const data = await PANELS[panel]();
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  } catch (e: any) {
    return { statusCode: 500, body: e?.message || "error" };
  }
};
