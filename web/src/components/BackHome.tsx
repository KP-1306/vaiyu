// web/src/components/BackHome.tsx
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Only show the back button on actual in-app surfaces.
 * Do NOT show on marketing pages, /signin, or /welcome.
 */
const SHOW_PREFIXES = [
  "/owner", "/desk", "/hk", "/maint", "/grid",
  "/guest", "/stay", "/menu", "/precheck", "/regcard", "/bill", "/admin"
];

export default function BackHome() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const show = SHOW_PREFIXES.some((p) => pathname.startsWith(p));
  if (!show) return null;

  return (
    <div className="p-2">
      <button
        className="btn btn-light"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/welcome");     // safe default if no history
        }}
      >
        ← Back to app
      </button>
    </div>
  );
}
