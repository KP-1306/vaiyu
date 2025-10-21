import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * AccountBubble — compact avatar + dropdown for the marketing homepage.
 *
 * - Renders ONLY on "/" (marketing) and hides if "?app=1" is present.
 * - Shows only when the user is signed in.
 * - Provides "Open app" (go to the in-app shell) + "Sign out".
 */
export default function AccountBubble() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // ✅ Show only on marketing home and not when the app shell is forced.
  const isMarketingOnly = useMemo(() => {
    if (typeof window === "undefined") return false;
    const { pathname, search } = window.location;
    const onMarketingHome = pathname === "/";
    const forcedApp = new URLSearchParams(search).get("app") === "1";
    return onMarketingHome && !forcedApp;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setEmail(data?.user?.email ?? null);
    };

    init();

    // Keep in sync with auth state changes in this tab
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (!mounted) return;
      setEmail(sess?.user?.email ?? null);
    });

    // Keep in sync with other tabs
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
    location.href = "/"; // bubble disappears because email becomes null
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
            {/* A lightweight way to jump into the “app shell” without deciding a role here */}
            <a
              role="menuitem"
              href="/?app=1"
              className="block px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              Open app
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
