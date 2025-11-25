// web/src/components/BackHome.tsx
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Surfaces where the pill is relevant (matches exact or as prefix/) */
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
  "/careers", // NEW: show Back home on careers page too
];

/** Pages where the pill should not be shown */
const HIDE_PREFIXES = ["/", "/signin", "/auth/callback"];

function startsWithAny(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

type Props = {
  /** Force a destination. If omitted, we auto-decide. */
  to?: string;
  label?: string;
  className?: string;
};

export default function BackHome({
  to,
  label = "← Back home",
  className = "",
}: Props) {
  const { pathname } = useLocation();

  // --- Hooks first (no early returns before hooks) ---
  const forcedTo = to ?? null;
  const [autoTo, setAutoTo] = useState<string>(forcedTo ?? "/");
  const shouldAuto = useMemo(() => forcedTo == null, [forcedTo]);

  useEffect(() => {
    // If the caller explicitly passed a `to`, always respect that.
    if (!shouldAuto && forcedTo) {
      setAutoTo(forcedTo);
      return;
    }

    // ---------- Path-specific overrides (no Supabase round-trip) ----------

    // 0) Careers page → always back to public landing.
    if (pathname === "/careers") {
      setAutoTo("/");
      return;
    }

    // 1) Owner detail pages (/owner/DEMO1, /owner/settings, etc.)
    //    → go back to the Owner console (/owner).
    if (pathname.startsWith("/owner/")) {
      setAutoTo("/owner");
      return;
    }

    // 2) Owner console root (/owner) → go to public landing.
    if (pathname === "/owner") {
      setAutoTo("/");
      return;
    }

    // 3) Any guest area (/guest, /guest/trips, …) → go to public landing.
    if (pathname.startsWith("/guest")) {
      setAutoTo("/");
      return;
    }

    // ---------- Generic fallback: use auth + membership ----------

    let cancelled = false;

    (async () => {
      try {
        // 1) Auth state
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;

        if (!user) {
          if (!cancelled) setAutoTo("/");
          return;
        }

        // 2) Membership check (best-effort; RLS errors → /guest)
        const { data: memRows, error } = await supabase
          .from("hotel_members")
          .select("role")
          .limit(1);

        if (error) {
          if (!cancelled) setAutoTo("/guest");
          return;
        }

        const hasOwnerRole = (memRows || []).some(
          (m: any) => m.role === "owner" || m.role === "manager",
        );

        if (!cancelled) setAutoTo(hasOwnerRole ? "/owner" : "/guest");
      } catch {
        if (!cancelled) setAutoTo("/guest");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldAuto, forcedTo, pathname]);

  // --- Decide visibility after hooks have run ---
  const hide = startsWithAny(pathname, HIDE_PREFIXES);
  const isAppSurface = startsWithAny(pathname, APP_PREFIXES);
  if (hide || !isAppSurface) return null;

  return (
    <div className="fixed left-3 top-3 z-40">
      <NavLink
        to={autoTo}
        className={`inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white ${className}`}
        aria-label={label}
      >
        {label}
      </NavLink>
    </div>
  );
}
