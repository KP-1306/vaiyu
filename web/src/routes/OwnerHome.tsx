// web/src/routes/OwnerHome.tsx
import { useEffect, useState, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import OwnerGate from '../components/OwnerGate';
import { API } from '../lib/api';
import OwnerDigestCard from '../components/OwnerDigestCard';
import SEO from "../components/SEO";
import UsageMeter from "../components/UsageMeter"; // NEW

// Tiny types to keep this file self-contained
type Kpis = { tickets: number; orders: number; onTime: number; late: number; avgMins: number };
type GridPeek = { mode: 'manual'|'assist'|'auto'; lastEventAt?: string|null };
type Peek = {
  hotel: { slug: string; name: string };
  kpis?: Kpis;
  grid?: GridPeek;
};

export default function OwnerHome() {
  const [sp, setSp] = useSearchParams();
  const [slug, setSlug] = useState<string>(sp.get('slug') || 'sunrise');
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loading, setLoading] = useState(true);

  // keep slug in URL for consistency with other owner pages
  useEffect(() => {
    const next = new URLSearchParams(sp);
    next.set('slug', slug);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Try real API peeks if present; else synthesize something friendly
        const r = await fetch(`${API}/owner/peek/${encodeURIComponent(slug)}`).catch(() => null);
        if (r && r.ok) {
          const j = await r.json();
          setPeek(j);
        } else {
          setPeek({
            hotel: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
            kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
            grid: { mode: 'manual', lastEventAt: null },
          });
        }
      } catch {
        setPeek({
          hotel: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
          kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
          grid: { mode: 'manual', lastEventAt: null },
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  return (
    <OwnerGate>
      <main className="max-w-6xl mx-auto p-4 space-y-4" aria-labelledby="owner-home-title">
        <SEO title="Owner Home" noIndex />

        {/* Header */}
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 id="owner-home-title" className="text-xl font-semibold">Owner Home</h1>
            <div className="text-sm text-gray-600">
              {peek?.hotel?.name || slug}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder="Hotel slug"
              aria-label="Hotel slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              style={{ width: 160 }}
            />
            <Link to={`/owner/settings?slug=${encodeURIComponent(slug)}`} className="btn btn-light">
              Settings
            </Link>
          </div>
        </header>

        {/* NEW: Usage (AI tokens) — shows latest month; if you want per-hotel, pass hotelId here */}
        <section className="grid md:grid-cols-2 gap-3" aria-label="Digest and usage">
          <OwnerDigestCard slug={slug} apiBase={API} className="mb-2" />
          <UsageMeter /* hotelId={profile?.hotel_id} */ />
        </section>

        {/* KPI glance (keep existing quick numbers) */}
        <section className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Key performance indicators">
          <Kpi title="Tickets" value={peek?.kpis?.tickets ?? '—'} />
          <Kpi title="Orders" value={peek?.kpis?.orders ?? '—'} />
          <Kpi title="On-time" value={peek?.kpis?.onTime ?? '—'} />
          <Kpi title="Late" value={peek?.kpis?.late ?? '—'} />
          <Kpi title="Avg mins" value={peek?.kpis?.avgMins ?? '—'} />
        </section>

        {/* Quick actions / deep links */}
        <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Quick links">
          <Tile
            title="Dashboard & KPIs"
            text="Trends, SLA hints, exports."
            to={`/owner/dashboard?slug=${encodeURIComponent(slug)}`}
            emoji="📈"
            cta="Open dashboard"
          />
          <Tile
            title="AI review moderation"
            text="Truth-anchored drafts, owner-approved."
            to={`/owner/reviews?slug=${encodeURIComponent(slug)}`}
            emoji="📝"
            cta="Review drafts"
          />
          <Tile
            title="Grid: Devices"
            text={`Mode: ${peek?.grid?.mode ?? '—'}. One-tap Shed/Restore in manual.`}
            to={`/grid/devices?slug=${encodeURIComponent(slug)}`}
            emoji="⚡"
            cta="Manage devices"
          />
          <Tile
            title="Grid: Events"
            text="Timeline, savings estimate, CSV."
            to={`/grid/events?slug=${encodeURIComponent(slug)}`}
            emoji="📊"
            cta="View events"
          />
          <Tile
            title="Housekeeping"
            text="Live tickets with SSE (no refresh)."
            to={`/hk?slug=${encodeURIComponent(slug)}`}
            emoji="🧽"
            cta="Open HK"
          />
          <Tile
            title="Front Desk"
            text="Requests, SLAs, routing."
            to={`/desk?slug=${encodeURIComponent(slug)}`}
            emoji="🛎️"
            cta="Open desk"
          />
          {/* Optional: expose Services (SLA) editor link here */}
          <Tile
            title="Services (SLA)"
            text="Edit labels, SLA minutes, active."
            to={`/owner/services?slug=${encodeURIComponent(slug)}`}
            emoji="🧩"
            cta="Open services"
          />
        </section>

        {/* Coming soon / secondary */}
        <section className="card" aria-label="Coming soon">
          <div className="font-semibold mb-1">Coming soon</div>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
            <li>Bookings & revenue peek (PMS sync)</li>
            <li>Staff KPIs & attendance hooks</li>
            <li>Energy & cost reports (time-of-day tariffs)</li>
            <li>Owner app & alerts</li>
          </ul>
        </section>

        {loading && <div role="status" aria-live="polite">Loading…</div>}
      </main>
    </OwnerGate>
  );
}

/* --- Small perf/a11y polish: memoize simple cards --- */
const Kpi = memo(function Kpi({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="card" role="group" aria-label={`${title} KPI`}>
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
});

const Tile = memo(function Tile({
  title, text, to, emoji, cta,
}: {
  title: string; text: string; to: string; emoji: string; cta: string;
}) {
  return (
    <Link to={to} className="card hover:shadow transition-shadow block" aria-label={`${title}: ${text}`}>
      <div className="text-xl" aria-hidden>{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
      <div className="mt-3">
        <span className="btn btn-light">{cta}</span>
      </div>
    </Link>
  );
});
