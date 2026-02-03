
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
    ArrowLeft,
    CheckCircle2,
    Clock,
    ChevronRight,
    Loader2,
    XCircle,
    ShoppingBag,
    Utensils,
    MapPin,
    RefreshCcw,
    Receipt
} from "lucide-react";

type FoodOrderData = {
    id: string;
    display_id?: string; // If we have one, else UUID
    status: string;
    created_at: string;
    updated_at: string;
    total_amount: number;
    booking_code?: string;
    room?: {
        number: string;
    };
    items: {
        id: string;
        item_name: string;
        quantity: number;
        total_price: number;
    }[];
    sla?: {
        sla_target_at: string;
        sla_started_at?: string;
    };
    events?: {
        event_type: string;
        created_at: string;
    }[];
};

export default function FoodOrderTracker() {
    const { id } = useParams(); // UUID
    const [data, setData] = useState<FoodOrderData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const fetchOrder = async () => {
        if (!id) return;
        try {
            const isDisplayId = id.startsWith('ORD-') || id.startsWith('ord-');

            // 1. Fetch Order Details (No join on rooms)
            // We fetch room_id and then look it up manually to avoid "foreign key not found" error
            // if strict FKs are not enforced in the DB.
            let query = supabase
                .from('food_orders')
                .select(`
                    id,
                    display_id,
                    status,
                    created_at,
                    updated_at,
                    total_amount,
                    room_id,
                    stay_id,
                    sla:food_order_sla_state(*)
                `);

            if (isDisplayId) {
                query = query.eq('display_id', id.toUpperCase());
            } else {
                query = query.eq('id', id);
            }

            const { data: order, error: orderErr } = await query.single();

            if (orderErr) throw orderErr;
            if (!order) throw new Error("Order not found");

            // 1b. Fetch Room Number manually
            let roomData = null;
            if (order.room_id) {
                const { data: r } = await supabase
                    .from('rooms')
                    .select('number')
                    .eq('id', order.room_id)
                    .maybeSingle(); // Use maybeSingle to avoid error if room deleted
                roomData = r;
            }

            // 2. Fetch Items
            const { data: items, error: itemsErr } = await supabase
                .from('food_order_items')
                .select('*')
                .eq('food_order_id', order.id);

            if (itemsErr) throw itemsErr;

            const total = items?.reduce((acc, item) => acc + (item.total_price || 0), 0) || 0;

            // 3. Fetch Events for timeline timestamps
            const { data: events } = await supabase
                .from('food_order_events')
                .select('event_type, created_at')
                .eq('food_order_id', order.id)
                .order('created_at', { ascending: true });

            // 1c. Get booking_code - prefer sessionStorage (no DB call), fallback to DB
            let bookingCode: string | undefined = undefined;
            try {
                bookingCode = sessionStorage.getItem('vaiyu:stay_code') || undefined;
            } catch { }

            // Only fetch from DB if not in sessionStorage
            if (!bookingCode && (order as any).stay_id) {
                const { data: stay } = await supabase
                    .from('stays')
                    .select('booking_code')
                    .eq('id', (order as any).stay_id)
                    .maybeSingle();
                bookingCode = stay?.booking_code;
            }

            setData({
                ...order,
                display_id: order.display_id || order.id.slice(0, 8).toUpperCase(),
                booking_code: bookingCode,
                room: roomData ? { number: roomData.number } : undefined,
                items: items || [],
                total_amount: total,
                events: events || []
            } as any);

        } catch (err: any) {
            console.error("Error fetching food order:", err);
            setError("Could not load order details.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrder();
        const interval = setInterval(fetchOrder, 10000);
        return () => clearInterval(interval);
    }, [id]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#020202] flex items-center justify-center text-zinc-500">
                <Loader2 className="animate-spin" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-[#020202] flex flex-col items-center justify-center p-6 text-center">
                <XCircle className="w-12 h-12 text-red-500 mb-4" />
                <h2 className="text-white text-lg font-bold">Order not found</h2>
                <p className="text-zinc-500 mt-2">{error || "We couldn't locate this order."}</p>
                <Link to="/guest" className="mt-8 px-6 py-3 bg-white text-black font-bold rounded-full">
                    Back to Dashboard
                </Link>
            </div>
        );
    }

    // --- Logic for status/ETA ---
    const createdTime = new Date(data.created_at);
    const isCompleted = ['COMPLETED', 'DELIVERED', 'CLOSED', 'RESOLVED'].includes(data.status);
    const isCancelled = data.status === 'CANCELLED';

    // Estimate: If SLA exists, use target. Else default 45 mins?
    // food_order_sla_state usually has sla_target_at
    const targetTime = data.sla?.sla_target_at ? new Date(data.sla.sla_target_at) : new Date(createdTime.getTime() + 45 * 60000);

    let diffMs = targetTime.getTime() - now.getTime();
    const totalDuration = targetTime.getTime() - createdTime.getTime();
    let percentLeft = Math.max(0, (diffMs / totalDuration) * 100);

    if (isCompleted) {
        diffMs = 0;
        percentLeft = 0;
    } else if (diffMs < 0) {
        percentLeft = 100; // Breached ring full? Or empty? RequestTracker logic:
        // If breached, diffMs < 0.
    }

    const diffMins = Math.ceil(diffMs / 60000);
    const isBreached = diffMs < 0 && !isCompleted && !isCancelled;

    // Ring Style
    const circumference = 2 * Math.PI * 45;
    const strokeDashoffset = circumference - (percentLeft / 100) * circumference;

    // Render Status Steps
    // Statuses: CREATED -> ACCEPTED -> PREPARING -> READY -> DELIVERED -> COMPLETED
    // Get timestamps from events
    const getEventTime = (eventType: string) => {
        const event = data.events?.find(e => e.event_type === eventType);
        return event ? new Date(event.created_at) : null;
    };

    const acceptedTime = getEventTime('ORDER_ACCEPTED') || (data.sla?.sla_started_at ? new Date(data.sla.sla_started_at) : null);
    const preparingTime = getEventTime('ORDER_PREPARING');
    const readyTime = getEventTime('ORDER_READY');
    const deliveredTime = getEventTime('ORDER_DELIVERED');

    const isAccepted = ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status);

    const steps = [
        { label: "Order Received", time: createdTime, active: true, completed: true },
        {
            label: "Order Accepted",
            time: acceptedTime,
            active: isAccepted,
            completed: isAccepted
        },
        {
            label: "Kitchen Preparing",
            time: preparingTime,
            active: ['PREPARING', 'READY', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status),
            completed: ['READY', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status)
        },
        {
            label: "On the way",
            time: readyTime,
            active: ['READY', 'DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status),
            completed: ['DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status)
        },
        {
            label: "Delivered",
            time: deliveredTime,
            active: ['DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status),
            completed: ['DELIVERED', 'COMPLETED', 'CLOSED'].includes(data.status)
        }
    ];

    return (
        <main className="min-h-screen bg-[#0b1120] font-sans pb-24 text-slate-200 selection:bg-orange-500/30">
            {/* Background with Orange tint for food */}
            <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#0b1120] to-[#0b1120] z-0" />

            <div className="relative z-10 max-w-lg mx-auto p-4 sm:p-6">
                {/* Header */}
                <header className="flex items-center gap-4 mb-8">
                    <Link to={data.booking_code ? `/stay/${data.booking_code}/requests?tab=food` : '/'} className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 hover:bg-slate-700 transition-colors">
                        <ArrowLeft size={18} className="text-white" />
                    </Link>
                    <h1 className="text-lg font-bold text-white">Your Order</h1>
                </header>

                {/* Status Hero */}
                <div className="text-center mb-8 animate-fade-in-up">
                    <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center border-4 mb-4 shadow-2xl relative overflow-hidden ${isCompleted
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
                        : isCancelled
                            ? 'bg-red-500/10 border-red-500 text-red-500'
                            : isBreached
                                ? 'bg-amber-500/10 border-transparent text-amber-500'
                                : 'bg-orange-500/10 border-transparent text-orange-500'
                        }`}>
                        {isCompleted ? <CheckCircle2 size={32} /> :
                            isCancelled ? <XCircle size={32} /> :
                                isBreached ? (
                                    <>
                                        <div className="absolute inset-0 rounded-full border-4 border-amber-500/30" />
                                        <div className="absolute inset-0 rounded-full border-4 border-t-amber-500 animate-spin" />
                                        <span className="relative z-10 text-[10px] font-black uppercase tracking-widest">Late</span>
                                    </>
                                ) : (
                                    <>
                                        <div className="absolute inset-0 rounded-full border-4 border-orange-500/30" />
                                        <div className="absolute inset-0 rounded-full border-4 border-t-orange-500 animate-spin" />
                                        <Utensils size={24} className="relative z-10" />
                                    </>
                                )}
                    </div>

                    <h2 className="text-2xl font-bold text-white mb-1">
                        {isCompleted ? "Enjoy your meal!" : isCancelled ? "Order Cancelled" : "Order is in progress"}
                    </h2>
                    <p className="text-slate-500 text-sm">
                        {isCompleted ? "Your order has been delivered." :
                            isCancelled ? "This order was cancelled." :
                                isBreached ? <span className="text-amber-500/80">Sorry for the delay.<br />We are working to deliver your order as quickly as possible.</span> : "Freshly preparing your items."}
                    </p>
                </div>

                {/* ETA Card */}
                {!isCancelled && (
                    <div className="bg-slate-900/40 border border-slate-800/60 backdrop-blur-md rounded-3xl p-6 mb-6 animate-fade-in-up animation-delay-100 flex items-center justify-between relative overflow-hidden shadow-xl">
                        <div className="z-10">
                            <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                                <Clock size={16} />
                                <span>{isCompleted ? "DELIVERED AT" : "ESTIMATED ARRIVAL"}</span>
                            </div>
                            <div className="text-3xl font-bold text-white font-mono mb-1">
                                {isCompleted ? new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : targetTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                {isCompleted ? "Completed" : isBreached ? "Delayed" : "On Schedule"}
                            </div>
                        </div>

                        {/* Timer Ring */}
                        <div className="relative w-24 h-24 flex-shrink-0 z-10">
                            <svg className="transform -rotate-90 w-24 h-24">
                                <circle cx="48" cy="48" r="45" stroke="rgba(255,255,255,0.05)" strokeWidth="6" fill="none" />
                                {!isCompleted && (
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r="45"
                                        stroke={isBreached ? "#ef4444" : "#f97316"}
                                        strokeWidth="6"
                                        fill="none"
                                        strokeDasharray={circumference}
                                        strokeDashoffset={strokeDashoffset}
                                        strokeLinecap="round"
                                        className="transition-all duration-1000 ease-linear"
                                    />
                                )}
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                                {isCompleted ? <CheckCircle2 size={24} className="text-emerald-500" /> : (
                                    <>
                                        <div className={`text-lg font-bold font-mono ${isBreached ? 'text-red-500' : 'text-orange-500'}`}>
                                            {Math.abs(diffMins)}
                                        </div>
                                        <div className={`text-[10px] uppercase font-bold ${isBreached ? 'text-red-500' : 'text-orange-500'}`}>
                                            {isBreached ? 'Min Late' : 'Min Left'}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Order Summary */}
                <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl overflow-hidden mb-6 animate-fade-in-up animation-delay-200">
                    <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Order Summary</span>
                        <span className="text-xs font-mono text-slate-400">#{data.display_id}</span>
                    </div>
                    <div className="p-4 space-y-3">
                        {data.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-start text-sm">
                                <div className="flex gap-3">
                                    <div className="w-5 h-5 rounded bg-slate-800 text-slate-400 flex items-center justify-center text-xs font-bold shrink-0">
                                        {item.quantity}x
                                    </div>
                                    <span className="text-slate-200 font-medium">{item.item_name}</span>
                                </div>
                                <span className="text-slate-400 font-mono">₹{item.total_price}</span>
                            </div>
                        ))}
                        <div className="h-px bg-white/5 my-2" />
                        <div className="flex justify-between items-center font-bold text-white">
                            <span>Total</span>
                            <span className="font-mono">₹{data.total_amount}</span>
                        </div>
                    </div>
                </div>

                {/* Timeline */}
                <div className="bg-slate-900/40 border border-slate-800/60 rounded-3xl p-6 mb-8 animate-fade-in-up animation-delay-300">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Status Updates</div>
                    <div className="relative pl-2 space-y-8">
                        <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-zinc-800 rounded-full" />
                        {steps.map((step, i) => (
                            <div key={i} className={`relative flex items-start gap-4 ${step.active ? 'opacity-100' : 'opacity-40'}`}>
                                <div className={`relative z-10 w-8 h-8 rounded-full border-4 flex items-center justify-center shrink-0 transition-all duration-500 ${step.completed ? 'bg-orange-500 border-orange-500 text-white' : step.active ? 'bg-[#0b1120] border-orange-500 animate-pulse' : 'bg-[#0b1120] border-slate-700'}`}>
                                    {step.completed && <CheckCircle2 size={14} />}
                                    {!step.completed && step.active && <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
                                </div>
                                <div className="pt-1">
                                    <div className={`text-sm font-bold ${step.active ? 'text-white' : 'text-zinc-500'}`}>{step.label}</div>
                                    {step.active && step.time && <div className="text-xs text-zinc-500 mt-0.5">{step.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Action Buttons */}
                {!isCompleted && !isCancelled && (
                    <button className="w-full bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white py-4 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2">
                        <RefreshCcw size={16} /> Need Help? Call Front Desk
                    </button>
                )}

            </div>
        </main>
    );
}
