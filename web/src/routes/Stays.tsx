// web/src/routes/Stays.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Stay = {
  id: string;
  hotel_id: string;
  hotel_name: string;
  city?: string | null;
  cover_image_url?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  earned_paise?: number | null; // credits earned for this stay
  review_status?: "pending" | "draft" | "published" | null;
};

const inr = (p = 0) => `₹${((p ?? 0) / 100).toFixed(2)}`;

export default function Stays() {
  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    try {
      // 1) Session gate
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const uid = sess.session?.user?.id;
      if (!uid) {
        setNeedsAuth(true);
        return;
      }

      // 2) Try a view first, then fall back to a base table
      // View shape we expect: user_recent_stays (recommended)
      let rows: any[] | null = null;
      let err: any = null;

      const v1 = await supabase
        .from("user_recent_stays")
        .select(
          "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status"
        )
        .order("check_in", { ascending: false })
        .limit(10);

      if (!v1.error) rows = v1.data ?? null;
      else err = v1.error;

      if (!rows) {
        // Fallback: generic stays table joined via RPC or view on server
        const v2 = await supabase
          .from("stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status"
          )
          .eq("user_id", uid)
          .order("check_in", { ascending: false })
          .limit(10);

        if (!v2.error) rows = v2.data ?? null;
        else err = v2.error;
      }

      if (!rows && err) throw err;
      setStays((rows ?? []) as Stay[]);
    } catch (e: any) {
      console.error("[/stays] load failed:", e);
      setError(e?.message || "Could not load your stays.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const hasData = useMemo(() => (stays?.length ?? 0) > 0, [stays]);

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Your stays</h1>
        <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
      </div>
      <p className="text-sm text-gray-600 mt-1">
        A tidy place for your trips, bills, reviews, and rewards—coming together here.
      </p>

      {needsAuth && !loading && (
        <div className="mt-4 p-3 rounded-md bg-amber-50 text-amber-800 text-sm">
          Please sign in to view your stays. <a href="/signin" className="underline">Go to sign in</a>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          {error} <button className="underline ml-2" onClick={load}>Retry</button>
        </div>
      )}

      {/* Show skeleton ONLY while loading */}
      {loading && <SkeletonGrid />}

      {/* ⬇️ The important part: if no data, DON'T render the card grid */}
      {!loading && !hasData && !error && !needsAuth && (
        <EmptyState />
      )}

      {!loading && hasData && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          {stays.map((s) => (
            <Link
              key={s.id}
              to={`/stays/${s.id}`}
              className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden hover:shadow-md transition"
            >
              <div className="flex">
                {s.cover_image_url ? (
                  <img src={s.cover_image_url} alt="" className="w-32 h-32 object-cover hidden sm:block" />
                ) : (
                  <div className="w-32 h-32 hidden sm:block bg-gradient-to-br from-slate-100 to-slate-200" />
                )}
                <div className="flex-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{s.hotel_name}</h3>
                    <span className="text-xs text-gray-500">{s.city || ""}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-700">
                    {(s.check_in || s.check_out) ? (
                      <>
                        {s.check_in ? new Date(s.check_in).toLocaleDateString() : "—"} →{" "}
                        {s.check_out ? new Date(s.check_out).toLocaleDateString() : "—"}
                      </>
                    ) : "Dates coming soon"}
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="text-gray-500">Credits:</span>{" "}
                    <span className="font-medium">{inr(s.earned_paise ?? 0)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}

function SkeletonGrid() {
  return (
    <section className="mt-6 grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border bg-white/90 shadow-sm p-4">
          <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
          <div className="h-24 w-full bg-gray-100 rounded" />
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-20 bg-gray-200 rounded" />
            <div className="h-6 w-20 bg-gray-200 rounded" />
          </div>
        </div>
      ))}
    </section>
  );
}

function EmptyState() {
  return (
    <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6 text-center">
      <p className="text-sm text-gray-600">
        No stays yet. When you book and check in at a partner hotel, your trips will appear here.
      </p>
      <div className="mt-3">
        <a className="btn" href="/hotel/demo">Explore a demo stay</a>
      </div>
    </section>
  );
}
