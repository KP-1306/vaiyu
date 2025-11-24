// web/src/components/AccountControls.tsx

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  getMyMemberships,
  PersistedRole,
  loadPersistedRole,
} from "../lib/auth";

type Membership = {
  hotelSlug: string | null;
  hotelName: string | null;
  role: "viewer" | "staff" | "manager" | "owner";
};

function useOnClickOutside(
  ref: React.RefObject<HTMLElement>,
  onOutside: () => void
) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

export default function AccountControls({
  className = "",
}: {
  className?: string;
}) {
  const nav = useNavigate();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep for future role-based logic (already in your codebase)
  const persisted: PersistedRole | null = loadPersistedRole();

  // Show the same menu everywhere (including /guest)
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      const e = data?.user?.email ?? null;
      const mems = e ? await getMyMemberships() : [];
      if (!alive) return;
      setEmail(e);
      setMemberships(mems);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_evt, session) => {
        const e = session?.user?.email ?? null;
        setEmail(e);
        if (!e) {
          setMemberships([]);
        } else {
          getMyMemberships().then(setMemberships);
        }
      }
    );

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const initials = (email?.trim()?.[0] ?? "U").toUpperCase();

  const menuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(menuRef, () => setOpen(false));

  if (loading) {
    return (
      <div
        className={`h-8 w-8 animate-pulse rounded-full bg-gray-200 ${className}`}
      />
    );
  }

  if (!email) {
    // Keep redirect to /guest for sign-in, same as before
    return (
      <Link
        to="/signin?intent=signin&redirect=/guest"
        className={`rounded-full bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 ${className}`}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-white outline-none ring-slate-300 hover:bg-slate-700 focus:ring"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          // IMPORTANT: z-50 keeps the menu above the large Guest dashboard panels
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg z-50"
        >
          {/* Signed in as */}
          <div className="px-4 py-3 text-xs text-slate-600">
            <div className="font-medium text-slate-900">
              {email.split("@")[0]}
            </div>
            <div className="truncate text-slate-500">{email}</div>
          </div>

          <div className="h-px bg-slate-200" />

          {/* Destinations */}
          <div className="py-1">
            <MenuLink
              to="/guest"
              label="My trips"
              onChoose={() => setOpen(false)}
            />
            {(memberships || [])
              .filter(
                (m) =>
                  (m.role === "owner" || m.role === "manager") && m.hotelSlug
              )
              .map((m, idx) => (
                <MenuLink
                  key={`${m.hotelSlug}-${idx}`}
                  to={`/owner/${m.hotelSlug}`}
                  label={`Owner @ ${m.hotelName || m.hotelSlug}`}
                  onChoose={() => setOpen(false)}
                />
              ))}
            {(memberships || []).some((m) => m.role === "staff") && (
              <MenuLink
                to="/staff"
                label="Staff workspace"
                onChoose={() => setOpen(false)}
              />
            )}
          </div>

          <div className="h-px bg-slate-200" />

          {/* Settings */}
          <div className="py-1">
            <MenuLink
              to="/profile"
              label="Update profile"
              onChoose={() => setOpen(false)}
            />
            <MenuLink
              to="/settings"
              label="Settings"
              onChoose={() => setOpen(false)}
            />
          </div>

          <div className="h-px bg-slate-200" />

          {/* Sign out */}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              try {
                // Clear any persisted role/slug if you use it
                localStorage.removeItem("owner:slug");
                localStorage.removeItem("staff:slug");
                await supabase.auth.signOut();
              } finally {
                nav("/", { replace: true });
              }
            }}
            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  to,
  label,
  onChoose,
}: {
  to: string;
  label: string;
  onChoose?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onChoose}
      className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
      role="menuitem"
    >
      {label}
    </Link>
  );
}
