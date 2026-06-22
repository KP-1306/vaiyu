// web/src/routes/admin/PlatformConsole.tsx
//
// VAiyu Operator Console — the platform-admin (cross-tenant) cockpit. All data is
// served by the service-role /api/admin/* endpoint, which re-checks platform_admins
// and enforces per-panel role tiers; this component only mirrors those tiers to
// decide which panels to render (so a support_admin never fires a 403'd request).
//
// Route is gated by PlatformAdminGate (is_platform_admin). Theme matches the owner
// dashboard (dark: bg-[#0B0E14], border-white/10, bg-white/[0.02]).
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, Building2, CreditCard, UserPlus, ShieldCheck, Server } from "lucide-react";
import { supabase } from "../../lib/supabase";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat("en-IN");
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

async function adminFetch<T>(panel: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  const r = await fetch(`/api/admin/${panel}`, { headers });
  if (!r.ok) throw new Error(`${panel}: ${r.status}`);
  return r.json() as Promise<T>;
}

function useAdminData<T>(panel: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    setLoading(true); setErr(null);
    adminFetch<T>(panel)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(String(e?.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [panel, enabled]);
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
function Section({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <header className="mb-3 flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{title}</h2>
        {subtitle && <span className="text-[10px] text-slate-500">· {subtitle}</span>}
      </header>
      {children}
    </section>
  );
}
function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-white/50">{label}</div>
      <div className="text-xl font-semibold text-white tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
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
function Empty({ text = "No data yet." }: { text?: string }) {
  return <div className="text-sm text-white/40">{text}</div>;
}

// 24h calls sparkline (inline SVG; error hours tinted red)
function Sparkline({ series }: { series: Array<{ calls: number; err_5xx: number; err_4xx: number }> }) {
  if (!series.length) return <Empty text="No traffic in the last 24h." />;
  const w = 520, h = 56, max = Math.max(1, ...series.map((s) => s.calls));
  const bw = w / series.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      {series.map((s, i) => {
        const bh = Math.max(1, (s.calls / max) * (h - 6));
        const err = (s.err_5xx || 0) + (s.err_4xx || 0) > 0;
        return <rect key={i} x={i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh}
          className={err ? "fill-red-400/70" : "fill-sky-400/50"} rx="1" />;
      })}
    </svg>
  );
}

// ── panels ─────────────────────────────────────────────────────────────────
type Fleet = { total: number; byStatus: Record<string, number>; byPlan: Record<string, number>; new7d: number; new30d: number; topCities: { city: string; n: number }[] };
function FleetPanel() {
  const { data, loading, err } = useAdminData<Fleet>("fleet");
  return (
    <Section icon={<Building2 className="h-3.5 w-3.5" />} title="Fleet" subtitle="all hotels">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Total hotels" value={n0.format(data.total)} />
            <Stat label="Active" value={n0.format(data.byStatus.active || 0)} />
            <Stat label="Trial" value={n0.format(data.byStatus.trial || 0)} />
            <Stat label="Past due / canceled" value={n0.format((data.byStatus.past_due || 0) + (data.byStatus.canceled || 0))} />
            <Stat label="New (30d)" value={n0.format(data.new30d)} sub={`${data.new7d} in last 7d`} />
          </div>
          <Card className="mt-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.byPlan).sort((a, b) => b[1] - a[1]).map(([p, c]) => <Pill key={p} label={p} n={c} />)}
            </div>
            {data.topCities.length > 0 && (
              <div className="mt-3 text-[11px] text-white/40">
                Top cities: {data.topCities.map((c) => `${c.city || "—"} (${c.n})`).join(" · ")}
              </div>
            )}
          </Card>
        </>
      )}
    </Section>
  );
}

type Health = {
  totals: { calls: number; avg_ms: number; errors: number };
  series: Array<{ calls: number; err_4xx: number; err_5xx: number }>;
  topFns: { fn: string; calls: number; avg_ms: number }[];
  slowest: { fn: string; calls: number; avg_ms: number }[];
  rateLimitHits24h: number;
  recent5xx: { fn: string; status: number; path: string; at: string }[];
  cron: { jobname: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; runs_24h: number; fails_24h: number }[];
};
function HealthPanel() {
  const { data, loading, err } = useAdminData<Health>("health");
  return (
    <Section icon={<Activity className="h-3.5 w-3.5" />} title="System Health" subtitle="VAiyu-wide · 24h">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Calls (24h)" value={n0.format(data.totals.calls)} />
              <Stat label="Avg latency" value={`${data.totals.avg_ms} ms`} />
              <Stat label="Errors" value={n0.format(data.totals.errors)} />
              <Stat label="Rate-limit hits" value={n0.format(data.rateLimitHits24h)} />
            </div>
            <div className="mt-4"><div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Calls / hour (red = had errors)</div><Sparkline series={data.series} /></div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Top functions</div>
                <ul className="text-sm space-y-1">
                  {data.topFns.length ? data.topFns.map((f) => (
                    <li key={f.fn} className="flex justify-between text-white/80"><span className="truncate">{f.fn}</span><span className="shrink-0 tabular-nums text-white/60">{f.calls} · {f.avg_ms}ms</span></li>
                  )) : <Empty />}
                </ul>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Slowest</div>
                <ul className="text-sm space-y-1">
                  {data.slowest.length ? data.slowest.map((f) => (
                    <li key={f.fn} className="flex justify-between text-white/80"><span className="truncate">{f.fn}</span><span className="shrink-0 tabular-nums text-amber-300/80">{f.avg_ms}ms</span></li>
                  )) : <Empty />}
                </ul>
              </div>
            </div>
          </Card>
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">Cron jobs</div>
            <ul className="text-sm space-y-1.5">
              {data.cron.length ? data.cron.map((c) => (
                <li key={c.jobname} className="flex items-center justify-between gap-2">
                  <span className="truncate text-white/80" title={c.schedule}>{c.jobname}</span>
                  <span className={`shrink-0 text-[11px] tabular-nums ${c.fails_24h > 0 ? "text-red-300" : c.last_status === "succeeded" ? "text-emerald-300/80" : "text-white/40"}`}>
                    {c.fails_24h > 0 ? `${c.fails_24h} fail` : c.last_status || "—"}
                  </span>
                </li>
              )) : <Empty />}
            </ul>
            <div className="text-[11px] uppercase tracking-wider text-white/50 mt-4 mb-2">Recent 5xx</div>
            <ul className="text-xs space-y-1">
              {data.recent5xx.length ? data.recent5xx.slice(0, 6).map((e, i) => (
                <li key={i} className="flex justify-between gap-2 text-white/70"><span className="truncate">{e.fn || e.path}</span><span className="shrink-0 text-red-300 tabular-nums">{e.status}</span></li>
              )) : <Empty text="No 5xx in 24h ✓" />}
            </ul>
          </Card>
        </div>
      )}
    </Section>
  );
}

type Payments = { gmv24h: number; gmv7d: number; gmv30d: number; txns30d: number; byStatus: Record<string, { count: number; sum: number }>; byMethod: Record<string, { count: number; sum: number }> };
function PaymentsPanel() {
  const { data, loading, err } = useAdminData<Payments>("payments");
  return (
    <Section icon={<CreditCard className="h-3.5 w-3.5" />} title="Payments & GMV" subtitle="cross-tenant · finance">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="GMV (24h)" value={inr0.format(data.gmv24h)} />
            <Stat label="GMV (7d)" value={inr0.format(data.gmv7d)} />
            <Stat label="GMV (30d)" value={inr0.format(data.gmv30d)} />
            <Stat label="Txns (30d)" value={n0.format(data.txns30d)} />
          </div>
          <Card className="mt-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">By status</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.byStatus).map(([s, v]) => (
                    <Pill key={s} label={s} n={v.count} tone={s === "COMPLETED" ? "good" : s === "FAILED" ? "bad" : "default"} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">By method</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.byMethod).map(([m, v]) => <Pill key={m} label={m} n={v.count} />)}
                </div>
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
    <Section icon={<UserPlus className="h-3.5 w-3.5" />} title="Onboarding" subtitle="applications → activations · support">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Pill label="pending" n={data.byStatus.pending || 0} tone="warn" />
            <Pill label="approved" n={data.byStatus.approved || 0} tone="good" />
            <Pill label="rejected" n={data.byStatus.rejected || 0} tone="bad" />
            <span className="text-[11px] text-white/40 ml-2">Hotels activated (30d): <b className="text-white/70">{data.activated30d}</b></span>
            <Link to="/admin/owner-applications" className="ml-auto text-[11px] text-sky-300/80 hover:text-sky-200">Open pipeline →</Link>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Recent applications</div>
          <ul className="text-sm divide-y divide-white/[0.06]">
            {data.recent.length ? data.recent.map((a, i) => (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span className="text-white/80 truncate">{a.hotel_name || "—"} <span className="text-white/40">· {a.city || "—"}</span></span>
                <span className="shrink-0 text-[11px] text-white/50">{a.status} · {fmtDate(a.created_at)}</span>
              </li>
            )) : <Empty />}
          </ul>
        </Card>
      )}
    </Section>
  );
}

type Tenants = { rows: { slug: string; name: string; city: string; plan: string; plan_status: string; created_at: string; revenueToday: number }[] };
function TenantsPanel() {
  const { data, loading, err } = useAdminData<Tenants>("tenants");
  return (
    <Section icon={<Server className="h-3.5 w-3.5" />} title="Tenants" subtitle="click a hotel to open its dashboard">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-white/40 text-left">
                <th className="pb-2 font-medium">Hotel</th><th className="pb-2 font-medium">City</th>
                <th className="pb-2 font-medium">Plan</th><th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Revenue today</th><th className="pb-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {data.rows.length ? data.rows.map((h) => (
                <tr key={h.slug} className="hover:bg-white/[0.03]">
                  <td className="py-1.5"><Link to={`/owner/${h.slug}`} className="text-sky-300/90 hover:text-sky-200">{h.name || h.slug}</Link></td>
                  <td className="py-1.5 text-white/60">{h.city || "—"}</td>
                  <td className="py-1.5 text-white/70">{h.plan}</td>
                  <td className="py-1.5 text-white/70">{h.plan_status}</td>
                  <td className="py-1.5 text-right tabular-nums text-white/80">{h.revenueToday ? inr0.format(h.revenueToday) : "—"}</td>
                  <td className="py-1.5 text-white/50">{fmtDate(h.created_at)}</td>
                </tr>
              )) : <tr><td colSpan={6}><Empty /></td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

type Audit = { rows: { at: string; action: string; actor: string; hotel_id: string; entity: string; entity_id: string }[] };
function AuditPanel() {
  const { data, loading, err } = useAdminData<Audit>("audit");
  return (
    <Section icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Audit & Security" subtitle="recent platform actions · super admin">
      {loading ? <Card><Skeleton /></Card> : err ? <Card><Empty text={`Unavailable (${err})`} /></Card> : data && (
        <Card className="overflow-x-auto">
          <ul className="text-xs space-y-1">
            {data.rows.length ? data.rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-white/70">
                <span className="text-white/40 tabular-nums shrink-0 w-28">{fmtDate(r.at)}</span>
                <span className="text-white/90 truncate">{r.action}</span>
                <span className="text-white/40 truncate">{r.entity}{r.entity_id ? `:${String(r.entity_id).slice(0, 8)}` : ""}</span>
              </li>
            )) : <Empty />}
          </ul>
        </Card>
      )}
    </Section>
  );
}

// ── page ───────────────────────────────────────────────────────────────────
export default function PlatformConsole() {
  const { data: me } = useAdminData<{ role: string }>("me");
  const role = me?.role || "";

  return (
    <main className="min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <header className="flex items-center justify-between border-b border-slate-800/50 pb-4">
          <div>
            <h1 className="text-lg font-bold text-white">VAiyu Operator Console</h1>
            <p className="text-xs text-slate-500">Platform-wide health, money & onboarding across all hotels.</p>
          </div>
          <div className="flex items-center gap-3">
            {role && <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60">{role}</span>}
            <Link to="/owner" className="text-[11px] text-slate-400 hover:text-white">← Dashboard</Link>
          </div>
        </header>

        <FleetPanel />
        <HealthPanel />
        {canSee(role, "payments") && <PaymentsPanel />}
        {canSee(role, "onboarding") && <OnboardingPanel />}
        <TenantsPanel />
        {canSee(role, "audit") && <AuditPanel />}
      </div>
    </main>
  );
}
