// web/src/routes/Stays.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type StayView = {
  id: string;
  hotel_id: string;
  hotel_name?: string | null;
  city?: string | null;
  cover_image_url?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  earned_paise?: number | null;
  review_status?: string | null;
};

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export default function Stay() {
  const { id = "" } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [stay, setStay] = useState<StayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dates = useMemo(() => {
    if (!stay) return null;
    const ci = stay.check_in ? new Date(stay.check_in) : null;
    const co = stay.check_out ? new Date(stay.check_out) : null;
    return { ci, co };
  }, [stay]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setStay(null);

      // If the route param is not a UUID (e.g., /stay/s3), show a friendly “not found”.
      if (!id || !isUuid(id)) {
        setLoading(false);
        setError("We couldn’t find that stay.");
        return;
      }

      try {
        // 1) Preferred: read from the view (works with our list page)
        const v = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status"
          )
          .eq("id", id)
          .maybeSingle();

        if (!alive) return;

        if (!v.error && v.data) {
          setStay(v.data as StayView);
          setLoading(false);
          return;
        }

        // 2) Fallback: pull base stay + hydrate hotel bits
        const s = await supabase
          .from("stays")
          .select("id, hotel_id, check_in, check_out, earned_paise, review_status")
          .eq("id", id)
          .maybeSingle();

        if (!alive) return;

        if (!s.error && s.data) {
          const base = s.data as Partial<StayView>;
          let hotel_name: string | null = null;
          let city: string | null = null;
          if (base.hotel_id) {
            const h = await supabase
              .from("hotels")
              .select("name, city, cover_image_url")
              .eq("id", base.hotel_id)
              .maybeSingle();
            if (!alive) return;
            if (!h.error && h.data) {
              hotel_name = (h.data as any).name ?? null;
              city = (h.data as any).city ?? null;
              (base as any).cover_image_url = (h.data as any).cover_image_url ?? null;
            }
          }
          setStay({
            id: base.id as string,
            hotel_id: base.hotel_id as string,
            hotel_name,
            city,
            cover_image_url: (base as any).cover_image_url ?? null,
            check_in: (base as any).check_in ?? null,
            check_out: (base as any).check_out ?? null,
            earned_paise: (base as any).earned_paise ?? 0,
            review_status: (base as any).review_status ?? null,
          });
        } else {
          setError("We couldn’t find that stay.");
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Something went wrong.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stay details</h1>
        {/* Single, clear CTA — removes duplicate labels */}
        <Link to="/stays" className="btn btn-light">Back to all stays</Link>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <div className="h-4 w-56 bg-gray-200 rounded mb-3" />
          <div className="h-24 w-full bg-gray-100 rounded" />
        </section>
      )}

      {/* Not found / no data state */}
      {!loading && (error || !stay) && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <p className="text-sm text-gray-700">
            {error || "We couldn’t find that stay."} If you haven’t stayed with a partner hotel yet,
            you’ll see your trips here once they’re available.
          </p>
          <div className="mt-4 flex gap-2">
            <Link to="/stays" className="btn">Browse all stays</Link>
            <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
          </div>
        </section>
      )}

      {/* Happy path */}
      {!loading && stay && (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {stay.hotel_name ?? "Partner hotel"}
                </h2>
                <p className="text-sm text-gray-500">{stay.city ?? ""}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-sm">
              <div>
                <span className="text-gray-500">Dates:</span>{" "}
                {dates?.ci || dates?.co
                  ? `${dates?.ci ? dates.ci.toLocaleDateString() : "—"} → ${dates?.co ? dates.co.toLocaleDateString() : "—"}`
                  : "Coming soon"}
              </div>
              <div>
                <span className="text-gray-500">Credits:</span>{" "}
                ₹{(((stay.earned_paise ?? 0) as number) / 100).toFixed(2)}
              </div>
              {stay.review_status && (
                <div>
                  <span className="text-gray-500">Review:</span> {stay.review_status}
                </div>
              )}
            </div>

            <div className="mt-6">
              <Link to="/stays" className="btn">Back to all stays</Link>
              <Link to="/guest" className="btn btn-light ml-2">Back to dashboard</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
