// web/src/components/BackHome.tsx
import { useLocation, useNavigate } from "react-router-dom";

const APP_PREFIXES = [
  "/guest", "/owner", "/desk", "/hk", "/maint", "/grid",
  "/stay", "/menu", "/precheck", "/regcard", "/bill", "/admin",
];

const HIDE_PREFIXES = ["/", "/signin", "/auth/callback", "/welcome"];

function startsWithAny(path: string, list: string[]) {
  // exact match or "prefix + /..."
  return list.some(p => path === p || path.startsWith(p + "/"));
}

export default function BackHome() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // never show on marketing/auth
  if (pathname === "/" || startsWithAny(pathname, HIDE_PREFIXES)) return null;

  // only show on real in-app surfaces
  const isApp = startsWithAny(pathname, APP_PREFIXES);
  if (!isApp) return null;

  return (
    <div className="p-2">
      <button
        className="btn btn-light"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/guest"); // safe default
        }}
      >
        ← Back home
      </button>
    </div>
  );
}
