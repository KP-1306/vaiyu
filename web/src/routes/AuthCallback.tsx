// web/src/routes/AuthCallback.tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

/** Allow only same-origin, app-internal redirects. Default to "/" (SmartLanding). */
function safeRedirect(raw: string | null | undefined, fallback = "/") {
  if (!raw) return fallback;
  try {
    const u = new URL(raw, window.location.origin);
    // block cross-origin and non-rooted paths
    if (u.origin !== window.location.origin) return fallback;
    if (!u.pathname.startsWith("/")) return fallback;
    return u.pathname + (u.search || "") + (u.hash || "");
  } catch {
    return fallback;
  }
}

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let finished = false;

    (async () => {
      try {
        // 1) Hash-style tokens (implicit flow)
        const hash = window.location.hash || "";
        if (/access_token=|refresh_token=/.test(hash)) {
          await supabase.auth.getSessionFromUrl({ storeSession: true });
          finished = true;
        }

        // 2) PKCE code flow (?code=...)
        if (!finished) {
          const code = params.get("code");
          if (code) {
            await supabase.auth.exchangeCodeForSession(code);
            finished = true;
          }
        }

        // 3) Already signed in (no tokens in URL but session exists)
        if (!finished) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) finished = true;
        }

        // Decide destination: default to "/" so SmartLanding kicks in
        const dest = safeRedirect(params.get("redirect"), "/");

        // Clean sensitive params & hash from the URL before navigation
        const clean = new URL(window.location.href);
        clean.hash = "";
        ["code", "redirect", "error", "error_description"].forEach((k) =>
          clean.searchParams.delete(k)
        );
        window.history.replaceState({}, "", clean.pathname + clean.search);

        if (finished) {
          navigate(dest, { replace: true });
        } else {
          // No valid tokens and no session → back to sign-in with friendly message
          navigate(
            `/signin?intent=signin&redirect=${encodeURIComponent(dest)}&error=${encodeURIComponent(
              "Login link is missing or expired. Please request a new one."
            )}`,
            { replace: true }
          );
        }
      } catch (e) {
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
    <div className="min-h-[50vh] grid place-items-center">
      <Spinner label="Signing you in…" />
    </div>
  );
}
