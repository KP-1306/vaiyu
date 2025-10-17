import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

/**
 * Normalize a redirect target:
 * - Same-origin only
 * - Rooted path only (starts with "/")
 * - Coerce any legacy "/welcome" URLs to "/"
 * - Fallback to "/" if anything looks off
 */
function safeRedirect(raw: string | null | undefined, fallback = "/") {
  const normalize = (p: string) => (p.startsWith("/welcome") ? "/" : p);

  if (!raw) return fallback;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return fallback;
    if (!u.pathname.startsWith("/")) return fallback;
    return normalize(u.pathname + (u.search || "") + (u.hash || ""));
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
        // 1) Handle implicit (hash) flow
        const hash = window.location.hash || "";
        if (/access_token=|refresh_token=/.test(hash)) {
          await supabase.auth.getSessionFromUrl({ storeSession: true });
          finished = true;
        }

        // 2) Handle PKCE code flow
        if (!finished) {
          const code = params.get("code");
          if (code) {
            await supabase.auth.exchangeCodeForSession(code);
            finished = true;
          }
        }

        // 3) If no tokens but already signed in, continue
        if (!finished) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) finished = true;
        }

        // Prefer ?redirect=…, or accept ?next=… as a backup
        const rawDest = params.get("redirect") ?? params.get("next");
        const dest = safeRedirect(rawDest, "/");

        // Clean sensitive params + hash before we navigate
        const clean = new URL(window.location.href);
        clean.hash = "";
        [
          "code",
          "redirect",
          "next",
          "error",
          "error_description",
          "provider_token",
        ].forEach((k) => clean.searchParams.delete(k));
        window.history.replaceState({}, "", clean.pathname + clean.search);

        if (finished) {
          navigate(dest, { replace: true });
        } else {
          // No valid tokens/session → back to sign-in
          navigate(
            `/signin?intent=signin&redirect=${encodeURIComponent(
              dest
            )}&error=${encodeURIComponent(
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
