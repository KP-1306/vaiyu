import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL as string;

type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  published_at: string;
};

export default function ReviewsWidget({ slug, pageSize = 12 }: { slug: string; pageSize?: number }) {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(append = false) {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ slug, limit: String(pageSize) });
      if (append && cursor) qs.set("cursor", cursor);
      const r = await fetch(`${API}/reviews-public?` + qs.toString());
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Failed to load reviews");
      setReviews((prev) => (append ? [...prev, ...(data.reviews || [])] : data.reviews || []));
      setNextCursor(data.next_cursor || null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setReviews([]);
    setCursor(null);
    setNextCursor(null);
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, pageSize]);

  function loadMore() {
    if (!nextCursor) return;
    setCursor(nextCursor);
    // after state update, call load with append=true
    setTimeout(() => load(true), 0);
  }

  return (
    <section className="bg-white rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Guest Reviews</h3>
        <div className="text-sm text-gray-500">{loading ? "Loading…" : null}</div>
      </div>

      {err && <div className="mt-2 text-sm text-amber-700">⚠️ {err}</div>}

      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-xl border p-3">
            <div className="flex items-center gap-1 text-amber-500" aria-label={`${r.rating} stars`}>
              {"★".repeat(Math.round(r.rating))}<span className="text-gray-400">{"★".repeat(Math.max(0, 5 - Math.round(r.rating)))}</span>
            </div>
            {r.title && <div className="font-medium mt-1">{r.title}</div>}
            <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
              {r.body || ""}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {new Date(r.published_at).toLocaleDateString()}
            </div>
          </li>
        ))}
        {reviews.length === 0 && !loading && !err && (
          <li className="text-sm text-gray-600">No reviews yet.</li>
        )}
      </ul>

      {nextCursor && (
        <div className="mt-4">
          <button className="btn btn-light !py-2 !px-3 text-sm" onClick={loadMore} disabled={loading}>
            Load more
          </button>
        </div>
      )}
    </section>
  );
}
