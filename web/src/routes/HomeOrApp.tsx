// web/src/routes/HomeOrApp.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

import Home from "./Home";
import GuestDashboard from "./GuestDashboard";

export default function HomeOrApp() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Allow `?app=1` or a local token chip to force the app view
  const forceApp = useMemo(() => {
    const sp = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    if (sp.get("app") === "1") return true;
    return !!(
      typeof window !== "undefined" && localStorage.getItem("stay:token")
    );
  }, []);

  // Snapshot the current auth session
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth
        .getSession()
        .catch(() => ({ data: { session: null } as any }));
      if (!mounted) return;
      setHasSession(!!data?.session);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Loading
  if (hasSession === null) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // If signed in OR user forced app view -> show dashboard; otherwise show marketing Home
  if (hasSession || forceApp) {
    return <GuestDashboard />;
  }
  return <Home />;
}
