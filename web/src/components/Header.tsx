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
  if (persisted?.role === "owner" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Owner console" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Property console" };
  }
  if (persisted?.role === "staff" && persisted.hotelSlug) {
    return { href: `/staff`, label: "Staff workspace" };
  }

  const owner = mems.find((m) => m.role === "owner" && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Owner console" };

  const mgr = mems.find((m) => m.role === "manager" && m.hotelSlug);
  if (mgr?.hotelSlug) return { href: `/owner/${mgr.hotelSlug}`, label: "Property console" };

  const staff = mems.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Staff workspace" };

  return { href: `/guest`, label: "My trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [authed, setAuthed] = useState(false);
  const [displayName, setDisplayName] = useState<string>("Guest");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  // resolve auth, name, avatar + memberships
  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const user = data?.user ?? null;

      if (!alive) return;

      setAuthed(!!user);

      if (user) {
        const name =
          (user.user_metadata?.full_name as string) ||
          (user.user_metadata?.name as string) ||
          (user.email as string) ||
          "User";
        const avatar =
          (user.user_metadata?.avatar_url as string) ||
          (user.user_metadata?.picture as string) ||
          null;

        setDisplayName(name);
        setAvatarUrl(avatar);
        try {
          localStorage.setItem("user:name", name);
        } catch {}

        const mems = await getMyMemberships();
        if (!alive) return;
        setMemberships(mems);
      } else {
        setDisplayName("Guest");
        setAvatarUrl(null);
        setMemberships([]);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const user = session?.user ?? null;
      setAuthed(!!user);
      if (user) {
        const n =
          (user.user_metadata?.full_name as string) ||
          (user.user_metadata?.name as string) ||
          (user.email as string) ||
          "User";
        const a =
          (user.user_metadata?.avatar_url as string) ||
          (user.user_metadata?.picture as string) ||
          null;
        setDisplayName(n);
        setAvatarUrl(a);
        getMyMemberships().then(setMemberships);
      } else {
        setDisplayName("Guest");
        setAvatarUrl(null);
        setMemberships([]);
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
    () => authed && memberships.some((m) => m.role === "owner" || m.role === "manager"),
    [authed, memberships]
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

        {/* Marketing nav */}
        <nav className="ml-6 hidden gap-4 text-sm md:flex">
          <Link to="/why">Why VAiyu</Link>
          <Link to="/ai">AI</Link>
          <Link to="/use-cases">Use-cases</Link>
          <Link to="/about">About</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Owner console quick entry (only when signed in & an owner/manager) */}
          {showOwnerConsoleButton && (
            <Link
              to="/owner"
              className="hidden rounded-full border px-3 py-1.5 text-sm md:inline-block"
            >
              Owner console
            </Link>
          )}

          {/* CTA: Sign in when anonymous; role-aware when authed */}
          {authed ? (
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

          {/* Avatar only when authed */}
          {authed && (
            <AccountControls className="ml-1" displayName={displayName} avatarUrl={avatarUrl} />
          )}
        </div>
      </div>

      {/* Optional hint on the homepage */}
      {pathname === "/" && authed && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{displayName}</strong>
        </div>
      )}
    </header>
  );
}
