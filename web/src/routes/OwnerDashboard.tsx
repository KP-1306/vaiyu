import { useEffect, useMemo, useState, useCallback } from 'react';
import { getExperienceReport } from '../lib/api';
import OwnerGate from '../components/OwnerGate';

type Report = {
  hotel: { slug: string; name: string };
  period: string;
  kpis: { tickets: number; orders: number; onTime: number; late: number; avgMins: number };
  hints: string[];
};

export default function OwnerDashboard() {
  // You can also read slug from search (?slug=xyz) or persist last-used slug in localStorage
  const [slug, setSlug] = useState<string>(() => new URLSearchParams(location.search).get('slug') || 'sunrise');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await getExperienceReport(slug);
      setData(r as Report);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const bars = useMemo(() => {
    if (!data) return [];
    const { tickets, orders, onTime, late, avgMins } = data.kpis;
    return [
      { label: 'Tickets', value: tickets },
      { label: 'Orders', value: orders },
      { label: 'On-time', value: onTime },
      { label: 'Late', value: late },
      { label: 'Avg mins', value: avgMins },
    ];
  }, [data]);

  return (
    <OwnerGate>
      <main className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Owner Dashboard</h1>
            {data && (
              <div className="text-sm text-gray-600">
                {data.hotel.name} • {data.period}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder="Hotel slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              style={{ width: 160 }}
            />
            <button className="btn btn-light" onClick={load}>Refresh</button>
          </div>
        </header>

        {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}
        {loading && <div>Loading…</div>}

        {data && !loading && (
          <>
            {/* KPI cards */}
            <section className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <Kpi title="Tickets" value={data.kpis.tickets} />
              <Kpi title="Orders" value={data.kpis.orders} />
              <Kpi title="On-time" value={data.kpis.onTime} />
              <Kpi title="Late" value={data.kpis.late} />
              <Kpi title="Avg mins" value={data.kpis.avgMins} />
            </section>

            {/* Tiny bar chart (SVG) */}
            <section className="card">
              <div className="font-semibold mb-2">Performance snapshot</div>
              <BarChart bars={bars} height={160} />
            </section>

            {/* Policy hints */}
            <section className="card">
              <div className="font-semibold mb-2">Suggestions</div>
              {data.hints.length ? (
                <ul className="list-disc pl-5 space-y-1">
                  {data.hints.map((h, idx) => <li key={idx}>{h}</li>)}
                </ul>
              ) : (
                <div className="text-gray-600">No obvious issues detected.</div>
              )}
            </section>
          </>
        )}
      </main>
    </OwnerGate>
  );
}

function Kpi({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function BarChart({ bars, height = 160 }: { bars: { label: string; value: number }[]; height?: number }) {
  const padding = 24;
  const w = Math.max(360, bars.length * 80);
  const h = height;
  const max = Math.max(1, ...bars.map(b => b.value));
  const barW = (w - padding * 2) / bars.length - 16;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={w} height={h} role="img" aria-label="Bar chart">
        {/* axis */}
        <line x1={padding} y1={h - padding} x2={w - padding} y2={h - padding} stroke="#e5e7eb" />
        {/* bars */}
        {bars.map((b, i) => {
          const x = padding + i * ((w - padding * 2) / bars.length);
          const barH = (b.value / max) * (h - padding * 2);
          const y = h - padding - barH;
          return (
            <g key={b.label}>
              <rect x={x + 8} y={y} width={barW} height={barH} fill="var(--brand, #145AF2)" rx="6" />
              <text x={x + 8 + barW / 2} y={h - padding + 14} textAnchor="middle" fontSize="12" fill="#4b5563">
                {b.label}
              </text>
              <text x={x + 8 + barW / 2} y={y - 6} textAnchor="middle" fontSize="12" fill="#111827">
                {b.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
