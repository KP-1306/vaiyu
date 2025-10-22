// web/src/components/AccountBubble.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * AccountBubble — compact avatar + dropdown for marketing home ("/") only.
 * Hides when ?app=1 is present. Syncs with Supabase auth and cross-tab storage.
 */
export default function AccountBubble() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Show only on the marketing homepage, and not when ?app=1 is present
  const isMarketingOnly = useMemo(() => {
    if (typeof window === "undefined") return false;
    const { pathname, search } = window.location;
    const isHome = pathname === "/";
    const forcedApp = new URLSearchParams(search).get("app") === "1";
    return isHome && !forcedApp;
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setEmail(data?.user?.email ?? null);
      } catch {
        if (mounted) setEmail(null);
      }
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!mounted) return;
      setEmail(sess?.user?.email ?? null);
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("supabase.auth")) {
        load();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mounted = false;
      sub.subscription?.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Hide entirely if not on marketing OR not signed in
  if (!isMarketingOnly || !email) return null;

  const initial = email[0]?.toUpperCase() ?? "U";

  const signOut = () => {
    // We already have a /logout route that clears everywhere; use it for reliability
    window.location.href = "/logout";
  };

  return (
    <div className="fixed right-3 top-3 z-[60] md:right-4 md:top-4">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border bg-white/90 px-3 py-2 shadow backdrop-blur hover:shadow-md"
        >
          <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
            {initial}
          </span>
          <span className="max-w-[160px] truncate text-xs text-gray-700" title={email}>
            {email}
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border bg-white shadow-lg"
          >
            <a
              role="menuitem"
              href="/guest"
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              My trips
            </a>
            <a
              role="menuitem"
              href="/owner"
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              Owner console
            </a>
            <button
              role="menuitem"
              onClick={signOut}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
