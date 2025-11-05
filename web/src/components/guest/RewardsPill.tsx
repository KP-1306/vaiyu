// web/src/components/guest/RewardsPill.tsx

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const inr = (paise: number) => `₹${(paise / 100).toFixed(0)}`;

export default function RewardsPill() {
  const [paise, setPaise] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setErr(null);
        const { data: sess, error: sErr } = await supabase.auth.getSession();
        if (sErr) throw sErr;
        const uid = sess.session?.user?.id;
        if (!uid) {
          setPaise(0);
          return;
        }
        const { data, error } = await supabase.rpc("get_rewards_available", { p_user: uid });
        if (error) throw error;
        if (alive) setPaise(Number(data ?? 0));
      } catch (e: any) {
        if (alive) {
          setErr(e?.message || "Failed to load");
          setPaise(0);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <Link to="/rewards"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 bg-white hover:shadow-sm transition"
      title="View Rewards & Vouchers"
    >
      <span className="i-gift text-sm" />
      <span className="text-sm font-medium">Rewards & Vouchers</span>
      <span className="text-xs text-gray-600">
        {paise === null ? "…" : inr(paise)}
      </span>
      {err ? <span className="sr-only">({err})</span> : null}
    </Link>
  );
}
