import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";

export default function OwnerConsoleButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) return setShow(false);
      const { data, error, count } = await supabase
        .from("hotel_members")
        .select("hotel_id", { head: true, count: "exact" })
        .eq("user_id", sess.session.user.id);
      if (!alive) return;
      if (error) return setShow(false);
      setShow(!!count && count > 0);
    })();
    return () => { alive = false; };
  }, []);

  if (!show) return null;
  return <Link to="/owner" className="btn">Owner console</Link>;
}
