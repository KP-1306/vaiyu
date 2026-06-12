// GuestNewStayDetails.tsx — Stay Details Screen
import { Link, useParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import RequestExtensionButton from "../../components/guest/RequestExtensionButton";
import { formatIstDateTime } from "../../utils/dateUtils";
import { formatPolicyTime } from "../../utils/policyTime";

type Stay = {
    id: string;
    hotel: {
        name: string;
        city?: string;
        phone?: string;
    };
    check_in: string;
    check_out: string;
    bill_total?: number | null;
    room_type?: string | null;
    booking_code?: string | null;
    hotel_slug?: string | null;
    status?: string | null;
    adults?: number;
    children?: number;
    room_charge?: number;
    city_tax?: number;
};

type FoodOrder = {
    order_id: string;
    display_id: string;
    status: string;
    created_at: string;
    total_amount: number;
    currency: string;
    items: { name: string; quantity: number; price: number }[];
    total_items: number;
};

type LedgerBreakdown = {
    room_charges: number;
    food_charges: number;
    service_charges: number;
    tax_amount: number;
    discount_amount: number;
    surcharge_amount: number;
    total_amount: number;
    paid_amount: number;
};

export default function GuestNewStayDetails() {
    const { id } = useParams<{ id: string }>();
    const [stay, setStay] = useState<Stay | null>(null);
    // Real hotel policy times (null when the hotel hasn't configured them → date only).
    const [checkinTime, setCheckinTime] = useState<string | null>(null);
    const [checkoutTime, setCheckoutTime] = useState<string | null>(null);
    const [orders, setOrders] = useState<FoodOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    // Per-entry-type breakdown from v_arrival_payment_state (post-walk-in-v2
    // bookings have ROOM_CHARGE / ADJUSTMENT / TAX as folio entries; older
    // bookings have nothing, in which case we fall back to stay.bill_total
    // and the legacy 97/3 split below).
    const [ledger, setLedger] = useState<LedgerBreakdown | null>(null);

    // Fetch stay details and food orders
    useEffect(() => {
        let mounted = true;

        (async () => {
            if (!id) return;

            try {
                // First try to find by booking_code (which is typically used in URLs)
                let { data } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .eq("booking_code", id)
                    .maybeSingle();

                // If not found by booking_code, try by id
                if (!data) {
                    const result = await supabase
                        .from("user_recent_stays")
                        .select("*")
                        .eq("id", id)
                        .maybeSingle();
                    data = result.data;
                }

                if (mounted && data) {
                    const bookingCode = data.booking_code || data.id?.slice(0, 12).toUpperCase();

                    setStay({
                        id: data.id,
                        hotel: {
                            name: data.hotel_name || data.hotel?.name || "Hotel",
                            city: data.hotel_city || data.hotel?.city,
                            phone: data.hotel_phone || "",
                        },
                        check_in: data.check_in,
                        check_out: data.check_out,
                        bill_total: data.bill_total,
                        room_type: data.room_type || "Standard",
                        booking_code: bookingCode,
                        hotel_slug: data.hotel_slug ?? null,
                        status: data.status ?? null,
                        // Real party size from the booking (bookings.adults_total/
                        // children_total), surfaced via user_recent_stays. Falls back
                        // to the booking column default (1 adult) only when genuinely
                        // absent — never a fabricated constant.
                        adults: data.adults_total ?? 1,
                        children: data.children_total ?? 0,
                        room_charge: data.room_charge || (data.bill_total ? data.bill_total * 0.97 : 0),
                        city_tax: data.city_tax || (data.bill_total ? data.bill_total * 0.03 : 0),
                    });

                    // Real hotel check-in/out policy times from the guest-safe view
                    // (v_public_hotels already exposes them). Date-only if unset.
                    if (data.hotel_id) {
                        const { data: ht } = await supabase
                            .from("v_public_hotels")
                            .select("default_checkin_time, default_checkout_time")
                            .eq("id", data.hotel_id)
                            .maybeSingle();
                        if (mounted) {
                            setCheckinTime(formatPolicyTime(ht?.default_checkin_time));
                            setCheckoutTime(formatPolicyTime(ht?.default_checkout_time));
                        }
                    }

                    // Fetch food orders for this stay
                    if (bookingCode) {
                        const { data: ordersData } = await supabase
                            .from("v_guest_food_orders")
                            .select("*")
                            .eq("booking_code", bookingCode)
                            .order("created_at", { ascending: false });

                        if (mounted && ordersData) {
                            setOrders(ordersData);
                        }

                        // Resolve booking_id via the booking code so we can
                        // pull the per-entry-type folio breakdown. user_recent_stays
                        // doesn't expose booking_id directly. If RLS blocks this
                        // read for some reason, the fallback path keeps the page
                        // functional (legacy 97/3 synthesis from bill_total).
                        const { data: bookingRow } = await supabase
                            .from("bookings")
                            .select("id")
                            .eq("code", bookingCode)
                            .maybeSingle();

                        if (mounted && bookingRow?.id) {
                            const { data: ledgerRow } = await supabase
                                .from("v_arrival_payment_state")
                                .select(
                                    "room_charges, food_charges, service_charges, tax_amount, discount_amount, surcharge_amount, total_amount, paid_amount",
                                )
                                .eq("booking_id", bookingRow.id)
                                .maybeSingle();

                            if (mounted && ledgerRow) {
                                setLedger({
                                    room_charges: Number(ledgerRow.room_charges) || 0,
                                    food_charges: Number(ledgerRow.food_charges) || 0,
                                    service_charges: Number(ledgerRow.service_charges) || 0,
                                    tax_amount: Number(ledgerRow.tax_amount) || 0,
                                    discount_amount: Number(ledgerRow.discount_amount) || 0,
                                    surcharge_amount: Number(ledgerRow.surcharge_amount) || 0,
                                    total_amount: Number(ledgerRow.total_amount) || 0,
                                    paid_amount: Number(ledgerRow.paid_amount) || 0,
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("[GuestNewStayDetails] Error loading stay:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [id]);

    // Format date
    const formatDate = (dateStr: string, timeLabel?: string | null) => {
        try {
            const date = new Date(dateStr);
            const formatted = date.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
            });
            return timeLabel ? `${formatted} ~ ${timeLabel}` : formatted;
        } catch {
            return dateStr;
        }
    };

    // Calculate nights
    const nights = useMemo(() => {
        if (!stay) return 1;
        const checkin = new Date(stay.check_in);
        const checkout = new Date(stay.check_out);
        return Math.max(Math.ceil((checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24)), 1);
    }, [stay]);

    // Format currency
    const formatCurrency = (amount: number | null | undefined) => {
        if (!amount && amount !== 0) return "—";
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Copy booking ID
    const copyBookingId = async () => {
        if (stay?.booking_code) {
            await navigator.clipboard.writeText(stay.booking_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Calculate total bill — prefer ledger (real folio) values, fall back to
    // the legacy 97/3 synthesis from bill_total for older bookings whose
    // room/tax never landed in folio_entries.
    const totalFoodBill = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const billRoom = ledger && ledger.room_charges > 0
        ? ledger.room_charges
        : (stay?.room_charge || 0);
    const billTax = ledger && ledger.tax_amount > 0
        ? ledger.tax_amount
        : (stay?.city_tax || 0);
    const billFood = ledger ? ledger.food_charges : 0;
    const billService = ledger ? ledger.service_charges : 0;
    const billDiscount = ledger ? ledger.discount_amount : 0;
    const billSurcharge = ledger ? ledger.surcharge_amount : 0;
    // When ledger has values, trust it as the source of truth (it already
    // includes food). When ledger is missing, fall back to bill_total + foodBill
    // for backwards compatibility with pre-walk-in-v2 stays.
    const grandTotal = ledger
        ? (billRoom + billTax + billFood + billService + billSurcharge - billDiscount)
        : ((stay?.bill_total || 0) + totalFoodBill);

    // Download/Print Invoice
    const downloadInvoice = () => {
        if (!stay) return;

        const invoiceWindow = window.open("", "_blank");
        if (!invoiceWindow) return;

        const invoiceHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Invoice - ${stay.booking_code}</title>
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
            <img src="/brand/vaiyu-logo.webp" alt="Vaiyu" onerror="this.style.display='none'" />
            <span>Vaiyu</span>
        </div>
        <div class="platform-tagline">Tax Invoice</div>
    </div>

    <!-- Hotel & Booking Details -->
    <div class="header">
        <div>
            <h1>${stay.hotel.name}</h1>
            <div class="subtitle">${stay.hotel.city || ""}</div>
        </div>
        <div class="booking-id">
            <div class="booking-label">Booking ID</div>
            <div>${stay.booking_code}</div>
        </div>
    </div>
    
    <div class="section">
        <div class="dates">
            <div class="date-item">
                <div class="date-label">Check-in</div>
                <div>${formatDate(stay.check_in)}</div>
            </div>
            <div class="date-item">
                <div class="date-label">Check-out</div>
                <div>${formatDate(stay.check_out)}</div>
            </div>
            <div class="date-item">
                <div class="date-label">Nights</div>
                <div>${nights}</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">Stay Charges</div>
        <div class="row"><span>Room</span><span>${formatCurrency(billRoom)}</span></div>
        ${billDiscount > 0 ? `<div class="row" style="color:#0a8a4a"><span>Discount</span><span>-${formatCurrency(billDiscount)}</span></div>` : ""}
        ${billSurcharge > 0 ? `<div class="row"><span>Surcharge</span><span>${formatCurrency(billSurcharge)}</span></div>` : ""}
        <div class="row"><span>${billTax > 0 || !ledger ? "Tax" : "City Tax"}</span><span>${formatCurrency(billTax)}</span></div>
        ${billService > 0 ? `<div class="row"><span>Service</span><span>${formatCurrency(billService)}</span></div>` : ""}
    </div>
    
    ${orders.length > 0 ? `
    <div class="section">
        <div class="section-title">Food Orders (${orders.length})</div>
        ${orders.map(o => `
            <div class="row"><span>Order #${o.display_id}</span><span>${formatCurrency(o.total_amount)}</span></div>
        `).join("")}
    </div>
    ` : ""}
    
    <div class="section">
        <div class="row total"><span>Grand Total</span><span>${formatCurrency(grandTotal)}</span></div>
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
                <div className="gn-page-title" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    if (!stay) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title">Stay not found</div>
                <Link to="/guest/trips" className="gn-btn gn-btn--secondary" style={{ marginTop: "1rem" }}>
                    Back to trips
                </Link>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Breadcrumb Navigation */}
            <div className="gn-breadcrumb">
                <Link to="/guest/bills" className="gn-breadcrumb__link">
                    ← Bills
                </Link>
                <span className="gn-breadcrumb__sep">/</span>
                <span className="gn-breadcrumb__current">{stay.hotel.name}</span>
            </div>

            {/* Page Header */}
            <h1 className="gn-page-title">Stay Details</h1>

            {/* Stay Card */}
            <div className="gn-card gn-stay-detail">
                <div className="gn-stay-detail__header">
                    <span className="gn-stay-detail__icon">🏨</span>
                    <h2 className="gn-stay-detail__title">{stay.hotel.name}</h2>
                </div>

                <div className="gn-stay-detail__room">
                    Room <span>{stay.room_type}</span>
                </div>

                <div className="gn-stay-detail__grid">
                    <div className="gn-stay-detail__item">
                        <span className="gn-stay-detail__item-icon">📅</span>
                        <span>{formatDate(stay.check_in, checkinTime)}</span>
                    </div>
                    <div className="gn-stay-detail__item">
                        <span className="gn-stay-detail__item-icon">📅</span>
                        <span>{formatDate(stay.check_out, checkoutTime)} ↗</span>
                    </div>
                    <div className="gn-stay-detail__item">
                        <span className="gn-stay-detail__item-icon">🌙</span>
                        <span>{nights} Night{nights !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="gn-stay-detail__item">
                        <span className="gn-stay-detail__item-icon">👤</span>
                        <span>
                            {(stay.adults ?? 1)} Adult{(stay.adults ?? 1) !== 1 ? "s" : ""}
                            {stay.children ? ` · ${stay.children} Child${stay.children !== 1 ? "ren" : ""}` : ""}
                        </span>
                    </div>
                </div>

                <div className="gn-stay-detail__booking-id">
                    <span>Booking ID: {stay.booking_code}</span>
                    <button className="gn-stay-detail__copy" onClick={copyBookingId} title="Copy booking ID">
                        {copied ? "✓" : "📋"}
                    </button>
                </div>

                {/* Stay extension — guest can request more nights; front desk approves. */}
                <div className="mt-4">
                    <RequestExtensionButton
                        stayId={stay.id}
                        currentCheckoutAt={stay.check_out}
                    />
                </div>
            </div>

            {/* Bill Summary */}
            <div className="gn-card gn-bill">
                <h3 className="gn-bill__title">Bill summary</h3>

                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">Room</span>
                    <span className="gn-bill__row--value">{formatCurrency(billRoom)}</span>
                </div>
                {billDiscount > 0 && (
                    <div className="gn-bill__row" style={{ color: "#6ee7b7" }}>
                        <span className="gn-bill__row--label">Discount</span>
                        <span className="gn-bill__row--value">−{formatCurrency(billDiscount)}</span>
                    </div>
                )}
                {billSurcharge > 0 && (
                    <div className="gn-bill__row">
                        <span className="gn-bill__row--label">Surcharge</span>
                        <span className="gn-bill__row--value">{formatCurrency(billSurcharge)}</span>
                    </div>
                )}
                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">{billTax > 0 || !ledger ? "Tax" : "City Tax"}</span>
                    <span className="gn-bill__row--value">{formatCurrency(billTax)}</span>
                </div>
                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">Food</span>
                    <span className="gn-bill__row--value">
                        {formatCurrency(ledger ? billFood : totalFoodBill)}
                    </span>
                </div>
                {billService > 0 && (
                    <div className="gn-bill__row">
                        <span className="gn-bill__row--label">Service</span>
                        <span className="gn-bill__row--value">{formatCurrency(billService)}</span>
                    </div>
                )}
                <div className="gn-bill__row gn-bill__row--total">
                    <span className="gn-bill__row--label">Total</span>
                    <span className="gn-bill__row--value">{formatCurrency(grandTotal)}</span>
                </div>

                <div className="gn-bill__action">
                    <span className="gn-bill__action-label">Download invoice</span>
                    <button className="gn-btn gn-btn--secondary" onClick={downloadInvoice}>
                        ⬇ {formatCurrency(grandTotal)?.replace("₹", "₹ ")} ›
                    </button>
                </div>
            </div>

            {/* Food Orders Section */}
            {orders.length > 0 && (
                <div className="gn-section">
                    <h3 className="gn-section-title">
                        <span style={{ marginRight: "8px" }}>🍽️</span>
                        Food Orders
                    </h3>

                    {/* Total Summary Card */}
                    <div className="gn-card gn-orders-summary">
                        <div className="gn-orders-summary__total">
                            <span className="gn-orders-summary__label">Total Food Bill</span>
                            <span className="gn-orders-summary__amount">
                                {formatCurrency(orders.reduce((sum, o) => sum + (o.total_amount || 0), 0))}
                            </span>
                        </div>
                        <div className="gn-orders-summary__stats">
                            <span className="gn-orders-summary__stat">
                                {orders.length} Order{orders.length !== 1 ? "s" : ""}
                            </span>
                            <span className="gn-orders-summary__stat">
                                {orders.reduce((sum, o) => sum + (o.total_items || 0), 0)} Items
                            </span>
                        </div>
                    </div>

                    {/* Individual Orders */}
                    <div className="gn-orders-list">
                        {orders.map((order) => (
                            <div key={order.order_id} className="gn-order-card">
                                <div className="gn-order-card__header">
                                    <span className="gn-order-card__id">
                                        Order #{order.display_id}
                                    </span>
                                    <span className={`gn - order - card__status gn - order - card__status--${order.status?.toLowerCase()} `}>
                                        {order.status}
                                    </span>
                                    <span className="gn-order-card__amount">
                                        {formatCurrency(order.total_amount)}
                                    </span>
                                </div>
                                <div className="gn-order-card__time">
                                    🕐 {formatIstDateTime(order.created_at)}
                                </div>
                                <div className="gn-order-card__items">
                                    {Array.isArray(order.items) && order.items.slice(0, 3).map((item, i) => (
                                        <span key={i} className="gn-order-card__item">
                                            {item.quantity}x {item.name}
                                        </span>
                                    ))}
                                    {Array.isArray(order.items) && order.items.length > 3 && (
                                        <span className="gn-order-card__item gn-order-card__item--more">
                                            +{order.items.length - 3} more
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Book Again — completed stays only. Routes into the public enquiry
                funnel (→ leads-public-capture → Lead CRM) with source attribution,
                so the hotel sees this lead is a returning guest. */}
            {(stay.status || "").toLowerCase() === "checked_out" && stay.hotel_slug && (
                <div className="gn-section">
                    <Link
                        to={`/p/${stay.hotel_slug}/enquire?utm_source=guest_portal_rebook`}
                        className="gn-btn gn-btn--primary"
                        style={{ width: "100%", textAlign: "center", display: "block" }}
                    >
                        🏨 Book {stay.hotel.name} again
                    </Link>
                </div>
            )}

            {/* Need assistance? */}
            <div className="gn-section">
                <h3 className="gn-section-title">Need assistance?</h3>
                <div className="gn-support-options">
                    <Link to="/guest/support" className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">💬</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">Chat with Us</div>
                        </div>
                        <span className="gn-support-option__arrow">›</span>
                    </Link>

                    <a href={`tel:${stay.hotel.phone} `} className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">📞</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">Call Guest Services</div>
                            <div className="gn-support-option__subtitle">{stay.hotel.phone}</div>
                        </div>
                    </a>
                </div>
            </div>
        </div>
    );
}
