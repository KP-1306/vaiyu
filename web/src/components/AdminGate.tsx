import { ReactNode, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AdminGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return setOk(false);

      // Light check: query profile role
      const { data: row } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      setOk(row?.role === "admin");
    })();
  }, []);

  if (ok === null) return <p>Checking access…</p>;
  if (!ok) return <p>Access denied.</p>;

  return <>{children}</>;
}
