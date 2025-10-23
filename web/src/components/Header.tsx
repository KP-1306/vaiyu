// web/src/components/Header.tsx
import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";

export default function Header() {
  const { pathname } = useLocation();

  // Helper: when we're already on "/", just change the hash.
  // When we're on another page, route to "/" with the hash.
  const toHomeHash = (hash: string) =>
    pathname === "/" ? { hash } : { pathname: "/", hash };

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null } as any }));
      if (!alive) return;
      setUserEmail(data?.user?.email ?? null);
      setLoading(false);
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
          <Link to={toHomeHash("#why")}>Why VAiyu</Link>
          <Link to={toHomeHash("#ai")}>AI</Link>
          <Link to={toHomeHash("#use-cases")}>Use-cases</Link>
          <Link to="/about">About</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* While loading, render nothing here to avoid flicker */}
          {loading ? null : userEmail ? (
            <AccountControls
              className="ml-1"
              displayName={userEmail.split("@")[0]}
            />
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

      {/* Optional little sign-in hint on home */}
      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
