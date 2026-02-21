// GuestNewBills.tsx — Bills and Orders for all stays
import { Link, useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";

type Stay = {
    id: string;
    hotel_id: string;
    hotel_name: string;
    hotel_slug?: string;
    check_in: string;
    check_out: string;
    bill_total: number | null;
    room_type?: string;
    booking_code?: string;
    status?: string;
};

type FoodOrder = {
    id: string;
    stay_id: string;
    hotel_name: string;
    created_at: string;
    total_amount: number;
    status: string;
    item_count: number;
    display_id?: string;
    booking_code?: string;
};

export default function GuestNewBills() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [stays, setStays] = useState<Stay[]>([]);
    const [orders, setOrders] = useState<FoodOrder[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter state
    const [selectedHotel, setSelectedHotel] = useState<string>(searchParams.get("hotel") || "all");
    const [selectedYear, setSelectedYear] = useState<string>(searchParams.get("year") || "all");
    const [activeTab, setActiveTab] = useState<"stays" | "orders">("stays");

    // Fetch stays and orders
    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                // Fetch stays
                const { data: staysData } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false });

                if (mounted && staysData) {
                    const mappedStays = staysData.map((s: any) => ({
                        id: s.id,
                        hotel_id: s.hotel_id,
                        hotel_name: s.hotel_name || s.hotel?.name || "Hotel",
                        hotel_slug: s.hotel_slug || s.hotel?.slug,
                        check_in: s.check_in,
                        check_out: s.check_out,
                        bill_total: s.bill_total,
                        room_type: s.room_type,
                        booking_code: s.booking_code,
                        status: s.status,
                    }));
                    setStays(mappedStays);

                    // Get booking codes for fetching orders
                    const bookingCodes = mappedStays
                        .map((s) => s.booking_code)
                        .filter(Boolean);

                    if (bookingCodes.length > 0) {
                        // Fetch food orders using the view (has proper RLS)
                        const { data: ordersData, error: ordersError } = await supabase
                            .from("v_guest_food_orders")
                            .select("*")
                            .in("booking_code", bookingCodes)
                            .order("created_at", { ascending: false });

                        if (ordersError) {
                            console.error("[GuestNewBills] Orders error:", ordersError);
                        }

                        if (mounted && ordersData) {
                            // Create a booking code to stay mapping
                            const bookingCodeToStay = new Map(
                                mappedStays.map(s => [s.booking_code, s])
                            );

                            setOrders(
                                ordersData.map((o: any) => {
                                    const stay = bookingCodeToStay.get(o.booking_code);
                                    return {
                                        id: o.order_id,
                                        stay_id: stay?.id || "",
                                        hotel_name: stay?.hotel_name || "Hotel",
                                        created_at: o.created_at,
                                        total_amount: o.total_amount || 0,
                                        status: o.status,
                                        item_count: o.total_items || 0,
                                        display_id: o.display_id,
                                        booking_code: o.booking_code,
                                    };
                                })
                            );
                        }
                    }
                }
            } catch (err) {
                console.error("[GuestNewBills] Error loading data:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    // Get unique hotels and years for filters
    const hotels = useMemo(() => {
        const hotelMap = new Map<string, string>();
        stays.forEach((s) => {
            if (s.hotel_id && s.hotel_name) {
                hotelMap.set(s.hotel_id, s.hotel_name);
            }
        });
        return Array.from(hotelMap.entries());
    }, [stays]);

    const years = useMemo(() => {
        const yearSet = new Set<number>();
        stays.forEach((s) => {
            yearSet.add(new Date(s.check_in).getFullYear());
        });
        return Array.from(yearSet).sort((a, b) => b - a);
    }, [stays]);

    // Filter stays
    const filteredStays = useMemo(() => {
        return stays.filter((s) => {
            const matchHotel = selectedHotel === "all" || s.hotel_id === selectedHotel;
            const matchYear = selectedYear === "all" || new Date(s.check_in).getFullYear().toString() === selectedYear;
            return matchHotel && matchYear;
        });
    }, [stays, selectedHotel, selectedYear]);

    // Filter orders
    const filteredOrders = useMemo(() => {
        return orders.filter((o) => {
            const stay = stays.find(s => s.id === o.stay_id);
            const matchHotel = selectedHotel === "all" || stay?.hotel_id === selectedHotel;
            const matchYear = selectedYear === "all" || new Date(o.created_at).getFullYear().toString() === selectedYear;
            return matchHotel && matchYear;
        });
    }, [orders, stays, selectedHotel, selectedYear]);

    // Group orders by booking code (stay)
    type OrderGroup = {
        booking_code: string;
        hotel_name: string;
        order_count: number;
        total_amount: number;
        total_items: number;
        check_in?: string;
        check_out?: string;
    };

    const groupedOrders = useMemo((): OrderGroup[] => {
        const groups = new Map<string, OrderGroup>();

        filteredOrders.forEach((order) => {
            const code = order.booking_code || "unknown";
            const existing = groups.get(code);

            if (existing) {
                existing.order_count += 1;
                existing.total_amount += order.total_amount;
                existing.total_items += order.item_count;
            } else {
                const stay = stays.find(s => s.booking_code === code);
                groups.set(code, {
                    booking_code: code,
                    hotel_name: order.hotel_name || stay?.hotel_name || "Hotel",
                    order_count: 1,
                    total_amount: order.total_amount,
                    total_items: order.item_count,
                    check_in: stay?.check_in,
                    check_out: stay?.check_out,
                });
            }
        });

        return Array.from(groups.values()).sort((a, b) => {
            // Sort by most recent check_in
            return new Date(b.check_in || 0).getTime() - new Date(a.check_in || 0).getTime();
        });
    }, [filteredOrders, stays]);

    // Calculate totals
    const totalBills = useMemo(() => {
        return filteredStays.reduce((sum, s) => sum + (s.bill_total || 0), 0);
    }, [filteredStays]);

    const totalOrders = useMemo(() => {
        return filteredOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    }, [filteredOrders]);

    const handleFilterChange = (hotel: string, year: string) => {
        setSelectedHotel(hotel);
        setSelectedYear(year);
        const params = new URLSearchParams();
        if (hotel !== "all") params.set("hotel", hotel);
        if (year !== "all") params.set("year", year);
        setSearchParams(params);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
        });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-greeting" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Header */}
            <div className="gn-page-header">
                <h1 className="gn-page-title">Bills & Orders</h1>
                <p className="gn-page-subtitle">
                    View all your stay bills and food orders
                </p>
            </div>

            {/* Summary Card */}
            <div className="gn-card gn-bills-summary">
                <div className="gn-bills-summary__item">
                    <span className="gn-bills-summary__label">Total Stay Bills</span>
                    <span className="gn-bills-summary__value">{formatCurrency(totalBills)}</span>
                    <span className="gn-bills-summary__count">{filteredStays.length} stays</span>
                </div>
                <div className="gn-bills-summary__divider" />
                <div className="gn-bills-summary__item">
                    <span className="gn-bills-summary__label">Total Food Orders</span>
                    <span className="gn-bills-summary__value">{formatCurrency(totalOrders)}</span>
                    <span className="gn-bills-summary__count">{filteredOrders.length} orders</span>
                </div>
            </div>

            {/* Filters */}
            <div className="gn-filters">
                <select
                    className="gn-filter-select"
                    value={selectedHotel}
                    onChange={(e) => handleFilterChange(e.target.value, selectedYear)}
                >
                    <option value="all">All Hotels</option>
                    {hotels.map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                    ))}
                </select>

                <select
                    className="gn-filter-select"
                    value={selectedYear}
                    onChange={(e) => handleFilterChange(selectedHotel, e.target.value)}
                >
                    <option value="all">All Years</option>
                    {years.map((year) => (
                        <option key={year} value={year.toString()}>{year}</option>
                    ))}
                </select>

                {(selectedHotel !== "all" || selectedYear !== "all") && (
                    <button
                        className="gn-btn gn-btn--ghost"
                        onClick={() => handleFilterChange("all", "all")}
                    >
                        Reset
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="gn-tabs">
                <button
                    className={`gn-tab ${activeTab === "stays" ? "gn-tab--active" : ""}`}
                    onClick={() => setActiveTab("stays")}
                >
                    Stay Bills ({filteredStays.length})
                </button>
                <button
                    className={`gn-tab ${activeTab === "orders" ? "gn-tab--active" : ""}`}
                    onClick={() => setActiveTab("orders")}
                >
                    Food Orders ({filteredOrders.length})
                </button>
            </div>

            {/* Stay Bills List */}
            {activeTab === "stays" && (
                <div className="gn-bills-list">
                    {filteredStays.length === 0 ? (
                        <div className="gn-empty-state">
                            <span>📋</span>
                            <p>No stay bills found</p>
                        </div>
                    ) : (
                        filteredStays.map((stay) => (
                            <Link
                                key={stay.id}
                                to={`/guest/stay/${stay.booking_code || stay.id}`}
                                className="gn-bill-row"
                            >
                                <div className="gn-bill-row__main">
                                    <div className="gn-bill-row__hotel">{stay.hotel_name}</div>
                                    <div className="gn-bill-row__dates">
                                        {formatDate(stay.check_in)} – {formatDate(stay.check_out)}
                                    </div>
                                    <div className="gn-bill-row__room">
                                        {stay.room_type || "Standard Room"}
                                    </div>
                                </div>
                                <div className="gn-bill-row__amount">
                                    {stay.bill_total ? formatCurrency(stay.bill_total) : "—"}
                                </div>
                                <span className="gn-bill-row__arrow">›</span>
                            </Link>
                        ))
                    )}
                </div>
            )}

            {/* Food Orders List */}
            {activeTab === "orders" && (
                <div className="gn-bills-list">
                    {groupedOrders.length === 0 ? (
                        <div className="gn-empty-state">
                            <span>🍽️</span>
                            <p>No food orders found</p>
                        </div>
                    ) : (
                        groupedOrders.map((group) => (
                            <Link
                                key={group.booking_code}
                                to={`/guest/stay/${group.booking_code}`}
                                className="gn-bill-row"
                            >
                                <div className="gn-bill-row__main">
                                    <div className="gn-bill-row__hotel">{group.hotel_name}</div>
                                    <div className="gn-bill-row__dates">
                                        {group.check_in && group.check_out
                                            ? `${formatDate(group.check_in)} – ${formatDate(group.check_out)}`
                                            : `Stay: ${group.booking_code}`
                                        }
                                    </div>
                                    <div className="gn-bill-row__room">
                                        {group.order_count} order{group.order_count !== 1 ? "s" : ""} · {group.total_items} items
                                    </div>
                                </div>
                                <div className="gn-bill-row__amount">
                                    {formatCurrency(group.total_amount)}
                                </div>
                                <span className="gn-bill-row__arrow">›</span>
                            </Link>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
