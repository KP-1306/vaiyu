// web/src/components/BackHome.tsx
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Show this pill ONLY on marketing pages.
 * - Hide on all in-app surfaces (guest/owner/desk/hk/maint/grid/profile/etc.)
 * - Hide when the URL contains ?app=1 (marketing page opened as "app shell")
 * - Never show on auth utility routes.
 */

const MARKETING_ROUTES = new Set<string>([
  "/", "/about", "/about-ai", "/press", "/privacy", "/terms",
  "/status", "/contact", "/careers"
]);

const APP_PREFIXES = [
  "/guest", "/owner", "/desk", "/hk", "/maint", "/grid",
  "/profile", "/hotel", "/menu", "/stay", "/bill",
  "/precheck", "/regcard", "/checkout", "/admin"
];

const AUTH_UTILITY = ["/signin", "/auth/callback", "/welcome"];

export default function BackHome() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  // If any app prefix matches, we are in the app → hide
  const onApp = APP_PREFIXES.some((p) => pathname.startsWith(p));
  if (onApp) return null;

  // Hide on auth utility pages
  if (AUTH_UTILITY.includes(pathname)) return null;

  // If marketing opened as app (?app=1), hide
  const sp = new URLSearchParams(search);
  const forcedApp = sp.get("app") === "1";
  if (forcedApp) return null;

  // Show only on the specific marketing routes we consider “home-like”
  const show = MARKETING_ROUTES.has(pathname);
  if (!show) return null;

  return (
    <div className="fixed left-3 top-3 z-40">
      <button
        className="btn btn-light"
        onClick={() => {
          // Prefer actual back if available; otherwise go to landing
          if (window.history.length > 1) navigate(-1);
          else navigate("/");
        }}
        aria-label="Back to home"
      >
        ← Back home
      </button>
    </div>
  );
}
