// GuestNewStayDetails.tsx — Stay Details Screen
import { Link, useParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { requestInvoice } from "../../services/invoiceService";
import { localizeRoomType } from "../../i18n/localizeRoomType";
import { resolveLabel } from "../../i18n/resolveLabel";
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
    items: { name: string; name_i18n?: Record<string, string> | null; quantity: number; price: number }[];
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
    const { t, i18n } = useTranslation(["stayDetails", "common"]);
    const dateLocale = i18n.language?.split("-")[0] === "hi" ? "hi-IN-u-nu-latn" : "en-IN";
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
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [showGst, setShowGst] = useState(false);
    const [gstin, setGstin] = useState("");
    const [bizName, setBizName] = useState("");

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
                            setBookingId(bookingRow.id);
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

    // Format date for the on-screen UI (locale-aware). The printed Tax Invoice
    // below stays en-IN intentionally (formal financial document).
    const formatDate = (dateStr: string, timeLabel?: string | null, locale: string = dateLocale) => {
        try {
            const date = new Date(dateStr);
            const formatted = date.toLocaleDateString(locale, {
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

    // Download Invoice — server-rendered, GST-compliant PDF (render-invoice fn).
    // Optional B2B fields (guest GSTIN + business name) print on the invoice.
    const downloadInvoice = async () => {
        if (downloading) return;
        setDownloading(true);
        try {
            const { url } = await requestInvoice({
                bookingId: bookingId ?? undefined,
                gstin: gstin.trim() || undefined,
                legalName: bizName.trim() || undefined,
            });
            window.open(url, "_blank");
        } catch {
            alert(t("stayDetails:invoiceError", "Could not generate the invoice. Please try again."));
        } finally {
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title" style={{ opacity: 0.5 }}>{t("common:state.loading")}</div>
            </div>
        );
    }

    if (!stay) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title">{t("stayDetails:notFound")}</div>
                <Link to="/guest/trips" className="gn-btn gn-btn--secondary" style={{ marginTop: "1rem" }}>
                    {t("stayDetails:backToTrips")}
                </Link>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Breadcrumb Navigation */}
            <div className="gn-breadcrumb">
                <Link to="/guest/bills" className="gn-breadcrumb__link">
                    ← {t("stayDetails:breadcrumbBills")}
                </Link>
                <span className="gn-breadcrumb__sep">/</span>
                <span className="gn-breadcrumb__current">{stay.hotel.name}</span>
            </div>

            {/* Page Header */}
            <h1 className="gn-page-title">{t("stayDetails:title")}</h1>

            {/* Stay Card */}
            <div className="gn-card gn-stay-detail">
                <div className="gn-stay-detail__header">
                    <span className="gn-stay-detail__icon">🏨</span>
                    <h2 className="gn-stay-detail__title">{stay.hotel.name}</h2>
                </div>

                <div className="gn-stay-detail__room">
                    {t("stayDetails:roomLabel")} <span>{localizeRoomType(stay.room_type, i18n.language)}</span>
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
                        <span>{t("stayDetails:nights", { count: nights })}</span>
                    </div>
                    <div className="gn-stay-detail__item">
                        <span className="gn-stay-detail__item-icon">👤</span>
                        <span>
                            {t("stayDetails:adults", { count: stay.adults ?? 1 })}
                            {stay.children ? ` · ${t("stayDetails:children", { count: stay.children })}` : ""}
                        </span>
                    </div>
                </div>

                <div className="gn-stay-detail__booking-id">
                    <span>{t("stayDetails:bookingId", { code: stay.booking_code })}</span>
                    <button className="gn-stay-detail__copy" onClick={copyBookingId} title={t("stayDetails:copyBookingId")}>
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
                <h3 className="gn-bill__title">{t("stayDetails:billSummary")}</h3>

                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">{t("stayDetails:room")}</span>
                    <span className="gn-bill__row--value">{formatCurrency(billRoom)}</span>
                </div>
                {billDiscount > 0 && (
                    <div className="gn-bill__row" style={{ color: "#6ee7b7" }}>
                        <span className="gn-bill__row--label">{t("stayDetails:discount")}</span>
                        <span className="gn-bill__row--value">−{formatCurrency(billDiscount)}</span>
                    </div>
                )}
                {billSurcharge > 0 && (
                    <div className="gn-bill__row">
                        <span className="gn-bill__row--label">{t("stayDetails:surcharge")}</span>
                        <span className="gn-bill__row--value">{formatCurrency(billSurcharge)}</span>
                    </div>
                )}
                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">{billTax > 0 || !ledger ? t("stayDetails:tax") : t("stayDetails:cityTax")}</span>
                    <span className="gn-bill__row--value">{formatCurrency(billTax)}</span>
                </div>
                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">{t("stayDetails:food")}</span>
                    <span className="gn-bill__row--value">
                        {formatCurrency(ledger ? billFood : totalFoodBill)}
                    </span>
                </div>
                {billService > 0 && (
                    <div className="gn-bill__row">
                        <span className="gn-bill__row--label">{t("stayDetails:service")}</span>
                        <span className="gn-bill__row--value">{formatCurrency(billService)}</span>
                    </div>
                )}
                <div className="gn-bill__row gn-bill__row--total">
                    <span className="gn-bill__row--label">{t("stayDetails:total")}</span>
                    <span className="gn-bill__row--value">{formatCurrency(grandTotal)}</span>
                </div>

                <div className="gn-bill__action">
                    <span className="gn-bill__action-label">{t("stayDetails:downloadInvoice")}</span>
                    <button className="gn-btn gn-btn--secondary" onClick={downloadInvoice} disabled={downloading}>
                        {downloading ? t("stayDetails:generating", "Generating…") : <>⬇ {formatCurrency(grandTotal)?.replace("₹", "₹ ")} ›</>}
                    </button>
                </div>

                {/* B2B: optional GST invoice (business name + GSTIN print on the invoice) */}
                <div className="gn-bill__gst" style={{ marginTop: ".5rem" }}>
                    {!showGst ? (
                        <button type="button" className="gn-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#6b7280", fontSize: ".8rem", textDecoration: "underline" }} onClick={() => setShowGst(true)}>
                            {t("stayDetails:needGstInvoice", "Need a GST invoice? (for business / input credit)")}
                        </button>
                    ) : (
                        <div style={{ display: "grid", gap: ".4rem", marginTop: ".25rem" }}>
                            <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder={t("stayDetails:businessName", "Registered business name")}
                                style={{ padding: ".5rem .6rem", border: "1px solid #e5e7eb", borderRadius: ".5rem", fontSize: ".85rem" }} />
                            <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder={t("stayDetails:gstin", "GSTIN (15 characters)")} maxLength={15}
                                style={{ padding: ".5rem .6rem", border: "1px solid #e5e7eb", borderRadius: ".5rem", fontSize: ".85rem", textTransform: "uppercase" }} />
                            <span style={{ fontSize: ".72rem", color: "#9ca3af" }}>{t("stayDetails:gstHint", "Enter these, then tap download above to get a GST tax invoice.")}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Food Orders Section */}
            {orders.length > 0 && (
                <div className="gn-section">
                    <h3 className="gn-section-title">
                        <span style={{ marginRight: "8px" }}>🍽️</span>
                        {t("stayDetails:foodOrders")}
                    </h3>

                    {/* Total Summary Card */}
                    <div className="gn-card gn-orders-summary">
                        <div className="gn-orders-summary__total">
                            <span className="gn-orders-summary__label">{t("stayDetails:totalFoodBill")}</span>
                            <span className="gn-orders-summary__amount">
                                {formatCurrency(orders.reduce((sum, o) => sum + (o.total_amount || 0), 0))}
                            </span>
                        </div>
                        <div className="gn-orders-summary__stats">
                            <span className="gn-orders-summary__stat">
                                {t("stayDetails:ordersCount", { count: orders.length })}
                            </span>
                            <span className="gn-orders-summary__stat">
                                {t("stayDetails:itemsCount", { count: orders.reduce((sum, o) => sum + (o.total_items || 0), 0) })}
                            </span>
                        </div>
                    </div>

                    {/* Individual Orders */}
                    <div className="gn-orders-list">
                        {orders.map((order) => (
                            <div key={order.order_id} className="gn-order-card">
                                <div className="gn-order-card__header">
                                    <span className="gn-order-card__id">
                                        {t("stayDetails:orderId", { id: order.display_id })}
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
                                            {item.quantity}x {resolveLabel(item.name_i18n, i18n.language, item.name)}
                                        </span>
                                    ))}
                                    {Array.isArray(order.items) && order.items.length > 3 && (
                                        <span className="gn-order-card__item gn-order-card__item--more">
                                            {t("stayDetails:more", { count: order.items.length - 3 })}
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
                        🏨 {t("stayDetails:bookAgain", { hotel: stay.hotel.name })}
                    </Link>
                </div>
            )}

            {/* Need assistance? */}
            <div className="gn-section">
                <h3 className="gn-section-title">{t("stayDetails:needAssistance")}</h3>
                <div className="gn-support-options">
                    <Link to="/guest/support" className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">💬</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">{t("stayDetails:chatWithUs")}</div>
                        </div>
                        <span className="gn-support-option__arrow">›</span>
                    </Link>

                    <a href={`tel:${stay.hotel.phone} `} className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">📞</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">{t("stayDetails:callGuestServices")}</div>
                            <div className="gn-support-option__subtitle">{stay.hotel.phone}</div>
                        </div>
                    </a>
                </div>
            </div>
        </div>
    );
}
