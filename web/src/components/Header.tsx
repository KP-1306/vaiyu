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
    return { href: `/owner/${persisted.hotelSlug}`, label: "Open owner console" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Open property console" };
  }
  if (persisted?.role === "staff" && persisted.hotelSlug) {
    return { href: `/staff`, label: "Open staff workspace" };
  }

  // 2) Otherwise pick best available role from memberships
  const owner = mems.find((m) => m.role === "owner" && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Open owner console" };

  const mgr = mems.find((m) => m.role === "manager" && m.hotelSlug);
  if (mgr?.hotelSlug) return { href: `/owner/${mgr.hotelSlug}`, label: "Open property console" };

  const staff = mems.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Open staff workspace" };

  // 3) Fallback: guest
  return { href: `/guest`, label: "Open my trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("Guest");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // show account/CTA when signed in + populate avatar/name
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      const user = data?.user ?? null;

      // basic identity
      const email = user?.email ?? null;
      const name =
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        email ||
        "User";
      const avatar =
        (user?.user_metadata?.avatar_url as string) ||
        (user?.user_metadata?.picture as string) ||
        null;

      // memberships
      const mems = email ? await getMyMemberships() : [];

      if (!alive) return;
      setUserEmail(email);
      setDisplayName(name);
      setAvatarUrl(avatar);
      setMemberships(mems);
      setLoading(false);

      try {
        if (name) localStorage.setItem("user:name", name);
      } catch {}
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const user = session?.user ?? null;
      const email = user?.email ?? null;

      const name =
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        email ||
        "User";
      const avatar =
        (user?.user_metadata?.avatar_url as string) ||
        (user?.user_metadata?.picture as string) ||
        null;

      setUserEmail(email);
      setDisplayName(name);
      setAvatarUrl(avatar);

      if (!email) {
        setMemberships([]);
      } else {
        const mems = await getMyMemberships();
        setMemberships(mems);
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

        <div className="ml-auto flex items-center gap-2">
          {/* Owner console quick link (visible when user has owner/manager membership) */}
          {!loading && userEmail && showOwnerConsoleButton && (
            <Link
              to="/owner"
              className="rounded-full border px-3 py-1.5 text-sm"
            >
              Owner console
            </Link>
          )}

          {/* Role-aware CTA */}
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

          {/* Avatar / account menu */}
          {!loading && userEmail && (
            <AccountControls
              className="ml-1"
              displayName={displayName}
              avatarUrl={avatarUrl}
            />
          )}
        </div>
      </div>

      {/* Optional: tiny marketing hint bar */}
      {pathname === "/" && userEmail && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{userEmail}</strong>
        </div>
      )}
    </header>
  );
}
