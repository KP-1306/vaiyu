// web/src/components/BackHome.tsx
import { NavLink, useLocation } from "react-router-dom";

const APP_PREFIXES = [
  "/guest", "/owner", "/desk", "/hk", "/maint", "/grid",
  "/stay", "/menu", "/precheck", "/regcard", "/bill", "/admin",
];

// Pages where the pill should not be shown
const HIDE_PREFIXES = ["/", "/signin", "/auth/callback"];

function startsWithAny(path: string, list: string[]) {
  // exact match or "prefix + /..."
  return list.some(p => path === p || path.startsWith(p + "/"));
}

export default function BackHome() {
  const { pathname } = useLocation();

  // Never show on home/auth
  if (startsWithAny(pathname, HIDE_PREFIXES)) return null;

  // Only show on real in-app surfaces
  const isApp = startsWithAny(pathname, APP_PREFIXES);
  if (!isApp) return null;

  // Always go to the public landing (/)
  return (
    <div className="fixed left-3 top-3 z-40">
      <NavLink
        to="/"
        className="inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white"
        aria-label="Go to home"
      >
        ← Back home
      </NavLink>
    </div>
  );
}
