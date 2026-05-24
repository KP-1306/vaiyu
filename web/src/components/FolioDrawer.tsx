import React, { useState, useEffect } from "react";
import { X, ChevronDown, CheckCircle2, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { RazorpayServiceError } from "../services/razorpayService";
import { getRazorpayClient } from "../services/razorpayClient";

interface FolioDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    arrival: any; // The row from v_arrival_dashboard_rows
}

interface FolioEntry {
    id: string;
    entry_type: string;
    amount: number;
    description: string;
    created_at: string;
}

interface Transaction {
    id: string;
    amount: number;
    method: string;
    status: string;
    collected_by: string;
    created_at: string;
    reference_id: string;
    /** Set when this payment was captured via Razorpay — enables Refund button */
    razorpay_payment_id?: string | null;
    /** Which Razorpay credential path was used. Drives refund dispatch
     *  (Route vs Direct) so old DIRECT payments still refund via DIRECT keys
     *  even if the hotel has since switched to ROUTE. */
    razorpay_mode?: "DIRECT" | "ROUTE" | null;
}

interface ArrivalEvent {
    id: string;
    event_type: string;
    old_value: string | null;
    new_value: string | null;
    details: any;
    performed_by: string | null;
    created_at: string;
}

export default function FolioDrawer({ isOpen, onClose, arrival }: FolioDrawerProps) {
    const [activeTab, setActiveTab] = useState<"SUMMARY" | "FOLIO" | "PAYMENTS" | "ACTIVITY">("FOLIO");
    const [entries, setEntries] = useState<FolioEntry[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [activityStream, setActivityStream] = useState<any[]>([]);
    const [staffNames, setStaffNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [showCollectPayment, setShowCollectPayment] = useState(false);

    // Payment Form State
    const [paymentMethod, setPaymentMethod] = useState("CASH");
    const [paymentAmount, setPaymentAmount] = useState<number | "">("");
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [isPaymentMethodOpen, setIsPaymentMethodOpen] = useState(false);

    // Refund modal state
    const [refundFor, setRefundFor] = useState<Transaction | null>(null);
    const [refundAmount, setRefundAmount] = useState<number | "">("");
    const [refundReason, setRefundReason] = useState<string>("");
    const [refundBusy, setRefundBusy] = useState(false);
    const [refundError, setRefundError] = useState<string | null>(null);

    function openRefundModal(tx: Transaction) {
        setRefundFor(tx);
        setRefundAmount(tx.amount);
        setRefundReason("");
        setRefundError(null);
    }
    function closeRefundModal() {
        setRefundFor(null);
        setRefundBusy(false);
        setRefundError(null);
    }
    async function submitRefund() {
        if (!refundFor) return;
        if (refundAmount === "" || Number(refundAmount) <= 0) {
            setRefundError("Refund amount must be > 0");
            return;
        }
        if (Number(refundAmount) > refundFor.amount + 0.001) {
            setRefundError(`Cannot refund more than the original amount (₹${refundFor.amount.toLocaleString()})`);
            return;
        }
        setRefundBusy(true);
        setRefundError(null);
        try {
            // Dispatch to the right Razorpay client based on how the original
            // payment was captured. A DIRECT-captured payment MUST be refunded
            // via DIRECT keys (hotel's own Razorpay account holds the funds).
            await getRazorpayClient(refundFor.razorpay_mode ?? "ROUTE").createRefund({
                paymentId: refundFor.id,
                amount: Number(refundAmount),
                reason: refundReason.trim() || undefined,
            });
            closeRefundModal();
            // Refresh the folio view — payment row + new folio entry will reflect
            fetchFolioAndTransactions();
        } catch (e) {
            const msg = e instanceof RazorpayServiceError ? e.message : String((e as any)?.message ?? e);
            setRefundError(msg);
        } finally {
            setRefundBusy(false);
        }
    }

    useEffect(() => {
        if (!isOpen || !arrival?.booking_id) return;
        fetchFolioAndTransactions();
    }, [isOpen, arrival?.booking_id]);

    const fetchFolioAndTransactions = async () => {
        setLoading(true);
        // Fetch Folio
        const { data: folioData } = await supabase
            .from("folio_entries")
            .select("*")
            .eq("booking_id", arrival.booking_id)
            .order("created_at", { ascending: true });

        if (folioData) setEntries(folioData);

        // Fetch Transactions
        const { data: txData } = await supabase
            .from("payments")
            .select("id, amount, method, status, collected_by, created_at, reference_id, razorpay_payment_id, razorpay_mode")
            .eq("booking_id", arrival.booking_id)
            .order("created_at", { ascending: false });

        if (txData) setTransactions(txData);

        // Fetch Activity Stream (Unified View)
        const { data: eventsData } = await supabase
            .from("v_booking_activity")
            .select("*")
            .eq("booking_id", arrival.booking_id)
            .order("event_time", { ascending: false })
            .order("sort_priority", { ascending: true });

        if (eventsData) setActivityStream(eventsData);

        // Resolve staff names for payments
        if (txData && txData.length > 0) {
            const uids = [...new Set(txData.map(t => t.collected_by).filter(Boolean))];
            if (uids.length > 0) {
                const { data: profiles } = await supabase
                    .from("profiles")
                    .select("id, full_name")
                    .in("id", uids);

                if (profiles) {
                    const nameMap: Record<string, string> = {};
                    profiles.forEach(p => { nameMap[p.id] = p.full_name; });
                    setStaffNames(nameMap);
                }
            }
        }

        // Default the payment amount to pending
        setPaymentAmount(arrival.pending_amount || "");
        setLoading(false);
    };

    const handleRecordPayment = async () => {
        if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) <= 0) return;

        setPaymentLoading(true);
        const userStr = localStorage.getItem("sb-auth-token") || "{}"; // Simplified fallback for auth
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await supabase.rpc("collect_payment", {
            p_booking_id: arrival.booking_id,
            p_amount: Number(paymentAmount),
            p_method: paymentMethod
        });

        if (!error) {
            setShowCollectPayment(false);
            setPaymentAmount("");
            fetchFolioAndTransactions(); // Refresh entries
        } else {
            alert("Payment failed: " + error.message);
        }
        setPaymentLoading(false);
    };

    // Build Unified Operational Timeline
    const timeline = React.useMemo(() => {
        if (!arrival) return [];
        const items: any[] = [];
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        // 0. Base Events (Synthesized from Arrival data to ensure timeline isn't empty)
        // Check-in event fallback
        if (arrival.actual_checkin_at) {
            items.push({
                id: `synthetic-checkin-${arrival.id}`,
                type: "CHECK-IN",
                timestamp: new Date(arrival.actual_checkin_at),
                desc: "Guest checked in",
                subDesc: `Room ${arrival.room_numbers || "assigned"}`,
                icon: "👋",
                color: "text-[#D4A373]",
                isSynthetic: true
            });
        }

        // Check-out event fallback
        if (arrival.actual_checkout_at) {
            items.push({
                id: `synthetic-checkout-${arrival.id}`,
                type: "CHECK-OUT",
                timestamp: new Date(arrival.actual_checkout_at),
                desc: "Guest checked out",
                subDesc: "Stay completed",
                icon: "🚪",
                color: "text-[#D4A373]",
                isSynthetic: true
            });
        }

        // Creation event fallback
        if (arrival.created_at) {
            items.push({
                id: `synthetic-created-${arrival.id}`,
                type: "BOOKING",
                timestamp: new Date(arrival.created_at),
                desc: "Booking created",
                subDesc: `Via ${arrival.source?.replace('_', ' ') || "Direct Entry"}`,
                icon: "📅",
                color: "text-[#F3E6D0]/30",
                isSynthetic: true
            });
        }

        // 1. Add Events from Unified Activity Stream
        activityStream.forEach((e: any) => {
            // Avoid duplicating synthetic events if real events exist
            if (e.event_category === 'ARRIVAL') {
                if (e.event_type === "CHECKIN" || e.event_type === "checked_in" || e.event_type === "inhouse") {
                    const synIdx = items.findIndex(i => i.type === "CHECK-IN" && i.isSynthetic);
                    if (synIdx > -1) items.splice(synIdx, 1);
                }
                if (e.event_type === "CHECKOUT" || e.event_type === "checked_out") {
                    const synIdx = items.findIndex(i => i.type === "CHECK-OUT" && i.isSynthetic);
                    if (synIdx > -1) items.splice(synIdx, 1);
                }
            }

            let type = e.event_type;
            let icon = "📝";
            let color = "text-[#F3E6D0]/50";
            let subDesc = e.description || "";
            let desc = e.title;

            // Map UI based on Category (following Enterprise Design)
            if (e.event_category === "ARRIVAL") {
                color = "text-green-400"; // Green badge conceptual mapping
                if (e.event_type === "CHECKIN" || e.event_type === "checked_in" || e.event_type === "inhouse") { icon = "👋"; type = "CHECK-IN"; }
                else if (e.event_type === "CHECKOUT" || e.event_type === "checked_out") { icon = "🚪"; type = "CHECK-OUT"; }
                else if (e.event_type === "precheckin") { icon = "📱"; type = "PRE-CHECKIN"; }
                else if (e.event_type === "ROOM_ASSIGNED") { icon = "🔑"; }
                else if (e.event_type === "ROOM_REASSIGNED") { icon = "🔄"; }
                else if (e.event_type === "NO_SHOW") { icon = "❌"; }
                else if (e.event_type === "CANCEL") { icon = "🚫"; }
            }
            else if (e.event_category === "FOOD") {
                color = "text-orange-400";
                icon = "🍽️";
                if (e.amount) subDesc += ` (₹${e.amount})`;
            }
            else if (e.event_category === "PAYMENT") {
                color = "text-blue-400";
                icon = "💳";
                const collectorName = e.actor_id && staffNames[e.actor_id] ? staffNames[e.actor_id] : "System";
                subDesc += ` • Collected by <span class="capitalize">${collectorName}</span>`;
            }
            else if (e.event_category === "SERVICE") {
                color = "text-purple-400";
                icon = "🛠️";
            }

            items.push({
                id: `${e.event_category}-${e.event_time}-${items.length}`,
                type: type.replace('_', '-'),
                timestamp: new Date(e.event_time),
                desc,
                subDesc,
                icon,
                color,
                raw: e,
                sort_priority: e.sort_priority || 0
            });
        });

        // 3. Add Folio Charges (Room/Misc) -> Ignore payments/refunds/food since they are handled in activityStream or other tabs
        entries.forEach(fe => {
            if (["PAYMENT", "REFUND", "FOOD_CHARGE"].includes(fe.entry_type)) return;

            let displayDesc = fe.description || fe.entry_type.replace('_', ' ');
            let amtStr = `₹${Number(fe.amount).toLocaleString('en-IN')}`;

            displayDesc = displayDesc.replace(/\s*\(\₹[\d,]+\)\s*/g, '');
            displayDesc = displayDesc.replace(/^Charge Added:\s*/i, '');
            displayDesc = displayDesc.replace(/#\s*/g, '');

            const desc = `${displayDesc.trim()} • ${amtStr}`;

            items.push({
                id: fe.id,
                type: "CHARGE",
                timestamp: new Date(fe.created_at),
                desc,
                subDesc: "",
                icon: "🧾",
                color: "text-[#F3E6D0]/70",
                raw: fe,
                sort_priority: 5 // Put charges lower in priority for same timestamp
            });
        });

        // Sort descending (newest first), resolving timestamp collisions with sort_priority
        return items.sort((a, b) => {
            const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
            if (timeDiff !== 0) return timeDiff;
            return (a.sort_priority || 0) - (b.sort_priority || 0);
        });
    }, [activityStream, entries, staffNames]);

    if (!isOpen || !arrival) return null;

    // Derived Financials from Entries — group by entry_type so each line in
    // the folio summary maps to a single category. ADJUSTMENT can be either
    // a discount (negative) or a surcharge (positive); split on sign.
    const sumWhere = (pred: (e: FolioEntry) => boolean) =>
        entries.filter(pred).reduce((acc, e) => acc + Number(e.amount), 0);
    const roomCharges = sumWhere(e => e.entry_type === "ROOM_CHARGE");
    const foodCharges = sumWhere(e => e.entry_type === "FOOD_CHARGE");
    const serviceCharges = sumWhere(e => e.entry_type === "SERVICE_CHARGE");
    const taxAmount = sumWhere(e => e.entry_type === "TAX");
    const discountAmount = -sumWhere(e => e.entry_type === "ADJUSTMENT" && Number(e.amount) < 0);
    const surchargeAmount = sumWhere(e => e.entry_type === "ADJUSTMENT" && Number(e.amount) > 0);
    // totalCharges = all non-payment entries with their stored sign — includes
    // ADJUSTMENT's negative sign so the discount is correctly subtracted.
    const totalCharges = entries.filter(e => !["PAYMENT", "REFUND"].includes(e.entry_type)).reduce((acc, e) => acc + Number(e.amount), 0);
    const totalPayments = entries.filter(e => ["PAYMENT", "REFUND"].includes(e.entry_type)).reduce((acc, e) => acc + Math.abs(Number(e.amount)), 0);

    // Fallback to arrival.pending_amount if no entries yet? Actually arrival view calculates it better.
    // Let's rely on the real-time entries we just fetched.
    const outstandingBalance = Math.max(0, totalCharges - totalPayments);

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="relative w-full max-w-md bg-[#231A13] text-[#F3E6D0] h-full flex flex-col shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="px-6 py-5 border-b border-orange-900/30">
                    <button onClick={onClose} className="absolute top-5 right-5 text-orange-200/50 hover:text-orange-200 transition">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#8C5D35] to-[#4A2E1A] border-2 border-[#D4A373] p-0.5 shadow-lg overflow-hidden flex items-center justify-center">
                            <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(arrival.guest_name)}&background=8C5D35&color=F3E6D0`} alt={arrival.guest_name} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-white mb-0.5">{arrival.guest_name}</h2>
                            <p className="text-xs text-[#D4A373] font-medium flex items-center gap-1.5 opacity-90">
                                {arrival.room_numbers || "Unassigned"} · {Math.max(1, Math.round((new Date(arrival.scheduled_checkout_at).getTime() - new Date(arrival.scheduled_checkin_at).getTime()) / (1000 * 60 * 60 * 24)))} Nights
                                <span className="text-orange-900/40">|</span>
                                {new Date(arrival.scheduled_checkin_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - {new Date(arrival.scheduled_checkout_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex px-6 items-center gap-6 border-b border-orange-900/30 text-sm font-medium mt-1">
                    {["SUMMARY", "FOLIO", "PAYMENTS", "ACTIVITY"].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`py-3 relative ${activeTab === tab ? "text-[#D4A373]" : "text-[#F3E6D0]/50 hover:text-[#F3E6D0]/80"}`}
                        >
                            {tab.charAt(0) + tab.slice(1).toLowerCase()}
                            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4A373] rounded-t-full" />}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 p-6 relative">
                    {activeTab === "FOLIO" && (
                        <div className="space-y-6">

                            {/* Outstanding Balance Banner */}
                            <div className="flex items-center justify-between text-lg">
                                <span className="text-[#F3E6D0]/70 font-medium">Outstanding Balance:</span>
                                <span className={`text-2xl font-bold ${outstandingBalance > 0 ? "text-[#E65F5C]" : "text-[#78B48B]"}`}>
                                    ₹ {outstandingBalance.toLocaleString('en-IN')}
                                </span>
                            </div>

                            {/* Folio Entries Table */}
                            <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 p-5 space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-bold tracking-wide text-[#F3E6D0]/60 uppercase">Folio Entries</h3>
                                    <button className="text-[#D4A373] hover:text-[#E8BA87] flex items-center justify-center w-5 h-5 rounded-full border border-orange-900/50">i</button>
                                </div>

                                {loading ? (
                                    <p className="text-sm text-[#F3E6D0]/40 text-center py-4">Loading folio...</p>
                                ) : (
                                    <div className="space-y-4 text-[15px]">
                                        {/* Summarized Entries for cleaner look */}
                                        <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                            <span>Room Charges</span>
                                            <span>₹ {roomCharges.toLocaleString('en-IN')}</span>
                                        </div>
                                        {discountAmount > 0 && (
                                            <div className="flex justify-between items-center text-[#78B48B]">
                                                <span>Discount</span>
                                                <span>(-₹ {discountAmount.toLocaleString('en-IN')})</span>
                                            </div>
                                        )}
                                        {surchargeAmount > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                                <span>Surcharge</span>
                                                <span>₹ {surchargeAmount.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {taxAmount > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                                <span>Tax</span>
                                                <span>₹ {taxAmount.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {foodCharges > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                                <span>Food / F&B</span>
                                                <span>₹ {foodCharges.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {serviceCharges > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                                <span>Service</span>
                                                <span>₹ {serviceCharges.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {totalPayments > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/70">
                                                <span>Payments Received</span>
                                                <span className="text-[#78B48B]">(-₹ {totalPayments.toLocaleString('en-IN')})</span>
                                            </div>
                                        )}

                                        <div className="w-full h-px bg-orange-900/30 my-2" />

                                        <div className="flex justify-between items-center text-[#F3E6D0]/80">
                                            <span>Total Charges</span>
                                            <span>₹ {totalCharges.toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[#F3E6D0]/80">
                                            <span>Total Payments</span>
                                            <span>(-₹ {totalPayments.toLocaleString('en-IN')})</span>
                                        </div>

                                        <div className="w-full h-px bg-orange-900/30 my-2" />

                                        <div className="flex justify-between items-center text-white font-bold text-base pt-1">
                                            <span>Outstanding Balance</span>
                                            <span className={outstandingBalance > 0 ? "text-[#E65F5C]" : "text-[#78B48B]"}>
                                                ₹ {outstandingBalance.toLocaleString('en-IN')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Action Button */}
                            {outstandingBalance > 0 && (
                                <button
                                    onClick={() => setShowCollectPayment(true)}
                                    className="w-full py-4 mt-6 bg-gradient-to-r from-[#B98357] to-[#8C5D35] text-white font-bold rounded-xl shadow-[0_0_20px_rgba(185,131,87,0.3)] hover:shadow-[0_0_25px_rgba(185,131,87,0.5)] transition-all flex items-center justify-center text-[15px]"
                                >
                                    Collect Payment
                                </button>
                            )}

                        </div>
                    )}

                    {activeTab === "SUMMARY" && (
                        <div className="space-y-6">
                            {/* Outstanding Balance Banner */}
                            <div className="flex items-center justify-between text-lg">
                                <span className="text-[#F3E6D0]/70 font-medium">Outstanding Balance:</span>
                                <span className={`text-2xl font-bold ${outstandingBalance > 0 ? "text-[#E65F5C]" : "text-[#78B48B]"}`}>
                                    ₹ {outstandingBalance.toLocaleString('en-IN')}
                                </span>
                            </div>

                            {/* Action Button */}
                            {outstandingBalance > 0 && (
                                <button
                                    onClick={() => setShowCollectPayment(true)}
                                    className="w-full py-4 bg-gradient-to-r from-[#B98357] to-[#8C5D35] text-white font-bold rounded-xl shadow-[0_0_20px_rgba(185,131,87,0.3)] hover:shadow-[0_0_25px_rgba(185,131,87,0.5)] transition-all flex items-center justify-center text-[15px]"
                                >
                                    Collect Payment
                                </button>
                            )}

                            {/* Stay Info Card */}
                            <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 p-5 space-y-4">
                                <h3 className="text-sm font-bold tracking-wide text-[#F3E6D0]/60 uppercase border-b border-orange-900/30 pb-2">Stay Information</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-[14px]">
                                    <div>
                                        <div className="text-[#F3E6D0]/50 mb-1 text-xs">Check-in</div>
                                        <div className="text-[#F3E6D0]/90 font-medium">{new Date(arrival.scheduled_checkin_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                                    </div>
                                    <div>
                                        <div className="text-[#F3E6D0]/50 mb-1 text-xs">Checkout</div>
                                        <div className="text-[#F3E6D0]/90 font-medium">{new Date(arrival.scheduled_checkout_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                                    </div>
                                    <div>
                                        <div className="text-[#F3E6D0]/50 mb-1 text-xs">Room</div>
                                        <div className="text-[#F3E6D0]/90 font-medium flex items-center gap-2">
                                            {arrival.room_numbers || "Unassigned"}
                                            {arrival.arrival_operational_state === "READY_TO_CHECKIN" && (
                                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[#F3E6D0]/50 mb-1 text-xs">Guests</div>
                                        <div className="text-[#F3E6D0]/90 font-medium">{arrival.guest_count || 1} Person</div>
                                    </div>
                                    <div className="col-span-2 mt-1">
                                        <div className="text-[#F3E6D0]/50 mb-1 text-xs">Booking Ref / Source</div>
                                        <div className="text-[#F3E6D0]/90 font-medium">{arrival.booking_code} <span className="text-[#D4A373]/80 mx-1">•</span> {arrival.arrival_badge === "OTA" ? "OTA Booking" : "Direct Booking"}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Quick KPIs Card */}
                            <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 p-5 space-y-4">
                                <h3 className="text-sm font-bold tracking-wide text-[#F3E6D0]/60 uppercase border-b border-orange-900/30 pb-2">Quick KPIs</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-[#231A13] p-3 rounded-lg border border-orange-900/10">
                                        <span className="text-[#F3E6D0]/80 text-sm">VIP Status</span>
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${arrival.vip_flag ? "bg-purple-900/50 text-purple-300" : "bg-gray-800 text-gray-400"}`}>
                                            {arrival.vip_flag ? "VIP STAY" : "STANDARD"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center bg-[#231A13] p-3 rounded-lg border border-orange-900/10">
                                        <span className="text-[#F3E6D0]/80 text-sm">Room Status</span>
                                        {(() => {
                                            const state = arrival.arrival_operational_state;
                                            let label = "WAITING";
                                            let color = "bg-amber-900/50 text-amber-300";

                                            if (state === "CHECKED_IN" || state === "PARTIALLY_ARRIVED") {
                                                label = "INHOUSE";
                                                color = "bg-emerald-900/50 text-emerald-300";
                                            } else if (state === "READY_TO_CHECKIN") {
                                                label = "READY";
                                                color = "bg-emerald-900/50 text-emerald-300";
                                            } else if (state === "WAITING_HOUSEKEEPING") {
                                                label = "DIRTY";
                                                color = "bg-red-900/50 text-red-300";
                                            } else if (state === "WAITING_ROOM_ASSIGNMENT" || state === "NO_ROOMS") {
                                                label = "UNASSIGNED";
                                                color = "bg-slate-800 text-slate-400";
                                            }

                                            return (
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>
                                                    {label}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                    {activeTab === "PAYMENTS" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-[#F3E6D0]">Transaction History</h3>
                                <span className="text-xs font-semibold text-[#F3E6D0]/50 bg-orange-900/20 px-2 py-1 rounded">
                                    {transactions.length} Records
                                </span>
                            </div>

                            {loading ? (
                                <p className="text-sm text-[#F3E6D0]/40 text-center py-8">Loading transactions...</p>
                            ) : transactions.length === 0 ? (
                                <div className="text-center py-10 bg-[#1A130C] rounded-xl border border-orange-900/20">
                                    <div className="text-4xl mb-3 opacity-50">🧾</div>
                                    <h4 className="text-[#F3E6D0]/80 font-bold mb-1">No Payments Yet</h4>
                                    <p className="text-[#F3E6D0]/40 text-sm">No transactions have been recorded for this stay.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {transactions.map(tx => (
                                        <div key={tx.id} className="bg-[#1A130C] rounded-xl border border-orange-900/20 p-4 relative overflow-hidden group hover:border-[#D4A373]/50 transition-colors">
                                            {/* Status Indicator Bar */}
                                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${tx.status === "COMPLETED" ? "bg-[#78B48B]" : tx.status === "REFUNDED" ? "bg-amber-500" : "bg-[#E65F5C]"}`}></div>

                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">
                                                        {tx.method === "CASH" ? "💵" : tx.method === "UPI" ? "📱" : tx.method === "BANK_TRANSFER" ? "🏦" : "💳"}
                                                    </span>
                                                    <div>
                                                        <div className="font-bold text-[#F3E6D0]/90 text-[15px] flex items-center gap-2">
                                                            ₹ {tx.amount.toLocaleString('en-IN')}
                                                            {tx.status === "REFUNDED" && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded uppercase tracking-wider">Refunded</span>}
                                                            {tx.status === "FAILED" && <span className="text-[10px] bg-red-500/20 text-red-500 px-1.5 py-0.5 rounded uppercase tracking-wider">Failed</span>}
                                                        </div>
                                                        <div className="text-xs text-[#F3E6D0]/50 mt-0.5">
                                                            {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-xs font-semibold text-[#D4A373]">
                                                        {tx.method.replace('_', ' ')}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-3 pt-3 border-t border-orange-900/20 flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-1.5 text-[#F3E6D0]/40">
                                                    <span className="opacity-70">By:</span>
                                                    <span className="text-[#F3E6D0]/70 font-medium capitalize">
                                                        {tx.collected_by && staffNames[tx.collected_by] ? staffNames[tx.collected_by] : "System"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {/* Refund only for COMPLETED Razorpay payments. Cash refunds
                                                        are a different workflow (no gateway round-trip) and aren't
                                                        wired yet. */}
                                                    {tx.status === "COMPLETED" && tx.razorpay_payment_id && (
                                                        <button
                                                            type="button"
                                                            onClick={() => openRefundModal(tx)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors text-[10px] font-bold uppercase tracking-wider"
                                                            title="Refund this payment via Razorpay (reverse_all)"
                                                        >
                                                            <RotateCcw className="w-3 h-3" />
                                                            Refund
                                                        </button>
                                                    )}
                                                    {tx.reference_id && (
                                                        <div className="text-[#F3E6D0]/30 font-mono tracking-tight">
                                                            #{/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(tx.reference_id) ? tx.reference_id.substring(0, 8).toUpperCase() : tx.reference_id}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Action Button */}
                            {outstandingBalance > 0 && (
                                <button
                                    onClick={() => setShowCollectPayment(true)}
                                    className="w-full py-4 mt-4 bg-[#231A13] border border-[#D4A373]/30 text-[#D4A373] hover:bg-[#D4A373]/10 font-bold rounded-xl transition-all flex items-center justify-center text-[15px]"
                                >
                                    + Record New Payment
                                </button>
                            )}
                        </div>
                    )}

                    {activeTab === "ACTIVITY" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-bold text-[#F3E6D0]">Operational Timeline</h3>
                                <span className="text-xs font-semibold text-[#F3E6D0]/50 bg-orange-900/20 px-2 py-1 rounded">
                                    {timeline.length} Events
                                </span>
                            </div>

                            {loading ? (
                                <p className="text-sm text-[#F3E6D0]/40 text-center py-8">Loading timeline...</p>
                            ) : timeline.length === 0 ? (
                                <div className="text-center py-10 bg-[#1A130C] rounded-xl border border-orange-900/20">
                                    <div className="text-4xl mb-3 opacity-50">⏳</div>
                                    <h4 className="text-[#F3E6D0]/80 font-bold mb-1">No Activity Yet</h4>
                                    <p className="text-[#F3E6D0]/40 text-sm">No events have been recorded for this stay.</p>
                                </div>
                            ) : (
                                <div className="relative pl-3 space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-orange-900/50 before:via-orange-900/20 before:to-transparent">
                                    {timeline.map((item, idx) => (
                                        <div key={item.id + idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                            {/* Icon */}
                                            <div className="flex items-center justify-center w-6 h-6 rounded-full border border-orange-900/30 bg-[#1A130C] text-[10px] shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 mr-4 md:mr-0">
                                                {item.icon}
                                            </div>

                                            {/* Card */}
                                            <div className="w-[calc(100%-3rem)] md:w-[calc(50%-1.5rem)] bg-[#1A130C] p-3.5 rounded-xl border border-orange-900/20 shadow-sm hover:border-[#D4A373]/30 transition-colors">
                                                <div className="mb-2">
                                                    <div className={`font-mono text-xs uppercase tracking-wider mb-1 ${item.color}`}>{item.type}</div>
                                                    <time className="text-xs font-medium text-[#F3E6D0]/50 block">
                                                        {item.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric" })} • {item.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                                    </time>
                                                </div>
                                                <div className="text-[#F3E6D0]/90 text-[15px] leading-snug">
                                                    {item.desc}
                                                </div>
                                                {item.subDesc && (
                                                    <div className="text-[#F3E6D0]/70 text-[13px] leading-snug mt-0.5" dangerouslySetInnerHTML={{ __html: item.subDesc }} />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-orange-900/30 text-xs text-[#F3E6D0]/40 text-center mt-auto">
                    Need assistance? Call Front Desk at +91 01234 56789 <span className="inline-flex w-4 h-4 rounded-full border border-orange-900/50 items-center justify-center ml-1">?</span>
                </div>
            </div>

            {/* Collect Payment "Popup" - Overlaying the drawer */}
            {showCollectPayment && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 rounded-l-2xl" onClick={() => setShowCollectPayment(false)} />
                    <div className="relative w-full max-w-sm bg-[#FAF8F5] text-gray-900 shadow-xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-200 bg-[#FAF8F5]">
                            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Collect Payment</h3>
                            <button onClick={() => setShowCollectPayment(false)} className="text-gray-400 hover:text-gray-600 transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 flex items-center gap-3 bg-[#F4F1EA]">
                            <div className="w-10 h-10 rounded-full bg-[#E5DFD3] border border-white flex items-center justify-center overflow-hidden flex-shrink-0">
                                <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(arrival.guest_name)}&background=8C5D35&color=F3E6D0`} alt={arrival.guest_name} />
                            </div>
                            <div className="leading-snug">
                                <div className="font-bold text-[15px]">{arrival.guest_name}</div>
                                <div className="text-xs text-gray-500 font-medium">{arrival.room_numbers || "Unassigned"} — {arrival.booking_code}</div>
                            </div>
                        </div>

                        <div className="px-5 py-6 space-y-5 bg-white">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-500">Outstanding Balance:</span>
                                <span className="text-2xl font-bold text-[#E65F5C]">₹ {outstandingBalance.toLocaleString('en-IN')}</span>
                            </div>

                            {/* Payment Method Selector Dropdown Mock */}
                            <div>
                                <div className="text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-wide">Payment Method</div>
                                <div className="relative">
                                    <button
                                        onClick={() => setIsPaymentMethodOpen(!isPaymentMethodOpen)}
                                        className="w-full flex items-center justify-between px-4 py-3 bg-[#F9F9F9] border border-gray-200 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-amber-600/20 group"
                                    >
                                        <div className="flex items-center gap-3 font-semibold text-gray-900 text-[15px]">
                                            <span className="text-emerald-600">💵</span> {paymentMethod === "CASH" ? "Cash" : paymentMethod === "CARD" ? "Card (Manual)" : paymentMethod === "UPI" ? "UPI" : "Bank Transfer"}
                                        </div>
                                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isPaymentMethodOpen ? "rotate-180" : ""}`} />
                                    </button>

                                    {/* Dropdown Options */}
                                    {isPaymentMethodOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 shadow-lg rounded-xl overflow-hidden z-10 flex flex-col p-1 animate-in fade-in slide-in-from-top-1">
                                            {[
                                                { id: "CASH", label: "Cash", icon: "💵", color: "text-emerald-600" },
                                                { id: "CARD", label: "Card (Manual)", icon: "💳", color: "text-blue-600" },
                                                { id: "BANK_TRANSFER", label: "Bank Transfer", icon: "🏦", color: "text-amber-700" },
                                                { id: "UPI", label: "UPI", icon: "📱", color: "text-indigo-600" }
                                            ].map(pm => (
                                                <button
                                                    key={pm.id}
                                                    onClick={() => { setPaymentMethod(pm.id); setIsPaymentMethodOpen(false); }}
                                                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 text-left transition"
                                                >
                                                    <div className="flex items-center gap-3 text-sm font-semibold text-gray-800">
                                                        <span className={pm.color}>{pm.icon}</span> {pm.label}
                                                    </div>
                                                    {paymentMethod === pm.id && <CheckCircle2 className="w-4 h-4 text-gray-400" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="relative">
                                    <span className="absolute left-4 py-3 text-gray-400 font-bold">₹</span>
                                    <input
                                        type="number"
                                        placeholder="Enter Amount"
                                        value={paymentAmount}
                                        onChange={e => setPaymentAmount(e.target.value ? Number(e.target.value) : "")}
                                        className="w-full pl-9 pr-4 py-3 bg-[#F9F9F9] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600/30 font-semibold text-[15px] placeholder-gray-400"
                                    />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Enter a note (optional)"
                                    className="w-full px-4 py-3 bg-[#F9F9F9] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600/30 text-sm placeholder-gray-400"
                                />
                            </div>

                            <button
                                onClick={handleRecordPayment}
                                disabled={paymentLoading || !paymentAmount}
                                className="w-full py-3.5 mt-2 bg-gradient-to-br from-[#CD955B] to-[#AD763D] text-white font-bold text-[15px] rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {paymentLoading ? "Processing..." : "Record Payment"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Refund modal — only mounted when refundFor is set */}
            {refundFor && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#1a1a1a] p-6 shadow-2xl">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-start gap-3">
                                <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center">
                                    <RotateCcw className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-[#F3E6D0]">Refund payment</h3>
                                    <p className="text-xs text-[#F3E6D0]/60 mt-0.5">
                                        Refund via Razorpay (Linked Account is debited)
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={closeRefundModal}
                                className="p-1.5 text-[#F3E6D0]/40 hover:text-[#F3E6D0] rounded-md transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="text-xs text-[#F3E6D0]/60 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                                Original payment: <span className="font-mono text-[#F3E6D0]">₹{refundFor.amount.toLocaleString("en-IN")}</span>
                                {" · "}
                                <span className="capitalize">{refundFor.method.toLowerCase()}</span>
                                {refundFor.razorpay_payment_id && (
                                    <>
                                        {" · "}
                                        <span className="font-mono text-[10px] text-[#F3E6D0]/50">{refundFor.razorpay_payment_id}</span>
                                    </>
                                )}
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#F3E6D0]/70 mb-1.5">
                                    Amount to refund (₹)
                                </label>
                                <input
                                    type="number"
                                    min={0.01}
                                    step={0.01}
                                    max={refundFor.amount}
                                    value={refundAmount}
                                    onChange={(e) => setRefundAmount(e.target.value === "" ? "" : Number(e.target.value))}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-[#F3E6D0] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                />
                                <p className="text-[11px] text-[#F3E6D0]/40 mt-1">
                                    Defaults to full amount. Partial refunds allowed.
                                </p>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#F3E6D0]/70 mb-1.5">
                                    Reason <span className="text-[#F3E6D0]/30 font-normal normal-case">(staff note, optional)</span>
                                </label>
                                <textarea
                                    value={refundReason}
                                    onChange={(e) => setRefundReason(e.target.value)}
                                    placeholder="Guest disputed extra night charge…"
                                    rows={2}
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#F3E6D0] placeholder-[#F3E6D0]/30 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-none"
                                />
                            </div>

                            {refundError && (
                                <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    <span>{refundError}</span>
                                </div>
                            )}

                            <div className="text-[11px] text-[#F3E6D0]/40 leading-relaxed border-t border-white/5 pt-3">
                                Refunds are processed with <code className="bg-white/5 px-1 rounded">reverse_all: 1</code> so funds come back from this hotel's Razorpay Linked Account. Razorpay typically settles refunds within 5–7 business days.
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={closeRefundModal}
                                    disabled={refundBusy}
                                    className="flex-1 py-2.5 rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-[#F3E6D0]/70 hover:bg-white/10 disabled:opacity-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={submitRefund}
                                    disabled={refundBusy || refundAmount === "" || Number(refundAmount) <= 0}
                                    className="flex-1 py-2.5 rounded-lg bg-amber-600 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                                >
                                    {refundBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                    {refundBusy ? "Processing…" : "Refund"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
