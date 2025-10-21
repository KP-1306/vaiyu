// web/src/components/Protected.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Protected({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setAuthed(!!data.session);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return null; // or a nice spinner
  if (!authed) {
    const redirect = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/signin?intent=signin&redirect=${redirect}`} replace />;
  }
  return <>{children}</>;
}
