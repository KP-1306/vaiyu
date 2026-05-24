// web/src/components/owner/PendingExtensionsCard.tsx
// Front-desk widget: list pending stay-extension requests + approve/reject flow.
// Drop-in for OwnerArrivals / OwnerDashboard.

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CheckCircle2, X, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  approveStayExtension,
  listPendingExtensions,
  rejectStayExtension,
  type StayExtensionRequest,
} from "../../services/stayExtensionService";

type Props = {
  hotelId: string | null;
  /** Called after a successful approve/reject so the parent page can refresh. */
  onResolved?: () => void;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PendingExtensionsCard({ hotelId, onResolved }: Props) {
  const [requests, setRequests] = useState<StayExtensionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row review modal state.
  const [reviewing, setReviewing] = useState<StayExtensionRequest | null>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hotelId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listPendingExtensions(hotelId);
      setRequests(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load extensions.");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription so a new guest request appears without a refresh.
  // Filtered server-side by hotel_id so we only get rows we care about.
  useEffect(() => {
    if (!hotelId) return;
    const channel = supabase
      .channel(`public:stay_extension_requests:${hotelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stay_extension_requests",
          filter: `hotel_id=eq.${hotelId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotelId, load]);

  function openReview(req: StayExtensionRequest, m: "approve" | "reject") {
    setReviewing(req);
    setMode(m);
    setAmount("");
    setNote("");
    setSubmitErr(null);
  }

  async function submitReview() {
    if (!reviewing) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      if (mode === "approve") {
        const parsed = amount.trim() === "" ? null : Number(amount);
        if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
          setSubmitErr("Additional amount must be a non-negative number.");
          setSubmitting(false);
          return;
        }
        await approveStayExtension({
          requestId: reviewing.id,
          additionalAmount: parsed,
          staffNote: note.trim() || undefined,
        });
      } else {
        await rejectStayExtension({
          requestId: reviewing.id,
          staffNote: note.trim() || undefined,
        });
      }
      setReviewing(null);
      await load();
      onResolved?.();
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!hotelId || (requests.length === 0 && !loading && !error)) {
    return null; // hide card entirely when nothing to show
  }

  return (
    <>
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-amber-200">
              Stay Extensions — Pending
            </h3>
            {requests.length > 0 && (
              <span className="rounded-full bg-amber-500/20 text-amber-200 px-2 py-0.5 text-[11px] font-bold">
                {requests.length}
              </span>
            )}
          </div>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}

        {!loading && requests.length === 0 && !error && (
          <p className="text-xs text-slate-500">No pending extension requests.</p>
        )}

        {requests.length > 0 && (
          <div className="space-y-2">
            {requests.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-white/[0.06] bg-[#0f1115] p-3 flex items-center justify-between gap-3 flex-wrap"
              >
                <div className="flex-1 min-w-[280px]">
                  <div className="text-sm text-slate-200">
                    Extend by{" "}
                    <span className="font-bold text-white">
                      {r.additional_nights} night{r.additional_nights === 1 ? "" : "s"}
                    </span>{" "}
                    →{" "}
                    <span className="font-semibold text-amber-200">
                      {fmtDate(r.requested_checkout_at)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    From {fmtDate(r.current_checkout_at)} · Requested {fmtTime(r.requested_at)}
                    {r.requested_by_source === "guest" ? " · by Guest" : " · by Staff"}
                  </div>
                  {r.guest_note && (
                    <div className="text-[11px] italic text-slate-400 mt-1">
                      "{r.guest_note}"
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openReview(r, "approve")}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-200 px-3 py-1.5 text-xs font-bold transition"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => openReview(r, "reject")}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 px-3 py-1.5 text-xs font-bold transition"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review modal */}
      {reviewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4"
          onClick={() => !submitting && setReviewing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#16181b] border border-white/[0.06] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">
                {mode === "approve" ? "Approve Extension" : "Reject Extension"}
              </h2>
              <button
                onClick={() => !submitting && setReviewing(null)}
                className="text-slate-500 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1 text-sm text-slate-400 mb-4">
              <p>
                <span className="text-slate-500">From:</span>{" "}
                {fmtDate(reviewing.current_checkout_at)}
              </p>
              <p>
                <span className="text-slate-500">To:</span>{" "}
                <span className="text-white font-semibold">
                  {fmtDate(reviewing.requested_checkout_at)}
                </span>{" "}
                ({reviewing.additional_nights} night
                {reviewing.additional_nights === 1 ? "" : "s"})
              </p>
              {reviewing.guest_note && (
                <p className="italic text-slate-500 pt-1">"{reviewing.guest_note}"</p>
              )}
            </div>

            {mode === "approve" && (
              <div className="space-y-2 mb-4">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Additional charge (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Leave blank to waive"
                  className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-400/50"
                />
                <p className="text-[10px] text-slate-500">
                  Posted as ROOM_CHARGE on the folio. Leave blank to grant the
                  extension at no cost.
                </p>
              </div>
            )}

            <div className="space-y-2 mb-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Staff note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  mode === "approve" ? "Approved by Mr. Sharma" : "Hotel fully booked"
                }
                className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-400/50"
              />
            </div>

            {submitErr && <p className="text-sm text-rose-300 mb-3">{submitErr}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => !submitting && setReviewing(null)}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={submitting}
                className={
                  "rounded-xl px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 shadow-lg " +
                  (mode === "approve"
                    ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
                    : "bg-rose-500 hover:bg-rose-600 shadow-rose-500/20")
                }
              >
                {submitting
                  ? "Saving…"
                  : mode === "approve"
                  ? "Confirm Approval"
                  : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
