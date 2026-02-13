import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    Camera,
    CreditCard,
    Loader2,
    Lock,
    ShieldCheck,
    Receipt,
    Upload
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function WalkInPayment() {
    const navigate = useNavigate();
    const location = useLocation();

    // Receive Full Context from Availability Step
    const {
        guestDetails,
        stayDetails,
        selectedRoomId,
        pricing,
        roomNumber,
        roomType,
        hotelId
    } = location.state || {};

    const [processing, setProcessing] = useState(false);
    const [idType, setIdType] = useState("aadhar");
    const [idNumber, setIdNumber] = useState("");

    // Redirect if missing critical data
    useEffect(() => {
        if (!guestDetails || !stayDetails || !pricing) {
            navigate("../walkin");
        }
    }, [guestDetails, stayDetails, pricing, navigate]);

    const handlePayment = async () => {
        setProcessing(true);

        try {
            // 1. Mock Payment Gateway Delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (!hotelId) throw new Error("Hotel ID missing");

            // 2. Create Walk-In Booking & Stay via RPC
            // Using the NEW signature with date/pax details
            const { data, error } = await supabase.rpc("create_walkin", {
                p_hotel_id: hotelId,
                p_guest_details: guestDetails,
                p_room_id: selectedRoomId,
                p_checkin_date: stayDetails.checkin_date,
                p_checkout_date: stayDetails.checkout_date,
                p_adults: stayDetails.adults,
                p_children: stayDetails.children,
                p_actor_id: null // Kiosk
            });

            if (error) throw error;

            console.log("Walk-in successful:", data);

            // 3. Navigate to Success
            navigate("../success", {
                state: {
                    roomNumber: roomNumber || "Assigned",
                    bookingCode: data.booking_code
                }
            });

        } catch (err: any) {
            console.error(err);
            alert("Payment/Check-in failed: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    if (!guestDetails || !pricing) return null;

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];

    return (
        <div className="mx-auto max-w-xl space-y-6 pb-20">
            {/* ── Stepper ── */}
            <CheckInStepper steps={WALKIN_STEPS} currentStep={2} />

            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Payment & Confirm</h2>
                <p className="text-slate-500">Secure your stay at Room {roomNumber}</p>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5 space-y-8">

                {/* Bill Summary */}
                <div className="flex flex-col items-center justify-center py-6 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Payable</p>
                    <div className="text-5xl font-bold text-slate-900 mt-2 tracking-tight">
                        ₹{pricing.totalPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full">
                        <span>{stayDetails.nights} Night(s)</span>
                        <span>•</span>
                        <span>{roomType}</span>
                    </div>
                </div>

                {/* Breakdown Toggle (Simulated) */}
                <div className="space-y-3 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl">
                    <div className="flex justify-between">
                        <span>Room Charges</span>
                        <span>₹{pricing.roomTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Taxes & Fees (12%)</span>
                        <span>₹{pricing.taxes.toLocaleString()}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex justify-between font-medium text-slate-900">
                        <span>Grand Total</span>
                        <span>₹{pricing.totalPayable.toLocaleString()}</span>
                    </div>
                </div>

                {/* ── Identity Proof ── */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                    <h4 className="text-base font-semibold text-slate-900">Identity Proof</h4>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">ID Type <span className="text-red-500">*</span></label>
                        <select
                            required
                            className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                            value={idType}
                            onChange={e => setIdType(e.target.value)}
                        >
                            <option value="aadhar">Aadhaar Card</option>
                            <option value="passport">Passport</option>
                            <option value="driving_license">Driving License</option>
                            <option value="voter_id">Voter ID</option>
                            <option value="other">Other</option>
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">ID Number <span className="text-red-500">*</span></label>
                        <input
                            required
                            className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                            value={idNumber}
                            onChange={e => setIdNumber(e.target.value)}
                            placeholder={idType === 'aadhar' ? 'XXXX-XXXX-XXXX' : idType === 'passport' ? 'A1234567' : 'Enter ID number'}
                        />
                    </div>

                    <div
                        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
                    >
                        <div className="rounded-full bg-white p-3 shadow-sm">
                            <Camera className="h-7 w-7 text-slate-400" />
                        </div>
                        <span className="text-sm font-medium text-slate-600">
                            Capture Front Side <span className="text-red-500">*</span>
                        </span>
                    </div>

                    <div
                        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
                    >
                        <div className="rounded-full bg-white p-3 shadow-sm">
                            <Upload className="h-7 w-7 text-slate-400" />
                        </div>
                        <span className="text-sm font-medium text-slate-500">
                            Upload Back Side <span className="text-slate-400 font-normal">(Optional)</span>
                        </span>
                    </div>
                </div>

                {/* Payment Methods */}
                <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-700">Select Payment Method</p>

                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2.5 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700 transition-colors">
                                <CreditCard className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">Credit / Debit Card</div>
                                <div className="text-xs text-slate-500">Visa, Mastercard, Amex</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-[5px] transition-all" />
                    </button>

                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700 transition-colors">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">UPI / QR Code</div>
                                <div className="text-xs text-slate-500">GPay, PhonePe, Paytm</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-[5px] transition-all" />
                    </button>
                </div>

                {/* Security Badge */}
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-2">
                    <Lock className="h-3 w-3" />
                    Secure 256-bit encrypted transaction
                </div>

                {/* Confirm Button */}
                <button
                    onClick={handlePayment}
                    disabled={processing}
                    className="w-full rounded-2xl bg-indigo-600 px-8 py-5 text-xl font-bold text-white shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-3"
                >
                    {processing ? (
                        <>
                            <Loader2 className="h-6 w-6 animate-spin" />
                            Processing...
                        </>
                    ) : (
                        <>
                            Pay ₹{pricing.totalPayable.toLocaleString()}
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
