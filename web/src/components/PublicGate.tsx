// web/src/components/PublicGate.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * If a session exists, immediately send the user to /welcome.
 * Otherwise render the public page.
 */
export default function PublicGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let unsub = () => { };
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate("/guest", { replace: true });
        return;
      }
      setReady(true);

      // If they sign in while on a public page, move them to /welcome
      const sub = supabase.auth.onAuthStateChange((_evt, session) => {
        if (session) navigate("/guest", { replace: true });
      });
      unsub = () => sub.data.subscription.unsubscribe();
    })();

    return () => unsub();
  }, [navigate]);

  return ready ? <>{children}</> : null;
}
