// web/src/components/BackHome.tsx
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function BackHome() {
  const [hasSession, setHasSession] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setHasSession(Boolean(data.session));
    })();
    return () => { mounted = false; };
  }, [loc.pathname]);

  function go() {
    if (hasSession) {
      navigate("/welcome");
    } else {
      navigate("/");
    }
  }

  return (
    <button onClick={go} className="btn btn-light fixed top-3 left-3 z-40">
      ← {hasSession ? "Back to app" : "Back to website"}
    </button>
  );
}
