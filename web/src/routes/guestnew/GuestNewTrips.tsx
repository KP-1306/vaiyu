// GuestNewTrips.tsx — Trips / Journey Overview Screen
import { Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
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
    const [stays, setStays] = useState<Stay[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<FilterState>({
        time: "all",
        hotel: "all",
        status: "all",
    });
    const [memberSince, setMemberSince] = useState(2024);

    // Fetch stays
    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                const { data } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false });

                if (mounted && data) {
                    const mapped = data.map((s: any) => ({
                        id: s.id,
                        hotel: {
                            name: s.hotel_name || s.hotel?.name || "Hotel",
                            city: s.hotel_city || s.hotel?.city,
                        },
                        check_in: s.check_in,
                        check_out: s.check_out,
                        bill_total: s.bill_total,
                        status: s.status,
                    }));
                    setStays(mapped);

                    // Calculate member since
                    if (mapped.length > 0) {
                        const oldest = mapped.reduce((min: number, stay: Stay) => {
                            const year = new Date(stay.check_in).getFullYear();
                            return year < min ? year : min;
                        }, new Date().getFullYear());
                        setMemberSince(oldest);
                    }
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

            // Status filter
            if (filters.status !== "all") {
                const now = new Date();
                const checkout = new Date(stay.check_out);
                const checkin = new Date(stay.check_in);

                if (filters.status === "completed" && checkout > now) return false;
                if (filters.status === "upcoming" && checkin < now) return false;
                if (filters.status === "cancelled" && stay.status !== "cancelled") return false;
            }

            return true;
        });
    }, [stays, filters]);

    // Group stays by month
    const groupedStays: GroupedStays = useMemo(() => {
        const groups: GroupedStays = {};

        filteredStays.forEach((stay) => {
            const date = new Date(stay.check_in);
            const key = date.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();

            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(stay);
        });

        return groups;
    }, [filteredStays]);

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

        const startStr = start.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        const endStr = end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

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
                <div className="gn-page-title" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Page Header */}
            <h1 className="gn-page-title">Your journey with Vaiyu</h1>
            <div className="gn-page-subtitle">
                <span>All stays</span>
                <span>·</span>
                <span>{totalNights} nights</span>
                <span>·</span>
                <span>Member since {memberSince}</span>
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
                    <span>{filters.time === "all" ? "All time" : filters.time === "this-year" ? "This year" : "Last year"}</span>
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
                    <span>{filters.hotel === "all" ? "All hotels" : filters.hotel}</span>
                    <span>▾</span>
                </button>

                <button
                    className={`gn-filter ${filters.status !== "all" ? "gn-filter--active" : ""}`}
                    onClick={() =>
                        setFilters((f) => ({
                            ...f,
                            status: f.status === "all" ? "completed" : f.status === "completed" ? "upcoming" : "all",
                        }))
                    }
                >
                    <span className="gn-filter__icon">📋</span>
                    <span>{filters.status === "all" ? "All statuses" : filters.status}</span>
                    <span>▾</span>
                </button>

                {(filters.time !== "all" || filters.hotel !== "all" || filters.status !== "all") && (
                    <button className="gn-btn gn-btn--ghost" onClick={resetFilters}>
                        Reset
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
                                to={`/guestnew/stay/${stay.id}`}
                                className="gn-card gn-trip-row"
                            >
                                <div className="gn-trip-row__icon">🏨</div>
                                <div className="gn-trip-row__info">
                                    <div className="gn-trip-row__hotel">{stay.hotel.name}</div>
                                    <div className="gn-trip-row__dates">
                                        {range} · {nights} night{nights !== 1 ? "s" : ""}
                                    </div>
                                </div>
                                {amount && <div className="gn-trip-row__amount">{amount}</div>}
                                <div className="gn-trip-row__arrow">View details ›</div>
                            </Link>
                        );
                    })}
                </div>
            ))}

            {/* Empty state */}
            {Object.keys(groupedStays).length === 0 && (
                <div className="gn-card" style={{ padding: "2rem", textAlign: "center" }}>
                    <div style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                        No stays found matching your filters.
                    </div>
                    <button className="gn-btn gn-btn--secondary" onClick={resetFilters}>
                        Clear filters
                    </button>
                </div>
            )}
        </div>
    );
}
