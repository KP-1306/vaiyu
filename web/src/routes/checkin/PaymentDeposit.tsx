import React, { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    CreditCard,
    Loader2,
    Lock,
    ShieldCheck,
    ArrowRight,
    Receipt
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function PaymentDeposit() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const slug = searchParams.get('slug');
    const { booking, guestDetails, roomId } = location.state || {};

    const [processing, setProcessing] = useState(false);

    // Mock calculation
    const depositAmount = 5000; // INR

    const handlePayment = async () => {
        setProcessing(true);

        try {
            // 1. Mock Payment Gateway Delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            const mappedGuestDetails = {
                ...guestDetails,
                id_type: (guestDetails?.id_type === 'aadhaar' || guestDetails?.id_type === 'passport' || guestDetails?.id_type === 'driving_license' || guestDetails?.id_type === 'other') 
                    ? guestDetails.id_type 
                    : (guestDetails?.id_type === 'aadhar' ? 'aadhaar' : 'other'),
            };

            // 2. Process Check-in RPC
            const { data, error } = await supabase.rpc("process_checkin", {
                p_booking_id: booking.id,
                p_guest_details: mappedGuestDetails,
                p_room_id: roomId,
                p_actor_id: null // System/Kiosk
            });

            if (error) throw error;

            if (data.status === 'SUCCESS' || data.status === 'ALREADY_CHECKED_IN') {
                navigate({ pathname: "../success", search: slug ? `?slug=${slug}` : "" }, { state: { booking, roomNumber: "101", hotelId: booking.hotel_id } });
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

    const PRECHECKIN_STEPS = ["Booking Details", "Guest Identity", "Security Deposit"];

    return (
        <div className="mx-auto max-w-2xl px-4 space-y-12">
            <div className="mb-8">
                <CheckInStepper steps={PRECHECKIN_STEPS} currentStep={2} />
            </div>

            <div className="gn-card premium-glass p-8 md:p-12 space-y-10 relative overflow-hidden group">
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-gold-400/5 blur-[100px] -mr-32 -mt-32" />

                <div className="space-y-6 text-center">
                    <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-gold-400/5 border border-gold-400/20 text-gold-400 text-[10px] font-black uppercase tracking-[0.4em]">
                        Authorization Required
                    </div>
                    <h2 className="text-4xl font-light text-white tracking-tight">Security <span className="text-gold-400 font-medium italic">Hold</span></h2>
                    <p className="text-gold-100/40 text-lg font-light leading-relaxed max-w-md mx-auto">
                        A refundable security deposit is required for incidentals during your residency.
                    </p>
                </div>

                <div className="flex flex-col items-center justify-center py-12 border-y border-white/5 bg-white/[0.01] rounded-3xl">
                    <p className="text-[10px] font-black text-gold-400/40 uppercase tracking-[0.3em] mb-4">Total Amount to Authorize</p>
                    <div className="text-6xl font-light text-white tracking-tighter flex items-start gap-1">
                        <span className="text-2xl text-gold-400/40 mt-2">₹</span>
                        {depositAmount.toLocaleString()}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-4 px-2 mb-2">
                        <Receipt className="h-4 w-4 text-gold-400/40" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Settlement Method</span>
                    </div>
                    
                    <button className="w-full group/btn relative flex items-center justify-between p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30 transition-all duration-500 text-left">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10 transition-all duration-500">
                                <CreditCard className="h-7 w-7" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-lg font-medium text-white tracking-tight">Digitized Card</div>
                                <div className="text-[9px] font-bold uppercase tracking-widest text-gold-400/30">Visa / Mastercard / Amex</div>
                            </div>
                        </div>
                        <div className="w-5 h-5 rounded-full border-2 border-white/10 group-hover/btn:border-gold-400 transition-all" />
                    </button>

                    <button className="w-full group/btn relative flex items-center justify-between p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30 transition-all duration-500 text-left">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10 transition-all duration-500">
                                <ShieldCheck className="h-7 w-7" />
                            </div>
                            <div className="space-y-1">
                                <div className="text-lg font-medium text-white tracking-tight">Digital Mesh</div>
                                <div className="text-[9px] font-bold uppercase tracking-widest text-gold-400/30">UPI / QR Transfer</div>
                            </div>
                        </div>
                        <div className="w-5 h-5 rounded-full border-2 border-white/10 group-hover/btn:border-gold-400 transition-all" />
                    </button>
                </div>

                <div className="space-y-6 pt-6">
                    <button
                        onClick={handlePayment}
                        disabled={processing}
                        className="w-full py-6 text-2xl font-light tracking-tight text-black bg-gold-400 rounded-2xl hover:bg-gold-300 transition-all duration-500 group relative overflow-hidden shadow-[0_20px_40px_-10px_rgba(212,175,55,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        {processing ? (
                            <div className="flex items-center justify-center gap-4">
                                <Loader2 className="h-6 w-6 animate-spin" />
                                <span className="uppercase tracking-[0.2em] text-[10px] font-black">Authorizing...</span>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center gap-4">
                                <span className="uppercase tracking-[0.15em] text-[11px] font-black">Authorize ₹{depositAmount.toLocaleString()}</span>
                                <ArrowRight className="h-6 w-6 group-hover:translate-x-2 transition-transform" />
                            </div>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="w-full py-4 text-xs font-bold tracking-[0.3em] text-white/20 hover:text-white transition-colors uppercase"
                    >
                        Cancel Authorization
                    </button>
                    
                    <div className="flex items-center justify-center gap-3 text-[9px] font-black uppercase tracking-[0.4em] text-white/10">
                        <Lock className="h-3.5 w-3.5" />
                        End-to-End Cryptographic Security
                    </div>
                </div>
            </div>
        </div>
    );
}
