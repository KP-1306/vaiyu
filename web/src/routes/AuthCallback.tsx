// web/src/routes/AuthCallback.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // Support both hash tokens and PKCE (?code=) links
        await supabase.auth
          .getSessionFromUrl({ storeSession: true })
          .catch(async () => {
            const code = new URLSearchParams(window.location.search).get("code");
            if (code) await supabase.auth.exchangeCodeForSession(code);
          });

        // Pick destination: ?redirect=… if present, else by role, else /
        const url = new URL(window.location.href);
        const explicit = url.searchParams.get("redirect");
        let dest = explicit || "/";

        if (!explicit) {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.id) {
              const { data: prof } = await supabase
                .from("user_profiles")
                .select("role")
                .eq("user_id", user.id)
                .maybeSingle();
              const role = prof?.role;
              if (role === "owner" || role === "manager") dest = "/owner";
              else if (role === "admin") dest = "/admin";
              else if (role === "hk") dest = "/hk";
              else if (role === "desk") dest = "/desk";
              else dest = "/guest";
            }
          } catch {/* ignore and keep default */}
        }

        // Clean URL then go
        url.hash = "";
        url.searchParams.delete("code");
        url.searchParams.delete("redirect");
        window.history.replaceState({}, "", url.pathname + url.search);
        navigate(dest, { replace: true });
      } catch (err) {
        // If anything fails, send back to sign-in (preserve redirect if any)
        const url = new URL(window.location.href);
        const redirect = url.searchParams.get("redirect");
        navigate(redirect ? `/signin?redirect=${encodeURIComponent(redirect)}` : "/signin", {
          replace: true,
        });
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-[50vh] grid place-items-center">
      <div className="text-center">
        <div className="text-lg font-medium">Signing you in…</div>
        <div className="text-sm text-gray-500 mt-1">Please wait a moment.</div>
      </div>
    </div>
  );
}
