import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

type HotelRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  cover_image_url: string | null;
  role?: string | null; // from membership (if you add it to the view)
};

export default function Owner() {
  const [loading, setLoading] = useState(true);
  const [hotels, setHotels] = useState<HotelRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // View returns only hotels where auth user is a member
      const { data, error } = await supabase
        .from("hotels_for_user")
        .select("id,name,slug,city,cover_image_url,role")
        .order("name", { ascending: true });

      if (!alive) return;
      if (error) {
        console.error(error);
        setHotels([]);
      } else {
        setHotels(data || []);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading your properties…" />
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <BackHome />
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Owner console</h1>
          <p className="text-sm text-gray-600">Select a property to manage.</p>
        </div>
        <Link to="/owner/onboard" className="btn btn-light">+ Add property</Link>
      </header>

      {hotels.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-sm">
          You don’t have access to any properties yet.
          <div className="mt-3">
            <Link to="/owner/onboard" className="btn">Register a property</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hotels.map((h) => (
            <Link
              key={h.id}
              to={`/owner/${h.slug}`}
              className="rounded-xl border bg-white hover:shadow-md transition p-4 flex flex-col"
            >
              <div className="h-32 rounded-lg overflow-hidden bg-gray-100 mb-3">
                {h.cover_image_url ? (
                  <img src={h.cover_image_url} alt={h.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-gray-400 text-xs">No photo</div>
                )}
              </div>
              <div className="text-base font-medium">{h.name}</div>
              <div className="text-xs text-gray-500">{h.city || "—"}</div>
              {h.role ? <div className="text-[11px] mt-1 px-2 py-0.5 bg-gray-100 rounded w-fit">{h.role}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
