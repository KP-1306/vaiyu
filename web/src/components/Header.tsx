// web/src/components/Header.tsx
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useRole } from "../context/RoleContext";
import { supabase } from "../lib/supabase";
import AccountControls from "./AccountControls";

export default function Header() {
  const navigate = useNavigate();
  const { current } = useRole(); // { role: 'guest'|'staff'|'manager'|'owner', hotelSlug?: string|null }

  // Minimal user info for avatar menu
  const [displayName, setDisplayName] = useState<string>("Guest");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        if (alive) {
          setDisplayName("Guest");
          setAvatarUrl(null);
        }
        return;
      }
      const name =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        (user.email as string) ||
        "User";
      const avatar =
        (user.user_metadata?.avatar_url as string) ||
        (user.user_metadata?.picture as string) ||
        null;

      if (alive) {
        setDisplayName(name);
        setAvatarUrl(avatar);
        try {
          localStorage.setItem("user:name", name);
        } catch {}
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Role-based CTA
  const { ctaLabel, onCta } = (() => {
    if ((current.role === "owner" || current.role === "manager") && current.hotelSlug) {
      return {
        ctaLabel: "Owner console",
        onCta: () => navigate(`/owner/${current.hotelSlug}`),
      };
    }
    if (current.role === "staff" && current.hotelSlug) {
      return { ctaLabel: "Staff console", onCta: () => navigate("/staff") };
    }
    return { ctaLabel: "Open app", onCta: () => navigate("/guest") };
  })();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3 sm:h-16 sm:px-4">
        {/* Left: Logo */}
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/logo.svg"
            alt="VAiyu"
            className="h-6 w-auto sm:h-7"
            onError={(e) => {
              // fallback to text if logo not found
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="text-base font-semibold tracking-tight">VAiyu</span>
        </Link>

        {/* Center: Primary nav (customize as needed) */}
        <nav className="ml-4 hidden items-center gap-4 text-sm text-gray-600 md:flex">
          <NavLink to="/why" className={({ isActive }) => (isActive ? "font-medium text-gray-900" : "hover:text-gray-900")}>
            Why VAiyu
          </NavLink>
          <NavLink to="/ai" className={({ isActive }) => (isActive ? "font-medium text-gray-900" : "hover:text-gray-900")}>
            AI
          </NavLink>
          <NavLink to="/use-cases" className={({ isActive }) => (isActive ? "font-medium text-gray-900" : "hover:text-gray-900")}>
            Use-cases
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? "font-medium text-gray-900" : "hover:text-gray-900")}>
            About
          </NavLink>
        </nav>

        <div className="grow" />

        {/* Right: Role-aware CTA + Account menu */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCta}
            className="inline-flex items-center rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ctaLabel}
          </button>

          {/* The avatar menu contains role switcher & Sign out → /logout */}
          <AccountControls displayName={displayName} avatarUrl={avatarUrl} />
        </div>
      </div>
    </header>
  );
}
