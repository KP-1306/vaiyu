// web/src/components/Header.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import AccountControls from "./AccountControls";
import { supabase } from "../lib/supabase";
import { getMyMemberships, loadPersistedRole, PersistedRole } from "../lib/auth";

type Membership = {
  hotelSlug: string | null;
  hotelName: string | null;
  role: "viewer" | "staff" | "manager" | "owner";
};

function pickDefaultLanding(
  mems: Membership[],
  persisted: PersistedRole | null
): { href: string; label: string } {
  // 1) If they explicitly chose a role before, respect it
  if (persisted?.role === "owner" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Owner console" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Property console" };
  }
  if (persisted?.role === "staff" && persisted.hotelSlug) {
    return { href: `/staff`, label: "Staff workspace" };
  }

  // 2) Otherwise pick best available role from memberships
  const owner = mems.find((m) => m.role === "owner" && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Owner console" };

  const mgr = mems.find((m) => m.role === "manager" && m.hotelSlug);
  if (mgr?.hotelSlug) return { href: `/owner/${mgr.hotelSlug}`, label: "Property console" };

  const staff = mems.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Staff workspace" };

  // 3) Fallback: guest
  return { href: `/guest`, label: "My trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // Load session once and keep it in sync
  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email ?? null;
      const mems = email ? await getMyMemberships() : [];
      if (!alive) return;
      setUserEmail(email);
      setMemberships(mems);
      setLoading(false);
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const email = session?.user?.email ?? null;
      setUserEmail(email);
      if (!email) {
        setMemberships([]);
      } else {
        getMyMemberships().then(setMemberships);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const persisted = useMemo(() => loadPersistedRole(), []);
  const cta = useMemo(() => pickDefaultLanding(memberships, persisted), [memberships, persisted]);

  const showOwnerConsoleButton = useMemo(
    () => memberships.some((m) => m.role === "owner" || m.role === "manager"),
    [memberships]
  );

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        {/* Logo */}
        <Link to="/" className="font-semibold">
          <span className="inline-flex items-center gap-2">
            <img src="/logo.svg" alt="VAiyu" className="h-6 w-6" />
            VAiyu
          </span>
        </Link>

        {/* Primary nav (marketing) */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <Link to="/why">Why VAiyu</Link>
          <Link to="/ai">AI</Link>
          <Link to="/use-cases">Use-cases</Link>
          <Link to="/about">About</Link>
        </nav>

        {/* Right side: CTA + Avatar */}
        <div className="ml-auto flex items-center gap-2">
          {!loading && userEmail && showOwnerConsoleButton && (
            <Link
              to="/owner"
              className="hidden rounded-full border px-3 py-1.5 text-sm md:inline-block"
            >
              Owner console
            </Link>
          )}

          {!loading && userEmail ? (
            <button
              onClick={() => navigate(cta.href)}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              {cta.label}
            </button>
          ) : (
            <Link
              to="/signin?intent=signin&redirect=/guest"
              className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          )}

          {/* Avatar / account menu: ALWAYS when signed in */}
          {!loading && userEmail && (
            <AccountControls className="ml-1" displayName={userEmail.split("@")[0]} />
          )}
        </div>
      </div>

      {/* Tiny signed-in hint only on marketing / */}
      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
