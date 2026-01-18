// web/src/components/BackHome.tsx
//
// Smart "Back" pill used across the app.
//
// OWNER area ladder:
//   /owner/TENANT1/workforce → /owner/TENANT1
//   /owner/TENANT1          → /owner
//   /owner                  → /
//
// OPS view (property-aware):
//   /ops?hotelId=TENANT1    → /owner/TENANT1
//   /ops?hotelId=<uuid>     → /owner/<slug mapped from uuid>
//   (falls back to /owner if lookup fails)
//
// Guest-lens surfaces:
//   /guest*                → /
//   /stays, /stay/*        → /guest   (guest dashboard)
//
// Other behaviour unchanged:
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
const HIDE_PREFIXES = ["/", "/signin", "/auth/callback", "/ops"];

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
    let cancelled = false;

    async function decide() {
      // ---------- Path-specific overrides (no Supabase round-trip) ----------

      // Careers page → always back to public landing.
      if (pathname === "/careers") {
        if (!cancelled) setAutoTo("/");
        return;
      }

      // OWNER AREA: three-step ladder
      if (segments[0] === "owner") {
        // /owner
        if (segments.length === 1) {
          if (!cancelled) setAutoTo("/");
          return;
        }

        // /owner/:slug  (hotel dashboard) → Owner console
        if (segments.length === 2) {
          if (!cancelled) setAutoTo("/owner");
          return;
        }

        // /owner/:slug/anything...  (hotel sub-page) → hotel dashboard
        // e.g. /owner/TENANT1/workforce → /owner/TENANT1
        if (!cancelled) setAutoTo(`/owner/${segments[1]}`);
        return;
      }

      // OPS AREA: if slug or hotelId is present, try to go back to that hotel's dashboard.
      // Handles both slug and UUID id.
      if (segments[0] === "ops") {
        try {
          const params = new URLSearchParams(search);
          // Check slug first (new pattern), then fall back to hotelId (legacy)
          const slugParam = params.get("slug");
          const hotelId =
            slugParam ||
            params.get("hotelId") ||
            params.get("hotel") ||
            params.get("propertyId");

          if (!hotelId) {
            // No context → fall back to Owner console.
            if (!cancelled) setAutoTo("/owner");
            return;
          }

          let slug: string | null = null;

          // 1) Treat hotelId as slug
          const { data: bySlug } = await supabase
            .from("hotels")
            .select("slug")
            .eq("slug", hotelId)
            .limit(1);

          if (bySlug && bySlug.length > 0 && bySlug[0]?.slug) {
            slug = bySlug[0].slug as string;
          } else {
            // 2) Treat hotelId as UUID id, map to slug
            const { data: byId } = await supabase
              .from("hotels")
              .select("slug")
              .eq("id", hotelId)
              .limit(1);

            if (byId && byId.length > 0 && byId[0]?.slug) {
              slug = byId[0].slug as string;
            }
          }

          if (!cancelled) {
            if (slug) {
              // /ops?hotelId=TENANT1 or UUID → /owner/TENANT1
              setAutoTo(`/owner/${slug}`);
            } else {
              // Lookup failed → go to Owner console
              setAutoTo("/owner");
            }
          }
        } catch {
          if (!cancelled) setAutoTo("/owner");
        }
        return;
      }

      // GUEST AREA root: /guest → public landing
      if (segments[0] === "guest") {
        if (!cancelled) setAutoTo("/");
        return;
      }

      // STAYS / STAY detail pages (guest lens)
      // /stays and /stay/:id should always return to guest dashboard,
      // regardless of whether the logged-in user also has owner access.
      if (segments[0] === "stays" || segments[0] === "stay") {
        if (!cancelled) setAutoTo("/guest");
        return;
      }

      // ---------- Generic fallback: use auth + membership ----------
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

        if (!cancelled) {
          setAutoTo(hasOwnerRole ? "/owner" : "/guest");
        }
      } catch {
        if (!cancelled) setAutoTo("/guest");
      }
    }

    void decide();

    return () => {
      cancelled = true;
    };
  }, [shouldAuto, forcedTo, pathname, search]);

  // --- Decide visibility after hooks have run ---
  const hide = startsWithAny(pathname, HIDE_PREFIXES) || pathname.endsWith("/staff-shifts") || pathname === "/owner/services";
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
