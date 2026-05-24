// web/src/routes/OwnerPayments.tsx
//
// Payments & Settlements page for owners. Shows:
//   - Headline cards: Total Collected, Refunded, Net to Hotel, Platform Fee
//   - Period filter (today / 7d / 30d / month / all / custom)
//   - Method + status filters
//   - Searchable, sortable list of payments
//   - Inline refund detail per row (expandable)
//
// Sources from `payments` and `refunds` tables (both populated by the
// Razorpay flow we shipped earlier). Cash payments are included too — the
// page is the unified ledger of money in/out per hotel.

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate";
import {
    RazorpayServiceError,
    type ReconcileDiscrepancy,
} from "../services/razorpayService";
import { getRazorpayClient, type RazorpayMode } from "../services/razorpayClient";
import {
    AlertTriangle,
    CheckCircle2,
    IndianRupee,
    RotateCcw,
    TrendingUp,
    PercentCircle,
    Search,
    Download,
    ChevronDown,
    ChevronUp,
    Filter,
    Loader2,
    RefreshCw,
    Shield,
    Clock,
} from "lucide-react";

/* ============================================================
   Types
   ============================================================ */

type PaymentMethod = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "WALLET" | "OTHER";
type PaymentStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

type PaymentRow = {
    id: string;
    booking_id: string;
    folio_id: string | null;
    amount: number;
    currency: string;
    method: PaymentMethod;
    status: PaymentStatus;
    reference_id: string | null;
    notes: string | null;
    collected_by: string | null;
    created_at: string;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    // Joined booking → for guest name + room
    booking?: { code: string | null; guest_name: string | null; room_id: string | null };
};

type RefundRow = {
    id: string;
    payment_id: string;
    amount: number;
    currency: string;
    status: "PENDING" | "PROCESSED" | "FAILED";
    reason: string | null;
    razorpay_refund_id: string | null;
    razorpay_mode: "DIRECT" | "ROUTE" | null;
    initiated_at: string;
    processed_at: string | null;
    // Joined from payments — fallback when the refund row's own mode isn't set
    // yet (cancellation-triggered rows are created before the mode is known).
    // Supabase returns FK-joined relations as arrays even when 1:1, hence the [].
    payment?: Array<{ razorpay_mode: "DIRECT" | "ROUTE" | null }> | null;
};

type PeriodKey = "today" | "7d" | "30d" | "month" | "all";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "7d", label: "Last 7 days" },
    { key: "30d", label: "Last 30 days" },
    { key: "month", label: "This month" },
    { key: "all", label: "All time" },
];

/* ============================================================
   Component
   ============================================================ */

export default function OwnerPayments() {
    const { slug } = useParams<{ slug: string }>();
    const [loading, setLoading] = useState(true);
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [platformFeePct, setPlatformFeePct] = useState<number>(0);
    // Hotel's current Razorpay mode — drives reconcile dispatch. Per-row
    // refund dispatch uses the refund/payment's own mode (which may differ
    // if the hotel switched modes after the payment was captured).
    const [hotelRazorpayMode, setHotelRazorpayMode] = useState<RazorpayMode>("NONE");
    const [payments, setPayments] = useState<PaymentRow[]>([]);
    const [refunds, setRefunds] = useState<RefundRow[]>([]);

    // Filters
    const [period, setPeriod] = useState<PeriodKey>("30d");
    const [methodFilter, setMethodFilter] = useState<"" | PaymentMethod>("");
    const [statusFilter, setStatusFilter] = useState<"" | PaymentStatus>("");
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState<string | null>(null);

    // Pending refunds (auto-flagged by the booking-cancellation trigger)
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [batchProcessing, setBatchProcessing] = useState(false);
    const [pendingProcessError, setPendingProcessError] = useState<string | null>(null);
    const [pendingProcessOk, setPendingProcessOk] = useState<number>(0);
    const [showPendingPanel, setShowPendingPanel] = useState(false);

    // Refresh-status state — for refunds submitted to Razorpay but stuck PENDING
    // (webhook didn't arrive). Independent of the trigger-flagged pending flow.
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

    // Reconciliation panel
    const [showReconcile, setShowReconcile] = useState(false);
    const [reconFrom, setReconFrom] = useState<string>(() => ymd(daysAgo(7)));
    const [reconTo, setReconTo] = useState<string>(() => ymd(new Date()));
    const [reconRunning, setReconRunning] = useState(false);
    const [reconError, setReconError] = useState<string | null>(null);
    const [reconResult, setReconResult] = useState<{
        paymentsChecked: number;
        refundsChecked: number;
        discrepancies: ReconcileDiscrepancy[];
        ranAt: string;
    } | null>(null);

    /* ---------- Load data ---------- */
    useEffect(() => {
        if (!slug) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const { data: hotel } = await supabase
                    .from("hotels")
                    .select("id, razorpay_platform_fee_pct, razorpay_mode")
                    .eq("slug", slug)
                    .maybeSingle();
                if (!hotel || cancelled) return;
                setHotelId(hotel.id);
                setPlatformFeePct(Number(hotel.razorpay_platform_fee_pct ?? 0));
                setHotelRazorpayMode((hotel.razorpay_mode ?? "NONE") as RazorpayMode);

                // Compute time bound from period filter (applied client-side
                // for `all`, otherwise pushed into the query).
                const { startISO } = periodBounds(period);

                const paymentQuery = supabase
                    .from("payments")
                    .select(
                        "id, booking_id, folio_id, amount, currency, method, status, reference_id, notes, collected_by, created_at, razorpay_order_id, razorpay_payment_id, booking:bookings(code, guest_name, room_id)",
                    )
                    .eq("hotel_id", hotel.id)
                    .order("created_at", { ascending: false });

                if (startISO) paymentQuery.gte("created_at", startISO);

                const { data: payRows } = await paymentQuery.limit(500);
                if (cancelled) return;
                setPayments((payRows ?? []) as unknown as PaymentRow[]);

                // Refunds for the same window. We join `payments(razorpay_mode)`
                // so per-refund dispatch can pick Route-vs-Direct even for rows
                // where the refund's own mode hasn't been backfilled yet.
                const refundQuery = supabase
                    .from("refunds")
                    .select("id, payment_id, amount, currency, status, reason, razorpay_refund_id, razorpay_mode, initiated_at, processed_at, payment:payments(razorpay_mode)")
                    .eq("hotel_id", hotel.id)
                    .order("initiated_at", { ascending: false });
                if (startISO) refundQuery.gte("initiated_at", startISO);

                const { data: refRows } = await refundQuery.limit(500);
                if (!cancelled) setRefunds((refRows ?? []) as RefundRow[]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [slug, period]);

    /* ---------- Realtime: any new payment or refund refreshes the view ---------- */
    useEffect(() => {
        if (!hotelId) return;
        const channel = supabase
            .channel(`owner-payments-${hotelId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
                // Refetch is simpler than diff-merging; for 500-row datasets it's fine.
                setPeriod((p) => p); // triggers the effect above
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "refunds" }, () => {
                setPeriod((p) => p);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [hotelId]);

    /* ---------- Derived data ---------- */
    const filtered = useMemo(() => {
        let rows = payments;
        if (methodFilter) rows = rows.filter((r) => r.method === methodFilter);
        if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
        const q = search.trim().toLowerCase();
        if (q) {
            rows = rows.filter(
                (r) =>
                    (r.booking?.code || "").toLowerCase().includes(q) ||
                    (r.booking?.guest_name || "").toLowerCase().includes(q) ||
                    (r.reference_id || "").toLowerCase().includes(q) ||
                    (r.razorpay_payment_id || "").toLowerCase().includes(q),
            );
        }
        return rows;
    }, [payments, methodFilter, statusFilter, search]);

    // Pending refunds — surfaced as a banner so staff process auto-flagged
    // cancellations before they slip through the cracks.
    const pendingRefunds = useMemo(
        () => refunds.filter((r) => r.status === "PENDING" && !r.razorpay_refund_id),
        [refunds],
    );

    // Stuck refunds — submitted to Razorpay (have razorpay_refund_id) but
    // still PENDING in our DB. Either the `refund.processed` webhook never
    // arrived, or it's genuinely still being processed by Razorpay. The
    // Refresh-status button calls Razorpay GET /refunds/{id} and reconciles.
    const stuckRefunds = useMemo(
        () => refunds.filter((r) => r.status === "PENDING" && !!r.razorpay_refund_id),
        [refunds],
    );

    // Resolve which Razorpay client to use for a refund row. Prefer the
    // refund's own razorpay_mode; fall back to the linked payment's mode
    // (set when the row was created by the cancellation trigger before the
    // mode column existed for refunds). Last-resort fallback: hotel's
    // current mode.
    function clientForRefund(r: RefundRow) {
        const fallback = r.payment?.[0]?.razorpay_mode ?? null;
        const mode: RazorpayMode = (r.razorpay_mode ?? fallback ?? hotelRazorpayMode) as RazorpayMode;
        return getRazorpayClient(mode);
    }

    async function processOnePending(r: RefundRow) {
        setProcessingId(r.id);
        setPendingProcessError(null);
        try {
            await clientForRefund(r).processPendingRefund(r.id);
            setPendingProcessOk((n) => n + 1);
            // Realtime channel will refetch; no manual reload needed.
        } catch (e) {
            setPendingProcessError(
                e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e),
            );
        } finally {
            setProcessingId(null);
        }
    }

    async function processAllPending() {
        if (pendingRefunds.length === 0) return;
        setBatchProcessing(true);
        setPendingProcessError(null);
        setPendingProcessOk(0);
        // Sequential to avoid rate-limiting ourselves
        for (const r of pendingRefunds) {
            try {
                await clientForRefund(r).processPendingRefund(r.id);
                setPendingProcessOk((n) => n + 1);
            } catch (e) {
                setPendingProcessError(
                    `Stopped at ${r.id.slice(0, 8)}: ${e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e)}`,
                );
                break;
            }
        }
        setBatchProcessing(false);
    }

    async function runRefresh(r: RefundRow) {
        setRefreshingId(r.id);
        setRefreshMessage(null);
        try {
            const out = await clientForRefund(r).refreshRefundStatus(r.id);
            if (out.changed) {
                setRefreshMessage(`Refund now ${out.ourStatus.toLowerCase()} — synced from Razorpay.`);
            } else {
                setRefreshMessage(`Razorpay still reports "${out.razorpayStatus}" — try again in a few minutes.`);
            }
        } catch (e) {
            setRefreshMessage(
                e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e),
            );
        } finally {
            setRefreshingId(null);
        }
    }

    async function runReconcile() {
        if (!hotelId) return;
        if (hotelRazorpayMode === "NONE") {
            setReconError("This hotel isn't on Razorpay (mode=NONE). Configure DIRECT or ROUTE in Owner Settings first.");
            return;
        }
        setReconRunning(true);
        setReconError(null);
        setReconResult(null);
        try {
            // Treat the date inputs as IST day boundaries so a "May 13" run
            // covers all of May 13 IST, not just the UTC slice.
            const fromIso = new Date(reconFrom + "T00:00:00+05:30").toISOString();
            const toIso = new Date(reconTo + "T23:59:59+05:30").toISOString();
            const out = await getRazorpayClient(hotelRazorpayMode).reconcilePeriod({ hotelId, from: fromIso, to: toIso });
            setReconResult({
                paymentsChecked: out.paymentsChecked,
                refundsChecked: out.refundsChecked,
                discrepancies: out.discrepancies,
                ranAt: new Date().toISOString(),
            });
        } catch (e) {
            setReconError(
                e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e),
            );
        } finally {
            setReconRunning(false);
        }
    }

    const refundsByPayment = useMemo(() => {
        const map = new Map<string, RefundRow[]>();
        for (const r of refunds) {
            const arr = map.get(r.payment_id) ?? [];
            arr.push(r);
            map.set(r.payment_id, arr);
        }
        return map;
    }, [refunds]);

    const totals = useMemo(() => computeTotals(payments, refunds, platformFeePct), [payments, refunds, platformFeePct]);

    /* ---------- CSV export (simple) ---------- */
    function exportCSV() {
        const rows = [
            ["Date (IST)", "Booking", "Guest", "Method", "Amount (₹)", "Status", "Reference", "Refunded (₹)"],
            ...filtered.map((p) => {
                const refundsTotal = (refundsByPayment.get(p.id) ?? [])
                    .filter((r) => r.status !== "FAILED")
                    .reduce((s, r) => s + Number(r.amount), 0);
                return [
                    new Date(p.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                    p.booking?.code ?? "",
                    p.booking?.guest_name ?? "",
                    p.method,
                    p.amount.toFixed(2),
                    p.status,
                    p.razorpay_payment_id || p.reference_id || "",
                    refundsTotal.toFixed(2),
                ];
            }),
        ];
        const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `payments-${slug}-${period}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /* ---------- Render ---------- */
    return (
        <OwnerGate>
            <div className="min-h-screen bg-slate-950 text-slate-100">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    {/* Header */}
                    <header className="flex items-start justify-between gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                                <Link to={`/owner/${slug}`} className="hover:text-slate-300 transition-colors">Dashboard</Link>
                                <span>/</span>
                                <span className="text-slate-300">Payments &amp; Settlements</span>
                            </div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Payments &amp; Settlements</h1>
                            <p className="mt-1 text-sm text-slate-400">
                                Money in, money out, and what Razorpay has settled to your Linked Account.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowReconcile((v) => !v)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${showReconcile
                                    ? "border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
                                    : "border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800"
                                    }`}
                                title="Audit our DB against Razorpay's API for a date range"
                            >
                                <Shield size={14} />
                                {showReconcile ? "Close reconciliation" : "Reconcile"}
                            </button>
                            <button
                                onClick={exportCSV}
                                disabled={filtered.length === 0}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Download size={14} />
                                Export CSV
                            </button>
                        </div>
                    </header>

                    {/* Period selector */}
                    <div className="flex items-center gap-1 mb-5 p-1 rounded-xl border border-slate-800 bg-slate-900/40 w-fit">
                        {PERIOD_OPTIONS.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => setPeriod(p.key)}
                                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors ${period === p.key
                                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                    : "text-slate-400 hover:text-white border border-transparent"
                                    }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Pending refunds banner — auto-flagged by booking-cancellation trigger.
                        Surfaces immediately so staff can review before money sits in limbo. */}
                    {pendingRefunds.length > 0 && (
                        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-amber-500/20">
                                <div className="flex items-center gap-2 min-w-0">
                                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span className="text-sm font-bold text-amber-200">
                                        {pendingRefunds.length} {pendingRefunds.length === 1 ? "refund" : "refunds"} pending review
                                    </span>
                                    <span className="text-xs text-amber-300/70 truncate">
                                        · auto-flagged when bookings were cancelled; not yet sent to Razorpay
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => setShowPendingPanel((v) => !v)}
                                        className="text-[11px] font-semibold text-amber-200 hover:text-white"
                                    >
                                        {showPendingPanel ? "Hide" : "Review"}
                                    </button>
                                    <button
                                        onClick={processAllPending}
                                        disabled={batchProcessing || processingId !== null}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 hover:text-white border-amber-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {batchProcessing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                        {batchProcessing ? "Processing…" : "Process all"}
                                    </button>
                                </div>
                            </div>

                            {pendingProcessError && (
                                <div className="px-4 py-2 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    {pendingProcessError}
                                </div>
                            )}
                            {pendingProcessOk > 0 && !pendingProcessError && (
                                <div className="px-4 py-2 text-xs text-emerald-300 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2">
                                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                                    {pendingProcessOk} {pendingProcessOk === 1 ? "refund" : "refunds"} submitted to Razorpay.
                                </div>
                            )}

                            {showPendingPanel && (
                                <div className="divide-y divide-amber-500/10">
                                    {pendingRefunds.map((r) => {
                                        const isProcessing = processingId === r.id;
                                        return (
                                            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                                                <div className="font-mono text-amber-300 w-24 shrink-0">
                                                    ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                                </div>
                                                <div className="flex-1 min-w-0 text-slate-300 truncate">
                                                    {r.reason ?? "Auto-flagged"}
                                                </div>
                                                <div className="text-slate-500 font-mono text-[10px] hidden sm:block">
                                                    {new Date(r.initiated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                                </div>
                                                <button
                                                    onClick={() => processOnePending(r)}
                                                    disabled={isProcessing || batchProcessing}
                                                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border-amber-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {isProcessing ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                                                    {isProcessing ? "Sending" : "Process"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Stuck refunds banner — submitted to Razorpay but webhook hasn't
                        flipped them to PROCESSED. Per-row Refresh calls Razorpay and
                        reconciles. Independent of the trigger-flagged pending flow above. */}
                    {stuckRefunds.length > 0 && (
                        <div className="mb-6 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-sky-500/20">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                                    <span className="text-sm font-bold text-sky-200">
                                        {stuckRefunds.length} {stuckRefunds.length === 1 ? "refund" : "refunds"} awaiting Razorpay confirmation
                                    </span>
                                    <span className="text-xs text-sky-300/70 truncate hidden sm:inline">
                                        · submitted to Razorpay; webhook hasn't arrived yet
                                    </span>
                                </div>
                            </div>
                            {refreshMessage && (
                                <div className="px-4 py-2 text-xs text-slate-300 bg-slate-900/50 border-b border-sky-500/20 flex items-center gap-2">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                    {refreshMessage}
                                </div>
                            )}
                            <div className="divide-y divide-sky-500/10">
                                {stuckRefunds.map((r) => {
                                    const isRefreshing = refreshingId === r.id;
                                    return (
                                        <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                                            <div className="font-mono text-sky-300 w-24 shrink-0">
                                                ₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                            </div>
                                            <div className="flex-1 min-w-0 text-slate-400 truncate font-mono text-[10px]">
                                                {r.razorpay_refund_id}
                                            </div>
                                            <div className="text-slate-500 font-mono text-[10px] hidden sm:block">
                                                Submitted{" "}
                                                {new Date(r.initiated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                            </div>
                                            <button
                                                onClick={() => runRefresh(r)}
                                                disabled={isRefreshing}
                                                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 border-sky-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {isRefreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                                                {isRefreshing ? "Checking" : "Refresh status"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Reconciliation panel — on-demand audit of our DB vs Razorpay's
                        source of truth for a date range. Read-only; never auto-fixes. */}
                    {showReconcile && (
                        <div className="mb-6 rounded-xl border border-sky-500/30 bg-slate-900/40 overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Shield className="w-4 h-4 text-sky-400 shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-slate-200">Reconciliation</div>
                                        <div className="text-[11px] text-slate-500">
                                            Audit our payments + refunds against Razorpay's API for a date range. Max 31 days per run.
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">From</label>
                                    <input
                                        type="date"
                                        value={reconFrom}
                                        onChange={(e) => setReconFrom(e.target.value)}
                                        max={reconTo}
                                        className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-200"
                                    />
                                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">To</label>
                                    <input
                                        type="date"
                                        value={reconTo}
                                        onChange={(e) => setReconTo(e.target.value)}
                                        min={reconFrom}
                                        max={ymd(new Date())}
                                        className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-xs text-slate-200"
                                    />
                                    <button
                                        onClick={runReconcile}
                                        disabled={reconRunning || !hotelId}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-sky-200 hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {reconRunning ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                                        {reconRunning ? "Auditing…" : "Run reconciliation"}
                                    </button>
                                </div>
                            </div>

                            {reconError && (
                                <div className="px-4 py-2.5 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    {reconError}
                                </div>
                            )}

                            {reconResult && (
                                <div className="px-4 py-3">
                                    <div className="flex items-center gap-4 mb-3 flex-wrap">
                                        <ReconStat label="Payments checked" value={reconResult.paymentsChecked} />
                                        <ReconStat label="Refunds checked" value={reconResult.refundsChecked} />
                                        <ReconStat
                                            label="Discrepancies"
                                            value={reconResult.discrepancies.length}
                                            tone={reconResult.discrepancies.length === 0 ? "ok" : "warn"}
                                        />
                                        <div className="text-[10px] text-slate-500 font-mono ml-auto">
                                            Ran {new Date(reconResult.ranAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} IST
                                        </div>
                                    </div>

                                    {reconResult.discrepancies.length === 0 ? (
                                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-3 text-xs text-emerald-200 flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                                            All clear — our records match Razorpay for this window.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                                            {reconResult.discrepancies.map((d, i) => (
                                                <DiscrepancyCard key={`${d.ourId}-${i}`} d={d} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {!reconResult && !reconError && !reconRunning && (
                                <div className="px-4 py-3 text-xs text-slate-500">
                                    Pick a date range and run. We'll fetch each payment + refund from Razorpay and report any mismatches.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Summary cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <SummaryCard
                            icon={IndianRupee}
                            label="Total collected"
                            value={fmtINR(totals.collected)}
                            sub={`${totals.completedCount} completed`}
                            tone="emerald"
                        />
                        <SummaryCard
                            icon={RotateCcw}
                            label="Refunded"
                            value={fmtINR(totals.refunded)}
                            sub={`${totals.processedRefundCount} processed`}
                            tone="amber"
                        />
                        <SummaryCard
                            icon={TrendingUp}
                            label="Net to hotel"
                            value={fmtINR(totals.netToHotel)}
                            sub="Collected − refunded − fee"
                            tone="sky"
                        />
                        <SummaryCard
                            icon={PercentCircle}
                            label="Platform fee retained"
                            value={fmtINR(totals.platformFee)}
                            sub={`${platformFeePct}% on Razorpay only`}
                            tone="neutral"
                        />
                    </div>

                    {/* Filters row */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search booking, guest, or reference"
                                className="w-full rounded-lg border border-slate-700 bg-slate-900/50 pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Filter className="w-4 h-4 text-slate-500" />
                            <select
                                value={methodFilter}
                                onChange={(e) => setMethodFilter(e.target.value as any)}
                                className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-2 text-sm text-slate-200"
                            >
                                <option value="">All methods</option>
                                <option value="UPI">UPI</option>
                                <option value="CARD">Card</option>
                                <option value="WALLET">Wallet</option>
                                <option value="BANK_TRANSFER">Bank transfer</option>
                                <option value="CASH">Cash</option>
                                <option value="OTHER">Other</option>
                            </select>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-2 text-sm text-slate-200"
                            >
                                <option value="">All statuses</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="PENDING">Pending</option>
                                <option value="FAILED">Failed</option>
                                <option value="REFUNDED">Refunded</option>
                            </select>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
                        {loading ? (
                            <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading payments…
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="py-16 text-center text-sm text-slate-500">
                                No payments in this window.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-800">
                                    <thead className="bg-slate-900/60">
                                        <tr>
                                            <Th>Date</Th>
                                            <Th>Booking</Th>
                                            <Th>Guest</Th>
                                            <Th>Method</Th>
                                            <Th align="right">Amount</Th>
                                            <Th align="right">Fee</Th>
                                            <Th align="right">Refunded</Th>
                                            <Th>Status</Th>
                                            <Th>Ref</Th>
                                            <Th />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60">
                                        {filtered.map((p) => {
                                            const refundList = refundsByPayment.get(p.id) ?? [];
                                            const refundedTotal = refundList
                                                .filter((r) => r.status !== "FAILED")
                                                .reduce((s, r) => s + Number(r.amount), 0);
                                            const fee = isRazorpay(p) ? p.amount * (platformFeePct / 100) : 0;
                                            const isExpanded = expanded === p.id;
                                            return (
                                                <>
                                                    <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                                                        <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                                                            {new Date(p.created_at).toLocaleDateString("en-IN", {
                                                                day: "numeric", month: "short", timeZone: "Asia/Kolkata",
                                                            })}
                                                            <div className="text-[11px] text-slate-500">
                                                                {new Date(p.created_at).toLocaleTimeString("en-IN", {
                                                                    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
                                                                })}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm font-mono text-slate-300 whitespace-nowrap">
                                                            {p.booking?.code ?? "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap max-w-[200px] truncate">
                                                            {p.booking?.guest_name ?? "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                                                            <MethodChip method={p.method} isRazorpay={isRazorpay(p)} />
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-right font-mono text-slate-100">
                                                            ₹{p.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-right font-mono text-slate-500">
                                                            {fee > 0 ? `−₹${fee.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-right font-mono text-amber-400">
                                                            {refundedTotal > 0 ? `−₹${refundedTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            <StatusBadge status={p.status} />
                                                        </td>
                                                        <td className="px-4 py-3 text-[11px] font-mono text-slate-500 whitespace-nowrap">
                                                            {p.razorpay_payment_id ? p.razorpay_payment_id.slice(0, 18) + "…" : "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            {refundList.length > 0 && (
                                                                <button
                                                                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                                                                    className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-white"
                                                                >
                                                                    {refundList.length} {refundList.length === 1 ? "refund" : "refunds"}
                                                                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {isExpanded && refundList.length > 0 && (
                                                        <tr className="bg-slate-900/60">
                                                            <td colSpan={10} className="px-4 py-3">
                                                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Refunds against this payment</div>
                                                                <div className="space-y-1.5">
                                                                    {refundList.map((r) => {
                                                                        const canRefresh = r.status === "PENDING" && !!r.razorpay_refund_id;
                                                                        const isRefreshing = refreshingId === r.id;
                                                                        return (
                                                                            <div key={r.id} className="flex items-center justify-between gap-3 text-xs bg-slate-900/80 rounded-lg px-3 py-2 border border-slate-800">
                                                                                <div className="flex items-center gap-3 min-w-0">
                                                                                    <span className="font-mono text-amber-400 shrink-0">
                                                                                        −₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                                                                    </span>
                                                                                    <RefundStatusBadge status={r.status} />
                                                                                    <span className="text-slate-400 truncate">
                                                                                        {r.reason || "No reason given"}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2 shrink-0">
                                                                                    {canRefresh && (
                                                                                        <button
                                                                                            onClick={() => runRefresh(r)}
                                                                                            disabled={isRefreshing}
                                                                                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 border-sky-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                                                            title="Ask Razorpay for the current refund status"
                                                                                        >
                                                                                            {isRefreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                                                                                            {isRefreshing ? "Checking" : "Refresh"}
                                                                                        </button>
                                                                                    )}
                                                                                    <div className="text-slate-500 font-mono text-[10px]">
                                                                                        {r.razorpay_refund_id || r.id.slice(0, 8)} ·{" "}
                                                                                        {new Date(r.initiated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <p className="text-[11px] text-slate-500 mt-4">
                        Showing the most recent {filtered.length} of {payments.length} payments for the selected window.
                        Settlement timing for Razorpay payouts to your Linked Account is governed by your Razorpay
                        agreement (usually T+1 to T+3 business days). The amounts here reflect what was captured, not
                        what has hit your bank account.
                    </p>
                </div>
            </div>
        </OwnerGate>
    );
}

/* ============================================================
   Sub-components
   ============================================================ */

function SummaryCard({
    icon: Icon,
    label,
    value,
    sub,
    tone,
}: {
    icon: any; // lucide-react icons; loose typing avoids ForwardRef vs ComponentType mismatch
    label: string;
    value: string;
    sub: string;
    tone: "emerald" | "amber" | "sky" | "neutral";
}) {
    const toneClass: Record<typeof tone, string> = {
        emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
        amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        sky: "bg-sky-500/10 text-sky-300 border-sky-500/30",
        neutral: "bg-slate-800 text-slate-400 border-slate-700",
    };
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-start gap-3">
                <div className={`h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center ${toneClass[tone]}`}>
                    <Icon size={16} />
                </div>
                <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
                    <div className="text-xl font-bold text-white font-mono tracking-tight mt-0.5">{value}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
                </div>
            </div>
        </div>
    );
}

function MethodChip({ method, isRazorpay }: { method: PaymentMethod; isRazorpay: boolean }) {
    const label = isRazorpay ? `${methodLabel(method)} · Razorpay` : methodLabel(method);
    const cls = isRazorpay
        ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
        : "bg-slate-800 text-slate-300 border-slate-700";
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cls}`}>
            {label}
        </span>
    );
}

function StatusBadge({ status }: { status: PaymentStatus }) {
    const cls: Record<PaymentStatus, string> = {
        COMPLETED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
        PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        FAILED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
        REFUNDED: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cls[status]}`}>
            {status.toLowerCase()}
        </span>
    );
}

function RefundStatusBadge({ status }: { status: "PENDING" | "PROCESSED" | "FAILED" }) {
    const cls: Record<typeof status, string> = {
        PROCESSED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
        PENDING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
        FAILED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    };
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${cls[status]}`}>
            {status.toLowerCase()}
        </span>
    );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
    return (
        <th scope="col" className={`px-4 py-2.5 text-${align} text-[10px] font-bold uppercase tracking-widest text-slate-500`}>
            {children}
        </th>
    );
}

/* ============================================================
   Helpers
   ============================================================ */

function isRazorpay(p: PaymentRow): boolean {
    return !!p.razorpay_payment_id;
}

function methodLabel(m: PaymentMethod): string {
    switch (m) {
        case "BANK_TRANSFER": return "Bank";
        case "WALLET": return "Wallet";
        default: return m.charAt(0) + m.slice(1).toLowerCase();
    }
}

function fmtINR(v: number): string {
    if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(v >= 10_00_000 ? 1 : 2)}L`;
    return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function periodBounds(p: PeriodKey): { startISO: string | null } {
    const now = new Date();
    if (p === "all") return { startISO: null };
    let start: Date;
    if (p === "today") {
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
    } else if (p === "7d") {
        start = new Date(now.getTime() - 7 * 86_400_000);
    } else if (p === "30d") {
        start = new Date(now.getTime() - 30 * 86_400_000);
    } else if (p === "month") {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
        return { startISO: null };
    }
    return { startISO: start.toISOString() };
}

function computeTotals(payments: PaymentRow[], refunds: RefundRow[], feePct: number) {
    const completed = payments.filter((p) => p.status === "COMPLETED");
    const collected = completed.reduce((s, p) => s + Number(p.amount), 0);

    const processedRefunds = refunds.filter((r) => r.status === "PROCESSED");
    const refunded = processedRefunds.reduce((s, r) => s + Number(r.amount), 0);

    // Platform fee applies only to Razorpay payments. For refunds, the fee is
    // reversed too (reverse_all: 1) so the net fee is computed on (paid − refunded).
    const razorpayCompleted = completed.filter(isRazorpay);
    const razorpayPaid = razorpayCompleted.reduce((s, p) => s + Number(p.amount), 0);
    const razorpayRefundedIds = new Set(processedRefunds.map((r) => r.payment_id));
    const razorpayRefunded = processedRefunds
        .filter((r) => razorpayCompleted.some((p) => p.id === r.payment_id))
        .reduce((s, r) => s + Number(r.amount), 0);
    void razorpayRefundedIds; // (placeholder for future per-payment fee tracking)
    const platformFee = ((razorpayPaid - razorpayRefunded) * feePct) / 100;

    const netToHotel = collected - refunded - platformFee;

    return {
        collected,
        refunded,
        platformFee,
        netToHotel,
        completedCount: completed.length,
        processedRefundCount: processedRefunds.length,
    };
}

function csvCell(v: string): string {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
}

function daysAgo(n: number): Date {
    return new Date(Date.now() - n * 86_400_000);
}

function ymd(d: Date): string {
    // Local-day YYYY-MM-DD (date inputs are timezone-naive by spec)
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function ReconStat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
    const cls =
        tone === "warn" ? "text-amber-300" :
            tone === "ok" ? "text-emerald-300" :
                "text-slate-200";
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
            <span className={`text-base font-mono font-bold ${cls}`}>{value}</span>
        </div>
    );
}

function DiscrepancyCard({ d }: { d: ReconcileDiscrepancy }) {
    const sev = {
        ERROR: { border: "border-rose-500/30", bg: "bg-rose-500/[0.06]", text: "text-rose-200", icon: AlertTriangle, iconColor: "text-rose-400" },
        WARN: { border: "border-amber-500/30", bg: "bg-amber-500/[0.06]", text: "text-amber-200", icon: AlertTriangle, iconColor: "text-amber-400" },
        INFO: { border: "border-sky-500/30", bg: "bg-sky-500/[0.06]", text: "text-sky-200", icon: Clock, iconColor: "text-sky-400" },
    }[d.severity];
    const SevIcon = sev.icon;
    const ourAmt = d.our?.amount as number | undefined;
    const rzpAmt = (d.razorpay?.amount as number | undefined);

    return (
        <div className={`rounded-lg border ${sev.border} ${sev.bg} px-3 py-2.5`}>
            <div className="flex items-start gap-2">
                <SevIcon className={`w-4 h-4 shrink-0 mt-0.5 ${sev.iconColor}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${sev.text}`}>
                            {d.severity} · {d.kind}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 truncate">
                            {d.razorpayId || d.ourId.slice(0, 8)}
                        </span>
                    </div>
                    <div className="text-xs text-slate-200">{d.message}</div>
                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono text-slate-500">
                        <div>
                            Ours: status=<span className="text-slate-300">{String(d.our?.status ?? "—")}</span>
                            {ourAmt !== undefined && (
                                <> · amount=<span className="text-slate-300">₹{Number(ourAmt).toFixed(2)}</span></>
                            )}
                        </div>
                        <div>
                            Razorpay: status=<span className="text-slate-300">{String(d.razorpay?.status ?? "—")}</span>
                            {rzpAmt !== undefined && (
                                <> · amount=<span className="text-slate-300">₹{(Number(rzpAmt) / 100).toFixed(2)}</span></>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
