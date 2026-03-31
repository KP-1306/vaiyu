// web/src/components/Header.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";

export default function Header() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  // Tiny “You’re signed in as …” strip (kept)
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setUserEmail(data?.user?.email ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_evt, session) => {
        setUserEmail(session?.user?.email ?? null);
      }
    );
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Smooth-scroll for in-page anchors (#ai, #why)
  useEffect(() => {
    if (hash && (pathname === "/" || pathname === "")) {
      const id = hash.replace("#", "");
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
    <header className="sticky top-0 z-[100] w-full border-b border-[#d4af37]/20 bg-[#0a0a0c]/80 backdrop-blur-md text-[#f5f3ef] shadow-sm transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="font-bold tracking-tight text-lg hover:text-[#d4af37] transition-colors">
          <span className="inline-flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-[#141210] border border-[#d4af37]/20 shadow-[0_0_10px_rgba(212,175,55,0.1)] overflow-hidden flex items-center justify-center p-0.5">
              <img
                src="/brand/vaiyu-logo.png"
                alt="VAiyu"
                className="h-full w-full object-contain rounded-full"
              />
            </div>
            VAiyu
          </span>
        </Link>

        {/* Primary nav (marketing anchors) */}
        <nav className="ml-8 hidden lg:flex items-center gap-6 text-sm font-medium">
          <a
            href="#why"
            onClick={onAnchor("why")}
            className="text-[#b8b3a8] hover:text-[#d4af37] hover:-translate-y-0.5 transition-all"
          >
            Why VAiyu
          </a>
          <a
            href="#ai"
            onClick={onAnchor("ai")}
            className="text-[#b8b3a8] hover:text-[#d4af37] hover:-translate-y-0.5 transition-all"
          >
            AI Engine
          </a>

          <Link to="/contact" className="text-[#b8b3a8] hover:text-[#d4af37] hover:-translate-y-0.5 transition-all">
            Use-cases
          </Link>

          <Link to="/about" className="text-[#b8b3a8] hover:text-[#d4af37] hover:-translate-y-0.5 transition-all">
            About
          </Link>
        </nav>

        {/* Right side: account menu only */}
        <div className="ml-auto flex items-center gap-4">
          <AccountControls theme="dark" />
        </div>
      </div>

      {/* Tiny signed-in hint on marketing home only */}
      {pathname === "/" && userEmail && (
        <div className="border-t border-[#d4af37]/10 bg-[#141210]/90 backdrop-blur text-center text-[11px] uppercase tracking-widest text-[#7a756a] py-2">
          Signed in to dashboard as <span className="font-bold text-[#d4af37] lowercase">{userEmail}</span>
        </div>
      )}
    </header>
  );
}
