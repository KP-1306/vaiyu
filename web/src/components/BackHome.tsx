// web/src/components/BackHome.tsx
import { useLocation, useNavigate } from "react-router-dom";

const HIDE_PATHS = new Set([
  "/", "/about", "/about-ai", "/use-cases", "/for-hotels", "/press",
  "/privacy", "/terms", "/contact", "/careers", "/status", "/thanks",
  "/signin", "/welcome",
]);

export default function BackHome() {
  const loc = useLocation();
  const navigate = useNavigate();

  // Hide on marketing/public pages
  const path = loc.pathname.toLowerCase();
  if (HIDE_PATHS.has(path) || path.startsWith("/hotel/")) return null;

  return (
    <div className="p-2">
      <button
        className="btn btn-light"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/welcome"); // safe default
        }}
      >
        ← Back to app
      </button>
    </div>
  );
}
