// web/src/routes/HomeOrApp.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Lazy import your real pages to keep this file tiny and safe,
// but you can also keep the direct imports if you prefer.
const Home = React.lazy(() => import("./Home"));
const GuestDashboard = React.lazy(() => import("./GuestDashboard"));

function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-[40vh] grid place-items-center text-sm text-gray-600">
      {label}
    </div>
  );
}

export default function HomeOrApp() {
  // 1) Session snapshot
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // 2) “force app” switch (?app=1 or guest chip in localStorage)
  const forceApp = useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("app") === "1") return true;
      return !!localStorage.getItem("stay:token");
    } catch {
      return false;
    }
  }, []);

  // 3) Load session once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        setHasSession(!!data?.session);
      } catch {
        if (!alive) return;
        setHasSession(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 4) Initial spinner while we check
  if (hasSession === null) {
    return <Spinner label="Loading…" />;
  }

  // 5) Decide what to show
  const showApp = hasSession || forceApp;

  return (
    <React.Suspense fallback={<Spinner />}>
      {showApp ? <GuestDashboard /> : <Home />}
    </React.Suspense>
  );
}
