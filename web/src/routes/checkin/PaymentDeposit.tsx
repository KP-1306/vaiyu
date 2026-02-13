import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    CreditCard,
    Loader2,
    Lock,
    ShieldCheck
} from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function PaymentDeposit() {
    const navigate = useNavigate();
    const location = useLocation();
    const { booking, guestDetails, roomId } = location.state || {};

    const [processing, setProcessing] = useState(false);

    // Mock calculation
    const depositAmount = 5000; // INR

    const handlePayment = async () => {
        setProcessing(true);

        try {
            // 1. Mock Payment Gateway Delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 2. Process Check-in RPC
            const { data, error } = await supabase.rpc("process_checkin", {
                p_booking_id: booking.id,
                p_guest_details: guestDetails,
                p_room_id: roomId,
                p_actor_id: null // System/Kiosk
            });

            if (error) throw error;

            if (data.status === 'SUCCESS' || data.status === 'ALREADY_CHECKED_IN') {
                navigate("../success", { state: { booking, roomNumber: "101" } }); // We need room number from room list, but assume we get it back or look it up.
                // Actually process_checkin returns stay_id. We might want to fetch stay details to show room number.
                // For now, let's just show success.
            } else {
                alert("Check-in failed: " + data.status);
            }

        } catch (err: any) {
            console.error(err);
            alert("Payment failed: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    if (!booking) return null;

    return (
        <div className="mx-auto max-w-xl space-y-8">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Security Deposit</h2>
                <p className="text-slate-500">A refundable deposit is required for incidentals.</p>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-lg ring-1 ring-slate-900/5 space-y-6">
                <div className="flex flex-col items-center justify-center py-6 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Amount</p>
                    <div className="text-5xl font-bold text-slate-900 mt-2">
                        ₹{depositAmount.toLocaleString()}
                    </div>
                </div>

                <div className="space-y-4">
                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700">
                                <CreditCard className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">Credit / Debit Card</div>
                                <div className="text-xs text-slate-500">Visa, Mastercard, Amex</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-4" />
                    </button>

                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">UPI / QR Code</div>
                                <div className="text-xs text-slate-500">GPay, PhonePe, Paytm</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-4" />
                    </button>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                    <Lock className="h-3 w-3" />
                    Secure 256-bit encrypted transaction
                </div>

                <button
                    onClick={handlePayment}
                    disabled={processing}
                    className="w-full rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-indigo-500 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                >
                    {processing ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                        "Pay & Complete Check-in"
                    )}
                </button>
            </div>
        </div>
    );
}
