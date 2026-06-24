// web/src/components/owner/OwnerBreadcrumb.tsx
// Global breadcrumb strip for owner-dashboard CHILD pages. Mounted once in
// RootLayout. Renders only on /owner/:slug/<sub> routes, and NOT on:
//   • the dashboard root (/owner/:slug) — it has its own breadcrumb,
//   • /owner, /owner/services, /owner/register — no hotel slug,
//   • finance/*, pricing/*, workforce, staff-shifts, analytics, settings,
//     payments — those pages render their OWN "Dashboard / …" breadcrumb header,
//     so the global strip is suppressed to avoid duplicates.
// The current page label is auto-derived from the OWNER_NAV manifest.

import { Link, useLocation } from "react-router-dom";
import { OWNER_NAV } from "../../lib/ownerNav";
import { useOwnerT } from "../../i18n/useOwnerT";

// Subpaths whose pages render their own breadcrumbs (OwnerDarkPage pages; the
// booking detail page renders its own "… / Booking <code>"; and several owner
// pages that render an inline "Dashboard / <Page>" header). Pages NOT listed here
// (e.g. housekeeping, arrivals) have no own breadcrumb and rely on this strip —
// do not add a page here unless it renders its own breadcrumb.
const SELF_BREADCRUMB = /^(finance|pricing|workforce|booking|staff-shifts|analytics|settings|payments)(\/|$)/;

// First-segment words that are NOT hotel slugs — they're literal owner routes
// (e.g. /owner/bookings/calendar, /owner/dashboard/:slug, /owner/invite/accept/:token).
// Without this guard the regex below would treat them as a slug and render a
// broken breadcrumb (wrong Dashboard link, no label). These pages either have no
// hotel context in the URL or are legacy aliases, so they get no global strip.
const RESERVED_SLUGS = new Set([
  "bookings", "dashboard", "invite", "services", "register", "home", "access", "onboard",
]);

export default function OwnerBreadcrumb() {
  const { pathname } = useLocation();
  const t = useOwnerT("owner-cards");
  const tNav = useOwnerT("owner-common");

  // Match an owner child page: /owner/<slug>/<sub...>
  const m = pathname.match(/^\/owner\/([^/]+)\/(.+)$/);
  if (!m) return null; // /owner or /owner/:slug (dashboard) → no strip
  const slug = m[1];
  const sub = m[2];
  if (RESERVED_SLUGS.has(slug)) return null;
  if (SELF_BREADCRUMB.test(sub)) return null;

  // Current page label: longest OWNER_NAV destination that prefixes the path.
  let current = "";
  let bestLen = -1;
  for (const it of OWNER_NAV) {
    if (it.id === "dashboard") continue;
    const to = it.to(slug);
    if ((pathname === to || pathname.startsWith(to + "/")) && to.length > bestLen) {
      current = tNav(`nav.${it.id}`, it.label);
      bestLen = to.length;
    }
  }

  return (
    // Solid dark bar (NOT translucent): the strip sits above each page's own
    // background in RootLayout, so a `bg-black/30` overlay rendered light-grey on
    // the body and washed out the text. Solid dark + light text = readable on
    // every owner page.
    <div className="w-full border-b border-white/10 bg-[#0f1113] px-4 sm:px-6 py-2.5">
      <nav
        aria-label={t("breadcrumb.ariaLabel", "Breadcrumb")}
        className="mx-auto flex max-w-[1400px] items-center gap-2 text-xs font-medium"
      >
        <Link to="/owner" className="text-slate-400 hover:text-white transition-colors">{t("breadcrumb.console", "Console")}</Link>
        <span className="text-slate-600">/</span>
        <Link to={`/owner/${slug}`} className="text-slate-400 hover:text-white transition-colors">{t("breadcrumb.dashboard", "Dashboard")}</Link>
        {current && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-slate-100 font-semibold">{current}</span>
          </>
        )}
      </nav>
    </div>
  );
}
