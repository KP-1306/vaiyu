// web/src/components/AccountControls.tsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type AccountControlsProps = {
  displayName?: string;       // e.g., "Kapil"
  avatarUrl?: string | null;  // optional
  className?: string;
};

export default function AccountControls({
  displayName = "Guest",
  avatarUrl = null,
  className = "",
}: AccountControlsProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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

  // Simple avatar (initial fallback)
  const initial =
    displayName?.trim()?.charAt(0)?.toUpperCase() ||
    (typeof window !== "undefined"
      ? (localStorage.getItem("user:name") || "U").charAt(0).toUpperCase()
      : "U");

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
          className="absolute right-0 mt-2 w-56 rounded-2xl bg-white shadow-lg ring-1 ring-black/5 z-[100]"
        >
          <div className="px-3 py-2">
            <div className="text-xs text-gray-500">Signed in as</div>
            <div className="text-sm font-medium truncate">{displayName}</div>
          </div>
          <div className="h-px bg-gray-100" />

          <MenuLink to="/profile" label="Update profile" onSelect={() => setOpen(false)} />
          <MenuLink to="/settings" label="Settings" onSelect={() => setOpen(false)} />

          <div className="h-px bg-gray-100 my-1" />

          {/* IMPORTANT: Sign out button → always navigate to /logout */}
          <MenuButton
            label="Sign out"
            onClick={() => {
              setOpen(false);
              // Use SPA navigation to /logout, which performs real sign-out
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
