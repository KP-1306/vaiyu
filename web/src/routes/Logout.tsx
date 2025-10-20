// web/src/routes/Logout.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const GUEST_CACHE_KEYS = ["va:guest", "stay:token"]; // add more keys here if needed

function clearSupabaseAuthStorage() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Supabase stores tokens like: sb-<project-ref>-auth-token
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

async function unregisterServiceWorkers() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
}

export default function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1) Best-effort: revoke refresh token server-side (all tabs)
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        // ignore – we'll still wipe client state and force reload
      }

      // 2) Client hygiene: clear all local/session storage we use
      try {
        clearSupabaseAuthStorage();
        GUEST_CACHE_KEYS.forEach((k) => {
          try { localStorage.removeItem(k); } catch {}
        });
        try { sessionStorage.clear(); } catch {}
      } catch {
        /* ignore */
      }

      // 3) (Optional) ensure no stale SW keeps an old app shell around
      await unregisterServiceWorkers();

      // 4) Redirect home. Do SPA nav first, then hard reload as fallback.
      if (!cancelled) {
        navigate("/", { replace: true });
        // In case the router is mid-transition or a stale shell is cached
        setTimeout(() => {
          try {
            // Prefer replace() to avoid adding an extra history entry
            window.location.replace("/");
          } catch {
            window.location.href = "/";
          }
        }, 60);
      }
    })();

    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <main className="min-h-[40vh] grid place-items-center">
      <p className="text-sm text-gray-600">Signing you out…</p>
    </main>
  );
}
