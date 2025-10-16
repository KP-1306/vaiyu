import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let done = false;

    (async () => {
      try {
        // Try hash-style (getSessionFromUrl) first:
        const hash = window.location.hash || "";
        if (/access_token=|refresh_token=/.test(hash)) {
          await supabase.auth.getSessionFromUrl({ storeSession: true });
          done = true;
        }

        // Fallback: PKCE "code" flow (query param)
        if (!done) {
          const code = params.get("code");
          if (code) {
            await supabase.auth.exchangeCodeForSession(code);
            done = true;
          }
        }

        // Where to go next (default /welcome)
        const dest = params.get("redirect") || "/welcome";

        // Clean URL (strip hash + sensitive params) before navigating
        const url = new URL(window.location.href);
        url.hash = "";
        ["code", "redirect", "error", "error_description"].forEach((k) =>
          url.searchParams.delete(k)
        );
        window.history.replaceState({}, "", url.pathname + url.search);

        navigate(dest, { replace: true });
      } catch (e) {
        // If something failed, push the user to a safe sign-in with a message
        const message =
          (e as any)?.message || "Could not complete login. Please try again.";
        navigate(
          `/signin?intent=signin&error=${encodeURIComponent(message)}`,
          { replace: true }
        );
      }
    })();
  }, [navigate, params]);

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="text-sm text-gray-600">Finishing sign-in…</div>
    </div>
  );
}
