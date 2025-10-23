import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";

export default function Header() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  // Used only for the tiny “You’re signed in as …” strip (kept from approved UI)
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setUserEmail(data?.user?.email ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Smooth-scroll for in-page anchors (#ai, #use-cases)
  useEffect(() => {
    if (hash && (pathname === "/" || pathname === "")) {
      const id = hash.replace("#", "");
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [pathname, hash]);

  const onAnchor = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (location.pathname !== "/") {
      navigate("/#" + id);
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
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

        {/* Primary nav (marketing anchors) */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <a href="#why" onClick={onAnchor("why")} className="hover:underline">
            Why VAiyu
          </a>
          <a href="#ai" onClick={onAnchor("ai")} className="hover:underline">
            AI
          </a>
          <a href="#use-cases" onClick={onAnchor("use-cases")} className="hover:underline">
            Use-cases
          </a>
          <Link to="/about" className="hover:underline">
            About
          </Link>
        </nav>

        {/* Right side: account menu only (no duplicate “Owner console”/“My trips” buttons) */}
        <div className="ml-auto flex items-center gap-2">
          <AccountControls />
        </div>
      </div>

      {/* Tiny signed-in hint on marketing home only */}
      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
