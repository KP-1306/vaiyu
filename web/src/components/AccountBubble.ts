// web/src/components/AccountBubble.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * AccountBubble — compact avatar + dropdown for marketing pages.
 * - Shows ONLY on "/" (marketing) and hides if ?app=1 is present
 * - Subscribes to Supabase auth state AND storage events for cross-tab sync
 * - Provides "My trips" + "Sign out"
 */
export default function AccountBubble() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Guard: show only on marketing homepage (/) and not when ?app=1
  const isMarketingOnly = useMemo(() => {
    if (typeof window === "undefined") return false;
    const { pathname, search } = window.location;
    const onMarketingHome = pathname === "/";
    const isForcedApp = new URLSearchParams(search).get("app") === "1";
    return onMarketingHome && !isForcedApp;
  }, []);

  // Bootstrap current user and keep it in sync (auth listener + cross-tab storage)
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setEmail(data?.user?.email ?? null);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!mounted) return;
      setEmail(sess?.user?.email ?? null);
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

  async function signOut() {
    await supabase.auth.signOut();
    // Return to marketing (and bubble will disappear because email becomes null)
    location.href = "/";
  }

  const initial = email?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="fixed top-3 right-3 z-50">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border bg-white/90 backdrop-blur px-3 py-2 shadow hover:shadow-md transition"
        >
          <span className="inline-grid place-items-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-semibold">
            {initial}
          </span>
          <span className="text-xs text-gray-700 max-w-[160px] truncate" title={email}>
            {email}
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 rounded-xl border bg-white shadow-lg overflow-hidden"
          >
            <a
              role="menuitem"
              href="/guest"
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              My trips
            </a>
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
