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
  // Remembered choice first
  if (persisted?.role === "owner" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Owner console" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Property console" };
  }
  if (persisted?.role === "staff") {
    return { href: `/staff`, label: "Staff workspace" };
  }

  // Best available membership
  const owner = mems.find((m) => (m.role === "owner" || m.role === "manager") && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Owner console" };

  const staff = mems.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Staff workspace" };

  // Fallback
  return { href: `/guest`, label: "My trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // Bootstrap + keep in sync
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const user = data?.user;
      const em = user?.email ?? null;
      const mems = em ? await getMyMemberships() : [];
      if (!alive) return;
      setEmail(em);
      setMemberships(mems);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const em = session?.user?.email ?? null;
      setEmail(em);
      if (!em) setMemberships([]);
      else getMyMemberships().then(setMemberships);
    });

    return () => sub.subscription.unsubscribe();
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
        <Link to="/" className="font-semibold">
          <span className="inline-flex items-center gap-2">
            <img src="/logo.svg" alt="VAiyu" className="h-6 w-6" />
            VAiyu
          </span>
        </Link>

        {/* Primary nav (simple + SEO-friendly) */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <Link to="/why">Why VAiyu</Link>
          <Link to="/ai">AI</Link>
          <Link to="/use-cases">Use-cases</Link>
          <Link to="/about">About</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {!loading && email && showOwnerConsoleButton && (
            <Link
              to="/owner"
              className="hidden rounded-full border px-3 py-1.5 text-sm md:inline-block"
            >
              Owner console
            </Link>
          )}

          {/* Role-aware CTA */}
          {!loading && email ? (
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

          {/* Avatar / account menu (switch role, profile, sign out) */}
          {!loading && email && (
            <AccountControls className="ml-1" displayName={email.split("@")[0]} />
          )}
        </div>
      </div>

      {/* Optional: tiny hint only on marketing "/" when authed */}
      {pathname === "/" && email && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{email}</strong>
        </div>
      )}
    </header>
  );
}
