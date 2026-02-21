import React, { useState, useEffect } from "react";
import { X, ChevronDown, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";

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

export default function FolioDrawer({ isOpen, onClose, arrival }: FolioDrawerProps) {
    const [activeTab, setActiveTab] = useState<"SUMMARY" | "FOLIO" | "PAYMENTS" | "ACTIVITY">("FOLIO");
    const [entries, setEntries] = useState<FolioEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [showCollectPayment, setShowCollectPayment] = useState(false);

    // Payment Form State
    const [paymentMethod, setPaymentMethod] = useState("CASH");
    const [paymentAmount, setPaymentAmount] = useState<number | "">("");
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [isPaymentMethodOpen, setIsPaymentMethodOpen] = useState(false);

    useEffect(() => {
        if (!isOpen || !arrival?.booking_id) return;
        fetchFolio();
    }, [isOpen, arrival?.booking_id]);

    const fetchFolio = async () => {
        setLoading(true);
        const { data } = await supabase
            .from("folio_entries")
            .select("*")
            .eq("booking_id", arrival.booking_id)
            .order("created_at", { ascending: true });

        if (data) setEntries(data);

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
            p_method: paymentMethod,
            p_user: user?.id
        });

        if (!error) {
            setShowCollectPayment(false);
            setPaymentAmount("");
            fetchFolio(); // Refresh entries
        } else {
            alert("Payment failed: " + error.message);
        }
        setPaymentLoading(false);
    };

    if (!isOpen || !arrival) return null;

    // Derived Financials from Entries
    // For simplicity, let's just group by type
    const roomCharges = entries.filter(e => e.entry_type === "ROOM_CHARGE").reduce((acc, e) => acc + Number(e.amount), 0);
    const foodCharges = entries.filter(e => e.entry_type === "FOOD_CHARGE").reduce((acc, e) => acc + Number(e.amount), 0);
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
                                        {foodCharges > 0 && (
                                            <div className="flex justify-between items-center text-[#F3E6D0]/90">
                                                <span>Food / F&B</span>
                                                <span>₹ {foodCharges.toLocaleString('en-IN')}</span>
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
        </div>
    );
}
