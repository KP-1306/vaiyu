// GuestNewTrips.tsx — Trips / Journey Overview Screen
import { Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";

type Stay = {
    id: string;
    hotel: {
        name: string;
        city?: string;
    };
    check_in: string;
    check_out: string;
    bill_total?: number | null;
    booking_code?: string | null;
    status?: string | null;
};

type GroupedStays = {
    [key: string]: Stay[];
};

type FilterState = {
    time: "all" | "this-year" | "last-year";
    hotel: string;
    status: "all" | "completed" | "upcoming" | "cancelled";
};

export default function GuestNewTrips() {
    const { t, i18n } = useTranslation(["trips", "common"]);
    const dateLocale = i18n.language?.split("-")[0] === "hi" ? "hi-IN-u-nu-latn" : "en-US";
    const [stays, setStays] = useState<Stay[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<FilterState>({
        time: "all",
        hotel: "all",
        status: "all",
    });
    // Real account-creation year ("member since" = when the account was created,
    // not a guess from stay history). Null until loaded → line hidden, never faked.
    const [memberSince, setMemberSince] = useState<number | null>(null);

    // Fetch stays
    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                const { data: sessionData } = await supabase.auth.getSession();
                const createdAt = sessionData.session?.user?.created_at;
                if (mounted && createdAt) {
                    setMemberSince(new Date(createdAt).getFullYear());
                }

                const { data } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false });

                if (mounted && data) {
                    const mapped: Stay[] = data.map((s: any) => ({
                        id: s.id,
                        hotel: {
                            name: s.hotel_name || s.hotel?.name || "Hotel",
                            city: s.hotel_city || s.hotel?.city,
                        },
                        check_in: s.check_in,
                        check_out: s.check_out,
                        bill_total: s.bill_total,
                        booking_code: s.booking_code,
                        status: s.status,
                    }));

                    // Backfill bill_total from the folio ledger — user_recent_stays
                    // hardcodes bill_total to NULL, so without this every trip row
                    // would have no amount. Stay portion = total − food so the
                    // number reflects what was paid for the room itself.
                    const codes = mapped
                        .map((s) => s.booking_code)
                        .filter(Boolean) as string[];
                    if (codes.length > 0) {
                        const { data: bookingsRows } = await supabase
                            .from("bookings")
                            .select("id, code")
                            .in("code", codes);
                        const codeToBookingId = new Map<string, string>();
                        bookingsRows?.forEach((b: any) => codeToBookingId.set(b.code, b.id));
                        const bookingIds = Array.from(codeToBookingId.values());
                        if (bookingIds.length > 0) {
                            const { data: ledgerRows } = await supabase
                                .from("v_arrival_payment_state")
                                .select("booking_id, total_amount")
                                .in("booking_id", bookingIds);
                            const bidToStayBill = new Map<string, number>();
                            ledgerRows?.forEach((l: any) => {
                                bidToStayBill.set(l.booking_id, Number(l.total_amount) || 0);
                            });
                            for (const stay of mapped) {
                                const bid = stay.booking_code ? codeToBookingId.get(stay.booking_code) : undefined;
                                const stayBill = bid ? bidToStayBill.get(bid) : undefined;
                                if (typeof stayBill === "number" && stayBill > 0) {
                                    stay.bill_total = stayBill;
                                }
                            }
                        }
                    }

                    setStays(mapped);
                }
            } catch (err) {
                console.error("[GuestNewTrips] Error loading stays:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    // Get unique hotels for filter
    const uniqueHotels = useMemo(() => {
        const hotels = new Set(stays.map((s) => s.hotel.name));
        return Array.from(hotels);
    }, [stays]);

    // Filter stays
    const filteredStays = useMemo(() => {
        return stays.filter((stay) => {
            const year = new Date(stay.check_in).getFullYear();
            const currentYear = new Date().getFullYear();

            // Time filter
            if (filters.time === "this-year" && year !== currentYear) return false;
            if (filters.time === "last-year" && year !== currentYear - 1) return false;

            // Hotel filter
            if (filters.hotel !== "all" && stay.hotel.name !== filters.hotel) return false;

            // Status filter — driven by the real stay lifecycle status, never date
            // arithmetic (a cancelled stay with past dates must not read "completed").
            // In-house/checkout-requested stays count as upcoming (not finished yet);
            // no_show is neither completed nor cancelled, so it appears under All only.
            if (filters.status !== "all") {
                const s = (stay.status || "").toLowerCase();
                if (filters.status === "completed" && s !== "checked_out") return false;
                if (filters.status === "upcoming" && !["reserved", "arriving", "inhouse", "checkout_requested"].includes(s)) return false;
                if (filters.status === "cancelled" && s !== "cancelled") return false;
            }

            return true;
        });
    }, [stays, filters]);

    // Group stays by month
    const groupedStays: GroupedStays = useMemo(() => {
        const groups: GroupedStays = {};

        filteredStays.forEach((stay) => {
            const date = new Date(stay.check_in);
            const key = date.toLocaleDateString(dateLocale, { month: "long", year: "numeric" }).toUpperCase();

            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(stay);
        });

        return groups;
    }, [filteredStays, dateLocale]);

    // Total nights
    const totalNights = useMemo(() => {
        return stays.reduce((sum, stay) => {
            const checkin = new Date(stay.check_in);
            const checkout = new Date(stay.check_out);
            const nights = Math.ceil((checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24));
            return sum + Math.max(nights, 1);
        }, 0);
    }, [stays]);

    // Format date range
    const formatDateRange = (checkIn: string, checkOut: string) => {
        const start = new Date(checkIn);
        const end = new Date(checkOut);
        const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        const startStr = start.toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
        const endStr = end.toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" });

        return {
            range: `${startStr} – ${endStr}`,
            nights: Math.max(nights, 1),
        };
    };

    // Format currency
    const formatCurrency = (amount: number | null | undefined) => {
        if (!amount) return null;
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const resetFilters = () => {
        setFilters({ time: "all", hotel: "all", status: "all" });
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title" style={{ opacity: 0.5 }}>{t("common:state.loading")}</div>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Page Header */}
            <h1 className="gn-page-title">{t("trips:title")}</h1>
            <div className="gn-page-subtitle">
                <span>{t("trips:allStays")}</span>
                <span>·</span>
                <span>{t("trips:nights", { count: totalNights })}</span>
                {memberSince != null && (
                    <>
                        <span>·</span>
                        <span>{t("trips:memberSince", { year: memberSince })}</span>
                    </>
                )}
            </div>

            {/* Filters */}
            <div className="gn-filters">
                <button
                    className={`gn-filter ${filters.time !== "all" ? "gn-filter--active" : ""}`}
                    onClick={() =>
                        setFilters((f) => ({
                            ...f,
                            time: f.time === "all" ? "this-year" : f.time === "this-year" ? "last-year" : "all",
                        }))
                    }
                >
                    <span className="gn-filter__icon">📅</span>
                    <span>{filters.time === "all" ? t("trips:filters.allTime") : filters.time === "this-year" ? t("trips:filters.thisYear") : t("trips:filters.lastYear")}</span>
                    <span>▾</span>
                </button>

                <button
                    className={`gn-filter ${filters.hotel !== "all" ? "gn-filter--active" : ""}`}
                    onClick={() => {
                        // Cycle through hotels
                        const currentIndex = uniqueHotels.indexOf(filters.hotel);
                        const nextHotel = currentIndex === -1 ? uniqueHotels[0] :
                            currentIndex === uniqueHotels.length - 1 ? "all" : uniqueHotels[currentIndex + 1];
                        setFilters((f) => ({ ...f, hotel: nextHotel || "all" }));
                    }}
                >
                    <span className="gn-filter__icon">🏨</span>
                    <span>{filters.hotel === "all" ? t("trips:filters.allHotels") : filters.hotel}</span>
                    <span>▾</span>
                </button>

                <button
                    className={`gn-filter ${filters.status !== "all" ? "gn-filter--active" : ""}`}
                    onClick={() =>
                        setFilters((f) => ({
                            ...f,
                            status: f.status === "all" ? "completed"
                                : f.status === "completed" ? "upcoming"
                                : f.status === "upcoming" ? "cancelled"
                                : "all",
                        }))
                    }
                >
                    <span className="gn-filter__icon">📋</span>
                    <span>{filters.status === "all" ? t("trips:filters.allStatuses") : t(`trips:status.${filters.status}`)}</span>
                    <span>▾</span>
                </button>

                {(filters.time !== "all" || filters.hotel !== "all" || filters.status !== "all") && (
                    <button className="gn-btn gn-btn--ghost" onClick={resetFilters}>
                        {t("trips:filters.reset")}
                    </button>
                )}
            </div>

            {/* Grouped Stays */}
            {Object.entries(groupedStays).map(([monthYear, monthStays]) => (
                <div key={monthYear} className="gn-trip-group">
                    <div className="gn-trip-group__month">{monthYear}</div>

                    {monthStays.map((stay) => {
                        const { range, nights } = formatDateRange(stay.check_in, stay.check_out);
                        const amount = formatCurrency(stay.bill_total);

                        return (
                            <Link
                                key={stay.id}
                                to={`/guest/stay/${stay.id}`}
                                className="gn-card gn-trip-row"
                            >
                                <div className="gn-trip-row__icon">🏨</div>
                                <div className="gn-trip-row__info">
                                    <div className="gn-trip-row__hotel">{stay.hotel.name}</div>
                                    <div className="gn-trip-row__dates">
                                        {range} · {t("trips:nights", { count: nights })}
                                    </div>
                                </div>
                                {amount && <div className="gn-trip-row__amount">{amount}</div>}
                                <div className="gn-trip-row__arrow">{t("trips:viewDetails")} ›</div>
                            </Link>
                        );
                    })}
                </div>
            ))}

            {/* Empty state */}
            {Object.keys(groupedStays).length === 0 && (
                <div className="gn-card" style={{ padding: "2rem", textAlign: "center" }}>
                    <div style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                        {t("trips:empty.noMatch")}
                    </div>
                    <button className="gn-btn gn-btn--secondary" onClick={resetFilters}>
                        {t("trips:empty.clearFilters")}
                    </button>
                </div>
            )}
        </div>
    );
}
