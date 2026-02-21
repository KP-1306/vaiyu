// web/src/components/GuestGate.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function GuestGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return nav("/signin?redirect=%2Fguestold", { replace:true });
      setOk(true);
    })();
  }, [nav]);

  if (!ok) return null;
  return <>{children}</>;
}
