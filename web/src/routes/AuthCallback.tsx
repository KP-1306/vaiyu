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
        // 1) Try claiming the session if it hasn't been claimed yet
        const { data: got } = await supabase.auth.getSession();
        if (!got.session) {
          await supabase.auth.getSessionFromUrl({ storeSession: true }).catch(async () => {
            const code = sp.get("code");
            if (code) await supabase.auth.exchangeCodeForSession(code);
          });
        }

        // 2) Decide where to go
        const desired = sp.get("redirect"); // e.g. "/owner" from the magic-link
        let dest = desired || "/guest";

        // 3) If you keep roles in user_profiles, decide by role
        const { data: user } = await supabase.auth.getUser();
        if (user?.user) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("role, home_path")
            .eq("user_id", user.user.id)
            .maybeSingle();

          // Role-based default if no explicit redirect was requested
          if (!desired) {
            const role = profile?.role;
            if (role === "owner" || role === "manager") dest = "/owner";
            else if (role === "staff") dest = "/desk";
            else dest = "/guest";
          }

          // Optional override from DB
          if (!desired && profile?.home_path) dest = profile.home_path;
        }

        navigate(dest, { replace: true });
      } catch {
        // If something went wrong, drop them to sign in
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
