import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ArrowLeft, Receipt, Clock, ChevronRight, ShoppingBag, Utensils, IndianRupee } from "lucide-react";
import QRCode from "react-qr-code";

type OrderHistoryItem = {
    order_id: string;
    display_id: string;
    status: string;
    created_at: string;
    total_amount: number;
    currency: string;
    items: {
        name: string;
        price: number;
        quantity: number;
    }[];
    total_items: number;
    sla_minutes_remaining: number | null;
};

export default function GuestOrderHistory() {
    const { code } = useParams();
    const [orders, setOrders] = useState<OrderHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [bookingCode, setBookingCode] = useState<string | null>(null);
    const [hotelInfo, setHotelInfo] = useState<{ name: string; upi_id: string | null } | null>(null);
    const [totalPaid, setTotalPaid] = useState(0);

    useEffect(() => {
        // 1. Resolve Booking Code
        let bCode: string | null | undefined = code;
        if (!bCode || bCode === 'DEMO') {
            bCode = sessionStorage.getItem('vaiyu:stay_code');
        }
        setBookingCode(bCode ?? null);

        if (bCode) {
            fetchOrders(bCode);
            fetchHotelDetails(bCode);
        } else {
            setLoading(false);
        }
    }, [code]);

    const fetchHotelDetails = async (bCode: string) => {
        try {
            // 1. Resolve stay to get hotel_id
            const { data: stayData, error: stayError } = await supabase
                .rpc("resolve_stay_by_code", { p_code: bCode })
                .maybeSingle();

            if (stayError || !stayData) return;

            // 2. Fetch hotel UPI info
            const { data: hotelData } = await supabase
                .from('hotels')
                .select('name, upi_id')
                .eq('id', (stayData as any).hotel_id)
                .single();

            if (hotelData) {
                setHotelInfo(hotelData);
            }

            // 3. Fetch Payments
            const { data: paymentData } = await supabase
                .from('payments')
                .select('amount, type')
                .eq('stay_id', (stayData as any).stay_id)
                .eq('type', 'PAYMENT') // Only count credits
                .eq('status', 'COMPLETED');

            const paid = paymentData?.reduce((sum, p) => sum + p.amount, 0) || 0;
            setTotalPaid(paid);

        } catch (err) {
            console.error("Error fetching hotel details:", err);
        }
    };

    const fetchOrders = async (bCode: string) => {
        try {
            const { data, error } = await supabase
                .from('v_guest_food_orders')
                .select('*')
                .eq('booking_code', bCode)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setOrders(data || []);
        } catch (err) {
            console.error("Error fetching order history:", err);
        } finally {
            setLoading(false);
        }
    };

    const grandTotal = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
    const currency = orders[0]?.currency || 'INR';
    const netPayable = Math.max(0, grandTotal - totalPaid);
    const isFullyPaid = grandTotal > 0 && netPayable === 0;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'DELIVERED':
            case 'COMPLETED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'CANCELLED': return 'text-red-400 bg-red-500/10 border-red-500/20';
            case 'CREATED': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            default: return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0b1120] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-[#0b1120] font-sans pb-24 text-slate-200 selection:bg-orange-500/30">
            <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#0b1120] to-[#0b1120] z-0" />

            <div className="relative z-10 max-w-lg mx-auto p-4 sm:p-6">
                {/* Header */}
                <header className="flex items-center gap-4 mb-8">
                    <Link to={`/stay/${bookingCode}/menu`} className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center border border-slate-700/50 hover:bg-slate-700 transition-colors">
                        <ArrowLeft size={18} className="text-white" />
                    </Link>
                    <div>
                        <h1 className="text-lg font-bold text-white">Order History</h1>
                        <p className="text-xs text-slate-400">Your food orders during this stay</p>
                    </div>
                </header>

                {/* Bill Summary Card */}
                <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 mb-8 shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <IndianRupee size={80} />
                    </div>
                    <p className="text-sm text-slate-400 font-medium mb-1">Total Bill</p>
                    <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-white">
                            {new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(grandTotal)}
                        </span>
                    </div>
                    <div className="mt-4 flex gap-2 text-xs text-slate-500">
                        <span className="bg-white/5 px-2 py-1 rounded-md">{orders.length} Orders</span>
                        <span className="bg-white/5 px-2 py-1 rounded-md">{orders.reduce((sum, o) => sum + o.total_items, 0)} Items</span>
                    </div>

                    {totalPaid > 0 && (
                        <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
                            <span className="bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                Paid: ₹{totalPaid.toLocaleString()}
                            </span>
                        </div>
                    )}

                    {/* UPI QR Code or Paid Badge */}
                    {isFullyPaid ? (
                        <div className="mt-6 pt-6 border-t border-white/10 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4">
                            <div className="bg-emerald-500/20 text-emerald-400 p-4 rounded-full mb-3 border border-emerald-500/30 ring-4 ring-emerald-500/10">
                                <Receipt size={32} />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-1">Payment Complete</h3>
                            <p className="text-sm text-slate-400">All orders have been settled.</p>
                        </div>
                    ) : (
                        hotelInfo?.upi_id && netPayable > 0 && (
                            <div className="mt-6 pt-6 border-t border-white/10 flex flex-col items-center">
                                <div className="bg-white p-3 rounded-xl shadow-lg mb-3">
                                    <QRCode
                                        value={`upi://pay?pa=${hotelInfo.upi_id}&pn=${encodeURIComponent(hotelInfo.name)}&am=${netPayable}&cu=${currency}`}
                                        size={140}
                                        style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                        viewBox={`0 0 256 256`}
                                    />
                                </div>
                                <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                                    <IndianRupee size={12} /> Scan to pay {new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(netPayable)}
                                </p>
                            </div>
                        )
                    )}
                </div>

                {/* Orders List */}
                <div className="space-y-4">
                    {orders.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <ShoppingBag className="text-slate-500" />
                            </div>
                            <h3 className="text-white font-medium mb-1">No orders yet</h3>
                            <p className="text-sm text-slate-500 mb-6">Hungry? Check out our menu!</p>
                            <Link to={`/stay/${bookingCode}/menu`} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-medium text-sm transition-colors">
                                Browse Menu
                            </Link>
                        </div>
                    ) : (
                        orders.map(order => (
                            <Link
                                key={order.order_id}
                                to={`/stay/${bookingCode}/orders/${order.display_id || order.order_id}`}
                                className="block bg-slate-800/40 border border-white/5 rounded-xl p-4 hover:bg-slate-800/60 transition-colors group"
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-white font-medium text-sm">
                                                Order #{order.display_id?.replace('ORD-', '') || '...'}
                                            </span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase tracking-wider ${getStatusColor(order.status)}`}>
                                                {order.status.replace('_', ' ')}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                            <Clock size={12} />
                                            <span>
                                                {new Date(order.created_at).toLocaleString('en-US', {
                                                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                    <span className="text-white font-bold text-sm">
                                        {new Intl.NumberFormat('en-IN', { style: 'currency', currency: order.currency }).format(order.total_amount)}
                                    </span>
                                </div>

                                {/* Items Preview */}
                                <div className="space-y-1 mb-3">
                                    {order.items?.slice(0, 2).map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-xs text-slate-400">
                                            <span>{item.quantity}x {item.name}</span>
                                        </div>
                                    ))}
                                    {(order.items?.length || 0) > 2 && (
                                        <div className="text-xs text-slate-500 italic">
                                            + {(order.items?.length || 0) - 2} more items...
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center text-xs text-blue-400 font-medium group-hover:translate-x-1 transition-transform">
                                    View Details <ChevronRight size={14} />
                                </div>
                            </Link>
                        ))
                    )}
                </div>
            </div>
        </main>
    );
}
