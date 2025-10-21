import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useRole } from "../context/RoleContext";

type AccountControlsProps = {
  displayName?: string;
  avatarUrl?: string | null;
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

  // Close on outside click / ESC
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Load memberships when menu opens
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

        // 1) active memberships
        const { data: mems, error: mErr } = await supabase
          .from("hotel_members")
          .select("hotel_id, role, active")
          .eq("user_id", uid)
          .eq("active", true);

        if (mErr || !mems?.length) {
          if (alive) setMemberships([]);
          return;
        }

        // 2) hotel meta
        const hotelIds = [...new Set(mems.map((m) => m.hotel_id))];
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
      /* noop */
    };
  }, [open]);

  // Initial letter fallback
  const initial =
    displayName?.trim()?.charAt(0)?.toUpperCase() ||
    (typeof window !== "undefined"
      ? (localStorage.getItem("user:name") || "U").charAt(0).toUpperCase()
      : "U");

  // Buckets
  const owners = useMemo(
    () => memberships.filter((m) => m.role === "owner" || m.role === "manager"),
    [memberships]
  );
  const staffs = useMemo(
    () => memberships.filter((m) => m.role === "staff"),
    [memberships]
  );

  // Switchers (we DO NOT offer “switch to guest” anymore)
  const goOwner = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "owner", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "owner", hotelSlug: slug }));
    } catch {}
    setOpen(false);
    navigate(`/owner/${slug}`);
  };

  const goManager = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "manager", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "manager", hotelSlug: slug }));
    } catch {}
    setOpen(false);
    navigate(`/owner/${slug}`);
  };

  const goStaff = (slug?: string | null) => {
    if (!slug) return;
    setCurrent({ role: "staff", hotelSlug: slug });
    try {
      localStorage.setItem("va:role", JSON.stringify({ role: "staff", hotelSlug: slug }));
    } catch {}
    setOpen(false);
    navigate(`/staff`);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
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

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 mt-2 w-64 rounded-2xl bg-white shadow-lg ring-1 ring-black/5 z-[100]"
        >
          <div className="px-3 py-2">
            <div className="text-xs text-gray-500">Signed in as</div>
            <div className="text-sm font-medium truncate">{displayName}</div>
            {current?.hotelSlug && (
              <div className="text-xs mt-1 text-gray-500">
                Current role: <span className="font-medium">{current.role}</span>
                {current.hotelSlug ? ` @ ${current.hotelSlug}` : ""}
              </div>
            )}
          </div>

          <div className="h-px bg-gray-100" />

          {/* App shortcuts (no “switch to guest”) */}
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 mb-1">Go to</div>

            <MenuLink to="/guest" label="My trips" onSelect={() => setOpen(false)} />

            {loadingRoles && (
              <div className="text-xs text-gray-500 px-1 py-1.5">Loading properties…</div>
            )}

            {!loadingRoles &&
              owners.map((m) => (
                <MenuButton
                  key={`own-${m.hotel_id}`}
                  label={`${m.role === "owner" ? "Owner" : "Manager"} @ ${m.slug || m.name || "hotel"}`}
                  onClick={() => (m.role === "owner" ? goOwner(m.slug) : goManager(m.slug))}
                />
              ))}

            {!loadingRoles &&
              staffs.map((m) => (
                <MenuButton
                  key={`stf-${m.hotel_id}`}
                  label={`Staff @ ${m.slug || m.name || "hotel"}`}
                  onClick={() => goStaff(m.slug)}
                />
              ))}
          </div>

          <div className="h-px bg-gray-100 my-1" />

          {/* Profile/Settings */}
          <MenuLink to="/profile" label="Update profile" onSelect={() => setOpen(false)} />
          <MenuLink to="/settings" label="Settings" onSelect={() => setOpen(false)} />

          <div className="h-px bg-gray-100 my-1" />

          {/* Sign out goes through /logout for the reliable flow */}
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
