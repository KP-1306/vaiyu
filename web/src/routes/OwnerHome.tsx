// web/src/routes/OwnerHome.tsx
import { useEffect, useState, memo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import OwnerDigestCard from "../components/OwnerDigestCard";
import SEO from "../components/SEO";
import UsageMeter from "../components/UsageMeter";
import ObservabilityCard from "../components/ObservabilityCard"; // right-column widget

// Tiny types to keep this file self-contained
type Kpis = { tickets: number; orders: number; onTime: number; late: number; avgMins: number };
type GridPeek = { mode: "manual" | "assist" | "auto"; lastEventAt?: string | null };
type Peek = { hotel: { slug: string; name: string }; kpis?: Kpis; grid?: GridPeek };

// Lightweight auth snapshot (no custom hook)
type LiteUser = { id: string; email?: string | null; user_metadata?: any; app_metadata?: any } | null;
function getRole(u: LiteUser): "guest" | "owner" | "staff" | "admin" {
  return (u?.user_metadata?.role || u?.app_metadata?.role || "guest") as any;
}
function getPropertySlug(u: LiteUser): string | undefined {
  return u?.user_metadata?.property_slug || u?.app_metadata?.property_slug;
}

export default function OwnerHome() {
  // Auth state
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<LiteUser>(null);
  const role = getRole(user);
  const profileSlug = getPropertySlug(user);

  // URL state
  const [sp, setSp] = useSearchParams();
  const [slug, setSlug] = useState<string>(sp.get("slug") || profileSlug || "sunrise");

  // Page data
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Auth hydrate ----
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setUser(data?.user ?? null);
      setAuthLoading(false);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
        if (!mounted) return;
        setUser(sess?.user ?? null);
      });
      return () => sub.subscription.unsubscribe();
    })();
    return () => { mounted = false; };
  }, []);

  // Keep slug in the URL
  useEffect(() => {
    const next = new URLSearchParams(sp);
    next.set("slug", slug);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Fetch peek (with demo fallback)
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/owner/peek/${encodeURIComponent(slug)}`).catch(() => null);
        if (r && r.ok) {
          const j = await r.json();
          setPeek(j);
        } else {
          setPeek({
            hotel: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
            kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
            grid: { mode: "manual", lastEventAt: null },
          });
        }
      } catch {
        setPeek({
          hotel: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
          kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
          grid: { mode: "manual", lastEventAt: null },
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // ---- RBAC Edge States (UI) ----
  if (authLoading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!user || !["owner", "admin"].includes(role)) {
    return <Denied />;
  }

  const hasProperty = Boolean(profileSlug || slug);
  if (!hasProperty) {
    return <NoProperty />;
  }

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4" aria-labelledby="owner-home-title">
      <SEO title="Owner Home" noIndex />

      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 id="owner-home-title" className="text-xl font-semibold">Owner Home</h1>
          <div className="text-sm text-gray-600">{peek?.hotel?.name || slug}</div>
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

      {/* Two-column layout: content + observability */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: main owner content */}
        <div className="md:col-span-2 space-y-4">
          {/* Digest + Usage */}
          <section className="grid md:grid-cols-2 gap-3" aria-label="Digest and usage">
            <OwnerDigestCard slug={slug} apiBase={API} className="mb-2" />
            <UsageMeter />
          </section>

          {/* KPI glance */}
          <section className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Key performance indicators">
            <Kpi title="Tickets" value={peek?.kpis?.tickets ?? "—"} />
            <Kpi title="Orders" value={peek?.kpis?.orders ?? "—"} />
            <Kpi title="On-time" value={peek?.kpis?.onTime ?? "—"} />
            <Kpi title="Late" value={peek?.kpis?.late ?? "—"} />
            <Kpi title="Avg mins" value={peek?.kpis?.avgMins ?? "—"} />
          </section>

          {/* Quick links */}
          <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Quick links">
            <Tile title="Dashboard & KPIs" text="Trends, SLA hints, exports."
                  to={`/owner/dashboard?slug=${encodeURIComponent(slug)}`} emoji="📈" cta="Open dashboard" />
            <Tile title="AI review moderation" text="Truth-anchored drafts, owner-approved."
                  to={`/owner/reviews?slug=${encodeURIComponent(slug)}`} emoji="📝" cta="Review drafts" />
            <Tile title="Grid: Devices" text={`Mode: ${peek?.grid?.mode ?? "—"}. One-tap Shed/Restore in manual.`}
                  to={`/grid/devices?slug=${encodeURIComponent(slug)}`} emoji="⚡" cta="Manage devices" />
            <Tile title="Grid: Events" text="Timeline, savings estimate, CSV."
                  to={`/grid/events?slug=${encodeURIComponent(slug)}`} emoji="📊" cta="View events" />
            <Tile title="Housekeeping" text="Live tickets with SSE (no refresh)."
                  to={`/hk?slug=${encodeURIComponent(slug)}`} emoji="🧽" cta="Open HK" />
            <Tile title="Front Desk" text="Requests, SLAs, routing."
                  to={`/desk?slug=${encodeURIComponent(slug)}`} emoji="🛎️" cta="Open desk" />
            <Tile title="Services (SLA)" text="Edit labels, SLA minutes, active."
                  to={`/owner/services?slug=${encodeURIComponent(slug)}`} emoji="🧩" cta="Open services" />
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
        </div>

        {/* Right: Observability widgets */}
        <div className="space-y-4">
          <ObservabilityCard />
        </div>
      </div>
    </main>
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
}: { title: string; text: string; to: string; emoji: string; cta: string; }) {
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

/* ---- RBAC Empty/Deny blocks (inline; can move to components/EmptyStates.tsx) ---- */
function Denied() {
  return (
    <main className="max-w-xl mx-auto p-8 text-center space-y-3">
      <h1 className="text-xl font-semibold">No access</h1>
      <p className="opacity-70">Your account doesn’t have permission to view this page.</p>
      <a className="btn btn-light" href="/contact">Request access</a>
    </main>
  );
}

function NoProperty() {
  return (
    <main className="max-w-xl mx-auto p-8 text-center space-y-4">
      <h1 className="text-xl font-semibold">You’re signed in as a Guest</h1>
      <p className="opacity-70">Join an existing property or register a new one to unlock owner tools.</p>
      <div className="flex gap-2 justify-center">
        <a className="btn" href="/join">Join property</a>
        <a className="btn btn-light" href="/owner/register">Register property</a>
      </div>
    </main>
  );
}
