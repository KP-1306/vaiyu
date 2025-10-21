// web/src/components/AccountControls.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useRole } from "../context/RoleContext";

type AccountControlsProps = {
  displayName?: string;       // e.g., "Kapil"
  avatarUrl?: string | null;  // optional
  className?: string;
};

type MemberRow = {
  hotel_id: string;
  role: "owner" | "manager" | "staff" | "viewer";
  slug?: string | null;
  name?: string | null;
};

export default function AccountControls({
  displayName = "Guest",
  avatarUrl = null,
  className = "",
}: AccountControlsProps) {
  const navigate = useNavigate();
  const { current, setCurrent } = useRole();

  const [open, setOpen] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [memberships, setMemberships] = useState<MemberRow[]>([]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown, { passive: true });
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load memberships (role per hotel) when menu opens
  useEffect(() => {
    if (!open) return;
    let alive = true;

    (async () => {
      setLoadingRoles(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id;
        if (!uid) {
          if (alive) setMemberships([]);
          return;
        }

        // 1) fetch member rows
        const { data: mems, error: mErr } = await supabase
          .from("hotel_members")
          .select("hotel_id, role, active")
          .eq("user_id", uid)
          .eq("active", true);

        if (mErr || !mems?.length) {
          if (alive) setMemberships([]);
          return;
        }

        const hotelIds = [...new Set(mems.map((m) => m.hotel_id))];

        // 2) fetch slugs/names for those hotels
        const { data: hotels } = await supabase
          .from("hotels")
          .select("id, slug, name")
          .in("id", hotelIds);

        const byId = new Map((hotels || []).map((h: any) => [h.id, h]));
        const rows: MemberRow[] = mems.map((m: any) => ({
          hotel_id: m.hotel_id,
          role: m.role,
          slug: byId.get(m.hotel_id)?.slug ?? null,
          name: byId.get(m.hotel_id)?.name ?? null,
        }));

        if (alive) setMemberships(rows);
      } finally {
        if (alive) setLoadingRoles(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  // Simple avatar (initial fallback)
  const initial =
    displayName?.trim()?.charAt(0)?.toUpperCase() ||
    (typeof window !== "undefined"
      ? (localStorage.getItem("user:name") || "U").charAt(0).toUpperCase()
      : "U");

  // Group entries for convenience
  const owners = useMemo(
    () => memberships.filter((m) => m.role === "owner" || m.role === "manager"),
    [memberships]
  );
  const managers = useMemo(
    () => memberships.filter((m) => m.role === "manager"),
    [memberships]
  );
  const staffs = useMemo(
    () => memberships.filter((m) => m.role === "staff"),
    [memberships]
  );

  // Role switches
  const switchToGuest = () => {
    setCurrent({ role: "guest", hotelSlug: null });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "guest" }));
    } catch {}
    setOpen(false);
    navigate("/guest");
  };

  const switchToOwner = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "owner", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "owner", hotelSlug: slug }));
      localStorage.setItem("owner:slug", slug);
    } catch {}
    setOpen(false);
    navigate(`/owner/${slug}`);
  };

  const switchToManager = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "manager", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "manager", hotelSlug: slug }));
      localStorage.setItem("owner:slug", slug);
    } catch {}
    setOpen(false);
    navigate(`/owner/${slug}`);
  };

  const switchToStaff = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "staff", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "staff", hotelSlug: slug }));
      localStorage.setItem("staff:slug", slug);
    } catch {}
    setOpen(false);
    navigate("/staff");
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold shadow hover:shadow-md outline-none focus:ring-2 focus:ring-blue-500"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName || "Account"}
            className="h-9 w-9 rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </button>

      {/* Menu */}
      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 mt-2 w-72 rounded-2xl bg-white shadow-lg ring-1 ring-black/5 z-[100]"
        >
          <div className="px-3 py-2">
            <div className="text-xs text-gray-500">Signed in as</div>
            <div className="text-sm font-medium truncate">{displayName}</div>
            <div className="text-xs mt-1 text-gray-500">
              Current:{" "}
              <span className="font-medium">
                {current?.role ?? "guest"}
              </span>
              {current?.hotelSlug ? ` @ ${current.hotelSlug}` : ""}
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Role switcher */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 mb-1">
              Switch role
            </div>

            <MenuButton label="Guest" onClick={switchToGuest} />

            {loadingRoles && (
              <div className="text-xs text-gray-500 px-1 py-1.5">
                Loading memberships…
              </div>
            )}

            {!loadingRoles && staffs.length > 0 && (
              <>
                <div className="mt-2 mb-1 text-[11px] uppercase tracking-wide text-gray-400">
                  Staff
                </div>
                {staffs.map((m) => (
                  <MenuButton
                    key={`stf-${m.hotel_id}`}
                    label={`@ ${m.slug || m.name || "hotel"}`}
                    onClick={() => switchToStaff(m.slug)}
                  />
                ))}
              </>
            )}

            {!loadingRoles && owners.length > 0 && (
              <>
                <div className="mt-2 mb-1 text-[11px] uppercase tracking-wide text-gray-400">
                  Owner / Manager
                </div>
                {owners
                  .filter((m) => m.role === "owner")
                  .map((m) => (
                    <MenuButton
                      key={`own-${m.hotel_id}`}
                      label={`Owner @ ${m.slug || m.name || "hotel"}`}
                      onClick={() => switchToOwner(m.slug)}
                    />
                  ))}
                {managers.map((m) => (
                  <MenuButton
                    key={`mgr-${m.hotel_id}`}
                    label={`Manager @ ${m.slug || m.name || "hotel"}`}
                    onClick={() => switchToManager(m.slug)}
                  />
                ))}
              </>
            )}
          </div>

          <div className="h-px bg-gray-100 my-1" />

          {/* Profile/Settings */}
          <MenuLink to="/profile" label="Update profile" onSelect={() => setOpen(false)} />
          <MenuLink to="/settings" label="Settings" onSelect={() => setOpen(false)} />

          <div className="h-px bg-gray-100 my-1" />

          {/* Sign out → always route through /logout */}
          <MenuButton
            label="Sign out"
            onClick={() => {
              setOpen(false);
              navigate("/logout");
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuLink({
  to,
  label,
  onSelect,
}: {
  to: string;
  label: string;
  onSelect?: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onSelect}
      className="block px-3 py-2 text-sm hover:bg-gray-50 focus:bg-gray-50 outline-none"
    >
      {label}
    </Link>
  );
}

function MenuButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 focus:bg-gray-50 outline-none"
    >
      {label}
    </button>
  );
}
