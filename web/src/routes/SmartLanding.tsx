import { useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Behavior:
 * - If there's a signed-in session:
 *     owner  -> /owner/dashboard
 *     others -> /guest
 * - If NOT signed in: render a public landing (no redirect).
 * - If a safe ?next=/path or ?redirect=/path is present, go there first.
 */
function safeSameOriginPath(raw: string | null) {
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    if (!u.pathname.startsWith("/")) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export default function SmartLanding() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1) honor ?next or ?redirect if safe
      const deeplink =
        safeSameOriginPath(params.get("next")) ??
        safeSameOriginPath(params.get("redirect"));
      if (deeplink) {
        if (!cancelled) nav(deeplink, { replace: true });
        return;
      }

      // 2) check session (don’t throw if supabase not ready)
      const { data } = await supabase.auth
        .getSession()
        .catch(() => ({ data: null as any }));
      const session = data?.session ?? null;

      if (session) {
        const role = String(session.user?.user_metadata?.role || "").toLowerCase();
        const dest = role === "owner" ? "/owner/dashboard" : "/guest";
        if (!cancelled) nav(dest, { replace: true });
      }
      // 3) else: fall through and render the public landing below
    })();

    return () => {
      cancelled = true;
    };
  }, [nav, params]);

  return <PublicLanding />;
}

/** Simple public landing (customize the copy/CTA as you like). */
function PublicLanding() {
  return (
    <main className="max-w-5xl mx-auto p-8">
      <section className="rounded-2xl border bg-white p-6">
        <h1 className="text-2xl font-semibold">Welcome to VAiyu</h1>
        <p className="mt-2 text-gray-700">
          Guest journeys, owner console, and grid-interactive operations.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="btn" to="/signin">Sign in</Link>
          <Link className="btn btn-light" to="/guest">Explore guest portal</Link>
          <Link className="btn btn-light" to="/owner/register">Register your property</Link>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Instant check-in</div>
          <p className="text-sm text-gray-600 mt-1">Scan on arrival and skip the queue.</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Bills & reviews</div>
          <p className="text-sm text-gray-600 mt-1">Find stays, download bills, leave feedback.</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Owner console</div>
          <p className="text-sm text-gray-600 mt-1">Dashboards, SLAs and automations.</p>
        </div>
      </section>
    </main>
  );
}
