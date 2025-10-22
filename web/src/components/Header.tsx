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
  // Always land users somewhere useful; but we don't surface console buttons here.
  if (persisted?.role === "owner" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "My trips" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "My trips" };
  }
  if (persisted?.role === "staff") {
    return { href: `/guest`, label: "My trips" };
  }
  return { href: `/guest`, label: "My trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email ?? null;
      const mems = email ? await getMyMemberships() : [];
      if (!alive) return;
      setUserEmail(email);
      setMemberships(mems);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const email = session?.user?.email ?? null;
      setUserEmail(email);
      if (!email) setMemberships([]);
      else getMyMemberships().then(setMemberships);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const persisted = useMemo(() => loadPersistedRole(), []);
  const cta = useMemo(() => pickDefaultLanding(memberships, persisted), [memberships, persisted]);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link to="/" className="font-semibold">
          <span className="inline-flex items-center gap-2">
            <img src="/logo.svg" alt="VAiyu" className="h-6 w-6" />
            VAiyu
          </span>
        </Link>

        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <Link to="/why">Why VAiyu</Link>
          <Link to="/ai">AI</Link>
          <Link to="/use-cases">Use-cases</Link>
          <Link to="/about">About</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
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

          {!loading && userEmail && (
            <AccountControls className="ml-1" displayName={userEmail.split("@")[0]} />
          )}
        </div>
      </div>

      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
