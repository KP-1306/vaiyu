// web/src/routes/OwnerHome.tsx
import { memo, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import { useRole } from "../context/RoleContext";
import OwnerDigestCard from "../components/OwnerDigestCard";
import { OwnerLangToggle } from "../i18n/OwnerLangToggle";
import UsageMeter from "../components/UsageMeter";
import ObservabilityCard from "../components/ObservabilityCard";
import { useOwnerT } from "../i18n/useOwnerT";

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
  const t = useOwnerT("owner-home");

  // Role context (you created this)
  const { current } = useRole(); // { role: 'guest'|'staff'|'manager'|'owner', hotelSlug?: string|null }

  // Resolve slug: route param > role context > ?slug > fallback
  const initialSlug =
    slugParam || current.hotelSlug || sp.get("slug") || "demo";

  const [slug, setSlug] = useState<string>(initialSlug);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState<any>(null);

  // Always keep a non-empty slug for links/API
  const resolvedSlug = slug || "demo";

  // Keep ?slug in the URL for refresh/share
  useEffect(() => {
    const next = new URLSearchParams(sp);
    next.set("slug", resolvedSlug);
    setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSlug]);

  // Hydrate auth user (lightweight, with proper cleanup)
  useEffect(() => {
    let mounted = true;

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_evt, sess) => {
        if (!mounted) return;
        setAuthUser(sess?.user ?? null);
      }
    );

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setAuthUser(data?.user ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthUser(null);
      });

    return () => {
      mounted = false;
      try {
        authListener?.subscription?.unsubscribe();
      } catch {
        // ignore
      }
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
    const activeSlug = resolvedSlug;

    (async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `${API}/owner/peek/${encodeURIComponent(activeSlug)}`
        );
        if (alive && r.ok) {
          setPeek(await r.json());
        } else if (alive) {
          setPeek(demoPeek(activeSlug));
        }
      } catch {
        if (alive) setPeek(demoPeek(activeSlug));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [resolvedSlug]);

  if (!allowed) {
    return (
      <main className="max-w-xl mx-auto p-8 text-center space-y-3">
        <h1 className="text-xl font-semibold">{t("noAccess.heading", "No access")}</h1>
        <p className="opacity-70">
          {t("noAccess.body", "You need owner/manager permissions to view this page.")}
        </p>
        <a className="btn btn-light" href="/contact">
          {t("noAccess.requestAccess", "Request access")}
        </a>
      </main>
    );
  }

  const gridMode = peek?.grid?.mode ?? "—";

  return (
    <main
      className="max-w-6xl mx-auto p-4 space-y-4"
      aria-labelledby="owner-home-title"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 id="owner-home-title" className="text-xl font-semibold">
            {t("title", "Owner Console")}
          </h1>
          <div className="text-sm text-gray-600">
            {peek?.hotel?.name ?? resolvedSlug}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OwnerLangToggle />
          <input
            className="input"
            placeholder={t("header.slugPlaceholder", "Hotel slug")}
            aria-label={t("header.slugPlaceholder", "Hotel slug")}
            value={slug}
            onChange={(e) => setSlug(e.target.value.trim())}
            style={{ width: 160 }}
          />
          <Link
            to={`/owner/settings?slug=${encodeURIComponent(resolvedSlug)}`}
            className="btn btn-light"
          >
            {t("header.settings", "Settings")}
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
            aria-label={t("sections.digest", "Digest and usage")}
          >
            <OwnerDigestCard
              slug={resolvedSlug}
              apiBase={API}
              className="mb-2"
            />
            <UsageMeter />
          </section>

          {/* KPI glance */}
          <section
            className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3"
            aria-label={t("sections.kpis", "Key performance indicators")}
          >
            <Kpi title={t("kpi.tickets", "Tickets")} value={peek?.kpis?.tickets ?? "—"} />
            <Kpi title={t("kpi.orders", "Orders")} value={peek?.kpis?.orders ?? "—"} />
            <Kpi title={t("kpi.onTime", "On-time")} value={peek?.kpis?.onTime ?? "—"} />
            <Kpi title={t("kpi.late", "Late")} value={peek?.kpis?.late ?? "—"} />
            <Kpi title={t("kpi.avgMins", "Avg mins")} value={peek?.kpis?.avgMins ?? "—"} />
          </section>

          {/* Quick links */}
          <section
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-3"
            aria-label={t("sections.quickLinks", "Quick links")}
          >
            <Tile
              title={t("tiles.dashboard.title", "Dashboard & KPIs")}
              text={t("tiles.dashboard.text", "Trends, SLA hints, exports.")}
              to={`/owner/${encodeURIComponent(resolvedSlug)}`}
              emoji="📈"
              cta={t("tiles.dashboard.cta", "Open dashboard")}
            />
            <Tile
              title={t("tiles.reviews.title", "AI review moderation")}
              text={t("tiles.reviews.text", "Truth-anchored drafts, owner-approved.")}
              to={`/owner/reviews?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="📝"
              cta={t("tiles.reviews.cta", "Review drafts")}
            />
            <Tile
              title={t("tiles.reputation.title", "Reputation Radar")}
              text={t("tiles.reputation.text", "Correlate tickets, stays & reviews. Flag suspicious patterns early.")}
              to={`/owner/${encodeURIComponent(resolvedSlug)}/reputation`}
              emoji="🛡️"
              cta={t("tiles.reputation.cta", "Open radar")}
            />
            <Tile
              title={t("tiles.gridDevices.title", "Grid: Devices")}
              text={t("tiles.gridDevices.text", "Mode: {{mode}}. One-tap Shed/Restore in manual.", { mode: gridMode })}
              to={`/grid/devices?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="⚡"
              cta={t("tiles.gridDevices.cta", "Manage devices")}
            />
            <Tile
              title={t("tiles.gridEvents.title", "Grid: Events")}
              text={t("tiles.gridEvents.text", "Timeline, savings estimate, CSV.")}
              to={`/grid/events?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="📊"
              cta={t("tiles.gridEvents.cta", "View events")}
            />
            <Tile
              title={t("tiles.housekeeping.title", "Housekeeping")}
              text={t("tiles.housekeeping.text", "Enterprise-grade room status & task management.")}
              to={`/owner/${encodeURIComponent(resolvedSlug)}/housekeeping`}
              emoji="🧹"
              cta={t("tiles.housekeeping.cta", "Open board")}
            />
            <Tile
              title={t("tiles.frontDesk.title", "Front Desk")}
              text={t("tiles.frontDesk.text", "Requests, SLAs, routing.")}
              to={`/desk?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="🛎️"
              cta={t("tiles.frontDesk.cta", "Open desk")}
            />
            <Tile
              title={t("tiles.services.title", "Services (SLA)")}
              text={t("tiles.services.text", "Edit labels, SLA minutes, active.")}
              to={`/owner/services?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="🧩"
              cta={t("tiles.services.cta", "Open services")}
            />
            <Tile
              title={t("tiles.guestProfiles.title", "Guest profiles")}
              text={t("tiles.guestProfiles.text", "Unified timeline of stays, tickets, orders, reviews & credits (demo guest).")}
              to={`/owner/guest/demo-guest?slug=${encodeURIComponent(resolvedSlug)}`}
              emoji="👤"
              cta={t("tiles.guestProfiles.cta", "Open demo guest")}
            />
          </section>

          {/* Coming soon */}
          <section className="card" aria-label={t("sections.comingSoon", "Coming soon")}>
            <div className="font-semibold mb-1">{t("sections.comingSoon", "Coming soon")}</div>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>{t("comingSoon.bookingsPeek", "Bookings & revenue peek (PMS sync)")}</li>
              <li>{t("comingSoon.staffKpis", "Staff KPIs & attendance hooks")}</li>
              <li>{t("comingSoon.energyReports", "Energy & cost reports (time-of-day tariffs)")}</li>
              <li>{t("comingSoon.ownerApp", "Owner app & alerts")}</li>
            </ul>
          </section>

          {loading && (
            <div role="status" aria-live="polite">
              {t("loading", "Loading…")}
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
  const safeSlug = slug || "demo";
  return {
    hotel: {
      slug: safeSlug,
      name: safeSlug[0]?.toUpperCase() + safeSlug.slice(1),
    },
    kpis: { tickets: 42, orders: 19, onTime: 36, late: 6, avgMins: 12 },
    grid: { mode: "manual", lastEventAt: null },
  };
}
