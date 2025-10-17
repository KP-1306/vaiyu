import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Never throws; always lands somewhere valid.
// Decision order (customize as needed):
// 1) ?next=/some/path (same-origin only) → redirect there
// 2) If signed in and user has "owner" role → /owner/dashboard
// 3) If signed in (guest) → /guest
// 4) Else → /guest (public landing)

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
      try {
        // 1) honor explicit next= param if it's safe
        const next = safeSameOriginPath(params.get("next")) || safeSameOriginPath(params.get("redirect"));
        if (next) {
          if (!cancelled) nav(next, { replace: true });
          return;
        }

        // 2) check session
        const { data } = await supabase.auth.getSession().catch(() => ({ data: null as any }));
        const session = data?.session ?? null;

        // 3) read a quick role flag from user_metadata (customize your source)
        const role = (session?.user?.user_metadata?.role as string | undefined)?.toLowerCase();

        const dest =
          role === "owner"
            ? "/owner/dashboard"
            : session
            ? "/guest"
            : "/guest"; // public landing is also /guest for now

        if (!cancelled) nav(dest, { replace: true });
      } catch (e) {
        // last-resort: never crash the route
        console.error("[SmartLanding] unexpected", e);
        if (!cancelled) nav("/guest", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nav, params]);

  return (
    <main className="min-h-[40vh] grid place-items-center">
      <div className="text-sm text-gray-600">Taking you to your dashboard…</div>
    </main>
  );
}
