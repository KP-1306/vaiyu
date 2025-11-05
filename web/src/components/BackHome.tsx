// web/src/components/BackHome.tsx
import { useEffect, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";

/** Hide on public/auth pages */
const HIDE_PREFIXES = ["/", "/signin", "/auth/callback"];

/** In-app surfaces (exact or prefix/) */
const APP_PREFIXES = [
  "/guest",
  "/owner",
  "/desk",
  "/hk",
  "/maint",
  "/grid",
  "/stay",
  "/menu",
  "/precheck",
  "/regcard",
  "/bill",
  "/admin",
  "/requestTracker",
];

function startsWithAny(path: string, list: string[]) {
  return list.some((p) => path === p || path.startsWith(p + "/"));
}

type Props = {
  /** Force a destination. Default = "/" (public landing) */
  to?: string;
  label?: string;
  className?: string;
};

export default function BackHome({
  to = "/",
  label = "← Back home",
  className = "",
}: Props) {
  const { pathname } = useLocation();

  // Hide on public/auth and on non-app surfaces
  const hide = useMemo(() => {
    if (startsWithAny(pathname, HIDE_PREFIXES)) return true;
    return !startsWithAny(pathname, APP_PREFIXES);
  }, [pathname]);

  // If hidden, render nothing
  if (hide) return null;

  // Ensure a <div id="backhome-portal"/> exists (once)
  useEffect(() => {
    let host = document.getElementById("backhome-portal");
    if (!host) {
      host = document.createElement("div");
      host.id = "backhome-portal";
      document.body.appendChild(host);
    }
    return () => {
      // keep the host for subsequent pages; don’t remove on unmount
    };
  }, []);

  const host = document.getElementById("backhome-portal");
  if (!host) return null;

  // Render via portal to escape any stacking/overlay issues
  return createPortal(
    <div
      // no pointer-events suppression; sit on top of everything
      className="fixed left-3 top-3 z-[9999]"
      style={{ pointerEvents: "auto" }}
    >
      <NavLink
        to={to}
        className={
          "inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 " +
          className
        }
        aria-label={label}
      >
        {label}
      </NavLink>
    </div>,
    host
  );
}
