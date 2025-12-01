// web/src/components/BackHome.tsx
//
// Smart "Back" pill used across the app.
//
// OWNER area ladder:
//   /owner/TENANT1/workforce → /owner/TENANT1
//   /owner/TENANT1          → /owner
//   /owner                  → /
//
// OPS view fix (owner flow):
//   /ops?hotelId=TENANT1    → /owner/TENANT1
//
// Other behaviour unchanged:
//   /guest* → /
//   other surfaces → role-based /owner or /guest via Supabase.
//   If used as <BackHome to="/somewhere">, it ALWAYS goes to `to`.

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
  "/ops",
  "/careers", // show Back pill on careers page too
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
  const { pathname, search } = useLocation();

  // If caller passes `to`, we always respect it.
  const forcedTo = to ?? null;

  const [autoTo, setAutoTo] = useState<string>(forcedTo ?? "/");
  const shouldAuto = useMemo(() => forcedTo == null, [forcedTo]);

  useEffect(() => {
    // If the caller explicitly passed a `to`, always respect that.
    if (!shouldAuto && forcedTo) {
      setAutoTo(forcedTo);
      return;
    }

    const segments = pathname.split("/").filter(Boolean); // e.g. ["owner","TENANT1","workforce"]

    // ---------- Path-specific overrides (no Supabase round-trip) ----------

    // Careers page → always back to public landing.
    if (pathname === "/careers") {
      setAutoTo("/");
      return;
    }

    // OWNER AREA: three-step ladder
    if (segments[0] === "owner") {
      // /owner
      if (segments.length === 1) {
        setAutoTo("/");
        return;
      }

      // /owner/:slug  (hotel dashboard) → Owner console
      if (segments.length === 2) {
        setAutoTo("/owner");
        return;
      }

      // /owner/:slug/anything...  (hotel sub-page) → hotel dashboard
      // e.g. /owner/TENANT1/workforce → /owner/TENANT1
      setAutoTo(`/owner/${segments[1]}`);
      return;
    }

    // OPS AREA: if hotelId is present, go back to that hotel's dashboard.
    // Example: /ops?hotelId=TENANT1 → /owner/TENANT1
    if (segments[0] === "ops") {
      const params = new URLSearchParams(search);
      const hotelId =
        params.get("hotelId") ||
        params.get("hotel") ||
        params.get("propertyId");

      if (hotelId) {
        setAutoTo(`/owner/${hotelId}`);
        return;
      }
      // If no hotelId, fall through to generic logic below.
    }

    // GUEST AREA: always back to landing
    if (segments[0] === "guest") {
      setAutoTo("/");
      return;
    }

    // ---------- Generic fallback: use auth + membership ----------

    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;

        if (!user) {
          if (!cancelled) setAutoTo("/");
          return;
        }

        // Membership check (best-effort; RLS errors → /guest)
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
  }, [shouldAuto, forcedTo, pathname, search]);

  // --- Decide visibility after hooks have run ---
  const hide = startsWithAny(pathname, HIDE_PREFIXES);
  const isAppSurface = startsWithAny(pathname, APP_PREFIXES);
  if (hide || !isAppSurface) return null;

  const dest = forcedTo ?? autoTo;

  return (
    <div className="fixed left-3 top-3 z-40">
      <NavLink
        to={dest}
        className={`inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white ${className}`}
        aria-label={label}
      >
        {label}
      </NavLink>
    </div>
  );
}
