// web/src/routes/OwnerReviews.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { listPendingReviews, approveReview, rejectReview } from "../lib/api";
import { connectEvents } from "../lib/sse";

type Pending = {
  id: string;
  bookingCode: string;
  hotel_slug: string;
  rating: number;
  title?: string;
  body?: string;
  created_at: string;
  anchors?: {
    tickets: number;
    orders: number;
    onTime: number;
    late: number;
    avgMins: number;
    details?: string[];
  };
};

export default function OwnerReviews() {
  const [rows, setRows] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [slugFilter, setSlugFilter] = useState<string>(""); // optional filter
  const [busy, setBusy] = useState<Record<string, boolean>>({}); // per-row spinner

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await listPendingReviews();
      setRows(((r as any)?.items || []) as Pending[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load pending reviews");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // auto-refresh when relevant events arrive
    const off = connectEvents({
      // fire on review lifecycle changes if your API emits these events
      review_created: () => load(),
      review_updated:  () => load(),
      review_deleted:  () => load(),
    });
    return () => off();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        slugFilter ? r.hotel_slug.toLowerCase().includes(slugFilter.toLowerCase()) : true
      ),
    [rows, slugFilter]
  );

  async function doApprove(p: Pending) {
    setBusy((b) => ({ ...b, [p.id]: true }));
    // optimistic: remove from list immediately
    setRows((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await approveReview(p.id, p.bookingCode);
    } catch (e) {
      // revert on failure
      setRows((prev) => [p, ...prev]);
      alert((e as any)?.message || "Approve failed");
    } finally {
      setBusy((b) => ({ ...b, [p.id]: false }));
    }
  }

  async function doReject(p: Pending) {
    if (!confirm("Reject this draft?")) return;
    setBusy((b) => ({ ...b, [p.id]: true }));
    // optimistic: remove from list immediately
    setRows((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await rejectReview(p.id, p.bookingCode);
    } catch (e) {
      // revert on failure
      setRows((prev) => [p, ...prev]);
      alert((e as any)?.message || "Reject failed");
    } finally {
      setBusy((b) => ({ ...b, [p.id]: false }));
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-4 space-y-4">
      {/* Header / toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold m-0">Review Moderation</h1>
          <div className="text-xs text-gray-600">Approve or reject AI-generated drafts before they go public.</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder="Filter by slug (e.g., sunrise)"
            value={slugFilter}
            onChange={(e) => setSlugFilter(e.target.value)}
            style={{ width: 220 }}
          />
          <button className="btn btn-light" onClick={load}>Refresh</button>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}
      {loading && <div>Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div className="card">No pending reviews 🎉</div>
      )}

      <div className="grid gap-10">
        {filtered.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500">
                  {p.hotel_slug} • {new Date(p.created_at).toLocaleString()}
                </div>
                <div className="font-semibold mt-1">
                  {p.title || "Suggested review"}
                </div>
                <div className="mt-1">{'⭐'.repeat(p.rating)}</div>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => doApprove(p)}
                  disabled={!!busy[p.id]}
                  title="Publish this draft"
                >
                  {busy[p.id] ? "Approving…" : "Approve"}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => doReject(p)}
                  disabled={!!busy[p.id]}
                  title="Discard this draft"
                >
                  {busy[p.id] ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </div>

            {p.body && <div className="mt-3 whitespace-pre-wrap">{p.body}</div>}

            {p.anchors && (
              <details className="mt-3">
                <summary className="cursor-pointer">Why this rating?</summary>
                <div className="text-sm mt-2 text-gray-700">
                  Requests: {p.anchors.tickets} · Orders: {p.anchors.orders} · On-time: {p.anchors.onTime} · Late: {p.anchors.late} · Avg mins: {p.anchors.avgMins}
                  {p.anchors.details?.length ? (
                    <div className="mt-2">
                      {p.anchors.details.map((d, i) => (
                        <div key={i} style={{ opacity: 0.9 }}>{d}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            )}

            <div className="text-xs text-gray-500 mt-2">
              Booking: {p.bookingCode}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
