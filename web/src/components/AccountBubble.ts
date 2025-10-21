import { useEffect, useMemo, useState } from "react";
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
    return { href: `/owner/${persisted.hotelSlug}`, label: "Open owner console" };
  }
  if (persisted?.role === "manager" && persisted.hotelSlug) {
    return { href: `/owner/${persisted.hotelSlug}`, label: "Open property console" };
  }
  if (persisted?.role === "staff" && persisted.hotelSlug) {
    return { href: `/staff`, label: "Open staff workspace" };
  }

  const owner = mems.find((m) => m.role === "owner" && m.hotelSlug);
  if (owner?.hotelSlug) return { href: `/owner/${owner.hotelSlug}`, label: "Open owner console" };

  const mgr = mems.find((m) => m.role === "manager" && m.hotelSlug);
  if (mgr?.hotelSlug) return { href: `/owner/${mgr.hotelSlug}`, label: "Open property console" };

  const staff = mems.find((m) => m.role === "staff");
  if (staff) return { href: `/staff`, label: "Open staff workspace" };

  return { href: `/guest`, label: "Open my trips" };
}

/**
 * AccountBubble — compact avatar + dropdown for the marketing home ("/").
 * - Shows ONLY on "/" and hides if ?app=1 is present (so the app header takes over)
 * - Role-aware “Open …” target
 * - Real avatar (avatar_url/picture) with initials fallback
 */
export default function AccountBubble() {
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("Guest");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const persisted = useMemo(() => loadPersistedRole(), []);

  // Only show on "/" and not with ?app=1
  const isMarketingOnly = useMemo(() => {
    if (typeof window === "undefined") return false;
    const { pathname, search } = window.location;
    const onMarketingHome = pathname === "/";
    const forcedApp = new URLSearchParams(search).get("app") === "1";
    return onMarketingHome && !forcedApp;
  }, []);

  // Bootstrap + keep in sync
  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } as any }));
      if (!mounted) return;

      const user = data?.user ?? null;
      const em = user?.email ?? null;
      const name =
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        em ||
        "User";
      const avatar =
        (user?.user_metadata?.avatar_url as string) ||
        (user?.user_metadata?.picture as string) ||
        null;

      setEmail(em);
      setDisplayName(name);
      setAvatarUrl(avatar);

      const mems = em ? await getMyMemberships() : [];
      if (!mounted) return;
      setMemberships(mems);
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!mounted) return;
      const user = session?.user ?? null;
      const em = user?.email ?? null;
      const name =
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        em ||
        "User";
      const avatar =
        (user?.user_metadata?.avatar_url as string) ||
        (user?.user_metadata?.picture as string) ||
        null;

      setEmail(em);
      setDisplayName(name);
      setAvatarUrl(avatar);

      const mems = em ? await getMyMemberships() : [];
      if (!mounted) return;
      setMemberships(mems);
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("supabase.auth.token")) {
        init();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Hide entirely if not on marketing OR not signed in
  if (!isMarketingOnly || !email) return null;

  const cta = pickDefaultLanding(memberships, persisted);
  const hasOwner = memberships.some((m) => m.role === "owner" || m.role === "manager");

  async function signOut() {
    try {
      await supabase.auth.signOut({ scope: "global" } as any);
    } catch {/* ignore */}
    // Clear local signal quickly
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("sb-") || k.includes("supabase.auth.token"))
        .forEach((k) => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch {/* ignore */}
    location.href = "/";
  }

  const initial =
    (displayName?.trim()?.charAt(0) || email?.charAt(0) || "U").toUpperCase();

  return (
    <div className="fixed top-3 right-3 z-50">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border bg-white/90 backdrop-blur px-3 py-2 shadow hover:shadow-md transition"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-7 h-7 rounded-full object-cover"
              referrerPolicy="no-referrer"
              draggable={false}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="inline-grid place-items-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-semibold">
              {initial}
            </span>
          )}
          <span className="text-xs text-gray-700 max-w-[180px] truncate" title={email}>
            {displayName !== "User" ? displayName : email}
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-60 rounded-xl border bg-white shadow-lg overflow-hidden"
          >
            {/* Role-aware primary action */}
            <a
              role="menuitem"
              href={cta.href}
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              {cta.label}
            </a>

            {/* Quick Owner console card when applicable */}
            {hasOwner && (
              <a
                role="menuitem"
                href="/owner"
                className="block px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => setOpen(false)}
              >
                Owner console
              </a>
            )}

            <div className="h-px bg-gray-100 my-1" />

            <button
              role="menuitem"
              onClick={signOut}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
