import { useEffect } from "react";
import { supabase } from "../lib/supabase";

/** On tab focus/visibility change, validate the session; if missing/expired, sign out. */
export function useFocusAuthCheck() {
  useEffect(() => {
    const check = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        try { await supabase.auth.signOut({ scope: "global" }); } catch {}
        window.location.replace("/logout");
        return;
      }
      const expMs = data.session?.expires_at ? data.session.expires_at * 1000 : 0;
      if (!data.session || (expMs && Date.now() > expMs)) {
        try { await supabase.auth.signOut({ scope: "global" }); } catch {}
        window.location.replace("/logout");
      }
    };

    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
}
