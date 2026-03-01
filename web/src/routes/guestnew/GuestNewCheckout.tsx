// GuestNewCheckout.tsx — Premium Checkout Experience (Grand Hotel Style)
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import {
    Check, CreditCard, ChevronRight, Calendar, Users,
    Luggage, Clock, Car, SprayCan, HelpCircle
} from "lucide-react";

type Stay = {
    id: string; // stay_id
    hotel_id: string;
    booking_id: string;
    hotel: {
        name: string;
        city?: string;
    };
    check_in: string;
    check_out: string;
    bill_total?: number | null;
    room_charge?: number;
    city_tax?: number;
    room_number?: string;
    guests?: number;
    booking_code?: string;
    status?: string;
};

export default function GuestNewCheckout() {
    const navigate = useNavigate();
    const [stay, setStay] = useState<Stay | null>(null);
    const [guestName, setGuestName] = useState("Guest");
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);

    // Fetch stay & user profile
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                // Get user
                const { data: session } = await supabase.auth.getSession();
                if (session.session?.user) {
                    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.session.user.id).single();
                    if (profile?.full_name) setGuestName(profile.full_name);
                    else if (session.session.user.email) setGuestName(session.session.user.email.split('@')[0]);
                }

                // Match GuestNewHome.tsx logic: Fetch recent stays and find the ACTIVE one
                const { data: stays } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false })
                    .limit(20);

                if (mounted && stays && stays.length > 0) {
                    // Find current/active stay (same logic as GuestNewHome.tsx)
                    const now = new Date();

                    let active = stays.find((s: any) =>
                        ["inhouse", "checked_in", "partially_arrived", "checkout_requested"].includes(s.status?.toLowerCase() || "")
                    );

                    if (!active) {
                        active = stays.find((s: any) => {
                            const checkout = new Date(s.check_out);
                            const isPast = ["checked_out", "cancelled"].includes(s.status?.toLowerCase() || "");
                            return !isPast && (
                                ["arriving", "expected", "confirmed"].includes(s.status?.toLowerCase() || "") ||
                                checkout >= now
                            );
                        });
                    }

                    active = active || stays[0]; // Fallback to most recent if no active found

                    // Fetch the booking_id directly from the stays table since it's not in the view
                    const { data: stayRow } = await supabase
                        .from('stays')
                        .select('booking_id, status')
                        .eq('id', active.id)
                        .single();

                    setStay({
                        id: active.id,
                        hotel_id: active.hotel_id,
                        booking_id: stayRow?.booking_id || "",
                        hotel: {
                            name: active.hotel_name || active.hotel?.name || "Grand Hotel & Spa",
                            city: active.hotel_city
                        },
                        check_in: active.check_in,
                        check_out: active.check_out,
                        bill_total: active.bill_total,
                        room_charge: active.bill_total || 0,
                        city_tax: active.city_tax || 0,
                        room_number: active.room_number || "402",
                        guests: active.guests || 2,
                        booking_code: active.booking_code,
                        status: stayRow?.status
                    });

                    if (stayRow?.status === 'checkout_requested') {
                        setCompleted(true);
                    }
                }
            } catch (err) {
                console.error("[GuestNewCheckout] Error:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    // Fetch Ledger Metrics & Payment Breakdown
    const [priorPayments, setPriorPayments] = useState(0);
    const [foodTotal, setFoodTotal] = useState(0);
    const [paymentBreakdown, setPaymentBreakdown] = useState<{ method: string; amount: number }[]>([]);

    useEffect(() => {
        if (!stay?.booking_id) return;
        (async () => {
            // 1. Fetch consolidated ledger totals
            const { data } = await supabase
                .from("v_arrival_payment_state")
                .select("paid_amount, total_amount")
                .eq("booking_id", stay.booking_id)
                .single();
            if (data) {
                setPriorPayments(data.paid_amount || 0);
                // Currently all charges hit the "foodTotal" bucket in the UI for simplicity
                setFoodTotal(data.total_amount || 0);
            }

            // Fetch payment breakdown
            const { data: paymentsData } = await supabase
                .from("payments")
                .select("amount, method, status")
                .eq("booking_id", stay.booking_id)
                .eq("status", "COMPLETED");

            if (paymentsData) {
                const breakdown = paymentsData.reduce((acc, curr) => {
                    const method = curr.method || 'OTHER';
                    acc[method] = (acc[method] || 0) + Number(curr.amount);
                    return acc;
                }, {} as Record<string, number>);

                setPaymentBreakdown(Object.entries(breakdown).map(([method, amount]) => ({ method, amount })));
            }
        })();
    }, [stay?.booking_id]);

    // Format currency
    const formatCurrency = (amount: number | null | undefined) => {
        if (amount === 0) return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
        }).format(0);

        if (!amount) return "—";

        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
        }).format(amount);
    };

    // Format dates range
    const dateRange = useMemo(() => {
        if (!stay) return "";
        const start = new Date(stay.check_in);
        const end = new Date(stay.check_out);
        const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
        return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
    }, [stay]);

    const handleCheckout = async () => {
        if (!stay) return;
        setProcessing(true);
        setError(null);

        try {
            const { data, error: rpcError } = await supabase.rpc('request_checkout', {
                p_booking_id: stay.booking_id
            });

            if (rpcError) throw rpcError;

            if (data?.success) {
                setCompleted(true);
                // Redirect to the review screen after 4 seconds
                setTimeout(() => navigate(`/guest/review/${stay.booking_code}`), 4000);
            } else {
                setError(data?.error || "Checkout failed. Please contact the front desk.");
                console.error("[Checkout] Response Error:", data);
            }
        } catch (err: any) {
            console.error("[Checkout] RPC Error:", err);
            setError(err.message || "An unexpected error occurred during checkout.");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="gn-loading">Loading...</div>;

    if (completed) {
        return (
            <div className="gn-checkout-page flex items-center justify-center">
                <div className="gn-glass-card p-12 text-center max-w-md">
                    <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-400 text-4xl">⏳</div>
                    <h2 className="gn-serif text-3xl text-white mb-2">Checkout Requested</h2>
                    <p className="text-white/60 mb-8">The front desk has been notified. Thank you for staying with us.</p>
                    <button onClick={() => navigate("/guest")} className="gn-btn-gold w-full py-4">Return Home</button>
                </div>
            </div>
        );
    }

    if (!stay) return null;

    // Calculations
    const roomCharges = stay.room_charge || 0;
    const taxes = stay.city_tax || 0;
    const roomService = foodTotal;
    const lateCheckout = 0; // Keeping as 0 for now as requested

    // Total calculation
    const total = roomCharges + taxes + roomService + lateCheckout;
    const balanceDue = Math.max(0, total - priorPayments);

    return (
        <div className="gn-checkout-page">
            <div className="gn-checkout-bg"></div>
            <div className="gn-checkout-overlay"></div>

            <div className="gn-checkout-wrapper">
                {/* Header */}
                <header className="flex justify-between items-center mb-8">
                    <div className="gn-serif text-2xl font-bold text-white tracking-wide">Vaiyu</div>
                    <div className="flex items-center gap-4">
                        <Link to="/guest" className="text-white/60 hover:text-white text-sm transition-colors">Home</Link>
                    </div>
                </header>

                {/* Hero */}
                <div className="mb-10">
                    <h1 className="gn-serif text-5xl text-white mb-2 tracking-tight">Checkout, {guestName.split(' ')[0]}.</h1>
                    <div className="text-[#C5A065] text-sm font-bold tracking-[0.15em] uppercase mb-6">{stay.hotel.name}</div>

                    <div className="flex gap-4">
                        <div className="gn-glass-pill px-6 py-2 text-white/90">
                            Room {stay.room_number || "402"}
                        </div>
                        <div className="gn-glass-pill px-6 py-2 text-white/90 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#C5A065]" />
                            {dateRange} ~ 11:00 AM
                        </div>
                    </div>
                </div>

                {/* Main Content Card - The big glass container */}
                <div className="gn-main-card grid grid-cols-12 gap-0 overflow-hidden rounded-3xl">

                    {/* Left Column: Overview (60%) */}
                    <div className="col-span-12 lg:col-span-7 p-10 border-r border-white/10 relative">
                        <div className="gn-serif text-3xl text-white mb-2">Checkout Overview</div>
                        <p className="text-white/50 text-sm mb-8">Review your stay details and settle your bill before checking out.</p>

                        <div className="grid grid-cols-2 gap-8 mb-8">
                            {/* Check-Out Details Box */}
                            <div className="col-span-1">
                                <div className="gn-serif text-lg text-white/90 mb-3">Check-Out Details</div>
                                <div className="gn-inset-card p-4 flex justify-between items-center">
                                    <div className="flex items-center gap-3 text-sm text-white/80">
                                        <Calendar className="w-4 h-4 text-[#C5A065]" />
                                        <span>{new Date(stay.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - 11:00 AM</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 opacity-30" />
                                </div>
                                <button className="w-full mt-2 bg-[#C5A065]/20 hover:bg-[#C5A065]/30 text-[#C5A065] text-xs font-semibold py-2 rounded transition-colors">
                                    Extend Stay
                                </button>
                            </div>

                            {/* Guest Count Box (Simulated to match visual weight of mockup) */}
                            <div className="col-span-1">
                                <div className="gn-serif text-lg text-white/90 mb-3">Stay Details</div>
                                <div className="gn-inset-card p-4 flex justify-between items-center h-[54px] cursor-pointer hover:bg-white/5 transition-colors">
                                    <div className="flex items-center gap-3 text-sm text-white/80">
                                        <Users className="w-4 h-4 size-4" />
                                        <span>{stay.guests} Adults</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 opacity-30" />
                                </div>
                            </div>
                        </div>

                        {/* Bill Breakdown List - Moved to Left Column as per mockup analysis */}
                        <div className="mb-8">
                            <div className="gn-serif text-lg text-white/90 mb-3">Bill Breakdown</div>
                            <div className="gn-inset-card p-6 space-y-3">
                                <div className="flex justify-between text-sm text-white/70">
                                    <span>Room Charges</span>
                                    <span className="text-white">{formatCurrency(roomCharges)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-white/70">
                                    <span>Food & Dining</span>
                                    <span className="text-white">{formatCurrency(roomService)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-white/70">
                                    <span>Late Checkout Fee <span className="text-xs opacity-50">(optional)</span></span>
                                    <span className="text-white">{formatCurrency(lateCheckout)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-white/70 pt-2 border-t border-white/5 mt-2">
                                    <span>Taxes & Fees</span>
                                    <span className="text-white">{formatCurrency(taxes)}</span>
                                </div>
                                <div className="flex justify-between items-end pt-3 mt-1 border-t border-white/10">
                                    <span className="text-white/60 text-lg gn-serif">Total</span>
                                    <span className="text-2xl text-[#C5A065] font-bold gn-serif">{formatCurrency(total)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Additional Services Grid */}
                        <div>
                            <div className="gn-serif text-lg text-white/90 mb-3">Additional Services</div>
                            <div className="grid grid-cols-4 gap-3">
                                {[
                                    { icon: Luggage, label: "Baggage\nAssistance" },
                                    { icon: Clock, label: "Late\nCheckout" },
                                    { icon: Car, label: "Airport\nTransfer" },
                                    { icon: SprayCan, label: "Housekeeping\nService" },
                                ].map((svc, i) => (
                                    <button key={i} className="gn-inset-card p-3 flex flex-col items-center justify-center text-center gap-2 hover:bg-[#C5A065]/10 hover:border-[#C5A065]/30 transition-all group">
                                        <svc.icon className="w-5 h-5 text-[#C5A065] group-hover:scale-110 transition-transform" />
                                        <span className="text-[0.65rem] leading-tight text-white/60 uppercase tracking-wide font-medium whitespace-pre-line">{svc.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Payment & Balance (40%) */}
                    <div className="col-span-12 lg:col-span-5 p-10 bg-white/[0.02] flex flex-col justify-between relative">

                        <div>
                            <div className="gn-serif text-3xl text-white mb-8">Payment & Balance</div>

                            <div className="space-y-4 mb-8">
                                <div className="flex justify-between text-white/60 text-sm">
                                    <span>Prior Payments</span>
                                    <span className="text-white font-medium">{formatCurrency(priorPayments)}</span>
                                </div>
                                {paymentBreakdown.length > 0 && (
                                    <div className="space-y-3 pt-1">
                                        {paymentBreakdown.map((b) => (
                                            <div key={b.method} className="flex justify-between text-white/40 text-sm pl-4 relative before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-2 before:h-[1px] before:bg-white/20">
                                                <div className="flex items-center gap-2">
                                                    {b.method === 'CARD' && <CreditCard className="w-4 h-4" />}
                                                    <span className="capitalize">{b.method.toLowerCase().replace('_', ' ')}</span>
                                                </div>
                                                <span className="text-white/60">{formatCurrency(b.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-white/10 py-6 mb-6">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-lg text-white/80 gn-serif">Balance Due</span>
                                    <span className="text-3xl text-[#C5A065] font-bold gn-serif tracking-tight">{formatCurrency(balanceDue)}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-2">
                                        <p className="text-red-400 text-sm font-medium">{error}</p>
                                        {error === 'Pending balance exists' && (
                                            <p className="text-red-400/70 text-xs mt-1">Please settle your remaining balance before checking out.</p>
                                        )}
                                    </div>
                                )}

                                <div className="relative group">
                                    <button
                                        type="button"
                                        className="w-full bg-white/5 border border-white/10 py-4 px-6 rounded-lg flex items-center justify-between transition-all group hover:bg-white/10 text-white cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <CreditCard className="w-5 h-5 text-[#C5A065]" />
                                            <span className="font-medium">Settle Balance</span>
                                        </div>
                                        <ChevronRight className="w-5 h-5 opacity-50 group-hover:translate-x-1 transition-transform" />
                                    </button>

                                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 w-64 bg-black/90 p-3 rounded-lg text-xs leading-relaxed text-center text-white/90 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
                                        Online payments are not available yet. Please contact the front desk to settle your balance.
                                        {/* Little triangle arrow pointing down */}
                                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-black/90 border-r border-b border-white/10 rotate-45 -mt-1"></div>
                                    </div>
                                </div>

                                <div className="text-center mt-3">
                                    <button
                                        onClick={() => {
                                            if (balanceDue > 0) {
                                                setShowPaymentModal(true);
                                            } else {
                                                handleCheckout();
                                            }
                                        }}
                                        disabled={processing || balanceDue > 0}
                                        className={`w-full py-4 px-6 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${balanceDue > 0
                                            ? 'bg-[#2A241F] text-white/40 cursor-not-allowed border border-white/5'
                                            : 'bg-gradient-to-r from-[#8E713C] to-[#C5A065] text-white shadow-lg shadow-[#C5A065]/20 hover:brightness-110 active:scale-[0.98]'
                                            }`}
                                    >
                                        {processing ? "Processing..." : (
                                            <>
                                                <Check className="w-5 h-5" />
                                                <span>Request Checkout</span>
                                            </>
                                        )}
                                    </button>

                                    {balanceDue > 0 && (
                                        <p className="text-sm mt-4 flex items-center justify-center gap-2 animate-in fade-in duration-300" style={{ color: '#A68A64' }}>
                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#A68A64', opacity: 0.8 }}></span>
                                            Please settle your balance to enable checkout
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-end gap-2 text-xs text-white/40">
                            <span>Need any assistance? Call Front Desk at <span className="text-white/60 hover:text-white cursor-pointer">+91 01234 56789</span></span>
                            <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/5 cursor-pointer">
                                <HelpCircle className="w-3 h-3" />
                            </div>
                        </div>

                    </div>
                </div>

            </div>

            {/* Styles */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap');
                
                .gn-checkout-page {
                    min-height: 100vh;
                    font-family: 'Inter', sans-serif;
                    color: #fff;
                    background: #1a1510; /* Warm dark brown base */
                    position: relative;
                }
                .gn-checkout-bg {
                    position: fixed; inset: 0;
                    background-image: url('https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=2000&q=80'); /* Warm luxury hotel lobby */
                    background-size: cover; background-position: center;
                    z-index: 0;
                }
                .gn-checkout-overlay {
                    position: fixed; inset: 0;
                    background: radial-gradient(circle at center, rgba(30,20,10,0.85) 0%, rgba(10,5,0,0.95) 100%);
                    z-index: 1;
                }
                .gn-checkout-wrapper {
                    position: relative; z-index: 2;
                    max-width: 1100px; margin: 0 auto;
                    padding: 3rem 2rem;
                }
                
                .gn-serif { font-family: 'Playfair Display', serif; }
                
                .gn-user-pill {
                    display: flex; items-center; gap: 0.75rem;
                    background: rgba(255,255,255,0.08);
                    padding: 0.4rem 0.5rem 0.4rem 1rem;
                    border-radius: 50px;
                    border: 1px solid rgba(255,255,255,0.1);
                    cursor: pointer; transition: background 0.2s;
                }
                .gn-user-pill:hover { background: rgba(255,255,255,0.12); }

                .gn-glass-pill {
                    border: 1px solid rgba(255,255,255,0.15);
                    background: rgba(40,30,20, 0.6);
                    backdrop-filter: blur(4px);
                    border-radius: 8px;
                    font-size: 0.9rem;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.2);
                }

                .gn-main-card {
                    background: rgba(28, 24, 20, 0.65); /* Warm dark tint */
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255,255,255,0.08);
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                }

                .gn-inset-card {
                    background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.05);
                    border-radius: 12px;
                    box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
                }

                .gn-loading {
                    height: 100vh; display: flex; align-items: center; justify-content: center;
                    background: #111; color: #C5A065; font-family: 'Playfair Display', serif;
                }

                .gn-glass-card {
                    background: rgba(30,30,30,0.8);
                    backdrop-filter: blur(16px);
                    border-radius: 24px;
                    border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
                }

                .gn-btn-gold {
                    background: linear-gradient(135deg, #a67c00 0%, #d4af37 100%);
                    color: white; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
                    border-radius: 8px;
                    transition: all 0.2s;
                }
                .gn-btn-gold:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(212,175,55,0.3); }

            `}</style>
        </div>
    );
}
