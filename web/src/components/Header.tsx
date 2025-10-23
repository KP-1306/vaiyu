import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";

/**
 * Header: marketing nav + account avatar only
 * - No "Owner console" pill anywhere
 * - Friendly welcome bar on the home page when signed in
 * - "AI" and "Use-cases" link to in-page sections on "/"
 */
export default function Header() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load user once and react to auth changes (no flicker)
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getUser();
        if (!alive) return;
        setUserEmail(data?.user?.email ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserEmail(session?.user?.email ?? null);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Smooth-scroll helper for in-page sections on "/"
  const scrollToId = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(id) as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const onHashNav = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, section: "#ai" | "#use-cases") => {
      e.preventDefault();
      if (pathname !== "/") {
        // navigate home with hash; MarketingHome will scroll on mount
        navigate(`/${section}`);
      } else {
        // already on home; just update hash & scroll
        if (window.location.hash !== section) window.history.replaceState(null, "", section);
        scrollToId(section);
      }
    },
    [navigate, pathname, scrollToId]
  );

  // When landing on "/" with a hash, scroll to it
  useEffect(() => {
    if (pathname === "/" && (hash === "#ai" || hash === "#use-cases")) {
      scrollToId(hash);
    }
  }, [pathname, hash, scrollToId]);

  const displayName = userEmail ? userEmail.split("@")[0] : null;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="font-semibold">
            <span className="inline-flex items-center gap-2">
              <img src="/logo.svg" alt="VAiyu" className="h-6 w-6" />
              VAiyu
            </span>
        </Link>

        {/* Primary nav (marketing) */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <a href="/#use-cases" onClick={(e) => onHashNav(e, "#use-cases")}>Why VAiyu</a>
          <a href="/#ai"        onClick={(e) => onHashNav(e, "#ai")}>AI</a>
          <a href="/#use-cases" onClick={(e) => onHashNav(e, "#use-cases")}>Use-cases</a>
          <Link to="/about">About</Link>
        </nav>

        {/* Right: avatar or Sign in — NO "Owner console" pills */}
        <div className="ml-auto flex items-center gap-2">
          {loading ? null : userEmail ? (
            <AccountControls className="ml-1" displayName={displayName ?? "Account"} />
          ) : (
            <Link
              to="/signin?intent=signin&redirect=/guest"
              className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Friendly welcome bar only on home */}
      {pathname === "/" && displayName && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          Welcome back, <strong>{displayName}</strong> — great to see you! 🎉
        </div>
      )}
    </header>
  );
}
