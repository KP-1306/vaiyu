// web/src/components/Header.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";

export default function Header() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  // Tiny “You’re signed in as …” strip (marketing only)
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setUserEmail(data?.user?.email ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Smooth-scroll when already on the home route and a hash is present
  useEffect(() => {
    if ((pathname === "/" || pathname === "") && hash) {
      const id = hash.replace(/^#/, "");
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [pathname, hash]);

  // Single helper for the in-page "Use-cases" item
  const goToHomeHash = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.location.pathname !== "/") {
      // Navigate to /#id without a full reload
      navigate(`/#${id}`);
      return;
    }
    // Already on home: smooth-scroll + update hash
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="font-semibold">
          <span className="inline-flex items-center gap-2">
            <img src="/logo.svg" alt="VAiyu" className="h-6 w-6" />
            VAiyu
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <Link to="/about" className="hover:underline">
            Why VAiyu
          </Link>
          <Link to="/about-ai" className="hover:underline">
            AI
          </Link>
          {/* Use-cases: always land on /#use-cases and smooth-scroll if already home */}
          <a href="/#use-cases" onClick={goToHomeHash("use-cases")} className="hover:underline">
            Use-cases
          </a>
        </nav>

        {/* Right side: account menu */}
        <div className="ml-auto flex items-center gap-2">
          <AccountControls />
        </div>
      </div>

      {/* Signed-in hint on marketing home only */}
      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
