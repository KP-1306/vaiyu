import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

type Report = {
  hotel: { slug: string; name: string };
  period: string;
  kpis: { tickets: number; orders: number; onTime: number; late: number; avgMins: number };
  hints?: string[];
};

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function OwnerDashboard() {
  const { slug = "sunrise" } = useParams();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`${API}/experience/report/${slug}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || "Failed");
        if (!cancelled) setData(body);
      })
      .catch((e) => !cancelled && setErr(e?.message || "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [slug]);

  const bars = useMemo(() => {
    if (!data) return [];
    const { tickets, orders, onTime, late } = data.kpis;
    return [
      { label: "Tickets", value: tickets },
      { label: "Orders", value: orders },
      { label: "On-time", value: onTime },
      { label: "Late", value: late },
    ];
  }, [data]);

  const max = useMemo(() => Math.max(1, ...bars.map((b) => b.value)), [bars]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (err) return <div className="card" style={{ margin: 16, borderColor: "#f59e0b" }}>⚠️ {err}</div>;
  if (!data) return null;

  const { kpis, hotel, period, hints } = data;

  return (
    <main className="max-w-4xl mx-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{hotel.name} — Owner Dashboard</h1>
          <div className="text-sm text-gray-600">{period}</div>
        </div>
        <a className="link" href={`/hotel/${hotel.slug}`} title="Open microsite">View microsite →</a>
      </header>

      {/* KPI row */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi title="Tickets" value={kpis.tickets} />
        <Kpi title="Orders" value={kpis.orders} />
        <Kpi title="On-time" value={kpis.onTime} tone="ok" />
        <Kpi title="Late" value={kpis.late} tone={kpis.late > 0 ? "warn" : undefined} />
        <Kpi title="Avg resolve (min)" value={kpis.avgMins} hint="Across completed tickets" />
      </section>

      {/* Tiny column chart (SVG, no libs) */}
      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="m-0">KPIs (visual)</h3>
          <div className="text-xs text-gray-600">Max: {max}</div>
        </div>
        <Chart bars={bars} max={max} />
      </section>

      {/* Hints / recommendations */}
      {hints?.length ? (
        <section className="card">
          <h3 className="m-0">Policy hints</h3>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            {hints.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function Kpi({
  title, value, hint, tone,
}: { title: string; value: number | string; hint?: string; tone?: "ok" | "warn" }) {
  const toneStyle =
    tone === "warn"
      ? { background: "#FEF3C7", borderColor: "#F59E0B", color: "#92400E" }
      : tone === "ok"
      ? { background: "#ECFDF5", borderColor: "#10B981", color: "#065F46" }
      : {};
  return (
    <div className="card" style={toneStyle}>
      <div className="text-xs text-gray-600">{title}</div>
      <div className="text-2xl font-semibold leading-tight">{value}</div>
      {hint && <div className="text-[11px] opacity-75">{hint}</div>}
    </div>
  );
}

function Chart({ bars, max }: { bars: { label: string; value: number }[]; max: number }) {
  const W = 520, H = 160, pad = 24;
  const bw = (W - pad * 2) / bars.length;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="KPI bar chart">
      {/* axes */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e5e7eb" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#e5e7eb" />
      {/* bars */}
      {bars.map((b, i) => {
        const h = max ? Math.round(((b.value || 0) / max) * (H - pad * 2)) : 0;
        const x = pad + i * bw + bw * 0.15;
        const y = H - pad - h;
        const w = bw * 0.7;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={w} height={h} fill="var(--brand, #0ea5e9)" opacity="0.85" />
            <text x={x + w / 2} y={H - pad + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
              {b.label}
            </text>
            <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize="11" fill="#111827">
              {b.value}
            </text>
          </g>
        );
      })}
      {/* gridline for 0 and max */}
      <text x={pad - 6} y={H - pad + 4} textAnchor="end" fontSize="10" fill="#6b7280">0</text>
      <text x={pad - 6} y={pad + 4} textAnchor="end" fontSize="10" fill="#6b7280">{max}</text>
    </svg>
  );
}
