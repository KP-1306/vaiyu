// GuestNewHome.tsx — Premium Guest Home Screen (Main Entry)
import { Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";

type Stay = {
    id: string;
    hotel_id?: string | null;
    status?: string | null;
    hotel: {
        name: string;
        city?: string;
        slug?: string | null;
    };
    check_in: string;
    check_out: string;
    actual_checkin_at?: string | null;
    bill_total?: number | null;
    room_type?: string | null;
    booking_code?: string | null;
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

        (async () => {
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
                                },
                                check_in: s.check_in,
                                check_out: s.check_out,
                                bill_total: s.bill_total,
                                room_type: s.room_type,
                                booking_code: s.booking_code,
                            }))
                        );

                        // Find current/active stay
                        const now = new Date();
                        const active = stays.find((s: any) => {
                            const checkin = new Date(s.check_in);
                            const checkout = new Date(s.check_out);
                            return now >= checkin && now <= checkout;
                        });

                        if (active) {
                            setCurrentStay({
                                id: active.id,
                                hotel_id: active.hotel_id,
                                status: active.status || "inhouse",
                                hotel: {
                                    name: active.hotel_name || active.hotel?.name || "Hotel",
                                    city: active.hotel_city || active.hotel?.city,
                                    slug: active.hotel_slug || active.hotel?.slug,
                                },
                                check_in: active.check_in,
                                check_out: active.check_out,
                                actual_checkin_at: active.actual_checkin_at,
                                bill_total: active.bill_total,
                                room_type: active.room_type,
                                booking_code: active.booking_code,
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
                                },
                                check_in: mostRecent.check_in,
                                check_out: mostRecent.check_out,
                                bill_total: mostRecent.bill_total,
                                room_type: mostRecent.room_type || "Standard",
                                booking_code: mostRecent.booking_code,
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("[GuestNewHome] Error loading data:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
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

    // Format checkout time
    const formatCheckoutTime = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            const today = new Date();
            const isToday = date.toDateString() === today.toDateString();
            return isToday ? "Today by 11:00 AM" : date.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
            }) + " by 11:00 AM";
        } catch {
            return "11:00 AM";
        }
    };

    // Calculate total stats
    const totalNights = useMemo(() => {
        return allStays.reduce((sum, stay) => {
            const checkin = new Date(stay.check_in);
            const checkout = new Date(stay.check_out);
            const nights = Math.ceil((checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24));
            return sum + Math.max(nights, 1);
        }, 0);
    }, [allStays]);

    const memberSince = useMemo(() => {
        if (allStays.length === 0) return 2024;
        const oldest = allStays.reduce((min, stay) => {
            const year = new Date(stay.check_in).getFullYear();
            return year < min ? year : min;
        }, new Date().getFullYear());
        return oldest;
    }, [allStays]);

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-greeting" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Greeting */}
            <h1 className="gn-greeting">
                {greeting}, {displayName}.
            </h1>

            {/* Hero Stay Card */}
            {currentStay && (
                <div className="gn-card gn-hero-stay">
                    <div className="gn-hero-stay__header">
                        <span className="gn-hero-stay__icon">🏨</span>
                        <div>
                            <h2 className="gn-hero-stay__title">
                                Your stay at {currentStay.hotel.name}
                            </h2>
                            <div className="gn-hero-stay__room">
                                Room <span>{currentStay.room_type || "Standard"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="gn-hero-stay__status">
                        {/* Check-in line: show actual if checked in */}
                        {currentStay.status === 'inhouse' && (
                            <div className="gn-hero-stay__checkin-time">
                                📅 Checked-in: {formatCheckoutTime(currentStay.actual_checkin_at || currentStay.check_in)}
                            </div>
                        )}
                        {currentStay.status !== 'inhouse' && (
                            <div className="gn-hero-stay__checkin-time">
                                📅 Check-in: {formatCheckoutTime(currentStay.check_in)}
                            </div>
                        )}

                        {/* Checkout line */}
                        <div className="gn-hero-stay__checkout-time">
                            📅 {currentStay.status === 'inhouse' ? 'Checkout' : 'Check-out'}: {formatCheckoutTime(currentStay.check_out)}
                            {currentStay.status === 'inhouse' && <span style={{ opacity: 0.6, marginLeft: 6 }}>(Scheduled)</span>}
                        </div>

                        {/* Status badge */}
                        {currentStay.status === 'inhouse' && (
                            <div className="gn-hero-stay__badge">
                                ✓ Checked-in
                            </div>
                        )}
                        {currentStay.status === 'arriving' && (
                            <div className="gn-hero-stay__badge gn-hero-stay__badge--upcoming">
                                Upcoming
                            </div>
                        )}
                        {currentStay.status === 'checked_out' && (
                            <div className="gn-hero-stay__badge gn-hero-stay__badge--completed">
                                ✓ Completed
                            </div>
                        )}
                    </div>

                    <div className="gn-hero-stay__actions">
                        <Link to={`/stay/${currentStay.booking_code || 'DEMO'}/menu?tab=services&code=${currentStay.booking_code || 'DEMO'}`} className="gn-btn gn-btn--primary">
                            🎧 Request Service
                        </Link>
                        {activeRequests > 0 && (
                            <Link to={`/stay/${currentStay.booking_code || 'DEMO'}/requests`} className="gn-btn gn-btn--secondary">
                                📋 My Requests ({activeRequests})
                            </Link>
                        )}
                        <Link to="/guestnew/checkout" className="gn-btn gn-btn--secondary">
                            🔲 Express Checkout
                        </Link>
                    </div>

                    <div className="gn-hero-stay__contact">
                        Contact <Link to="/guestnew/support">Guest Services</Link> ›
                    </div>
                </div>
            )}

            {/* Quick Actions */}
            <div className="gn-section">
                <h3 className="gn-section-title">
                    <span style={{ marginRight: "8px" }}>📋</span>
                    Quick actions
                </h3>
                <div className="gn-quick-actions">
                    <Link to="/scan" className="gn-quick-action">
                        <span className="gn-quick-action__icon">⌁</span>
                        <span className="gn-quick-action__text">Scan QR Check-in</span>
                        <span className="gn-quick-action__arrow">›</span>
                    </Link>
                    <Link to="/claim" className="gn-quick-action">
                        <span className="gn-quick-action__icon">⌕</span>
                        <span className="gn-quick-action__text">Find booking</span>
                        <span className="gn-quick-action__arrow">›</span>
                    </Link>
                    <Link to="/guestnew/bills" className="gn-quick-action">
                        <span className="gn-quick-action__icon">📄</span>
                        <span className="gn-quick-action__text">Bills</span>
                        <span className="gn-quick-action__arrow">›</span>
                    </Link>
                    <Link to="/contact" className="gn-quick-action">
                        <span className="gn-quick-action__icon">🎧</span>
                        <span className="gn-quick-action__text">Support</span>
                        <span className="gn-quick-action__arrow">›</span>
                    </Link>
                </div>
            </div>

            {/* Need something? Section */}
            <div className="gn-section">
                <h3 className="gn-section-title">Need something?</h3>
                <div className="gn-services">
                    <Link to="/guestnew/request-service?type=housekeeping" className="gn-service-chip">
                        <span className="gn-service-chip__icon">🧹</span>
                        <span>Housekeeping</span>
                        <span>›</span>
                    </Link>
                    <Link to="/guestnew/request-service?type=room-service" className="gn-service-chip">
                        <span className="gn-service-chip__icon">🍽️</span>
                        <span>Room Service</span>
                    </Link>
                    <Link to="/guestnew/request-service?type=laundry" className="gn-service-chip">
                        <span className="gn-service-chip__icon">👔</span>
                        <span>Laundry</span>
                    </Link>
                </div>
            </div>

            {/* Your Journey Link */}
            <Link to="/guestnew/trips" className="gn-journey-link">
                <span className="gn-journey-link__title">Your journey</span>
                <span className="gn-journey-link__stats">
                    {allStays.length} stays · {totalNights} nights · Member since {memberSince}
                </span>
                <span className="gn-journey-link__arrow">›</span>
            </Link>
        </div>
    );
}
