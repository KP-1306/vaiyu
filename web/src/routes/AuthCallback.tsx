import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

function safeRedirect(raw: string | null | undefined, fallback = "/welcome") {
  if (!raw) return fallback;
  try {
    // allow only same-origin relative paths like "/owner" or "/welcome?x=1"
    const u = new URL(raw, window.location.origin);
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
    let done = false;

    (async () => {
      try {
        // 1) Try hash-style tokens (implicit flow)
        const hash = window.location.hash || "";
        if (/access_token=|refresh_token=/.test(hash)) {
          await supabase.auth.getSessionFromUrl({ storeSession: true });
          done = true;
        }

        // 2) Fallback to PKCE code flow (?code=...)
        if (!done) {
          const code = params.get("code");
          if (code) {
            await supabase.auth.exchangeCodeForSession(code);
            done = true;
          }
        }

        // 3) If no tokens but session already exists, continue
        if (!done) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            done = true;
          }
        }

        // Destination (default /welcome), but keep it safe
        const dest = safeRedirect(params.get("redirect"), "/welcome");

        // Clean the URL (remove hash + sensitive params) before navigating
        const url = new URL(window.location.href);
        url.hash = "";
        ["code", "redirect", "error", "error_description"].forEach((k) =>
          url.searchParams.delete(k)
        );
        window.history.replaceState({}, "", url.pathname + url.search);

        if (done) {
          navigate(dest, { replace: true });
        } else {
          // no tokens and no session → back to sign-in with a friendly msg
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
    <div className="min-h-screen grid place-items-center">
      <div className="text-sm text-gray-600">Finishing sign-in…</div>
    </div>
  );
}
