// web/src/components/Header.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import AccountControls from "./AccountControls";
import { useAuth } from "../context/AuthContext";
import { useMemberships } from "../hooks/useMemberships";

function pickLanding(memberships: ReturnType<typeof useMemberships>["memberships"]) {
  const owner = memberships.find((m) => m.role === "owner" && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Owner console" };

  const mgr = memberships.find((m) => m.role === "manager" && m.hotelSlug);
  if (mgr?.hotelSlug) return { href: `/owner/${mgr.hotelSlug}`, label: "Property console" };

  const staff = memberships.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Staff workspace" };

  return { href: `/guest`, label: "My trips" };
}

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { loading, user, email } = useAuth();
  const { memberships } = useMemberships(user?.id ?? null);
  const cta = useMemo(() => pickLanding(memberships), [memberships]);

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
          {!loading && user ? (
            <>
              <button
                onClick={() => navigate(cta.href)}
                className="rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {cta.label}
              </button>
              {/* Avatar must always render when user exists */}
              <AccountControls className="ml-1" displayName={(email || "User").split("@")[0]} />
            </>
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

      {pathname === "/" && user && email && (
        <div className="border-t bg-blue-50 text-center text-xs text-blue-900">
          You’re signed in as <strong>{email}</strong>
        </div>
      )}
    </header>
  );
}
