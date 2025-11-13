// web/src/routes/AuthCallback.tsx
import { useEffect, useState } from "react";
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
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // 1) Try to consume tokens/code from the URL (magic link / OAuth PKCE).
        try {
          await consumeAuthFromUrl();
        } catch (err) {
          // We log but DO NOT block login if this helper fails.
          console.error("AuthCallback: consumeAuthFromUrl failed", err);
        }

        // 2) Try to get the current session; if this fails we treat as "no session"
        let sess: Awaited<ReturnType<typeof getCurrentSession>> | null = null;
        try {
          sess = await getCurrentSession();
        } catch (err) {
          console.error("AuthCallback: getCurrentSession failed", err);
        }

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
          // ✅ Success → go to the app (e.g. /desk/tickets)
          navigate(dest, { replace: true });
        } else {
          // ❌ No session (invalid/expired link) → send back to signin
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
      } catch (err) {
        // Catch any unexpected top-level error so we NEVER hang on the spinner
        console.error("AuthCallback: unexpected fatal error", err);
        if (!alive) return;
        setFatalError(
          "We couldn’t complete the sign-in. Please close this tab and try again from the app."
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigate, params]);

  if (fatalError) {
    return (
      <div className="min-h-[50vh] grid place-items-center px-4">
        <div className="max-w-md text-center">
          <p className="text-sm text-red-700 mb-3">{fatalError}</p>
          <a href="/signin" className="text-sm text-blue-600 underline">
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[50vh] grid place-items-center">
      <Spinner label="Signing you in…" />
    </div>
  );
}
