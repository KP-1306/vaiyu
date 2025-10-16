// web/src/routes/Logout.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Utilities to purge any lingering local/session storage keys
function hardClearSupabaseStorage() {
  try {
    // Supabase stores the session in a key like: sb-<project-ref>-auth-token
    // We’ll remove anything that looks like it.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export default function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // 1) Revoke refresh token server-side and clear client state.
        //    scope:'global' ensures other tabs also get signed out.
        await supabase.auth.signOut({ scope: "global" });
      } catch {
        // ignore, we’ll force-clear anyway
      }

      // 2) Belt & suspenders: clear any lingering auth cache
      hardClearSupabaseStorage();
      localStorage.removeItem("va:guest");       // if you store guest info
      sessionStorage.clear();                    // optional

      // 3) Redirect to sign-in (add cache-buster so browsers don’t reuse history)
      navigate(`/signin?intent=signin&_=${Date.now()}`, { replace: true });
    })();
  }, [navigate]);

  return null;
}
