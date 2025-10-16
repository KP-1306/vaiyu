// web/src/routes/AuthCallback.tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // Claim session if needed (hash OR PKCE)
        const { data: cur } = await supabase.auth.getSession();
        if (!cur.session) {
          await supabase.auth.getSessionFromUrl({ storeSession: true }).catch(async () => {
            const code = sp.get("code");
            if (code) await supabase.auth.exchangeCodeForSession(code);
          });
        }

        // Decide destination
        const desired = sp.get("redirect");
        let dest = desired || "/guest";

        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("role, home_path")
            .eq("user_id", u.user.id)
            .maybeSingle();

          if (!desired) {
            const role = profile?.role;
            if (role === "owner" || role === "manager") dest = "/owner";
            else if (role === "staff") dest = "/desk";
            else dest = "/guest";
            if (profile?.home_path) dest = profile.home_path;
          }
        }

        navigate(dest, { replace: true });
      } catch {
        navigate("/signin", { replace: true });
      }
    })();
  }, [navigate, sp]);

  return (
    <div className="min-h-[50vh] grid place-items-center">
      <div className="text-center">
        <div className="text-lg font-medium">Signing you in…</div>
        <div className="text-sm text-gray-500 mt-1">Please wait.</div>
      </div>
    </div>
  );
}
