// web/src/components/guest/RequestExtensionButton.tsx
// Guest-facing button + modal to request a stay extension.
// Shows the current most-recent extension status if one exists.

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  cancelStayExtension,
  listExtensionsForStay,
  requestStayExtension,
  type StayExtensionRequest,
} from "../../services/stayExtensionService";

type Props = {
  /** Stay UUID — required for the RPC. */
  stayId: string;
  /** Current scheduled checkout (ISO). Used to seed the date input. */
  currentCheckoutAt: string;
  /** Optional className to position the button in the parent layout. */
  className?: string;
};

function isoNextDay(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function RequestExtensionButton({
  stayId,
  currentCheckoutAt,
  className,
}: Props) {
  const [latest, setLatest] = useState<StayExtensionRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(isoNextDay(currentCheckoutAt));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    if (!stayId) return;
    try {
      const list = await listExtensionsForStay(stayId);
      setLatest(list[0] ?? null);
    } catch {
      // Non-critical — we'll show the request button anyway.
    }
  }, [stayId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    setSuccess(false);
    try {
      await requestStayExtension({
        stayId,
        requestedCheckoutDate: date,
        guestNote: note.trim() || undefined,
      });
      setSuccess(true);
      await refresh();
      // Auto-close after a brief success moment so the new "pending" card shows.
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 1400);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not submit request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelPending() {
    if (!latest || latest.status !== "pending") return;
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelStayExtension(latest.id);
      await refresh();
    } catch (e: unknown) {
      // Surface inline so the badge area can render the error.
      setErr(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setCancelling(false);
    }
  }

  // ─── Status badge for an existing request ─────────────────
  const badge = latest && (
    <div
      className={
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold " +
        (latest.status === "pending"
          ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
          : latest.status === "approved"
          ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30"
          : latest.status === "rejected"
          ? "bg-rose-500/15 text-rose-200 border border-rose-500/30"
          : "bg-white/5 text-slate-400 border border-white/10")
      }
    >
      {latest.status === "pending" && <Clock className="w-3 h-3" />}
      {latest.status === "approved" && <CheckCircle2 className="w-3 h-3" />}
      {latest.status === "rejected" && <XCircle className="w-3 h-3" />}
      Extension {latest.status} · {fmtDate(latest.requested_checkout_at)}
    </div>
  );

  return (
    <>
      <div className={"flex flex-col items-start gap-2 " + (className ?? "")}>
        <div className="flex items-center gap-2 flex-wrap">
          {badge}
          {/* Pending → guest can withdraw the request. */}
          {latest?.status === "pending" && (
            <button
              onClick={cancelPending}
              disabled={cancelling}
              className="text-[11px] font-bold uppercase tracking-wider text-rose-300 hover:text-rose-200 disabled:opacity-50 underline-offset-2 hover:underline"
            >
              {cancelling ? "Cancelling…" : "Cancel request"}
            </button>
          )}
        </div>
        {/* Show inline error from a failed cancel — keeps it close to the badge. */}
        {err && latest?.status === "pending" && (
          <p className="text-xs text-rose-300">{err}</p>
        )}
        {/* Hide the request button while a pending request exists. */}
        {latest?.status !== "pending" && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-4 py-2 text-sm font-bold text-amber-200 transition"
          >
            <CalendarPlus className="w-4 h-4" />
            Request stay extension
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur p-4"
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#16181b] border border-white/[0.06] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-1">Extend your stay</h2>
            <p className="text-xs text-slate-400 mb-5">
              Current checkout: <span className="text-slate-200 font-semibold">{fmtDate(currentCheckoutAt)}</span>.
              Pick a new checkout date — front desk will confirm and let you know about any additional charges.
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  New checkout date
                </label>
                <input
                  type="date"
                  value={date}
                  min={isoNextDay(currentCheckoutAt)}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white [color-scheme:dark] focus:outline-none focus:border-amber-400/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Reason (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Flight rescheduled, meeting extended…"
                  className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400/50 resize-none"
                />
              </div>

              {err && <p className="text-sm text-rose-300">{err}</p>}
              {success && (
                <p className="text-sm text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Request submitted. Front desk will confirm shortly.
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => !submitting && setOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || success}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 px-5 py-2 text-sm font-bold text-black transition disabled:opacity-60 shadow-lg shadow-amber-500/20"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? "Sending…" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
