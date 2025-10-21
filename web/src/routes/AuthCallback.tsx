// web/src/routes/AuthCallback.tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Spinner from "../components/Spinner";
import { consumeAuthFromUrl, getCurrentSession } from "../lib/auth";

/**
 * Normalize a redirect target:
 * - Same-origin only
 * - Rooted path only (starts with "/")
 * - Coerce legacy "/welcome" to "/guest"
 * - Fallback to "/guest" if anything looks off
 */
function safeRedirect(raw: string | null | undefined, fallback = "/guest") {
  const normalize = (p: string) => (p.startsWith("/welcome") ? "/guest" : p);
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
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) Try to consume tokens/code from the URL (magic link / OAuth PKCE).
      const consumed = await consumeAuthFromUrl();

      // 2) If we have a session (either consumed now or already signed in), continue.
      const sess = await getCurrentSession();

      // Destination preference: ?redirect=… (or legacy ?next=…)
      const rawDest = params.get("redirect") ?? params.get("next");
      const dest = safeRedirect(rawDest, "/guest");

      // Clean sensitive params + hash from the URL before navigating
      const clean = new URL(window.location.href);
      clean.hash = "";
      ["code", "redirect", "next", "error", "error_description", "provider_token"].forEach((k) =>
        clean.searchParams.delete(k)
      );
      window.history.replaceState({}, "", clean.pathname + clean.search);

      if (!alive) return;

      if (sess) {
        // Success → go to the app
        navigate(dest, { replace: true });
      } else {
        // No session (invalid/expired link) → send back to signin
        const intent = params.get("intent") || "signin";
        navigate(
          `/signin?intent=${encodeURIComponent(
            intent
          )}&redirect=${encodeURIComponent(dest)}&error=${encodeURIComponent(
            "Login link is missing or expired. Please request a new one."
          )}`,
          { replace: true }
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigate, params]);

  return (
    <div className="min-h-[50vh] grid place-items-center">
      <Spinner label="Signing you in…" />
    </div>
  );
}
