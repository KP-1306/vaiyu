import { useEffect, useState } from "react";
import {
  listPendingReviews,
  approveReview,
  rejectReview,
} from "../lib/api";

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

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const r = await listPendingReviews();
      setRows((r as any)?.items || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load pending reviews");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doApprove(p: Pending) {
    await approveReview(p.id, p.bookingCode);
    load();
  }
  async function doReject(p: Pending) {
    if (!confirm("Reject this draft?")) return;
    await rejectReview(p.id, p.bookingCode);
    load();
  }

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Review Moderation</h1>
        <button className="btn btn-light" onClick={load}>Refresh</button>
      </div>

      {err && <div className="card" style={{ borderColor: "#f59e0b" }}>⚠️ {err}</div>}
      {loading && <div>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="card">No pending reviews 🎉</div>
      )}

      <div className="grid gap-10">
        {rows.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500">
                  {p.hotel_slug} • {new Date(p.created_at).toLocaleString()}
                </div>
                <div className="font-semibold mt-1">{p.title || "Suggested review"}</div>
                <div className="mt-1">{'⭐'.repeat(p.rating)}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={() => doApprove(p)}>Approve</button>
                <button className="btn btn-outline" onClick={() => doReject(p)}>Reject</button>
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
