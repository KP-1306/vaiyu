// web/src/hooks/useMemberships.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type Membership = {
  hotelSlug: string | null;
  hotelName: string | null;
  role: "viewer" | "staff" | "manager" | "owner";
};

export function useMemberships(userId: string | null) {
  const [loading, setLoading] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!userId) {
        setMemberships([]);
        return;
      }
      setLoading(true);
      try {
        // 1) member rows
        const { data: mems, error } = await supabase
          .from("hotel_members")
          .select("hotel_id, role, active")
          .eq("user_id", userId)
          .eq("active", true);

        if (error || !mems?.length) {
          if (alive) setMemberships([]);
          return;
        }

        const hotelIds = [...new Set(mems.map((m: any) => m.hotel_id))];
        const { data: hotels } = await supabase
          .from("hotels")
          .select("id, slug, name")
          .in("id", hotelIds);

        const byId = new Map((hotels || []).map((h: any) => [h.id, h]));

        const rows: Membership[] = mems.map((m: any) => ({
          hotelSlug: byId.get(m.hotel_id)?.slug ?? null,
          hotelName: byId.get(m.hotel_id)?.name ?? null,
          role: m.role,
        }));

        if (alive) setMemberships(rows);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  return { loading, memberships };
}
