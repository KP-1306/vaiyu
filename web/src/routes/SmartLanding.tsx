// web/src/routes/SmartLanding.tsx
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import App from "../App";                    // public marketing landing
import GuestDashboard from "./GuestDashboard";
import Spinner from "../components/Spinner";
import { supabase } from "../lib/supabase";

type LiteUser = { id: string; email?: string | null; user_metadata?: any; app_metadata?: any } | null;

function getRole(u: LiteUser): "guest" | "owner" | "staff" | "admin" {
  // Adjust if you store role elsewhere
  return (
    u?.user_metadata?.role ||
    u?.app_metadata?.role ||
    "guest"
  );
}

const OWNER_DEST = "/owner"; // change to "/owner/home" if that's your owner route

export default function SmartLanding() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<LiteUser>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setUser(data?.user ?? null);
      setLoading(false);

      // keep in sync with auth events
      const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
        if (!mounted) return;
        setUser(sess?.user ?? null);
      });
      return () => sub.subscription.unsubscribe();
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) return <App />;

  const role = getRole(user);
  if (role === "guest") return <GuestDashboard />;
  if (role === "owner" || role === "staff" || role === "admin") {
    return <Navigate to={OWNER_DEST} replace />;
  }
  return <App />;
}
