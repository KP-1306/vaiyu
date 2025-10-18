// web/src/routes/Logout.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Remove any lingering Supabase session keys from localStorage.
 * Supabase stores sessions under keys like: sb-<project-ref>-auth-token
 */
function hardClearSupabaseStorage() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export default function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1) Revoke refresh token server-side for ALL tabs.
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        // ignore – we'll still clear client cache and redirect
      }

      // 2) Extra hygiene (client-side)
      hardClearSupabaseStorage();
      try {
        localStorage.removeItem("va:guest"); // if you cache guest info
      } catch {}
      try {
        sessionStorage.clear();
      } catch {}

      // 3) Redirect to PUBLIC HOME (consistent with BackHome pill + new flow)
      if (!cancelled) navigate("/", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Lightweight UX while sign-out happens
  return (
    <main className="min-h-[40vh] grid place-items-center">
      <p className="text-sm text-gray-600">Signing you out…</p>
    </main>
  );
}
