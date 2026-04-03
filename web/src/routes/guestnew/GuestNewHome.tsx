import { Link } from "react-router-dom";
import { useState, useEffect, useMemo, ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import { getServices } from "../../lib/api";
import { SimpleTooltip } from "../../components/SimpleTooltip";
import "./guestnew.css";
import "./HeroMockup.css";

type Stay = {
    id: string; // booking_id
    primary_stay_id: string;
    hotel_id?: string | null;
    status: string | null;
    hotel: {
        name: string;
        city?: string;
        slug?: string | null;
        phone?: string | null;
        whatsapp?: string | null;
        email?: string | null;
        amenities?: string[] | null;
    };
    check_in: string;
    check_out: string;
    room_numbers?: string | null;
    room_types?: string[] | null;
    rooms_detail?: any[];
    booking_code?: string | null;
    outstanding_balance?: number | null;
    total_amount?: number | null;
    bill_total?: number | null; // Keep for backward compatibility with user_recent_stays
    room_type?: string | null; // Keep for backward compatibility
    room_charge?: number | null;
    city_tax?: number | null;
    guests?: number;
    precheckin_token?: string | null;
    precheckin_expires_at?: string | null;
    precheckin_used_at?: string | null;
    total_nights?: number | null;
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
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

    // Get time-aware greeting
    const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    }, []);

    // Fetch user profile and active bookings
    const [activeBookings, setActiveBookings] = useState<any[]>([]);

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

                    // Fetch Active Bookings (Grouped Stays)
                    const { data: bookings } = await supabase
                        .from("v_guest_active_bookings")
                        .select("*")
                        .order("check_in", { ascending: true });

                    if (mounted && bookings) {
                        const mappedBookings = bookings.map((b: any) => ({
                            id: b.booking_id,
                            primary_stay_id: b.primary_stay_id,
                            booking_code: b.booking_code,
                            hotel_id: b.hotel_id,
                            hotel: {
                                name: b.hotel_name,
                                city: b.hotel_city,
                                slug: b.hotel_slug,
                                phone: b.hotel_phone,
                                whatsapp: b.hotel_whatsapp,
                                email: b.hotel_email,
                            },
                            check_in: b.check_in,
                            check_out: b.check_out,
                            status: b.status, // 'inhouse' or 'arriving'
                            room_numbers: b.room_numbers_display,
                            rooms_detail: b.rooms_detail,
                            outstanding_balance: b.outstanding_balance,
                            city_tax: (b.total_amount || 0) * 0.03,
                            precheckin_token: b.precheckin_token,
                            precheckin_expires_at: b.precheckin_expires_at,
                            precheckin_used_at: b.precheckin_used_at,
                            room_types: b.room_types, // Array of room type names
                            total_nights: b.total_nights
                        }));

                        // Sort: Inhouse first, then by check-in date
                        const sortedBookings = [...mappedBookings].sort((a, b) => {
                            if (a.status === 'inhouse' && b.status !== 'inhouse') return -1;
                            if (a.status !== 'inhouse' && b.status === 'inhouse') return 1;
                            return new Date(a.check_in).getTime() - new Date(b.check_in).getTime();
                        });

                        setActiveBookings(sortedBookings);

                        // Default currentStay to the first sorted booking if not set
                        if (sortedBookings.length > 0 && (!currentStay || !sortedBookings.find(sb => sb.id === currentStay.id))) {
                            setCurrentStay(sortedBookings[0]);
                        }
                    }

                    // Also fetch all stays for the "Trips" history if needed, but the hero section now uses activeBookings
                    const { data: stays } = await supabase
                        .from("user_recent_stays")
                        .select("*")
                        .order("check_in", { ascending: false })
                        .limit(20);

                    if (mounted && stays) {
                        setAllStays(
                            stays.map((s: any) => ({
                                id: s.id,
                                primary_stay_id: s.id, // For single stays, primary_stay_id IS safe to be s.id
                                hotel_id: s.hotel_id,
                                status: s.status,
                                hotel: {
                                    name: s.hotel_name || s.hotel?.name || "Hotel",
                                    city: s.hotel_city || s.hotel?.city,
                                    slug: s.hotel_slug || s.hotel?.slug,
                                    phone: s.hotel_phone || s.hotel?.phone,
                                    whatsapp: s.hotel_whatsapp || s.hotel?.wa_display_number,
                                    email: s.hotel_email || s.hotel?.email,
                                    amenities: s.hotel?.amenities || s.hotel_amenities || [],
                                },
                                check_in: s.check_in,
                                check_out: s.check_out,
                                bill_total: s.bill_total,
                                room_type: s.room_type,
                                room_numbers: s.room_number,
                                booking_code: s.booking_code,
                                guests: s.guests || 1,
                            }))
                        );
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
        if (!currentStay?.primary_stay_id) {
            setActiveRequests(0);
            return;
        }

        (async () => {
            try {
                // Count active tickets (not completed/cancelled) - Scoped to PRIMARY STAY
                const { count: ticketCount } = await supabase
                    .from("tickets")
                    .select("*", { count: "exact", head: true })
                    .eq("stay_id", currentStay.primary_stay_id)
                    .not("status", "in", "(\"completed\",\"cancelled\")");

                // Count active food orders (pending/preparing) - Scoped to PRIMARY STAY
                const { count: orderCount } = await supabase
                    .from("food_orders")
                    .select("*", { count: "exact", head: true })
                    .eq("stay_id", currentStay.primary_stay_id)
                    .in("status", ["pending", "preparing", "ready"]);

                setActiveRequests((ticketCount || 0) + (orderCount || 0));
            } catch (err) {
                console.error("[GuestNewHome] Error fetching active requests:", err);
            }
        })();
    }, [currentStay?.primary_stay_id]);

    const [recentRequests, setRecentRequests] = useState<any[]>([]);
    const [folioItems, setFolioItems] = useState<any[]>([]);
    const [foodOrders, setFoodOrders] = useState<any[]>([]);
    const [grandTotal, setGrandTotal] = useState(0);
    const [ledgerPaid, setLedgerPaid] = useState(0);
    const [ledgerTotalState, setLedgerTotalState] = useState(0);
    const [hotelAmenities, setHotelAmenities] = useState<any>(null);
    const [propertyAmenities, setPropertyAmenities] = useState<string[]>([]);
    const [serviceOfferings, setServiceOfferings] = useState<any[]>([]);
    const [menuCategories, setMenuCategories] = useState<any[]>([]);

    // Helper for proper offering emojis
    const getOfferingEmoji = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes("dining") || n.includes("food") || n.includes("menu") || n.includes("breakfast") || n.includes("lunch") || n.includes("dinner")) return "🍽️";
        if (n.includes("housekeeping") || n.includes("cleaning") || n.includes("maid") || n.includes("turndown")) return "🧹";
        if (n.includes("spa") || n.includes("wellness") || n.includes("massage") || n.includes("salon")) return "💆‍♀️";
        if (n.includes("transfer") || n.includes("taxi") || n.includes("cab") || n.includes("pickup") || n.includes("airport") || n.includes("travel")) return "🚕";
        if (n.includes("laundry") || n.includes("ironing") || n.includes("wash") || n.includes("dry-clean")) return "🧺";
        if (n.includes("maintenance") || n.includes("repair") || n.includes("fix") || n.includes("electrical") || n.includes("plumbing")) return "🔧";
        if (n.includes("wifi") || n.includes("internet") || n.includes("network")) return "📶";
        if (n.includes("drink") || n.includes("bar") || n.includes("beverage") || n.includes("cocktail") || n.includes("wine")) return "🍹";
        if (n.includes("key") || n.includes("lock") || n.includes("access") || n.includes("security")) return "🔑";
        if (n.includes("bell") || n.includes("concierge") || n.includes("porter") || n.includes("reception") || n.includes("help") || n.includes("support")) return "🛎️";
        if (n.includes("gym") || n.includes("fitness") || n.includes("workout") || n.includes("sport")) return "🏋️‍♂️";
        if (n.includes("pool") || n.includes("swim")) return "🏊‍♂️";
        if (n.includes("doctor") || n.includes("medical") || n.includes("health")) return "💊";
        return "✨";
    };

    // Fetch hotel amenities (Wi-Fi, Breakfast, Notes) and general amenities
    useEffect(() => {
        if (!currentStay?.hotel_id) return;
        (async () => {
            try {
                const { data } = await supabase
                    .from("hotel_guest_info")
                    .select("*")
                    .eq("hotel_id", currentStay.hotel_id)
                    .maybeSingle();
                if (data) setHotelAmenities(data);

                // Fetch proper hotel amenities if they weren't in the stay object, because user_recent_stays view strips them
                const { data: hotelData } = await supabase
                    .from("hotels")
                    .select("amenities")
                    .eq("id", currentStay.hotel_id)
                    .maybeSingle();

                if (hotelData?.amenities) {
                    setPropertyAmenities(hotelData.amenities);
                }
            } catch (err) {
                console.error("[GuestNewHome] Error fetching hotel amenities:", err);
            }
        })();
    }, [currentStay?.hotel_id]);

    // Fetch dynamic Property Offerings (Services + Menu Categories)
    useEffect(() => {
        if (!currentStay?.hotel_id) return;

        const fetchOfferings = async () => {
            try {
                // 1) Fetch Services
                const res = await getServices(currentStay.hotel_id);
                if (res?.items) setServiceOfferings(res.items);

                // 2) Fetch Menu Categories
                const { data: categories } = await supabase
                    .from('menu_categories')
                    .select('id, name')
                    .eq('hotel_id', currentStay.hotel_id)
                    .eq('active', true)
                    .order('display_order');

                if (categories) setMenuCategories(categories);
            } catch (err) {
                console.error("[GuestNewHome] Error fetching offerings:", err);
            }
        };

        fetchOfferings();
    }, [currentStay?.hotel_id]);

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

    // Format SQL Time (HH:MM:SS to h:mm A)
    const formatSqlTime = (timeStr: string) => {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':');
        if (!hours || !minutes) return timeStr;
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10) || 0;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
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

                // Scoped to Aggregated Booking for Financials
                if (currentStay.id) {
                    // Fetch consolidated ledger totals directly
                    const { data: ledger } = await supabase
                        .from("v_arrival_payment_state")
                        .select("total_amount, paid_amount")
                        .eq("booking_id", currentStay.id)
                        .maybeSingle();

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

    // Helper for amenity icons
    const getAmenityIcon = (amenity: string) => {
        const lower = amenity.toLowerCase();
        if (lower.includes('wifi') || lower.includes('wi-fi') || lower.includes('internet')) return '📶';
        if (lower.includes('pool')) return '🏊';
        if (lower.includes('gym') || lower.includes('fitness')) return '🏋️';
        if (lower.includes('spa')) return '💆';
        if (lower.includes('restaurant') || lower.includes('dining')) return '🍽️';
        if (lower.includes('bar') || lower.includes('lounge')) return '🍸';
        if (lower.includes('parking')) return '🅿️';
        if (lower.includes('room service')) return '🛎️';
        if (lower.includes('pet') || lower.includes('animal')) return '🐾';
        if (lower.includes('laundry')) return '🧺';
        if (lower.includes('air conditioning') || lower.includes('ac')) return '❄️';
        if (lower.includes('meeting') || lower.includes('business')) return '💼';
        if (lower.includes('breakfast')) return '🍳';
        if (lower.includes('airport') || lower.includes('shuttle') || lower.includes('transfer')) return '🚐';
        return '✨'; // default fallback icon
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

    const [activeIndex, setActiveIndex] = useState(0);
    const [scrollProgress, setScrollProgress] = useState(0);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollLeft, scrollWidth, clientWidth } = e.currentTarget;
        const maxScroll = scrollWidth - clientWidth;
        const progress = maxScroll > 0 ? scrollLeft / maxScroll : 0;
        setScrollProgress(progress);

        if (activeBookings.length > 0) {
            setActiveIndex(Math.round(progress * (activeBookings.length - 1)));
        }
    };

    const scroll = (direction: 'left' | 'right') => {
        const el = document.querySelector('.hero-mockup-scroll-container') as HTMLElement;
        if (el) {
            const firstCard = el.firstElementChild as HTMLElement;
            const cardWidth = firstCard ? firstCard.offsetWidth + 18 : 296;
            const scrollAmount = direction === 'left' ? -cardWidth : cardWidth;
            el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        }
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-greeting" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    if (!loading && allStays.length === 0 && activeBookings.length === 0) {
        return (
            <div className="gn-container" style={{ maxWidth: '1200px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', maxWidth: '500px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧳</div>
                    <h2 style={{ color: 'var(--text-primary)', marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>No Stays Found</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem', lineHeight: 1.5 }}>
                        You don't have any upcoming or active stays linked to your account yet.
                        If you have a booking reference code, you can look it up to link it.
                    </p>
                    <Link
                        to="/checkin"
                        style={{
                            background: 'var(--accent-gold)',
                            color: '#000',
                            padding: '12px 24px',
                            borderRadius: '100px',
                            fontWeight: 600,
                            textDecoration: 'none',
                            display: 'inline-block',
                            transition: 'opacity 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                        Look up Booking
                    </Link>
                </div>
            </div>
        );
    }

    // Helper to normalize dates to midnight for consistent "day" counting
    const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const getStayDayLabel = (checkInStr: string, totalNights: number) => {
        const start = normalizeDate(new Date(checkInStr));
        const now = normalizeDate(new Date());
        const diffDays = Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const currentDay = Math.min(Math.max(1, diffDays), totalNights);
        const nightsTotal = totalNights || 1;
        return `Stay: Day ${currentDay} of ${nightsTotal} ${nightsTotal === 1 ? 'night' : 'nights'}`;
    };

    const getNightsRemainingLabel = (checkInStr: string, checkOutStr: string, totalNights?: number) => {
        const start = normalizeDate(new Date(checkInStr));
        const end = normalizeDate(new Date(checkOutStr));
        const now = normalizeDate(new Date());

        // Calculate total nights if not provided
        const nightsTotal = totalNights || Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        // daysPassed = floor((now - checkin) / 1 day) + 1
        const daysPassed = Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // nightsLeft = totalNights - daysPassed
        const nightsLeft = nightsTotal - daysPassed;

        const diffToCheckout = Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffToCheckout < 0) return "Checkout delayed";
        if (diffToCheckout === 0) return "Checkout today";
        if (nightsLeft <= 0) return "Final night";
        return `${nightsLeft} ${nightsLeft === 1 ? 'night' : 'nights'} left`;
    };

    // Helper for smart time labels (Upcoming/Inhouse)
    // type: 'arrival' | 'checkout'
    const getSmartTimeLabel = (dateStr: string, type: 'arrival' | 'checkout') => {
        const target = normalizeDate(new Date(dateStr));
        const now = normalizeDate(new Date());
        const prefix = type === 'arrival' ? 'Starts' : 'Ends';

        const diffDays = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Tomorrow";
        if (diffDays < 0) return type === 'arrival' ? "🔴 Check-in delayed" : "Ended";
        return `${prefix} in ${diffDays} days`;
    };

    return (
        <div className="gn-container" style={{ maxWidth: '1200px' }}>
            <div className="hero-mockup-wrapper">
                {/* Hero Section */}
                <div className="gn-hero-section">
                    <div className="gn-hero-content">
                        {/* Header Section */}
                        <header className="hero-mockup-greeting-group">
                            <h1 className="hero-mockup-greeting">
                                {currentStay?.status === 'arriving'
                                    ? `${displayName.charAt(0).toUpperCase() + displayName.slice(1).toLowerCase()}, Here is your upcoming stay.`
                                    : `Welcome, ${displayName.toLowerCase()}.`
                                }
                            </h1>
                        </header>

                        {/* Main Featured Booking Card */}
                        {currentStay ? (
                            <div className="hero-mockup-card">
                                <div className="hero-mockup-card-header">
                                    <div className="hero-mockup-hotel">
                                        🏨 {currentStay.hotel?.name || 'Hotel'}
                                    </div>
                                    <div className="hero-mockup-outstanding">
                                        Outstanding: <span>{formatCurrency(currentStay.outstanding_balance || 0)}</span>
                                    </div>
                                </div>

                                {currentStay.status === 'arriving' ? (
                                    <div className="hero-mockup-card-body-split">
                                        <div className="hero-mockup-card-body-left">
                                            <div className="hero-mockup-room">
                                                {currentStay.room_numbers && currentStay.room_numbers !== 'Unassigned'
                                                    ? `Room: ${currentStay.room_numbers}`
                                                    : `Room Type: ${currentStay.room_types?.join(', ') || 'Standard Room'}`
                                                }
                                            </div>
                                            <div className="hero-mockup-status-row">
                                                <div className="hero-mockup-status-pill gn-status-pill--upcoming">
                                                    <span className="gn-status-dot-amber"></span> UPCOMING STAY
                                                </div>
                                            </div>
                                            <div className="hero-mockup-booking-code" style={{ marginBottom: '12px' }}>
                                                Booking: {currentStay.booking_code}
                                            </div>
                                            <div className="hero-mockup-time-stack">
                                                <div className="hero-mockup-time-item">
                                                    <span className="hero-mockup-time-label">Arrival:</span> {new Date(currentStay.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 2:00 PM
                                                </div>
                                                <div className="hero-mockup-time-item">
                                                    <span className="hero-mockup-time-label">Checkout:</span> {new Date(currentStay.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 11:00 AM
                                                </div>
                                                <div style={{ marginTop: '2px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                                                    {(currentStay.total_nights || nights)} {(currentStay.total_nights || nights) === 1 ? 'night' : 'nights'}
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: '#e5c158', fontWeight: 600 }}>
                                                    {getSmartTimeLabel(currentStay.check_in, 'arrival')}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="hero-mockup-card-body-right">
                                            {currentStay.precheckin_token && !currentStay.precheckin_used_at && (
                                                <Link to={`/precheckin/${currentStay.precheckin_token}`} className="gn-internal-action-button gn-internal-action--primary">
                                                    <span className="icon">✓</span> Complete Pre Check-In
                                                </Link>
                                            )}
                                            <button onClick={() => setIsDetailsModalOpen(true)} className="gn-internal-action-button gn-internal-action--secondary">
                                                View Details <span className="arrow">›</span>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="hero-mockup-card-body-split">
                                        <div className="hero-mockup-card-body-left">
                                            <div className="hero-mockup-room">
                                                Room: {currentStay.room_numbers}
                                            </div>
                                            <div className="hero-mockup-status-row">
                                                <div className="hero-mockup-status-pill gn-status-pill--inhouse-active">
                                                    ✓ STAY IN PROGRESS
                                                </div>
                                            </div>
                                            <div className="hero-mockup-booking-code" style={{ marginBottom: '12px' }}>
                                                Booking: {currentStay.booking_code}
                                            </div>
                                            <div className="hero-mockup-time-stack">
                                                <div className="hero-mockup-time-item" style={{ fontWeight: 500, color: '#fff', marginBottom: '4px' }}>
                                                    {getStayDayLabel(currentStay.check_in, currentStay.total_nights || nights)}
                                                </div>
                                                {(() => {
                                                    const label = getNightsRemainingLabel(currentStay.check_in, currentStay.check_out, currentStay.total_nights || nights);
                                                    if (label === "Checkout delayed") return (
                                                        <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>
                                                            🔴 Checkout delayed — was {new Date(currentStay.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 11:00 AM
                                                        </div>
                                                    );
                                                    if (label === "Checkout today") return (
                                                        <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>
                                                            🔴 Checkout today • 11:00 AM
                                                        </div>
                                                    );
                                                    return (
                                                        <>
                                                            <div className="hero-mockup-time-item">
                                                                <span className="hero-mockup-time-label">Checkout:</span> {new Date(currentStay.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 11:00 AM
                                                            </div>
                                                            <div style={{ marginTop: '2px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                                                                {label}
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                        <div className="hero-mockup-card-body-right">
                                            <Link to={`/stay/${currentStay.booking_code}/menu?tab=services`} className="gn-internal-action-button gn-internal-action--primary">
                                                <span className="icon">🛎️</span> Request Service
                                            </Link>
                                            <button onClick={() => setIsDetailsModalOpen(true)} className="gn-internal-action-button gn-internal-action--secondary">
                                                View Details <span className="arrow">›</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ opacity: 0.6, fontStyle: 'italic', padding: '40px 0', color: '#fff' }}>
                                No active stays found.
                            </div>
                        )}

                        {/* Other Bookings Selection Carousel */}
                        {activeBookings.length > 1 && (
                            <div className="hero-mockup-carousel-group">
                                <div className="hero-mockup-carousel-header">
                                    <h3 className="hero-mockup-carousel-title">Other Bookings ({activeBookings.length})</h3>
                                    <Link to="/guest/trips" className="hero-mockup-view-all">View All ↗</Link>
                                </div>

                                <div className="hero-mockup-carousel-main">
                                    <div className="hero-mockup-arrow hero-mockup-arrow--left" onClick={() => scroll('left')}>‹</div>

                                    <div className="hero-mockup-scroll-container" onScroll={handleScroll}>
                                        {activeBookings.map((booking, i) => {
                                            const nights = Math.ceil(Math.abs(new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / (1000 * 60 * 60 * 24));
                                            return (
                                                <div
                                                    key={booking.id}
                                                    className={`hero-mockup-subcard ${currentStay?.id === booking.id ? 'active' : ''}`}
                                                    onClick={() => setCurrentStay(booking)}
                                                >
                                                    <div className="hero-mockup-subcard-hotel">
                                                        {booking.hotel.name.toUpperCase()}
                                                    </div>
                                                    <div className="hero-mockup-subcard-room">
                                                        {booking.room_numbers && booking.room_numbers !== 'Unassigned'
                                                            ? `Room: ${booking.room_numbers}`
                                                            : `${booking.room_types?.[0] || 'Standard Room'}`
                                                        }
                                                    </div>
                                                    <div className="hero-mockup-subcard-footer">
                                                        <div className="hero-mockup-subcard-status-wrapper">
                                                            <div className={`hero-mockup-subcard-status ${booking.status === 'inhouse' ? 'gn-status-pill--inhouse' : 'gn-status-pill--upcoming'}`}>
                                                                {booking.status === 'inhouse' ? (
                                                                    <div className="gn-status-pill--inhouse-active" style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '100px', width: 'fit-content' }}>
                                                                        ✓ STAY IN PROGRESS
                                                                    </div>
                                                                ) : (
                                                                    <><span className="gn-status-dot-amber"></span> UPCOMING</>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="hero-mockup-subcard-info">
                                                            {booking.status === 'inhouse' ? (
                                                                <div className="hero-mockup-time-stack" style={{ marginTop: '0', gap: '4px' }}>
                                                                    {(() => {
                                                                        const label = getNightsRemainingLabel(booking.check_in, booking.check_out, booking.total_nights);
                                                                        if (label === "Checkout delayed") return (
                                                                            <div className="hero-mockup-subcard-checkout">
                                                                                <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 Checkout delayed</span>
                                                                            </div>
                                                                        );
                                                                        if (label === "Checkout today") return (
                                                                            <div className="hero-mockup-subcard-checkout">
                                                                                <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 Checkout today</span> • 11:00 AM
                                                                            </div>
                                                                        );
                                                                        return (
                                                                            <>
                                                                                <div className="hero-mockup-subcard-checkout">
                                                                                    Checkout: {new Date(booking.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 11:00 AM
                                                                                </div>
                                                                                <div className="hero-mockup-nights-left" style={{ fontSize: '0.8rem', color: '#e5c158' }}>
                                                                                    {label}
                                                                                </div>
                                                                            </>
                                                                        );
                                                                    })()}
                                                            </div>
                                                            ) : (
                                                                <div className="hero-mockup-time-stack" style={{ marginTop: '0', gap: '4px' }}>
                                                                    <div className="hero-mockup-subcard-checkout">
                                                                        Arrival: {new Date(booking.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • 2:00 PM
                                                                    </div>
                                                                    <div className="hero-mockup-nights-left" style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem' }}>
                                                                        {(booking.total_nights || nights)} {(booking.total_nights || nights) === 1 ? 'night' : 'nights'}
                                                                    </div>
                                                                    <div className="hero-mockup-nights-left" style={{ color: 'rgba(229, 193, 88, 0.8)', fontSize: '0.8rem', fontWeight: 500 }}>
                                                                        {getSmartTimeLabel(booking.check_in, 'arrival')}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="hero-mockup-arrow hero-mockup-arrow--right" onClick={() => scroll('right')}>›</div>
                                </div>

                                <div className="hero-mockup-nav-controls">
                                    <div className="hero-mockup-dots">
                                        {activeBookings.map((_, i) => (
                                            <div
                                                key={i}
                                                className={`hero-mockup-dot ${activeIndex === i ? 'active' : ''}`}
                                                onClick={() => {
                                                    const el = document.querySelector('.hero-mockup-scroll-container') as HTMLElement;
                                                    if (el) {
                                                        const firstCard = el.firstElementChild as HTMLElement;
                                                        const cardWidth = firstCard ? firstCard.offsetWidth + 18 : 296;
                                                        el.scrollTo({ left: i * cardWidth, behavior: 'smooth' });
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
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

                {currentStay?.status === 'arriving' && currentStay?.precheckin_token && !currentStay?.precheckin_used_at ? (
                    <Link to={`/pre-checkin/${currentStay.precheckin_token}`} className="gn-action-btn gn-action-btn--gold">
                        <div className="gn-action-btn__icon">📝</div>
                        <div className="gn-action-btn__content">
                            <span className="gn-action-btn__title">Complete Pre-Checkin</span>
                            <span className="gn-action-btn__subtitle">Skip the Front Desk</span>
                        </div>
                    </Link>
                ) : (
                    <ConditionalTooltip content="Express checkout is available during your active stay." condition={!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase())}>
                        <Link to="/guest/checkout" onClick={(e) => handleActionClick(e, 'checkout')} className={`gn-action-btn gn-action-btn--dark ${!currentStay || ["arriving", "expected", "confirmed", "checked_out", "cancelled", "no_show"].includes((currentStay.status || "").toLowerCase()) ? 'gn-action-btn--disabled' : ''}`}>
                            <div className="gn-action-btn__icon">✔️</div>
                            <div className="gn-action-btn__content">
                                <span className="gn-action-btn__title">Checkout</span>
                                <span className="gn-action-btn__subtitle">Express Exit</span>
                            </div>
                        </Link>
                    </ConditionalTooltip>
                )}
            </div>

            {/* Main Content Split (Requests + Folio) */}
            <div className="gn-feature-split">
                {/* Left: Active Requests & Live Folio */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {/* Active Requests */}
                    <div className="gn-table-card">
                        <div className="gn-table-header">
                            <h3 className="gn-table-title">Recent Requests</h3>
                            <Link to={`/stay/${currentStay?.booking_code || 'DEMO'}/menu?tab=orders&code=${currentStay?.booking_code || 'DEMO'}`} className="gn-btn-ghost">View All</Link>
                        </div>
                        {recentRequests.length > 0 ? (
                            <div className="gn-requests-list" style={{ padding: '0 1.25rem' }}>
                                {recentRequests.map(req => (
                                    <div key={req.id} className="gn-req-row">
                                        <div className="gn-req-item">
                                            <span style={{ fontSize: '1.2rem' }}>{req.type === 'ticket' ? '🛎️' : '🍽️'}</span>
                                            <span>{req.title}</span>
                                        </div>
                                        <div className={`gn-pill gn-pill--${getStatusColor(req.status)}`}>
                                            {req.status}
                                        </div>
                                        <div className="gn-req-time">{new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.5, fontStyle: 'italic' }}>
                                No active requests at the moment.
                            </div>
                        )}
                    </div>

                    {/* Live Folio */}
                    <div className="gn-table-card" style={{ padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3 className="gn-table-title" style={{ marginBottom: 0 }}>Live Folio</h3>
                        </div>
                        <div className="gn-folio" style={{ marginTop: 0 }}>
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

                            <button
                                onClick={downloadInvoice}
                                className="gn-btn-download"
                                disabled={grandTotal > 0}
                                style={{ opacity: grandTotal > 0 ? 0.6 : 1, cursor: grandTotal > 0 ? 'not-allowed' : 'pointer' }}
                            >
                                {grandTotal > 0 ? "Clear Dues to Download" : "Download Invoice"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right: Hotel Info & Contact */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {hotelAmenities && ["inhouse", "checked_in", "arriving", "expected", "confirmed"].includes((currentStay?.status || "").toLowerCase()) && (
                        <div className="gn-table-card">
                            <div className="gn-table-header">
                                <h3 className="gn-table-title">Hotel Info & Amenities</h3>
                            </div>
                            <div style={{ padding: '1.25rem' }}>
                                {hotelAmenities.wifi_ssid && (
                                    <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '1rem' }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Wi-Fi Network</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: 600 }}>{hotelAmenities.wifi_ssid}</span>
                                        </div>
                                        {hotelAmenities.wifi_password && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                                {["inhouse", "checked_in"].includes((currentStay?.status || "").toLowerCase()) ? (
                                                    <>
                                                        <span style={{ color: 'var(--text-muted)' }}>Password: {hotelAmenities.wifi_password}</span>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(hotelAmenities.wifi_password);
                                                                const el = document.getElementById('copy-btn');
                                                                if (el) { el.innerText = 'Copied!'; setTimeout(() => el.innerText = 'Copy', 2000); }
                                                            }}
                                                            id="copy-btn"
                                                            style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Copy
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>Password: <span style={{ opacity: 0.6 }}>(Available after Check-In)</span></span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {(hotelAmenities.breakfast_start || hotelAmenities.breakfast_end) && (
                                    <div style={{ paddingBottom: hotelAmenities.guest_notes ? '1rem' : '0', borderBottom: hotelAmenities.guest_notes ? '1px solid var(--border-subtle)' : 'none', marginBottom: hotelAmenities.guest_notes ? '1rem' : '0' }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>🍳 Breakfast Hours</div>
                                        <div style={{ fontWeight: 500 }}>
                                            {hotelAmenities.breakfast_start && hotelAmenities.breakfast_end
                                                ? `${formatSqlTime(hotelAmenities.breakfast_start)} - ${formatSqlTime(hotelAmenities.breakfast_end)}`
                                                : formatSqlTime(hotelAmenities.breakfast_start) || formatSqlTime(hotelAmenities.breakfast_end)}
                                        </div>
                                    </div>
                                )}
                                {hotelAmenities.guest_notes && (
                                    <div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>📌 Guest Notes</div>
                                        <div style={{ fontSize: '0.875rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                            {hotelAmenities.guest_notes}
                                        </div>
                                    </div>
                                )}
                                {propertyAmenities.length > 0 && (
                                    <div style={{ marginTop: hotelAmenities.guest_notes || hotelAmenities.breakfast_start || hotelAmenities.wifi_ssid ? '1.5rem' : '0', paddingTop: hotelAmenities.guest_notes || hotelAmenities.breakfast_start || hotelAmenities.wifi_ssid ? '1rem' : '0', borderTop: hotelAmenities.guest_notes || hotelAmenities.breakfast_start || hotelAmenities.wifi_ssid ? '1px solid var(--border-subtle)' : 'none' }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Property Amenities</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            {propertyAmenities.map((amenity: string, idx: number) => (
                                                <div key={idx} style={{ padding: '4px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '20px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span>{getAmenityIcon(amenity)}</span>
                                                    <span>{amenity}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="gn-table-card" style={{ padding: '1.5rem' }}>
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
                                    <div className="gn-support-card__content" style={{ minWidth: 0 }}>
                                        <div className="gn-support-card__title">Email Front Desk</div>
                                        <div className="gn-support-card__value" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{currentStay.hotel.email}</div>
                                    </div>
                                </a>
                            )}
                        </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
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

            {/* Premium Details Modal */}
            {isDetailsModalOpen && currentStay && createPortal(
                <div className="guestnew" style={{ position: 'relative', zIndex: 10000 }}>
                    <div className="gn-modal-overlay" onClick={() => setIsDetailsModalOpen(false)}>
                        <div className="gn-modal-content gn-premium-modal" onClick={e => e.stopPropagation()}>
                            <button className="gn-modal-close" onClick={() => setIsDetailsModalOpen(false)}>×</button>

                            <div className="gn-modal-header">
                                <h2>Booking Details</h2>
                                <div className="gn-modal-booking-code">{currentStay.booking_code}</div>
                            </div>

                            <div className="gn-modal-body">
                                <div className="gn-modal-section">
                                    <h3>{currentStay.hotel.name}</h3>
                                    <div className="gn-modal-status-row">
                                        <span className={`hero-mockup-status-pill ${currentStay.status === 'inhouse' ? 'gn-status-pill--inhouse' : 'gn-status-pill--upcoming'}`}>
                                            {currentStay.status === 'inhouse' ? '✓ CHECKED-IN' : <><span className="gn-status-dot-amber"></span> UPCOMING STAY</>}
                                        </span>
                                    </div>
                                </div>

                                <div className="gn-modal-section gn-modal-grid">
                                    <div className="gn-modal-grid-item">
                                        <span className="gn-modal-label">Check-in</span>
                                        <span className="gn-modal-value">{new Date(currentStay.check_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}<br />From 2:00 PM</span>
                                    </div>
                                    <div className="gn-modal-grid-item">
                                        <span className="gn-modal-label">Check-out</span>
                                        <span className="gn-modal-value">{new Date(currentStay.check_out).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}<br />By 11:00 AM</span>
                                    </div>
                                </div>

                                <div className="gn-modal-section gn-modal-grid">
                                    <div className="gn-modal-grid-item">
                                        <span className="gn-modal-label">
                                            {currentStay.room_numbers && currentStay.room_numbers !== 'Unassigned' ? 'Room' : 'Room Type'}
                                        </span>
                                        <span className="gn-modal-value">
                                            {currentStay.room_numbers && currentStay.room_numbers !== 'Unassigned'
                                                ? currentStay.room_numbers
                                                : (currentStay.room_types?.join(', ') || 'Standard Room')
                                            }
                                        </span>
                                    </div>
                                    <div className="gn-modal-grid-item">
                                        <span className="gn-modal-label">Guests</span>
                                        <span className="gn-modal-value">{currentStay.guests || 1} Guests</span>
                                    </div>
                                </div>

                                <div className="gn-modal-section">
                                    <h4 className="gn-modal-subsection-title">Price Breakdown</h4>
                                    <div className="gn-modal-price-row">
                                        <span>Room Charge</span>
                                        <span>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(currentStay.room_charge || 0)}</span>
                                    </div>
                                    <div className="gn-modal-price-row">
                                        <span>City Tax</span>
                                        <span>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(currentStay.city_tax || 0)}</span>
                                    </div>
                                    <div className="gn-modal-price-row gn-modal-total-row">
                                        <span>Total Estimated</span>
                                        <span>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(currentStay.total_amount || 0)}</span>
                                    </div>
                                </div>

                                <div className="gn-modal-section">
                                    <h4 className="gn-modal-subsection-title">Property Offerings</h4>
                                    <div className="gn-modal-services-preview">
                                        {menuCategories.length === 0 && serviceOfferings.length === 0 ? (
                                            <div className="gn-modal-helper-text" style={{ textAlign: 'left', opacity: 0.6, marginBottom: 0 }}>
                                                Discovering available services...
                                            </div>
                                        ) : (
                                            <>
                                                {/* Show Menu Categories */}
                                                {menuCategories.map(cat => (
                                                    <div key={cat.id} className="gn-modal-service-pill">
                                                        {getOfferingEmoji(cat.name)} {cat.name}
                                                    </div>
                                                ))}
                                                {/* Show Services (limit to 20 total offerings including categories) */}
                                                {serviceOfferings.slice(0, Math.max(0, 20 - menuCategories.length)).map(svc => (
                                                    <div key={svc.id || svc.key} className="gn-modal-service-pill">
                                                        {getOfferingEmoji(svc.label_en || svc.label || svc.key)} {svc.label_en || svc.label || svc.key}
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                    <p className="gn-modal-helper-text" style={{ marginTop: '12px', textAlign: 'left', marginBottom: 0 }}>
                                        These services and menus will be available to request directly from your dashboard once you check-in!
                                    </p>
                                </div>

                                {currentStay.status === 'arriving' && currentStay.precheckin_token && !currentStay.precheckin_used_at && (
                                    <div className="gn-modal-action-area">
                                        <p className="gn-modal-helper-text">To ensure a smooth arrival, please complete your pre-checkin before you arrive.</p>
                                        <Link to={`/pre-checkin/${currentStay.precheckin_token}`} className="gn-internal-action-button gn-internal-action--primary">
                                            <span className="icon">✓</span> Complete Pre Check-In
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
