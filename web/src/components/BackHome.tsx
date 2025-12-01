// web/src/components/BackHome.tsx
//
// Smart "Back" pill used across the app.
//
// Behaviour:
// - Hides itself on auth/landing pages.
// - If used as <BackHome /> (no `to` prop):
//     • On detail/inner pages (e.g. /owner/<slug>/settings, /desk/..., /ops/...)
//       AND when the user has already navigated within VAiyu in this session,
//       it prefers a real history back (navigate(-1)) so you return to the
//       previous screen (e.g. hotel dashboard → workforce → back → hotel dashboard).
//     • Otherwise it falls back to your existing logic:
//       - /owner/* → /owner
//       - /guest* → /
//       - other surfaces → role-based /owner or /guest via Supabase.
// - If used as <BackHome to="/somewhere">, it ALWAYS goes to `to`.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // If caller passes `to`, we always respect it (no smart history).
  const forcedTo = to ?? null;

  const [autoTo, setAutoTo] = useState<string>(forcedTo ?? "/");

  // Tracks whether we have at least one *internal* navigation in this SPA
  // session. Once true, we know navigate(-1) will stay within VAiyu.
  const [canHistoryBack, setCanHistoryBack] = useState(false);
  const previousPathRef = useRef<string | null>(null);

  const shouldAuto = useMemo(() => forcedTo == null, [forcedTo]);

  // Record previous pathname to decide if we can safely use navigate(-1)
  useEffect(() => {
    if (
      previousPathRef.current &&
      previousPathRef.current !== pathname
    ) {
      // We have seen at least one in-app route change
      setCanHistoryBack(true);
    }
    previousPathRef.current = pathname;
  }, [pathname]);

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

    // 1) Owner detail pages (/owner/DEMO1, /owner/DEMO1/settings, etc.)
    //    → default "home" is the Owner console (/owner).
    //    (Smart history will still take you to the previous page when possible.)
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

  // Final destination if we DON'T use history.back()
  const dest = forcedTo ?? autoTo;

  // We only want smart "previous page" behaviour on nested/inner screens,
  // not on root paths like "/" or "/owner" or "/guest".
  const isDetailPage =
    pathname.startsWith("/owner/") ||
    pathname.startsWith("/desk") ||
    pathname.startsWith("/hk") ||
    pathname.startsWith("/maint") ||
    pathname.startsWith("/grid") ||
    pathname.startsWith("/ops") ||
    pathname.startsWith("/stay") ||
    pathname.startsWith("/menu") ||
    pathname.startsWith("/precheck") ||
    pathname.startsWith("/regcard") ||
    pathname.startsWith("/bill");

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    const hasExplicitTo = !!forcedTo;

    const shouldUseHistory =
      !hasExplicitTo && canHistoryBack && isDetailPage;

    if (shouldUseHistory) {
      e.preventDefault();
      navigate(-1);
    }
    // otherwise, let NavLink navigate to `dest` as usual.
  }

  return (
    <div className="fixed left-3 top-3 z-40">
      <NavLink
        to={dest}
        onClick={handleClick}
        className={`inline-flex items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 text-sm shadow hover:bg-white ${className}`}
        aria-label={label}
      >
        {label}
      </NavLink>
    </div>
  );
}
