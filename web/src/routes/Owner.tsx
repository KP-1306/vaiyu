// web/src/routes/Owner.tsx
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import Spinner from "@/components/Spinner";

type HotelCard = { id: string; slug: string; name: string };

export default function Owner() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hotels, setHotels] = useState<HotelCard[]>([]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id;
        if (!uid) { setErr("Not signed in."); setLoading(false); return; }

        // 1) memberships (must be allowed by RLS)
        const memRes = await supabase
          .from("hotel_members")
          .select("hotel_id")
          .eq("user_id", uid);

        if (memRes.error) throw memRes.error;
        const ids = (memRes.data ?? []).map(m => m.hotel_id);
        if (ids.length === 0) { setHotels([]); setLoading(false); return; }

        // 2) hotels for those ids (must be allowed by RLS)
        const hotRes = await supabase
          .from("hotels")
          .select("id, slug, name")
          .in("id", ids);

        if (hotRes.error) throw hotRes.error;

        const hs = (hotRes.data ?? []) as HotelCard[];
        if (!alive) return;

        setHotels(hs);
        setLoading(false);

        // Auto-open when there’s exactly one property
        if (hs.length === 1 && hs[0].slug) {
          nav(`/owner/${hs[0].slug}`, { replace: true });
        }
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load your properties.");
        setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [nav]);

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner label="Loading your properties..." />
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-xl mx-auto p-6 rounded-2xl border bg-rose-50 text-rose-900">
        <div className="font-semibold mb-2">Couldn’t load your properties</div>
        <div className="text-sm mb-3">{err}</div>
        <ul className="text-xs list-disc ml-5 space-y-1">
          <li>Check that you’re signed in with the invited/owner email.</li>
          <li>Make sure RLS policies allow <code>SELECT</code> on <code>hotel_members</code> and <code>hotels</code>.</li>
        </ul>
      </div>
    );
  }

  // render your existing grid/list
  return (
    <main className="max-w-6xl mx-auto p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Owner console</h1>
        <Link to="/owner/register" className="btn btn-light">+ Add property</Link>
      </header>

      {hotels.length === 0 ? (
        <div className="rounded-2xl border p-6 bg-gray-50">
          <div className="font-medium mb-1">No properties yet</div>
          <div className="text-sm text-gray-600">Add a property or accept an invite sent to your email.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {hotels.map(h => (
            <Link key={h.id} to={`/owner/${h.slug}`} className="rounded-2xl border p-4 bg-white hover:shadow-sm">
              <div className="h-28 rounded-xl bg-gray-100 grid place-items-center text-gray-400">No photo</div>
              <div className="mt-3 font-medium">{h.name}</div>
              <div className="text-xs mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5">owner</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
