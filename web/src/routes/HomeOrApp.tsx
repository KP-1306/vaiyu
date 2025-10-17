// web/src/routes/HomeOrApp.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// 👇 Use whatever your current homepage component is.
// If your file is named differently, just change the import.
import Home from "./Home"; // or "./MarketingHome", "./Landing", etc.

export default function HomeOrApp() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      if (!mounted) return;

      // If we already have a session, go straight to the app
      if (data?.session) {
        navigate("/guest", { replace: true });
      }
    })();

    // Also react if the user logs in on this page
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (s?.user) navigate("/guest", { replace: true });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  // While signed out, render the normal marketing homepage.
  return <Home />;
}
