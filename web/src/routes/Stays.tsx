// web/src/routes/Stays.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type StayRow = {
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

export default function Stays() {
  const [rows, setRows] = useState<StayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasRows = rows.length > 0;

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from("user_recent_stays")
          .select(
            "id, hotel_id, hotel_name, city, cover_image_url, check_in, check_out, earned_paise, review_status"
          )
          .order("check_in", { ascending: false });

        if (!alive) return;

        if (error) {
          console.error("[Stays] supabase error", error);
          setError(error.message || "Could not load your stays.");
          setRows([]);
          return;
        }

        setRows((data || []) as StayRow[]);
      } catch (e: any) {
        if (!alive) return;
        console.error("[Stays] unexpected error", e);
        setError(e?.message || "Could not load your stays.");
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const totals = useMemo(() => {
    if (!hasRows) return null;
    let totalPaise = 0;
    for (const r of rows) {
      totalPaise += r.earned_paise ?? 0;
    }
    return {
      totalCreditsPaise: totalPaise,
    };
  }, [rows, hasRows]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Your stays</h1>
          <p className="text-sm text-gray-600 mt-1">
            See past and recent stays at VAiyu partner properties.
          </p>
        </div>
        <Link to="/guest" className="btn btn-light">
          Back to dashboard
        </Link>
      </div>

      {loading ? (
        <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-6">
          <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
          <div className="h-24 w-full bg-gray-100 rounded" />
        </section>
      ) : error ? (
        <section className="mt-6 rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm">
          <p className="text-gray-800">{error}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-light"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <Link to="/guest" className="btn btn-light">
              Back to dashboard
            </Link>
          </div>
        </section>
      ) : !hasRows ? (
        <EmptyState />
      ) : (
        <>
          {totals && (
            <section className="mt-5 rounded-2xl border bg-slate-50/80 p-4 text-xs text-gray-700 flex flex-wrap items-center gap-3">
              <span className="font-semibold">
                Total credits earned across stays:
              </span>
              <span className="px-3 py-1 rounded-full bg-white shadow-sm border text-sm">
                ₹{(totals.totalCreditsPaise / 100).toFixed(2)}
              </span>
            </section>
          )}

          <section className="mt-5 grid gap-3">
            {rows.map((r) => (
              <StayCard key={r.id} row={r} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function StayCard({ row }: { row: StayRow }) {
  const { id, hotel_name, city, check_in, check_out, earned_paise, review_status } =
    row;

  const datesLabel =
    check_in || check_out
      ? `${check_in ? new Date(check_in).toLocaleDateString() : "—"} → ${
          check_out ? new Date(check_out).toLocaleDateString() : "—"
        }`
      : "Dates to be updated";

  const creditsRupees = ((earned_paise ?? 0) / 100).toFixed(2);

  return (
    <Link
      to={`/stay/${encodeURIComponent(id)}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border bg-white/90 hover:bg-slate-50 shadow-sm px-4 py-3 transition-colors"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">
          {hotel_name || "Partner hotel"}
        </div>
        <div className="text-xs text-gray-500">
          {city || "Location coming soon"}
        </div>
        <div className="mt-1 text-xs text-gray-600">{datesLabel}</div>
      </div>
      <div className="flex flex-col items-end gap-1 text-xs">
        <div className="text-gray-500">Credits</div>
        <div className="font-semibold text-emerald-700">
          ₹{creditsRupees}
        </div>
        {review_status && (
          <div className="mt-1 inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 bg-gray-50 text-[10px] text-gray-600">
            Review: {review_status}
          </div>
        )}
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-8 text-center">
      <p className="text-gray-700">
        No stays yet. Your trips will appear here after your first visit to a
        partner hotel.
      </p>
      <div className="mt-3">
        <Link to="/guest" className="btn btn-light">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
