// web/src/routes/OwnerHome.tsx
import { memo, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import { useRole } from "../context/RoleContext";
import OwnerDigestCard from "../components/OwnerDigestCard";
import UsageMeter from "../components/UsageMeter";
import ObservabilityCard from "../components/ObservabilityCard";

/** --- Local types to keep the file focused --- */
type Kpis = {
  tickets: number;
  orders: number;
  onTime: number;
  late: number;
  avgMins: number;
};
type GridPeek = {
  mode: "manual" | "assist" | "auto";
  lastEventAt?: string | null;
};
type Peek = { hotel: { slug: string; name: string }; kpis?: Kpis; grid?: GridPeek };

/** --- Component --- */
export default function OwnerHome() {
  const navigate = useNavigate();
  const { slug: slugParam } = useParams<{ slug?: string }>();
  const [sp, setSp] = useSearchParams();

  // Role context (you created this)
  const { current } = useRole(); // { role: 'guest'|'staff'|'manager'|'owner', hotelSlug?: string|null }

  // Resolve slug: route param > role context > ?slug > fallback
  const initialSlug =
    slugParam || current.hotelSlug || sp.get("slug") || "demo";

  const [slug, setSlug] = useState<string>(initialSlug);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState<any>(null);

  // Keep ?slug in the URL for refresh/share
  useEffect(() => {
    const next = new URLSearchParams(sp);
    next.set("slug", slug);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Hydrate auth user (lightweight)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setAuthUser(data?.user ?? null);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
        if (!mounted) return;
        setAuthUser(sess?.user ?? null);
      });
      return () => sub.subscription.unsubscribe();
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // RBAC guard — only owners/managers may view
  const allowed = useMemo(
    () => current.role === "owner" || current.role === "manager",
    [current.role]
  );

  // Redirect staff/guest into their consoles if they end up here
  useEffect(() => {
    if (!authUser) return;
    if (!allowed) {
      if (current.role === "staff") navigate("/staff", { replace: true });
      else navigate("/guest", { replace: true });
    }
  }, [allowed, authUser, current.role, navigate]);

  // Fetch peek (API best-effort; safe demo fallback)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/owner/peek/${encodeURIComponent(slug)}`);
        if (alive && r.ok) {
          setPeek(await r.json());
        } else if (alive) {
          setPeek(demoPeek(slug));
        }
      } catch {
        if (alive) setPeek(demoPeek(slug));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  if (!allowed) {
    return (
      <main className="max-w-xl mx-auto p-8 text-center space-y-3">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="opacity-70">
          You need owner/manager permissions to view this page.
        </p>
        <a className="btn btn-light" href="/contact">
          Request access
        </a>
      </main>
    );
  }

  return (
    <main
      className="max-w-6xl mx-auto p-4 space-y-4"
      aria-labelledby="owner-home-title"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 id="owner-home-title" className="text-xl font-semibold">
            Owner Console
          </h1>
          <div className="text-sm text-gray-600">
            {peek?.hotel?.name ?? slug}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder="Hotel slug"
            aria-label="Hotel slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.trim())}
            style={{ width: 160 }}
          />
          <Link
            to={`/owner/settings?slug=${encodeURIComponent(slug)}`}
            className="btn btn-light"
          >
            Settings
          </Link>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: main content */}
        <div className="md:col-span-2 space-y-4">
          {/* Digest + Usage */}
          <section
            className="grid md:grid-cols-2 gap-3"
            aria-label="Digest and usage"
          >
            <OwnerDigestCard slug={slug} apiBase={API} className="mb-2" />
            <UsageMeter />
          </section>

          {/* KPI glance */}
          <section
            className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3"
            aria-label="Key performance indicators"
          >
            <Kpi title="Tickets" value={peek?.kpis?.tickets ?? "—"} />
            <Kpi title="Orders" value={peek?.kpis?.orders ?? "—"} />
            <Kpi title="On-time" value={peek?.kpis?.onTime ?? "—"} />
            <Kpi title="Late" value={peek?.kpis?.late ?? "—"} />
            <Kpi title="Avg mins" value={peek?.kpis?.avgMins ?? "—"} />
          </section>

          {/* Quick links */}
          <section
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-3"
            aria-label="Quick links"
          >
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
            {/* NEW: Reputation Radar tile */}
            <Tile
              title="Reputation Radar"
              text="Correlate tickets, stays & reviews. Flag suspicious patterns early."
              to={`/owner/${encodeURIComponent(slug)}/reputation`}
              emoji="🛡️"
              cta="Open radar"
            />
            <Tile
              title="Grid: Devices"
              text={`Mode: ${
                peek?.grid?.mode ?? "—"
              }. One-tap Shed/Restore in manual.`}
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
            <Tile
              title="Services (SLA)"
              text="Edit labels, SLA minutes, active."
              to={`/owner/services?slug=${encodeURIComponent(slug)}`}
              emoji="🧩"
              cta="Open services"
            />
            {/* Guest unified profile (demo entry) */}
            <Tile
              title="Guest profiles"
              text="Unified timeline of stays, tickets, orders, reviews & credits (demo guest)."
              to={`/owner/guest/demo-guest?slug=${encodeURIComponent(slug)}`}
              emoji="👤"
              cta="Open demo guest"
            />
          </section>

          {/* Coming soon */}
          <section className="card" aria-label="Coming soon">
            <div className="font-semibold mb-1">Coming soon</div>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>Bookings & revenue peek (PMS sync)</li>
              <li>Staff KPIs & attendance hooks</li>
              <li>Energy & cost reports (time-of-day tariffs)</li>
              <li>Owner app & alerts</li>
            </ul>
          </section>

          {loading && (
            <div role="status" aria-live="polite">
              Loading…
            </div>
          )}
        </div>

        {/* Right: observability widgets */}
        <div className="space-y-4">
          <ObservabilityCard />
        </div>
      </div>
    </main>
  );
}

/** --- Small perf/a11y polish: memoized presentational bits --- */
const Kpi = memo(function Kpi({
  title,
  value,
}: {
  title: string;
  value: number | string;
}) {
  return (
    <div className="card" role="group" aria-label={`${title} KPI`}>
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
});

const Tile = memo(function Tile({
  title,
  text,
  to,
  emoji,
  cta,
}: {
  title: string;
  text: string;
  to: string;
  emoji: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="card hover:shadow transition-shadow block"
      aria-label={`${title}: ${text}`}
    >
      <div className="text-xl" aria-hidden>
        {emoji}
      </div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
      <div className="mt-3">
        <span className="btn btn-light">{cta}</span>
      </div>
    </Link>
  );
});

/** --- Local helpers --- */
function demoPeek(slug: string): Peek {
  return {
    hotel: {
      slug,
      name: slug[0]?.toUpperCase() + slug.slice(1),
    },
    kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
    grid: { mode: "manual", lastEventAt: null },
  };
}
