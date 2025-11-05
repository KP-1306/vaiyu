// web/src/components/BackHome.tsx
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Never show on these */
const HIDE_PREFIXES = ["/", "/signin", "/auth/callback"];

/** Area prefixes (exact or as prefix/) */
const OWNER_PREFIXES = ["/owner", "/desk", "/hk", "/maint", "/grid", "/admin"];
const GUEST_PREFIXES = ["/guest", "/stay", "/menu", "/precheck", "/regcard", "/bill", "/requestTracker"];

/** Helpers */
function startsWithAny(path: string, list: string[]) {
  return list.some((p) => path === p || path.startsWith(p + "/"));
}

type Props = {
  /** Force a destination. If omitted, we auto-decide. */
  to?: string;
  label?: string;
  className?: string;
};

export default function BackHome({ to, label = "← Back home", className = "" }: Props) {
  const { pathname } = useLocation();

  // Hide on public/auth pages
  if (startsWithAny(pathname, HIDE_PREFIXES)) return null;

  // Show only for known in-app surfaces
  const isOwnerArea = startsWithAny(pathname, OWNER_PREFIXES);
  const isGuestArea = startsWithAny(pathname, GUEST_PREFIXES);
  if (!isOwnerArea && !isGuestArea) return null;

  // Resolve destination
  const [autoTo, setAutoTo] = useState<string>(to || "/");
  const shouldAuto = useMemo(() => !to, [to]);

  useEffect(() => {
    if (!shouldAuto) {
      setAutoTo(to!);
      return;
    }

    // Prefer context from URL (fast, no network)
    if (isOwnerArea) {
      setAutoTo("/owner");
      return;
    }
    if (isGuestArea) {
      setAutoTo("/guest");
      return;
    }

    // Fallback (rare): decide via auth + membership (RLS will scope)
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;
        if (!user) {
          if (!cancelled) setAutoTo("/");
          return;
        }
        const { data: memRows, error } = await supabase
          .from("hotel_members")
          .select("id")
          .limit(1);

        if (error) {
          if (!cancelled) setAutoTo("/guest");
          return;
        }
        const hasMembership = (memRows?.length || 0) > 0;
        if (!cancelled) setAutoTo(hasMembership ? "/owner" : "/guest");
      } catch {
        if (!cancelled) setAutoTo("/guest");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldAuto, to, isOwnerArea, isGuestArea]);

  return (
    // Ensure the pill is always clickable and above other UI
    <div className="fixed left-3 top-3 z-50 pointer-events-none">
      <NavLink
        to={autoTo}
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white ${className}`}
        aria-label={label}
      >
        {label}
      </NavLink>
    </div>
  );
}
