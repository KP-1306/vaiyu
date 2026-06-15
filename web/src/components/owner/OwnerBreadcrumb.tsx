// web/src/components/owner/OwnerBreadcrumb.tsx
// Global breadcrumb strip for owner-dashboard CHILD pages. Mounted once in
// RootLayout. Renders only on /owner/:slug/<sub> routes, and NOT on:
//   • the dashboard root (/owner/:slug) — it has its own breadcrumb,
//   • /owner, /owner/services, /owner/register — no hotel slug,
//   • finance/*, pricing/*, workforce — those pages render OwnerDarkPage's own
//     breadcrumbs (avoid duplicates).
// The current page label is auto-derived from the OWNER_NAV manifest.

import { Link, useLocation } from "react-router-dom";
import { OWNER_NAV } from "../../lib/ownerNav";

// Subpaths whose pages already render their own (OwnerDarkPage) breadcrumbs.
const SELF_BREADCRUMB = /^(finance|pricing|workforce)(\/|$)/;

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
      current = it.label;
      bestLen = to.length;
    }
  }

  return (
    <div className="w-full border-b border-white/[0.05] bg-black/30 px-4 sm:px-6 py-2 backdrop-blur-sm">
      <nav
        aria-label="Breadcrumb"
        className="mx-auto flex max-w-[1400px] items-center gap-2 text-[11px] font-medium text-slate-400"
      >
        <Link to="/owner" className="hover:text-indigo-300 transition-colors">Console</Link>
        <span className="text-slate-600">/</span>
        <Link to={`/owner/${slug}`} className="hover:text-indigo-300 transition-colors">Dashboard</Link>
        {current && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-slate-200">{current}</span>
          </>
        )}
      </nav>
    </div>
  );
}
