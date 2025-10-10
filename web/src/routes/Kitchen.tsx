import { useEffect, useMemo, useState } from "react";
import OwnerGate from "../components/OwnerGate";
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

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected[r.id]),
    [rows, selected]
  );

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const r = await listPendingReviews();
      const items = ((r as any)?.items || r || []) as Pending[];
      setRows(items);
      // prune stale selections
      setSelected((prev) => {
        const next: Record<string, boolean> = {};
        for (const it of items) if (prev[it.id]) next[it.id] = true;
        return next;
      });
    } catch (e: any) {
      setErr(e?.message || "Failed to load pending reviews");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((p) => {
      return (
        p.bookingCode.toLowerCase().includes(s) ||
        (p.title || "").toLowerCase().includes(s) ||
        (p.body || "").toLowerCase().includes(s)
      );
    });
  }, [rows, q]);

  function toggleAll() {
    if (allSelected) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of filtered) next[r.id] = true;
    setSelected(next);
  }

  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const selectedList = useMemo(
    () => filtered.filter((r) => selected[r.id]),
    [filtered, selected]
  );

  async function doApprove(p: Pending) {
    await approveReview(p.id, p.bookingCode);
    load();
  }
  async function doReject(p: Pending) {
    if (!confirm("Reject this draft?")) return;
    await rejectReview(p.id, p.bookingCode);
    load();
  }

  async function approveAll() {
    if (!filtered.length) return;
    if (!confirm(`Approve all ${filtered.length} draft(s)?`)) return;
    await Promise.all(filtered.map((p) => approveReview(p.id, p.bookingCode)));
    load();
  }

  async function approveSelected() {
    if (!selectedList.length) return;
    if (!confirm(`Approve ${selectedList.length} selected draft(s)?`)) return;
    await Promise.all(selectedList.map((p) => approveReview(p.id, p.bookingCode)));
    load();
  }

  async function rejectSelected() {
    if (!selectedList.length) return;
    if (!confirm(`Reject ${selectedList.length} selected draft(s)?`)) return;
    await Promise.all(selectedList.map((p) => rejectReview(p.id, p.bookingCode)));
    load();
  }

  function downloadCSV() {
    const rowsForCsv = filtered;
    const header = [
      "id",
      "bookingCode",
      "hotel_slug",
      "rating",
      "title",
      "body",
      "created_at",
      "tickets",
      "orders",
      "onTime",
      "late",
      "avgMins",
    ];

    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      // escape quotes; wrap in quotes if contains comma/quote/newline
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [
      header.join(","),
      ...rowsForCsv.map((r) =>
        [
          r.id,
          r.bookingCode,
          r.hotel_slug,
          r.rating,
          r.title || "",
          r.body || "",
          r.created_at,
          r.anchors?.tickets ?? 0,
          r.anchors?.orders ?? 0,
          r.anchors?.onTime ?? 0,
          r.anchors?.late ?? 0,
          r.anchors?.avgMins ?? 0,
        ]
          .map(esc)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pending-reviews-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <OwnerGate>
      <main className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Review Moderation</h1>
            <div className="text-sm text-gray-600">
              Approve or reject AI-suggested drafts before they go public.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder="Search by booking code, title or text…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 280 }}
            />
            <button className="btn btn-light" onClick={load} disabled={loading}>
              Refresh
            </button>
          </div>
        </header>

        <div className="card">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={approveAll} disabled={!filtered.length || loading}>
              Approve all ({filtered.length})
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <button
              className="btn"
              onClick={approveSelected}
              disabled={!selectedList.length || loading}
              title="Approve selected"
            >
              Approve selected ({selectedList.length})
            </button>
            <button
              className="btn btn-outline"
              onClick={rejectSelected}
              disabled={!selectedList.length || loading}
              title="Reject selected"
            >
              Reject selected
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <button className="btn btn-light" onClick={downloadCSV} disabled={!filtered.length}>
              Download CSV
            </button>
            <div className="ml-auto text-sm text-gray-600">
              {filtered.length} pending in view
            </div>
          </div>
        </div>

        {err && (
          <div className="card" style={{ borderColor: "#f59e0b" }}>
            ⚠️ {err}
          </div>
        )}
        {loading && <div>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="card">No pending reviews 🎉</div>
        )}

        <div className="grid gap-10">
          {!!filtered.length && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
              />
              Select all in view
            </label>
          )}

          {filtered.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!selected[p.id]}
                    onChange={() => toggleOne(p.id)}
                  />
                  <div>
                    <div className="text-xs text-gray-500">
                      {p.hotel_slug} • {new Date(p.created_at).toLocaleString()}
                    </div>
                    <div className="font-semibold mt-1">
                      {p.title || "Suggested review"}
                    </div>
                    <div className="mt-1">{'⭐'.repeat(p.rating)}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => doApprove(p)}>
                    Approve
                  </button>
                  <button className="btn btn-outline" onClick={() => doReject(p)}>
                    Reject
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
    </OwnerGate>
  );
}
