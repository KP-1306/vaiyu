// supabase/functions/admin-alerts/index.ts
//
// Proactive platform-ops alerting for the Operator Console. Turns the same signals
// the console shows (cron failures, 24h 5xx, past-due hotels, failed payments) from
// PULL into PUSH: emails platform admins when something needs attention.
//
// Invoked ONLY by pg_cron (via public.va_admin_invoke_alerts) — never the browser.
// Two modes:
//   • watch  (every 5 min): emails only when the issue set CHANGES (dedup via
//             platform_alert_state) — new problems and recoveries, never repeat spam.
//   • digest (daily 09:00 IST): always emails a status summary (issues or all-clear).
//
// Email via Resend (same as send-notifications). If RESEND_API_KEY is absent the
// function DRY-RUNS (computes + returns, sends nothing) so it is safe to run locally.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretKey, isServiceToken } from "../_shared/keys.ts";
import { Resend } from "npm:resend";
import { withObs } from "../_shared/http-telemetry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = secretKey();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = '"VAiyu Ops" <noreply@vaiyu.co.in>';
// Comma-separated override; otherwise active platform_admins' emails are used.
const ENV_RECIPIENTS = (Deno.env.get("ADMIN_ALERT_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const FALLBACK_RECIPIENT = "ajitkumarpes@gmail.com";

type Issue = { level: "warn" | "bad"; label: string; detail?: string };

const svc = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sinceISO = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function countRows(table: string, build: (q: any) => any): Promise<number> {
  const { count } = await build(svc().from(table).select("id", { count: "exact", head: true }));
  return count ?? 0;
}

async function computeIssues(): Promise<Issue[]> {
  const issues: Issue[] = [];

  // cron failures — broken RIGHT NOW (last run failed, or overdue), not "failed
  // once in 24h", so a recovered blip stops re-emailing. overdue is computed in
  // va_admin_cron_health (single source of truth, shared with the console banner).
  try {
    const { data } = await svc().rpc("va_admin_cron_health");
    const failing = (data ?? []).filter((c: any) => c.last_status === "failed" || c.overdue);
    if (failing.length) issues.push({ level: "bad", label: `${failing.length} cron job(s) failing`, detail: failing.map((c: any) => c.jobname).join(", ") });
  } catch { /* ignore */ }

  // 5xx in last 24h
  try {
    const err5xx = await countRows("api_hits", (q) => q.gte("status", 500).gte("at", sinceISO(24)));
    if (err5xx > 0) issues.push({ level: err5xx >= 10 ? "bad" : "warn", label: `${err5xx} server error(s) (5xx) in 24h` });
  } catch { /* ignore */ }

  // hotels past due
  try {
    const pastDue = await countRows("hotels", (q) => q.eq("plan_status", "past_due"));
    if (pastDue > 0) issues.push({ level: "warn", label: `${pastDue} hotel(s) past due` });
  } catch { /* ignore */ }

  // failed payments (24h)
  try {
    const failedPay = await countRows("payments", (q) => q.eq("status", "FAILED").gte("created_at", sinceISO(24)));
    if (failedPay > 0) issues.push({ level: "warn", label: `${failedPay} failed payment(s) in 24h` });
  } catch { /* ignore */ }

  // edge-function call failures (cron->fn) via pg_net — a cron can report
  // "succeeded" (it merely enqueues the post) while the HTTP call errors/times out,
  // so cron health alone misses these. 60m window so a low-frequency cron (e.g.
  // */30) still registers; ANY 4xx/5xx is a real worker error, but timeouts need
  // >=3 to ignore transient cold starts.
  try {
    const { data } = await svc().rpc("va_admin_http_failures", { p_minutes: 60 });
    const r = (Array.isArray(data) ? data[0] : data) as { http_4xx?: number; http_5xx?: number; timeouts?: number } | null;
    const httpErr = Number(r?.http_4xx ?? 0) + Number(r?.http_5xx ?? 0);
    const timeouts = Number(r?.timeouts ?? 0);
    if (httpErr >= 1 || timeouts >= 3) {
      const parts: string[] = [];
      if (Number(r?.http_5xx)) parts.push(`${r!.http_5xx} HTTP 5xx`);
      if (Number(r?.http_4xx)) parts.push(`${r!.http_4xx} HTTP 4xx`);
      if (timeouts) parts.push(`${timeouts} timeout`);
      issues.push({ level: "bad", label: "edge-function calls failing (cron->fn)", detail: `${parts.join(", ")} in 60m` });
    }
  } catch { /* ignore */ }

  return issues;
}

async function recipients(): Promise<string[]> {
  if (ENV_RECIPIENTS.length) return ENV_RECIPIENTS;
  try {
    const { data: admins } = await svc().from("platform_admins").select("user_id").eq("is_active", true);
    const ids = (admins ?? []).map((a: any) => a.user_id);
    const out: string[] = [];
    for (const id of ids) {
      const { data } = await svc().auth.admin.getUserById(id);
      const email = data?.user?.email;
      if (email) out.push(email);
    }
    const uniq = [...new Set(out)];
    return uniq.length ? uniq : [FALLBACK_RECIPIENT];
  } catch {
    return [FALLBACK_RECIPIENT];
  }
}

function fingerprint(issues: Issue[]): string {
  return issues.map((i) => `${i.level}:${i.label}`).sort().join("|");
}

function renderHtml(title: string, issues: Issue[]): string {
  const rows = issues.length
    ? issues.map((i) => `<tr><td style="padding:4px 8px">${i.level === "bad" ? "🔴" : "🟠"}</td><td style="padding:4px 8px">${i.label}${i.detail ? ` — <span style="color:#666">${i.detail}</span>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="2" style="padding:8px;color:#0a0">✅ All systems normal.</td></tr>`;
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
    <h2 style="margin:0 0 4px">${title}</h2>
    <p style="color:#666;margin:0 0 12px;font-size:13px">VAiyu Operator Console · platform-wide</p>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <p style="margin-top:16px"><a href="https://vaiyu.co.in/admin/platform">Open the Operator Console →</a></p>
  </div>`;
}

async function sendEmail(to: string[], subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false; // dry-run (e.g. local)
  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`resend: ${error.message ?? error}`);
  return true;
}

async function readState(kind: string): Promise<string | null> {
  const { data } = await svc().from("platform_alert_state").select("fingerprint").eq("kind", kind).maybeSingle();
  return data?.fingerprint ?? null;
}
async function writeState(kind: string, fp: string): Promise<void> {
  await svc().from("platform_alert_state").upsert({ kind, fingerprint: fp, sent_at: new Date().toISOString() }, { onConflict: "kind" });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");
  // AuthZ: cron/service-role only.
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  if (!isServiceToken(token)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  let mode = "watch";
  try {
    const url = new URL(req.url);
    mode = (url.searchParams.get("mode") || (await req.json().catch(() => ({})))?.mode || "watch").toString();
  } catch { /* default watch */ }

  const issues = await computeIssues();
  const fp = fingerprint(issues);
  const to = await recipients();
  let sent = false, action = "noop";

  if (mode === "digest") {
    const subject = issues.length ? `VAiyu daily ops — ${issues.length} issue(s)` : "VAiyu daily ops — all clear ✅";
    sent = await sendEmail(to, subject, renderHtml("Daily operations digest", issues));
    await writeState("watch", fp); // align watch baseline so the digest doesn't double-fire watch
    action = "digest";
  } else {
    // watch: only act when the issue set changes
    const prev = await readState("watch");
    if (fp !== prev) {
      if (issues.length) {
        sent = await sendEmail(to, `⚠️ VAiyu ops — ${issues.length} issue(s) need attention`, renderHtml("Issues detected", issues));
        action = "alert";
      } else {
        sent = await sendEmail(to, "✅ VAiyu ops — recovered, all systems normal", renderHtml("Recovered", []));
        action = "recovered";
      }
      await writeState("watch", fp);
    }
  }

  return new Response(
    JSON.stringify({ mode, action, issues, recipients: to, sent, dryRun: !RESEND_API_KEY }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

Deno.serve(withObs("admin-alerts", handler));
