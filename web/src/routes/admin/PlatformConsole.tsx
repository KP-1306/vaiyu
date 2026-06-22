// web/src/routes/admin/PlatformConsole.tsx
//
// VAiyu Operator Console — the platform-admin (cross-tenant) cockpit. All data is
// served by the service-role /api/admin/* endpoint, which re-checks platform_admins
// and enforces per-panel role tiers; this component only mirrors those tiers to
// decide which panels to render (so a support_admin never fires a 403'd request).
//
// Route is gated by PlatformAdminGate (is_platform_admin). Theme matches the owner
// dashboard (dark). Live: 60s auto-refresh + manual refresh; status rollup + trend
// deltas + tenant search/sort/filter/CSV.
import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Building2, CheckCircle2, CreditCard, Download, RefreshCw, ShieldCheck, Server, UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabase";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat("en-IN");
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// ── data layer (auth + auto-refresh) ───────────────────────────────────────
const RefreshCtx = createContext(0);

async function adminFetch<T>(panel: string, query = ""): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  const r = await fetch(`/api/admin/${panel}${query ? `?${query}` : ""}`, { headers });
  if (!r.ok) throw new Error(`${panel}: ${r.status}`);
  return r.json() as Promise<T>;
}

function useAdminData<T>(panel: string, enabled = true, query = "") {
  const tick = useContext(RefreshCtx);
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading((d) => d || data === null); setErr(null);
    adminFetch<T>(panel, query)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, enabled, query, tick]);
  return { data, err, loading };
}

// ── role tiers (mirror of _adminAuth.canSeePanel) ──────────────────────────
const canSee = (role: string, panel: string) =>
  role === "super_admin" ||
  ["fleet", "health", "tenants"].includes(panel) ||
  (panel === "payments" && role === "finance_admin") ||
  (panel === "onboarding" && role === "support_admin");

// ── presentational atoms ───────────────────────────────────────────────────
function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/10 bg-white/[0.02] p-5 ${className}`}>{children}</div>;
}
function Section({ id, icon, title, subtitle, right, children }: { id?: string; icon: ReactNode; title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-24 rounded-2xl transition-shadow duration-500">
      <header className="mb-3 flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{title}</h2>
        {subtitle && <span className="text-[10px] text-slate-500">· {subtitle}</span>}
        {right && <div className="ml-auto">{right}</div>}
      </header>
      {children}
    </section>
  );
}

// Segmented range toggle (used by the System Health panel). Options are capped at
// the api_hits 7-day retention — we never offer a window the telemetry can't fill.
function RangeToggle({ value, onChange, options }: { value: number; onChange: (v: number) => void; options: { label: string; hours: number }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
      {options.map((o) => (
        <button
          key={o.hours}
          onClick={() => onChange(o.hours)}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
            value === o.hours ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Scroll to a panel by id + briefly ring-highlight it (used by the status banner).
function focusPanel(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("ring-2", "ring-sky-400/50", "shadow-[0_0_0_4px_rgba(56,189,248,0.08)]");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-sky-400/50", "shadow-[0_0_0_4px_rgba(56,189,248,0.08)]"), 1800);
}

// Map a status-banner issue label to the panel that explains it.
function panelForIssue(label: string): string | null {
  const l = label.toLowerCase();
  if (/cron|5xx|server error|edge-function|timeout/.test(l)) return "panel-health";
  if (/payment|past due|mrr|gmv/.test(l)) return "panel-payments";
  if (/onboard|application/.test(l)) return "panel-onboarding";
  return null;
}

// Isolate a panel render failure so one bad panel can't white-screen the console.
class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error(`[PlatformConsole] ${this.props.name} panel crashed`, err); }
  render() {
    if (this.state.failed) {
      return <div className="mt-8"><Card><Empty text={`${this.props.name} panel failed to render — the rest of the console is unaffected.`} /></Card></div>;
    }
    return this.props.children;
  }
}
function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="text-xl font-semibold text-white tabular-nums">{value}</div>
      {sub != null && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}
function Delta({ cur, prev, suffix = "" }: { cur: number; prev: number; suffix?: string }) {
  if (!prev || prev <= 0) return <span className="text-white/30">no prior data</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return <span className={up ? "text-emerald-300/90" : "text-red-300/90"}>{up ? "▲" : "▼"} {Math.abs(pct)}%{suffix} vs prev</span>;
}
function Pill({ label, n, tone = "default" }: { label: string; n: number; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones: Record<string, string> = {
    default: "border-white/10 bg-white/[0.03] text-white/80",
    good: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    bad: "border-red-500/20 bg-red-500/10 text-red-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${tones[tone]}`}>
      {label}<span className="tabular-nums font-semibold">{n0.format(n)}</span>
    </span>
  );
}
function Skeleton() {
  return <div className="space-y-2"><div className="h-4 rounded bg-white/[0.06] animate-pulse" /><div className="h-4 rounded bg-white/[0.06] animate-pulse w-2/3" /></div>;
}
function Empty({ text = "No data yet." }: { text?: string }) { return <div className="text-sm text-white/40">{text}</div>; }

function Sparkline({ series }: { series: Array<{ calls: number; err_5xx: number; err_4xx: number }> }) {
  // The series is gap-filled (every bucket present), so "empty" = every bucket zero.
  if (!series.length || series.every((s) => !s.calls)) return <Empty text="No traffic in this window." />;
  const w = 520, h = 56, max = Math.max(1, ...series.map((s) => s.calls));
  const bw = w / series.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      {series.map((s, i) => {
        const bh = Math.max(1, (s.calls / max) * (h - 6));
        const err = (s.err_5xx || 0) + (s.err_4xx || 0) > 0;
        return <rect key={i} x={i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} className={err ? "fill-red-400/70" : "fill-sky-400/50"} rx="1" />;
      })}
    </svg>
  );
}

function csvExport(filename: string, rows: Record<string, any>[], cols: { key: string; label: string }[]) {
  const esc = (v: any) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// ── status rollup banner ────────────────────────────────────────────────────
type Summary = { ok: boolean; issues: { level: "warn" | "bad"; label: string; detail?: string }[]; lastAlertAt?: string | null };
function AlertStamp({ at }: { at?: string | null }) {
  if (!at) return null;
  return <div className="mt-2 text-[11px] text-white/30">Last alert email: {fmtDate(at)}</div>;
}
function StatusBanner() {
  const { data, loading } = useAdminData<Summary>("summary");
  if (loading && !data) return null;
  if (!data) return null;
  if (data.ok) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> All systems normal — no issues detected.
        </div>
        <AlertStamp at={data.lastAlertAt} />
      </div>
    );
  }
  const hasBad = data.issues.some((i) => i.level === "bad");
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 ${hasBad ? "border-red-500/25 bg-red-500/10" : "border-amber-500/25 bg-amber-500/10"}`}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${hasBad ? "text-red-300" : "text-amber-300"}`}>
        <AlertTriangle className="h-4 w-4" /> {data.issues.length} thing{data.issues.length === 1 ? "" : "s"} need attention
      </div>
      <ul className="mt-2 space-y-1">
        {data.issues.map((i, idx) => {
          const target = panelForIssue(i.label);
          const body = <><span>{i.label}{i.detail ? <span className="text-white/40"> — {i.detail}</span> : null}</span>{target && <span className="text-white/30 group-hover:text-sky-300/70">→</span>}</>;
          return (
            <li key={idx} className="flex items-start gap-2 text-sm text-white/80">
              <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${i.level === "bad" ? "bg-red-400" : "bg-amber-400"}`} />
              {target
                ? <button onClick={() => focusPanel(target)} className="group flex items-center gap-1.5 text-left hover:text-white" title="Jump to the panel that explains this">{body}</button>
                : <span className="flex items-center gap-1.5">{body}</span>}
            </li>
          );
        })}
      </ul>
      <AlertStamp at={data.lastAlertAt} />
    </div>
  );
}

// ── panels ─────────────────────────────────────────────────────────────────
type Fleet = { total: number; byStatus: Record<string, number>; byPlan: Record<string, number>; new7d: number; new30d: number; new30dPrev: number; topCities: { city: string; n: number }[] };
function FleetPanel() {
  const { data, loading, err } = useAdminData<Fleet>("fleet");
  return (
    <Section icon={<Building2 className="h-3.5 w-3.5" />} title="Fleet" subtitle="all hotels">
      {loading && !data ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Total hotels" value={n0.format(data.total)} />
            <Stat label="Active" value={n0.format(data.byStatus.active || 0)} />
            <Stat label="Trial" value={n0.format(data.byStatus.trial || 0)} />
            <Stat label="Past due / canceled" value={n0.format((data.byStatus.past_due || 0) + (data.byStatus.canceled || 0))} />
            <Stat label="New (30d)" value={n0.format(data.new30d)} sub={<Delta cur={data.new30d} prev={data.new30dPrev} />} />
          </div>
          <Card className="mt-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.byPlan).sort((a, b) => b[1] - a[1]).map(([p, c]) => <Pill key={p} label={p} n={c} />)}
            </div>
            {data.topCities.length > 0 && (
              <div className="mt-3 text-[11px] text-white/40">Top cities: {data.topCities.map((c) => `${c.city || "—"} (${c.n})`).join(" · ")}</div>
            )}
          </Card>
        </>
      )}
    </Section>
  );
}

type Health = {
  hours: number;
  totals: { calls: number; avg_ms: number; errors: number; p95_ms: number; p99_ms: number }; prevCalls: number;
  series: Array<{ calls: number; err_4xx: number; err_5xx: number }>;
  topFns: { fn: string; calls: number; avg_ms: number }[]; slowest: { fn: string; calls: number; avg_ms: number }[];
  rateLimitHits: number; recent5xx: { fn: string; status: number; path: string; at: string }[];
  cron: { jobname: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; runs_24h: number; fails_24h: number }[];
};
const HEALTH_RANGES = [{ label: "24h", hours: 24 }, { label: "7d", hours: 168 }];
function HealthPanel() {
  const [hours, setHours] = useState(24);
  const { data, loading, err } = useAdminData<Health>("health", true, `hours=${hours}`);
  const win = hours >= 168 ? "7d" : `${hours}h`;
  const bucket = hours <= 48 ? "hour" : "6h";
  return (
    <Section id="panel-health" icon={<Activity className="h-3.5 w-3.5" />} title="System Health" subtitle={`VAiyu-wide · ${win}`}
      right={<RangeToggle value={hours} onChange={setHours} options={HEALTH_RANGES} />}>
      {loading && !data ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <div className="grid grid-cols-4 gap-3">
              <Stat label={`Calls (${win})`} value={n0.format(data.totals.calls)} sub={<Delta cur={data.totals.calls} prev={data.prevCalls} />} />
              {(() => {
                const rate = data.totals.calls ? (data.totals.errors / data.totals.calls) * 100 : 0;
                const tone = rate >= 1 ? "text-red-300" : rate >= 0.1 ? "text-amber-300" : "text-white";
                return <Stat label={`Error rate (${win})`} value={<span className={tone}>{rate.toFixed(2)}%</span>} sub={`${n0.format(data.totals.errors)} of ${n0.format(data.totals.calls)}`} />;
              })()}
              <Stat label="p95 latency" value={`${n0.format(data.totals.p95_ms)} ms`} sub={`avg ${data.totals.avg_ms} · p99 ${n0.format(data.totals.p99_ms)} ms`} />
              <Stat label={`Rate-limit hits (${win})`} value={n0.format(data.rateLimitHits)} />
            </div>
            <div className="mt-4"><div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Calls / {bucket} (red = had errors)</div><Sparkline series={data.series} /></div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Top functions</div>
                <ul className="text-sm space-y-1">{data.topFns.length ? data.topFns.map((f) => (<li key={f.fn} className="flex justify-between text-white/80"><span className="truncate">{f.fn}</span><span className="shrink-0 tabular-nums text-white/60">{f.calls} · {f.avg_ms}ms</span></li>)) : <Empty />}</ul>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Slowest</div>
                <ul className="text-sm space-y-1">{data.slowest.length ? data.slowest.map((f) => (<li key={f.fn} className="flex justify-between text-white/80"><span className="truncate">{f.fn}</span><span className="shrink-0 tabular-nums text-amber-300/80">{f.avg_ms}ms</span></li>)) : <Empty />}</ul>
              </div>
            </div>
          </Card>
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">Cron jobs</div>
            <ul className="text-sm space-y-1.5">{data.cron.length ? data.cron.map((c) => (
              <li key={c.jobname} className="flex items-center justify-between gap-2">
                <span className="truncate text-white/80" title={c.schedule}>{c.jobname}</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${c.fails_24h > 0 ? "text-red-300" : c.last_status === "succeeded" ? "text-emerald-300/80" : "text-white/40"}`}>{c.fails_24h > 0 ? `${c.fails_24h} fail` : c.last_status || "—"}</span>
              </li>)) : <Empty />}</ul>
            <div className="text-[11px] uppercase tracking-wider text-white/50 mt-4 mb-2">Recent 5xx</div>
            <ul className="text-xs space-y-1">{data.recent5xx.length ? data.recent5xx.slice(0, 6).map((e, i) => (<li key={i} className="flex justify-between gap-2 text-white/70"><span className="truncate">{e.fn || e.path}</span><span className="shrink-0 text-red-300 tabular-nums">{e.status}</span></li>)) : <Empty text="No 5xx in 24h ✓" />}</ul>
          </Card>
        </div>
      )}
    </Section>
  );
}

type Payments = { gmv24h: number; gmv7d: number; gmv7dPrev: number; gmv30d: number; txns30d: number; byStatus: Record<string, { count: number; sum: number }>; byMethod: Record<string, { count: number; sum: number }>; mrr: number; mrrAtRisk: number; renewals30dValue: number; pricesSet: boolean };
function PaymentsPanel() {
  const { data, loading, err } = useAdminData<Payments>("payments");
  return (
    <Section id="panel-payments" icon={<CreditCard className="h-3.5 w-3.5" />} title="Payments & Revenue" subtitle="cross-tenant · finance">
      {loading && !data ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="GMV (24h)" value={inr0.format(data.gmv24h)} />
            <Stat label="GMV (7d)" value={inr0.format(data.gmv7d)} sub={<Delta cur={data.gmv7d} prev={data.gmv7dPrev} />} />
            <Stat label="GMV (30d)" value={inr0.format(data.gmv30d)} />
            <Stat label="Txns (30d)" value={n0.format(data.txns30d)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <Stat label="MRR (active)" value={data.pricesSet ? inr0.format(data.mrr) : "—"} sub={data.pricesSet ? undefined : "set plan_prices to compute"} />
            <Stat label="MRR at risk (past due)" value={data.pricesSet ? inr0.format(data.mrrAtRisk) : "—"} />
            <Stat label="Renewals (30d)" value={data.pricesSet ? inr0.format(data.renewals30dValue) : "—"} />
          </div>
          <Card className="mt-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">By status</div>
                <div className="flex flex-wrap gap-2">{Object.entries(data.byStatus).map(([s, v]) => <Pill key={s} label={s} n={v.count} tone={s === "COMPLETED" ? "good" : s === "FAILED" ? "bad" : "default"} />)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">By method</div>
                <div className="flex flex-wrap gap-2">{Object.entries(data.byMethod).map(([m, v]) => <Pill key={m} label={m} n={v.count} />)}</div>
              </div>
            </div>
          </Card>
        </>
      )}
    </Section>
  );
}

type Onboarding = { total: number; byStatus: Record<string, number>; recent: { hotel_name: string; city: string; contact_name: string; status: string; created_at: string }[]; activated30d: number };
function OnboardingPanel() {
  const { data, loading, err } = useAdminData<Onboarding>("onboarding");
  return (
    <Section id="panel-onboarding" icon={<UserPlus className="h-3.5 w-3.5" />} title="Onboarding" subtitle="applications → activations · support">
      {loading && !data ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Pill label="pending" n={data.byStatus.pending || 0} tone="warn" />
            <Pill label="approved" n={data.byStatus.approved || 0} tone="good" />
            <Pill label="rejected" n={data.byStatus.rejected || 0} tone="bad" />
            <span className="text-[11px] text-white/40 ml-2">Hotels activated (30d): <b className="text-white/70">{data.activated30d}</b></span>
            <Link to="/admin/owner-applications" className="ml-auto text-[11px] text-sky-300/80 hover:text-sky-200">Open pipeline →</Link>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Recent applications</div>
          <ul className="text-sm divide-y divide-white/[0.06]">{data.recent.length ? data.recent.map((a, i) => (
            <li key={i} className="flex items-center justify-between py-1.5"><span className="text-white/80 truncate">{a.hotel_name || "—"} <span className="text-white/40">· {a.city || "—"}</span></span><span className="shrink-0 text-[11px] text-white/50">{a.status} · {fmtDate(a.created_at)}</span></li>
          )) : <Empty />}</ul>
        </Card>
      )}
    </Section>
  );
}

type TenantRow = { slug: string; name: string; city: string; plan: string; plan_status: string; created_at: string; revenueToday: number };
type Tenants = { rows: TenantRow[]; total: number; nextOffset: number | null; plans: string[]; statuses: string[] };
type TenantSortKey = "name" | "city" | "plan" | "plan_status" | "revenueToday" | "created_at";

function TenantsPanel() {
  const tick = useContext(RefreshCtx);
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [plans, setPlans] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [sortKey, setSortKey] = useState<TenantSortKey>("created_at");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const seq = useRef(0); // drops out-of-order responses (fast typing / rapid filter changes)

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  // All filtering/sorting/paging is server-side; compose the query the same way for
  // page loads, "Load more", and CSV-all.
  const qparams = (extra: Record<string, string | number> = {}) => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (plan) p.set("plan", plan);
    if (status) p.set("status", status);
    p.set("sort", sortKey);
    p.set("dir", sortDir === 1 ? "asc" : "desc");
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  };

  async function load(reset: boolean) {
    const my = ++seq.current;
    try {
      reset ? setLoading(true) : setLoadingMore(true);
      setErr(null);
      const off = reset ? 0 : (nextOffset ?? 0);
      const d = await adminFetch<Tenants>("tenants", qparams({ offset: off }));
      if (my !== seq.current) return; // a newer request superseded this one
      setTotal(d.total);
      setNextOffset(d.nextOffset);
      if (d.plans?.length) setPlans(d.plans);
      if (d.statuses?.length) setStatuses(d.statuses);
      setRows((prev) => (reset ? d.rows : [...prev, ...d.rows]));
    } catch (e) {
      if (my === seq.current) setErr(String((e as Error)?.message || e));
    } finally {
      if (my === seq.current) { setLoading(false); setLoadingMore(false); }
    }
  }
  // Refetch from page 1 on any filter/sort change or auto-refresh; "Load more" appends.
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debouncedQ, plan, status, sortKey, sortDir, tick]);

  // Text columns default to A→Z, numeric/date columns to high→low (most useful first).
  const sortBy = (k: TenantSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "name" || k === "city" || k === "plan" || k === "plan_status" ? 1 : -1); }
  };
  const arrow = (k: TenantSortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");
  const selCls = "rounded-lg border border-white/10 bg-[#151A25] px-2 py-1 text-xs text-white/80";

  async function exportCsv() {
    try {
      setExporting(true);
      const d = await adminFetch<Tenants>("tenants", qparams({ offset: 0, limit: 5000 }));
      csvExport(`vaiyu-tenants-${new Date().toISOString().slice(0, 10)}.csv`, d.rows, [
        { key: "name", label: "Hotel" }, { key: "slug", label: "Slug" }, { key: "city", label: "City" },
        { key: "plan", label: "Plan" }, { key: "plan_status", label: "Status" }, { key: "revenueToday", label: "Revenue today (INR)" }, { key: "created_at", label: "Joined" },
      ]);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section icon={<Server className="h-3.5 w-3.5" />} title="Tenants" subtitle="search · filter · sort — server-side across all hotels">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : (
        <Card className="overflow-x-auto">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / slug / city…" className={`${selCls} w-56`} />
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={selCls}><option value="">All plans</option>{plans.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <span className="text-[11px] text-white/40">{rows.length} of {total}</span>
            <button onClick={exportCsv} disabled={exporting} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70 hover:bg-white/[0.06] disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "CSV"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-white/40 text-left select-none">
                <th className="pb-2 font-medium cursor-pointer" onClick={() => sortBy("name")}>Hotel{arrow("name")}</th>
                <th className="pb-2 font-medium cursor-pointer" onClick={() => sortBy("city")}>City{arrow("city")}</th>
                <th className="pb-2 font-medium cursor-pointer" onClick={() => sortBy("plan")}>Plan{arrow("plan")}</th>
                <th className="pb-2 font-medium cursor-pointer" onClick={() => sortBy("plan_status")}>Status{arrow("plan_status")}</th>
                <th className="pb-2 font-medium text-right cursor-pointer" onClick={() => sortBy("revenueToday")}>Revenue today{arrow("revenueToday")}</th>
                <th className="pb-2 font-medium cursor-pointer" onClick={() => sortBy("created_at")}>Joined{arrow("created_at")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.length ? rows.map((h) => (
                <tr key={h.slug} className="hover:bg-white/[0.03]">
                  <td className="py-1.5"><Link to={`/owner/${h.slug}`} className="text-sky-300/90 hover:text-sky-200">{h.name || h.slug}</Link></td>
                  <td className="py-1.5 text-white/60">{h.city || "—"}</td>
                  <td className="py-1.5 text-white/70">{h.plan}</td>
                  <td className="py-1.5 text-white/70">{h.plan_status}</td>
                  <td className="py-1.5 text-right tabular-nums text-white/80">{h.revenueToday ? inr0.format(h.revenueToday) : "—"}</td>
                  <td className="py-1.5 text-white/50">{fmtDate(h.created_at)}</td>
                </tr>
              )) : <tr><td colSpan={6}><Empty text="No hotels match." /></td></tr>}
            </tbody>
          </table>
          {nextOffset != null && (
            <div className="mt-3">
              <button
                onClick={() => load(false)}
                disabled={loadingMore}
                className="text-xs text-white/60 hover:text-white/90 border border-white/10 rounded px-3 py-1.5 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : `Load more (${total - rows.length} more)`}
              </button>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}

type AuditRow = { at: string; action: string; actor: string; actorEmail?: string; system: boolean; hotel: string | null; entity: string; detail: string };
type Audit = { rows: AuditRow[]; actions: string[]; nextBefore: number | null };
const humanizeAction = (a: string) => a.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function AuditPanel() {
  const tick = useContext(RefreshCtx);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(reset: boolean) {
    try {
      reset ? setLoading(true) : setLoadingMore(true);
      setErr(null);
      const q = new URLSearchParams();
      if (action) q.set("action", action);
      if (!reset && nextBefore) q.set("before", String(nextBefore));
      const d = await adminFetch<Audit>("audit", q.toString());
      if (d.actions?.length) setActions(d.actions);
      setNextBefore(d.nextBefore);
      setRows((prev) => (reset ? d.rows : [...prev, ...d.rows]));
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [action, tick]);

  return (
    <Section icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Audit & Security" subtitle="recent platform actions · super admin">
      <Card className="overflow-x-auto">
        <div className="mb-2 flex items-center gap-2">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-white/30"
          >
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{humanizeAction(a)}</option>)}
          </select>
          {action && <button onClick={() => setAction("")} className="text-xs text-white/40 hover:text-white/70">clear</button>}
        </div>
        {loading ? <Skeleton /> : err ? <Empty text={`Unavailable (${err})`} /> : (
          <>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/30 pb-1 border-b border-white/5">
              <span className="shrink-0 w-28">Time</span>
              <span className="shrink-0 w-40">Action</span>
              <span className="shrink-0 w-36">Actor</span>
              <span className="shrink-0 w-28">Hotel</span>
              <span>Detail</span>
            </div>
            <ul className="text-xs space-y-1 mt-1">{rows.length ? rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-white/70">
                <span className="text-white/40 tabular-nums shrink-0 w-28">{fmtDate(r.at)}</span>
                <span className="text-white/90 shrink-0 w-40 truncate" title={r.action}>{humanizeAction(r.action)}</span>
                <span className={`shrink-0 w-36 truncate ${r.system ? "text-white/30 italic" : "text-sky-300/80"}`} title={r.actorEmail || r.actor}>{r.actor}</span>
                <span className="text-white/40 shrink-0 w-28 truncate" title={r.hotel || ""}>{r.hotel || "—"}</span>
                <span className="text-white/50 truncate" title={r.detail}>{r.detail}</span>
              </li>)) : <Empty />}</ul>
            {nextBefore && (
              <button
                onClick={() => load(false)}
                disabled={loadingMore}
                className="mt-3 text-xs text-white/60 hover:text-white/90 border border-white/10 rounded px-3 py-1.5 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

// ── page ───────────────────────────────────────────────────────────────────
function relAgo(sec: number) { return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`; }

export default function PlatformConsole() {
  const [tick, setTick] = useState(0);
  const [lastSync, setLastSync] = useState(() => Date.now());
  const [, force] = useState(0);

  // 60s auto-refresh — but skip while the tab is hidden (don't hammer the
  // cross-tenant service-role endpoints for a backgrounded tab); refetch on return.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTick((t) => t + 1); }, 60000);
    const onVis = () => { if (!document.hidden) setTick((t) => t + 1); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  useEffect(() => { setLastSync(Date.now()); }, [tick]);
  // 10s heartbeat purely for the "updated Xs ago" label (no data fetch)
  useEffect(() => { const id = setInterval(() => force((x) => x + 1), 10000); return () => clearInterval(id); }, []);
  const agoSec = Math.max(0, Math.round((Date.now() - lastSync) / 1000));

  return (
    <RefreshCtx.Provider value={tick}>
      <RoleAware>
        {(role) => (
          <main className="min-h-screen bg-[#0B0E14] text-slate-200">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
              <header className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                <div>
                  <h1 className="text-lg font-bold text-white">VAiyu Operator Console</h1>
                  <p className="text-xs text-slate-500">Platform-wide health, money &amp; onboarding across all hotels.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-500">updated {relAgo(agoSec)} ago</span>
                  <button onClick={() => setTick((t) => t + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/[0.06]" title="Refresh now">
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </button>
                  {role && <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60">{role}</span>}
                  <Link to="/owner" className="text-[11px] text-slate-400 hover:text-white">← Dashboard</Link>
                </div>
              </header>

              <PanelBoundary name="Status"><StatusBanner /></PanelBoundary>
              <PanelBoundary name="Fleet"><FleetPanel /></PanelBoundary>
              <PanelBoundary name="System Health"><HealthPanel /></PanelBoundary>
              {canSee(role, "payments") && <PanelBoundary name="Payments"><PaymentsPanel /></PanelBoundary>}
              {canSee(role, "onboarding") && <PanelBoundary name="Onboarding"><OnboardingPanel /></PanelBoundary>}
              <PanelBoundary name="Tenants"><TenantsPanel /></PanelBoundary>
              {canSee(role, "audit") && <PanelBoundary name="Audit"><AuditPanel /></PanelBoundary>}
            </div>
          </main>
        )}
      </RoleAware>
    </RefreshCtx.Provider>
  );
}

// resolves the admin's role (for panel gating) and exposes it to children
function RoleAware({ children }: { children: (role: string) => ReactNode }) {
  const { data } = useAdminData<{ role: string }>("me");
  return <>{children(data?.role || "")}</>;
}
