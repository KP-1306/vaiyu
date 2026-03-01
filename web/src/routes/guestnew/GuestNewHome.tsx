import { Link } from "react-router-dom";
import { useState, useEffect, useMemo, ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { SimpleTooltip } from "../../components/SimpleTooltip";
import "./guestnew.css";

type Stay = {
    id: string;
    hotel_id?: string | null;
    status?: string | null;
    hotel: {
        name: string;
        city?: string;
        slug?: string | null;
        phone?: string | null;
        whatsapp?: string | null;
        email?: string | null;
    };
    check_in: string;
    check_out: string;
    actual_checkin_at?: string | null;
    bill_total?: number | null;
    room_type?: string | null;
    room_number?: string | null;
    booking_code?: string | null;
    room_charge?: number | null;
    city_tax?: number | null;
    guests?: number;
};

// Helper for Tooltips
const ConditionalTooltip = ({ children, content, condition }: { children: ReactNode, content: string, condition: boolean }) => {
    if (condition) {
        return <SimpleTooltip content={content}>{children}</SimpleTooltip>;
    }
    return <>{children}</>;
};

export default function GuestNewHome() {
    const [displayName, setDisplayName] = useState<string>("Guest");
    const [currentStay, setCurrentStay] = useState<Stay | null>(null);
    const [allStays, setAllStays] = useState<Stay[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeRequests, setActiveRequests] = useState(0);

    // Get time-aware greeting
    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    }, []);

    // Fetch user profile and stays
    useEffect(() => {
        let mounted = true;

        const loadData = async () => {
            try {
                const { data: sessionData } = await supabase.auth.getSession();
                const user = sessionData.session?.user;

                if (user) {
                    // Get display name
                    const name =
                        (user.user_metadata?.name as string) ??
                        user.user_metadata?.full_name ??
                        user.email?.split("@")[0] ??
                        "Guest";
                    setDisplayName(name.split(" ")[0]); // First name only

                    // Get profile name if available
                    const { data: profile } = await supabase
                        .from("profiles")
                        .select("full_name")
                        .eq("id", user.id)
                        .maybeSingle();

                    if (profile?.full_name?.trim()) {
                        setDisplayName(profile.full_name.split(" ")[0]);
                    }

                    // Fetch stays
                    const { data: stays } = await supabase
                        .from("user_recent_stays")
                        .select("*")
                        .order("check_in", { ascending: false })
                        .limit(20);

                    if (mounted && stays) {
                        setAllStays(
                            stays.map((s: any) => ({
                                id: s.id,
                                hotel_id: s.hotel_id,
                                status: s.status,
                                hotel: {
                                    name: s.hotel_name || s.hotel?.name || "Hotel",
                                    city: s.hotel_city || s.hotel?.city,
                                    slug: s.hotel_slug || s.hotel?.slug,
                                    phone: s.hotel_phone || s.hotel?.phone,
                                    whatsapp: s.hotel_whatsapp || s.hotel?.wa_display_number,
                                    email: s.hotel_email || s.hotel?.email,
                                },
                                check_in: s.check_in,
                                check_out: s.check_out,
                                bill_total: s.bill_total,
                                room_type: s.room_type,
                                room_number: s.room_number, // Attempt to fetch real room number
                                booking_code: s.booking_code,
                                room_charge: s.room_charge || (s.bill_total ? s.bill_total * 0.97 : 0),
                                city_tax: s.city_tax || (s.bill_total ? s.bill_total * 0.03 : 0),
                                guests: s.guests || 1,
                            }))
                        );

                        // Find current/active stay
                        const now = new Date();

                        // 1. Prioritize active stays
                        let active = stays.find((s: any) =>
                            ["inhouse", "checked_in", "partially_arrived", "checkout_requested"].includes(s.status?.toLowerCase() || "")
                        );

                        // 2. Fallback to upcoming stay
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

                        if (active) {
                            setCurrentStay({
                                id: active.id,
                                hotel_id: active.hotel_id,
                                status: active.status || "inhouse",
                                hotel: {
                                    name: active.hotel_name || active.hotel?.name || "Hotel",
                                    city: active.hotel_city || active.hotel?.city,
                                    slug: active.hotel_slug || active.hotel?.slug,
                                    phone: active.hotel_phone || active.hotel?.phone,
                                    whatsapp: active.hotel_whatsapp || active.hotel?.wa_display_number,
                                    email: active.hotel_email || active.hotel?.email,
                                },
                                check_in: active.check_in,
                                check_out: active.check_out,
                                actual_checkin_at: active.actual_checkin_at,
                                bill_total: active.bill_total,
                                room_type: active.room_type,
                                booking_code: active.booking_code,
                                room_charge: active.room_charge || (active.bill_total ? active.bill_total * 0.97 : 0),
                                city_tax: active.city_tax || (active.bill_total ? active.bill_total * 0.03 : 0),
                                guests: active.guests || 1,
                            });
                        } else if (stays.length > 0) {
                            // Use most recent stay for demo
                            const mostRecent = stays[0];
                            setCurrentStay({
                                id: mostRecent.id,
                                hotel_id: mostRecent.hotel_id,
                                status: mostRecent.status || "checked-in",
                                hotel: {
                                    name: mostRecent.hotel_name || mostRecent.hotel?.name || "Hotel Demo One",
                                    city: mostRecent.hotel_city || mostRecent.hotel?.city,
                                    slug: mostRecent.hotel_slug || mostRecent.hotel?.slug,
                                    phone: mostRecent.hotel_phone || mostRecent.hotel?.phone,
                                    whatsapp: mostRecent.hotel_whatsapp || mostRecent.hotel?.wa_display_number,
                                    email: mostRecent.hotel_email || mostRecent.hotel?.email,
                                },
                                check_in: mostRecent.check_in,
                                check_out: mostRecent.check_out,
                                bill_total: mostRecent.bill_total,
                                room_type: mostRecent.room_type || "Standard",
                                room_number: mostRecent.room_number,
                                booking_code: mostRecent.booking_code,
                                room_charge: mostRecent.room_charge || (mostRecent.bill_total ? mostRecent.bill_total * 0.97 : 0),
                                city_tax: mostRecent.city_tax || (mostRecent.bill_total ? mostRecent.bill_total * 0.03 : 0),
                                guests: mostRecent.guests || 1,
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("[GuestNewHome] Error loading data:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        loadData();

        // Subscribe to realtime updates for stays and bookings
        const subscription = supabase
            .channel('guest_home_stays')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'stays' }, loadData)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, loadData)
            .subscribe();

        return () => {
            mounted = false;
            supabase.removeChannel(subscription);
        };
    }, []);

    // Fetch active requests count when currentStay changes
    useEffect(() => {
        if (!currentStay?.id) {
            setActiveRequests(0);
            return;
        }

        (async () => {
            try {
                // Count active tickets (not completed/cancelled)
                const { count: ticketCount } = await supabase
                    .from("tickets")
                    .select("*", { count: "exact", head: true })
                    .eq("stay_id", currentStay.id)
                    .not("status", "in", "(\"completed\",\"cancelled\")");

                // Count active food orders (pending/preparing)
                const { count: orderCount } = await supabase
                    .from("food_orders")
                    .select("*", { count: "exact", head: true })
                    .eq("stay_id", currentStay.id)
                    .in("status", ["pending", "preparing", "ready"]);

                setActiveRequests((ticketCount || 0) + (orderCount || 0));
            } catch (err) {
                console.error("[GuestNewHome] Error fetching active requests:", err);
            }
        })();
    }, [currentStay?.id]);

    const [recentRequests, setRecentRequests] = useState<any[]>([]);
    const [folioItems, setFolioItems] = useState<any[]>([]);
    const [foodOrders, setFoodOrders] = useState<any[]>([]);
    const [grandTotal, setGrandTotal] = useState(0);
    const [ledgerPaid, setLedgerPaid] = useState(0);
    const [ledgerTotalState, setLedgerTotalState] = useState(0);

    const handleActionClick = (e: React.MouseEvent, action: 'request_service' | 'track_requests' | 'checkout' | 'call_reception' | 'whatsapp_reception' | 'email_reception') => {
        if (!currentStay) {
            e.preventDefault();
            alert("No stay available.");
            return;
        }

        const statusLower = (currentStay.status || "").toLowerCase();
        const isPast = ["checked_out", "cancelled", "no_show"].includes(statusLower);
        const isUpcoming = ["arriving", "expected", "confirmed"].includes(statusLower);

        switch (action) {
            case 'request_service':
                if (isUpcoming) {
                    e.preventDefault();
                    alert("You can request services after you check-in to your room. We look forward to welcoming you!");
                } else if (isPast) {
                    e.preventDefault();
                    alert("This stay has already concluded.");
                }
                break;
            case 'track_requests':
                if (isUpcoming) {
                    e.preventDefault();
                    alert("You have no requests to track for an upcoming stay.");
                }
                // Past stays CAN track requests (to view history)
                break;
            case 'checkout':
                if (isUpcoming) {
                    e.preventDefault();
                    alert("Express checkout is available during your stay.");
                } else if (isPast) {
                    e.preventDefault();
                    alert("This stay has already concluded.");
                } else if (statusLower === 'checkout_requested') {
                    e.preventDefault();
                    alert("Your checkout request is already pending approval. Thank you!");
                }
                break;
            case 'call_reception':
            case 'whatsapp_reception':
            case 'email_reception':
                if (isPast) {
                    e.preventDefault();
                    alert("This stay has already concluded.");
                }
                // allow upcoming stays to call reception
                break;
        }
    };

    // Format currency
    const formatCurrency = (amount: number | null | undefined) => {
        if (!amount && amount !== 0) return "—";
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Format date
    const formatDate = (dateStr: string, includeTime = false) => {
        try {
            const date = new Date(dateStr);
            const formatted = date.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
            });
            return includeTime ? `${formatted} ~ 11:00 AM` : formatted;
        } catch {
            return dateStr;
        }
    };

    useEffect(() => {
        if (!currentStay?.id) return;

        (async () => {
            try {
                // Fetch tickets from v_guest_tickets
                const { data: tickets } = await supabase
                    .from("v_guest_tickets")
                    .select("*")
                    .eq("stay_id", currentStay.id)
                    .order("created_at", { ascending: false })
                    .limit(5);

                // Fetch ALL orders from v_guest_food_orders (using booking_code) to calculate true total
                const { data: orders } = await supabase
                    .from("v_guest_food_orders")
                    .select("*")
                    .eq("booking_code", currentStay.booking_code)
                    .order("created_at", { ascending: false });

                // Store orders for invoice (filter to completed/delivered only)
                if (orders) {
                    setFoodOrders(orders.filter((o: any) => ['delivered', 'completed', 'ready'].includes(o.status?.toLowerCase())));
                }

                const recentOrders = (orders || []).slice(0, 5);

                const combined = [
                    ...(tickets || []).map((t: any) => ({
                        type: 'ticket',
                        id: t.id,
                        title: t.service_name || "Service Request",
                        status: t.status,
                        created_at: t.created_at,
                        eta: "15m"
                    })),
                    ...(recentOrders || []).map((o: any) => ({
                        type: 'order',
                        id: o.order_id,
                        title: `Order #${o.display_id}`,
                        status: o.status,
                        created_at: o.created_at,
                        eta: "20m"
                    }))
                ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 5);

                setRecentRequests(combined);

                // Calculate Live Folio using Enterprise Ledger View
                const items = [];
                let ledgerTotal = 0;
                let paidAmount = 0;

                // Fetch booking_id from stays table since the recent stays view doesn't have it
                const { data: stayData } = await supabase
                    .from("stays")
                    .select("booking_id")
                    .eq("id", currentStay.id)
                    .single();

                if (stayData?.booking_id) {
                    // Fetch consolidated ledger totals directly
                    const { data: ledger } = await supabase
                        .from("v_arrival_payment_state")
                        .select("total_amount, paid_amount")
                        .eq("booking_id", stayData.booking_id)
                        .single();

                    if (ledger) {
                        ledgerTotal = ledger.total_amount || 0;
                        paidAmount = ledger.paid_amount || 0;
                    }
                }

                // Room Charges
                if (currentStay.room_type) {
                    const roomCharge = currentStay.bill_total || 0;
                    items.push({ label: `Room Charges (${currentStay.room_type})`, amount: roomCharge });
                }

                // Push consolidated food/service charges based on ledger
                // (Subtracting assumed room charges to get the remainders for the UI breakdown)
                const roomChargeBase = currentStay.bill_total || 0;
                const dynamicCharges = Math.max(0, ledgerTotal - roomChargeBase);
                if (dynamicCharges > 0) {
                    items.push({ label: 'Food & Dining (Ledger)', amount: dynamicCharges });
                }

                if (paidAmount > 0) {
                    items.push({ label: 'Payments Received', amount: -paidAmount });
                }

                setFolioItems(items);
                setLedgerPaid(paidAmount || 0);
                setLedgerTotalState(ledgerTotal || 0);
                // "Current Total" in Live Folio implies Outstanding Balance realistically
                setGrandTotal(Math.max(0, ledgerTotal - paidAmount));

            } catch (err) {
                console.error("Error fetching dashboard details:", err);
            }
        })();
    }, [currentStay?.id, currentStay?.booking_code]);

    const getStatusColor = (status: string) => {
        const s = status.toLowerCase();
        if (s === 'completed' || s === 'resolved' || s === 'ready' || s === 'delivered') return 'success';
        if (s === 'cancelled' || s === 'rejected') return 'error';
        if (s === 'in_progress' || s === 'preparing' || s === 'new' || s === 'pending') return 'warning';
        return 'info';
    };

    // Calculate nights
    const nights = useMemo(() => {
        if (!currentStay) return 1;
        const checkin = new Date(currentStay.check_in);
        const checkout = new Date(currentStay.check_out);
        return Math.max(Math.ceil((checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24)), 1);
    }, [currentStay]);

    // Download/Print Invoice
    const downloadInvoice = () => {
        if (!currentStay) return;

        const invoiceWindow = window.open("", "_blank");
        if (!invoiceWindow) return;

        const invoiceHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Invoice - ${currentStay.booking_code}</title>
    <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333; }
        .platform-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #eee; margin-bottom: 25px; }
        .platform-logo { display: flex; align-items: center; gap: 10px; }
        .platform-logo img { height: 40px; }
        .platform-logo span { font-size: 24px; font-weight: 700; color: #d4a574; }
        .platform-tagline { font-size: 12px; color: #999; }
        h1 { font-size: 22px; margin-bottom: 5px; margin-top: 0; }
        .subtitle { color: #666; margin-bottom: 20px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; }
        .booking-id { font-size: 14px; color: #666; text-align: right; }
        .booking-label { font-size: 11px; color: #999; text-transform: uppercase; }
        .section { margin-bottom: 25px; }
        .section-title { font-weight: 600; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #eee; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; }
        .row.total { border-top: 2px solid #333; font-weight: 600; font-size: 18px; margin-top: 10px; padding-top: 15px; }
        .dates { display: flex; gap: 30px; }
        .date-item { }
        .date-label { font-size: 12px; color: #666; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
        .footer-logo { color: #d4a574; font-weight: 600; }
        @media print { body { margin: 0; } .platform-header { page-break-inside: avoid; } }
    </style>
</head>
<body>
    <!-- Vaiyu Platform Header -->
    <div class="platform-header">
        <div class="platform-logo">
            <img src="/brand/vaiyu-logo.png" alt="Vaiyu" onerror="this.style.display='none'" />
            <span>Vaiyu</span>
        </div>
        <div class="platform-tagline">Tax Invoice</div>
    </div>

    <!-- Hotel & Booking Details -->
    <div class="header">
        <div>
            <h1>${currentStay.hotel.name}</h1>
            <div class="subtitle">${currentStay.hotel.city || ""}</div>
        </div>
        <div class="booking-id">
            <div class="booking-label">Booking ID</div>
            <div>${currentStay.booking_code}</div>
        </div>
    </div>
    
    <div class="section">
        <div class="dates">
            <div class="date-item">
                <div class="date-label">Check-in</div>
                <div>${formatDate(currentStay.check_in)}</div>
            </div>
            <div class="date-item">
                <div class="date-label">Check-out</div>
                <div>${formatDate(currentStay.check_out)}</div>
            </div>
            <div class="date-item">
                <div class="date-label">Nights</div>
                <div>${nights}</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">Stay Charges</div>
        <div class="row"><span>Room</span><span>${formatCurrency(currentStay.room_charge)}</span></div>
        <div class="row"><span>City Tax</span><span>${formatCurrency(currentStay.city_tax)}</span></div>
    </div>
    
    ${foodOrders.length > 0 ? `
    <div class="section">
        <div class="section-title">Food & Dining (${foodOrders.length})</div>
        ${foodOrders.map(o => `
            <div class="row" style="margin-bottom: 0; padding-bottom: 2px;">
                <span style="font-weight: 500;">Order #${o.display_id}</span>
                <span style="font-weight: 500;">${formatCurrency(o.total_amount)}</span>
            </div>
            ${o.items && o.items.length > 0 ? `
                <div style="margin-left: 15px; margin-bottom: 8px; font-size: 13px; color: #666;">
                    ${o.items.map((item: any) => `
                        <div style="display: flex; justify-content: space-between; padding: 2px 0;">
                            <span>${item.quantity}x ${item.name}</span>
                            <span>${formatCurrency(item.price * item.quantity)}</span>
                        </div>
                    `).join("")}
                </div>
            ` : ''}
        `).join("")}
    </div>
    ` : ""}
    
    <div class="section" style="border-top: 2px solid #333; margin-top: 15px; padding-top: 10px;">
        <div class="row" style="font-weight: 600; font-size: 16px;"><span>Total Charges</span><span>${formatCurrency(ledgerTotalState)}</span></div>
    </div>

    ${ledgerPaid > 0 ? `
    <div class="section">
        <div class="row" style="color: #4CAF50; font-weight: 600; font-size: 16px;"><span>Payments Received</span><span>-${formatCurrency(ledgerPaid)}</span></div>
    </div>
    ` : ""}
    
    <div class="section">
        <div class="row" style="font-weight: 700; font-size: 18px; margin-top: 5px;"><span>Balance Due</span><span>${formatCurrency(grandTotal)}</span></div>
    </div>
    
    <div class="footer">
        <div>Generated on ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
        <div style="margin-top: 8px;">Booked via <span class="footer-logo">Vaiyu</span> · vaiyu.co.in</div>
    </div>
    
    <script>window.print();</script>
</body>
</html>`;

        invoiceWindow.document.write(invoiceHtml);
        invoiceWindow.document.close();
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-greeting" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    return (
        <div className="gn-container" style={{ maxWidth: '1200px' }}>
            {/* Hero Section with Background Image */}
            <div className="gn-hero-section">
                <div className="gn-hero-content">
                    {/* Header Section */}
                    <header className="gn-hero-header">
                        <h1 className="gn-greeting">
                            Welcome, {displayName}.
                        </h1>
                        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: 'var(--text-gold)', fontStyle: 'italic', opacity: 0.9 }}>
                            {currentStay?.hotel.name || "Grand Hotel & Spa"}
                        </div>
                    </header>

                    {/* Status Bar Widget */}
                    {currentStay && (
                        <div className="gn-status-bar">
                            <div className="gn-status-item">
                                Room <span>{currentStay.room_number || currentStay.room_type || "—"}</span>
                            </div>
                            <div className="gn-status-item gn-status-item--highlight">
                                <span>▶</span> {["checkout_requested"].includes(currentStay.status?.toLowerCase() || "") ? 'Checkout Requested' : (currentStay.status?.toLowerCase() === 'inhouse' || currentStay.status?.toLowerCase() === 'checked_in') ? 'Checked-In' : 'Upcoming'}
                            </div>
                            <div className="gn-status-item">
                                {["arriving", "expected", "confirmed"].includes((currentStay.status || "").toLowerCase()) ? 'Check-In' : 'Check-Out'}:
                                <span> {new Date(["arriving", "expected", "confirmed"].includes((currentStay.status || "").toLowerCase()) ? currentStay.check_in : currentStay.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - 11:00 AM</span>
                            </div>
                            <div className="gn-status-item" style={{ flex: 1, justifyContent: 'flex-end', borderRight: 'none' }}>
                                Outstanding: <span>{formatCurrency(grandTotal)}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Action Grid (Colorful Buttons) */}
            <div className="gn-action-grid">
                <ConditionalTooltip content="Available after you check-in to your room!" condition={!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase())}>
                    <Link to={`/stay/${currentStay?.booking_code || 'DEMO'}/menu?tab=services&code=${currentStay?.booking_code || 'DEMO'}`} onClick={(e) => handleActionClick(e, 'request_service')} className={`gn-action-btn gn-action-btn--teal ${!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase()) ? 'gn-action-btn--disabled' : ''}`}>
                        <div className="gn-action-btn__icon">🛎️</div>
                        <div className="gn-action-btn__content">
                            <span className="gn-action-btn__title">Request Service</span>
                            <span className="gn-action-btn__subtitle">Dining & Amenities</span>
                        </div>
                    </Link>
                </ConditionalTooltip>

                <ConditionalTooltip content="Tracking becomes available once you've made a request!" condition={!currentStay || ["arriving", "expected", "confirmed"].includes((currentStay.status || "").toLowerCase())}>
                    <Link to={`/stay/${currentStay?.booking_code || 'DEMO'}/requests`} onClick={(e) => handleActionClick(e, 'track_requests')} className={`gn-action-btn gn-action-btn--blue ${!currentStay || ["arriving", "expected", "confirmed"].includes((currentStay.status || "").toLowerCase()) ? 'gn-action-btn--disabled' : ''}`}>
                        <div className="gn-action-btn__icon">📊</div>
                        <div className="gn-action-btn__content">
                            <span className="gn-action-btn__title">Track Requests</span>
                            <span className="gn-action-btn__subtitle">Check Status</span>
                        </div>
                    </Link>
                </ConditionalTooltip>

                <Link
                    to={currentStay?.hotel?.phone ? `tel:${currentStay.hotel.phone}` : "/contact"}
                    onClick={(e) => handleActionClick(e, 'call_reception')}
                    className={`gn-action-btn gn-action-btn--gold ${!currentStay || ["checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase()) ? 'gn-action-btn--disabled' : ''}`}
                >
                    <div className="gn-action-btn__icon">📞</div>
                    <div className="gn-action-btn__content">
                        <span className="gn-action-btn__title">Call Reception</span>
                        <span className="gn-action-btn__subtitle">{currentStay?.hotel?.phone || "Guest Services"}</span>
                    </div>
                </Link>

                <ConditionalTooltip content="Express checkout is available during your active stay." condition={!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase())}>
                    <Link to="/guest/checkout" onClick={(e) => handleActionClick(e, 'checkout')} className={`gn-action-btn gn-action-btn--dark ${!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase()) ? 'gn-action-btn--disabled' : ''}`}>
                        <div className="gn-action-btn__icon">✔️</div>
                        <div className="gn-action-btn__content">
                            <span className="gn-action-btn__title">Checkout</span>
                            <span className="gn-action-btn__subtitle">Express Exit</span>
                        </div>
                    </Link>
                </ConditionalTooltip>
            </div>

            {/* Main Content Split (Requests + Folio) */}
            <div className="gn-feature-split">
                {/* Left: Active Requests Table */}
                <div className="gn-table-card">
                    <div className="gn-table-header">
                        <h3 className="gn-table-title">My Active Requests & Orders</h3>
                        <Link to={`/stay/${currentStay?.booking_code || 'DEMO'}/requests`} style={{ color: 'var(--text-gold)', textDecoration: 'none', fontSize: '0.875rem' }}>View All ›</Link>
                    </div>

                    <div className="gn-req-list">
                        {recentRequests.length > 0 ? (
                            recentRequests.map((req) => (
                                <div key={`${req.type}-${req.id}`} className="gn-req-row">
                                    <div className="gn-req-item">
                                        <div className="gn-req-img" style={{ background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                                            {req.type === 'ticket' ? '🛎️' : '🍽️'}
                                        </div>
                                        {req.title}
                                    </div>
                                    <div>
                                        <span className={`gn-pill gn-pill--${getStatusColor(req.status)}`}>
                                            {req.status}
                                        </span>
                                    </div>
                                    <div className="gn-req-time">
                                        {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                No active requests at the moment.
                            </div>
                        )}
                    </div>

                    {/* Quick Contact Options */}
                    <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                        <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Us</h4>
                        <div className="gn-support-grid">
                            {currentStay?.hotel?.phone && (
                                <a href={`tel:${currentStay.hotel.phone}`} className="gn-support-card">
                                    <div className="gn-support-card__icon">📞</div>
                                    <div className="gn-support-card__content">
                                        <div className="gn-support-card__title">Call Guest Services</div>
                                        <div className="gn-support-card__value">{currentStay.hotel.phone}</div>
                                    </div>
                                </a>
                            )}

                            {currentStay?.hotel?.whatsapp && (
                                <a href={`https://wa.me/${currentStay.hotel.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="gn-support-card">
                                    <div className="gn-support-card__icon">💬</div>
                                    <div className="gn-support-card__content">
                                        <div className="gn-support-card__title">WhatsApp Us</div>
                                        <div className="gn-support-card__value">{currentStay.hotel.whatsapp}</div>
                                    </div>
                                </a>
                            )}

                            {currentStay?.hotel?.email && (
                                <a href={`mailto:${currentStay.hotel.email}`} className="gn-support-card">
                                    <div className="gn-support-card__icon">✉️</div>
                                    <div className="gn-support-card__content">
                                        <div className="gn-support-card__title">Email Front Desk</div>
                                        <div className="gn-support-card__value">{currentStay.hotel.email}</div>
                                    </div>
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: Live Folio Widget */}
                <div>
                    <h3 className="gn-table-title" style={{ marginBottom: '1rem' }}>Live Folio</h3>
                    <div className="gn-folio">
                        {folioItems.map((item, i) => (
                            <div key={i} className="gn-folio-row">
                                <span>{item.label}</span>
                                <span>{formatCurrency(item.amount)}</span>
                            </div>
                        ))}

                        <div className="gn-folio-total">
                            <span>Current Total:</span>
                            <span>{formatCurrency(grandTotal)}</span>
                        </div>

                        <button onClick={downloadInvoice} className="gn-btn-download">Download Invoice</button>
                    </div>

                    <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                        <Link to="/contact" className="gn-btn gn-btn--ghost">
                            Need Help?
                        </Link>
                    </div>
                </div>
            </div>

            {/* Department Footer Mockup */}
            <div style={{ marginTop: '4rem', opacity: 0.5, borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                <div>Your Dedicated Service Officers</div>
                <div>Hotel Need to Know ›</div>
            </div>
        </div>
    );
}
