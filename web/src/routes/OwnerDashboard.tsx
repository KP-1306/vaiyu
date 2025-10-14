// web/src/routes/OwnerDashboard.tsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { API, getExperienceReport } from '../lib/api';
import OwnerGate from '../components/OwnerGate';
import OwnerGridSummary from '../components/OwnerGridSummary';
import SEO from "../components/SEO";

type Report = {
  hotel: { slug: string; name: string };
  period: string;
  kpis: { tickets: number; orders: number; onTime: number; late: number; avgMins: number };
  hints: string[];
};

<SEO title="Owner Home" noIndex />

type Range = 'today' | '7d' | '30d' | 'all';

const LS_KEY = 'owner:dashboard';
const DEFAULT_SLUG = new URLSearchParams(location.search).get('slug') || 'sunrise';
const DEFAULT_RANGE = (new URLSearchParams(location.search).get('range') as Range) || 'all';

export default function OwnerDashboard() {
  // restore persisted state
  const initial = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        return {
          slug: (new URLSearchParams(location.search).get('slug') || j.slug || DEFAULT_SLUG) as string,
          range: ((new URLSearchParams(location.search).get('range') as Range) || j.range || DEFAULT_RANGE) as Range,
        };
      }
    } catch {}
    return { slug: DEFAULT_SLUG, range: DEFAULT_RANGE as Range };
  })();

  const [slug, setSlug]   = useState<string>(initial.slug);
  const [range, setRange] = useState<Range>(initial.range);
  const [data, setData]   = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // persist to URL + localStorage
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    sp.set('slug', slug);
    sp.set('range', range);
    history.replaceState(null, '', `${location.pathname}?${sp.toString()}`);
    localStorage.setItem(LS_KEY, JSON.stringify({ slug, range }));
  }, [slug, range]);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const url = `${API}/experience/report/${encodeURIComponent(slug)}${range === 'all' ? '' : `?range=${range}`}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text());
      const json = (await r.json()) as Report;
      setData(json);
    } catch (e: any) {
      try {
        const fallback = await getExperienceReport(slug);
        setData(fallback as unknown as Report);
      } catch {
        setErr(e?.message || 'Failed to load report');
      }
    } finally {
      setLoading(false);
    }
  }, [slug, range]);

  useEffect(() => { load(); }, [load]);

  const bars = useMemo(() => {
    if (!data) return [];
    const { tickets, orders, onTime, late, avgMins } = data.kpis;
    return [
      { label: 'Tickets', value: tickets },
      { label: 'Orders',  value: orders  },
      { label: 'On-time', value: onTime  },
      { label: 'Late',    value: late    },
      { label: 'Avg mins',value: avgMins },
    ];
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const rows = [
      ['Hotel', data.hotel.name],
      ['Period', data.period],
      [],
      ['Metric','Value'],
      ['Tickets',  String(data.kpis.tickets)],
      ['Orders',   String(data.kpis.orders)],
      ['On-time',  String(data.kpis.onTime)],
      ['Late',     String(data.kpis.late)],
      ['Avg mins', String(data.kpis.avgMins)],
      [],
      ['Suggestions'],
      ...((data.hints || []).map(h => [h])),
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${data.hotel.slug}-${range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <OwnerGate>
      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Owner · Dashboard</h1>
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
              aria-label="Hotel slug"
            />
            <select
              className="select"
              value={range}
              onChange={(e) => setRange(e.target.value as Range)}
              title="Date range"
              aria-label="Date range"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            <button className="btn btn-light" onClick={load}>Refresh</button>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
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

            {/* Performance snapshot */}
            <section className="card">
              <div className="font-semibold mb-2">Performance snapshot</div>
              <BarChart bars={bars} height={160} />
            </section>

            {/* Suggestions */}
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

            {/* ---- Energy / Grid block ---- */}
            <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              <OwnerGridSummary />
              <div className="card">
                <div className="text-xs text-gray-500">Grid</div>
                <div className="font-semibold">Quick actions</div>
                <div className="mt-3 grid gap-2">
                  <a className="btn btn-light" href="/grid/devices">Devices</a>
                  <a className="btn btn-light" href="/grid/playbooks">Playbooks</a>
                  <a className="btn btn-light" href="/grid/events">Events timeline</a>
                </div>
              </div>
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
