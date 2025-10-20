import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function OwnerHomeRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return nav("/signin?redirect=/owner/home", { replace: true });

      // memberships
      const mem = await supabase.from("hotel_members").select("hotel_id").eq("user_id", uid);
      if (mem.error || !mem.data?.length) return nav("/owner", { replace: true });

      const ids = mem.data.map(m => m.hotel_id);
      const hs = await supabase.from("hotels").select("slug").in("id", ids);
      if (hs.error || !hs.data?.length) return nav("/owner", { replace: true });

      const slug = hs.data[0].slug;
      if (alive && slug) nav(`/owner/${slug}`, { replace: true });
    })();
    return () => { alive = false; };
  }, [nav]);
  return null;
}
