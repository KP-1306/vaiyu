// GuestNewRewards.tsx — Rewards & Wallet Screen
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

type Voucher = {
    id: string;
    title: string;
    value: string;
    expires: string;
    hotel?: string;
};

export default function GuestNewRewards() {
    const [tier, setTier] = useState("Platinum");
    const [points, setPoints] = useState(0);
    const [memberSince, setMemberSince] = useState(2024);
    const [vouchers, setVouchers] = useState<Voucher[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                // Fetch stays to calculate points
                const { data: stays } = await supabase
                    .from("user_recent_stays")
                    .select("bill_total, check_in")
                    .order("check_in", { ascending: false });

                if (mounted && stays) {
                    // Calculate points from spend (1 point per ₹100)
                    const totalSpend = stays.reduce((sum, s) => sum + (s.bill_total || 0), 0);
                    setPoints(Math.round(totalSpend / 100));

                    // Calculate member since
                    if (stays.length > 0) {
                        const oldest = stays.reduce((min, s) => {
                            const year = new Date(s.check_in).getFullYear();
                            return year < min ? year : min;
                        }, new Date().getFullYear());
                        setMemberSince(oldest);
                    }

                    // Demo vouchers (in production, fetch from API)
                    setVouchers([
                        {
                            id: "1",
                            title: "10% Off Next Stay",
                            value: "10%",
                            expires: "Mar 2026",
                            hotel: "Any Vaiyu Property",
                        },
                        {
                            id: "2",
                            title: "Free Room Upgrade",
                            value: "Upgrade",
                            expires: "Apr 2026",
                            hotel: "Select Properties",
                        },
                    ]);
                }
            } catch (err) {
                console.error("[GuestNewRewards] Error:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

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
            <h1 className="gn-page-title">Rewards & Wallet</h1>

            {/* Tier Card */}
            <div className="gn-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
                <div className="gn-rewards__tier">
                    <div className="gn-rewards__tier-badge">👑</div>
                    <div className="gn-rewards__tier-info">
                        <div className="gn-rewards__tier-name">{tier}</div>
                        <div className="gn-rewards__tier-member-since">
                            Member since {memberSince}
                        </div>
                    </div>
                </div>
            </div>

            {/* Points Balance */}
            <div className="gn-card gn-rewards__points">
                <div>
                    <div className="gn-rewards__points-label">Available Points</div>
                    <div className="gn-rewards__points-value">
                        {points.toLocaleString()}
                    </div>
                </div>
                <button className="gn-btn gn-btn--secondary">
                    Redeem →
                </button>
            </div>

            {/* Points Breakdown */}
            <div className="gn-card" style={{ padding: "1rem", marginBottom: "2rem" }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "var(--text-sm)",
                        marginBottom: "0.5rem",
                    }}
                >
                    <span style={{ color: "var(--text-muted)" }}>Points earned this year</span>
                    <span style={{ color: "var(--text-primary)" }}>{Math.round(points * 0.4).toLocaleString()}</span>
                </div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "var(--text-sm)",
                    }}
                >
                    <span style={{ color: "var(--text-muted)" }}>Points expiring soon</span>
                    <span style={{ color: "var(--gold-400)" }}>0</span>
                </div>
            </div>

            {/* Vouchers */}
            <div className="gn-section">
                <h3 className="gn-rewards__section-title">Your Vouchers</h3>

                {vouchers.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {vouchers.map((voucher) => (
                            <div
                                key={voucher.id}
                                className="gn-card"
                                style={{
                                    padding: "1rem",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "1rem",
                                }}
                            >
                                <div
                                    style={{
                                        width: 50,
                                        height: 50,
                                        borderRadius: "var(--radius-lg)",
                                        background: "linear-gradient(135deg, var(--gold-400), var(--gold-600))",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontWeight: 700,
                                        color: "#0a0a0c",
                                        fontSize: "var(--text-sm)",
                                        flexShrink: 0,
                                    }}
                                >
                                    {voucher.value}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                                        {voucher.title}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "var(--text-xs)",
                                            color: "var(--text-muted)",
                                        }}
                                    >
                                        {voucher.hotel} · Expires {voucher.expires}
                                    </div>
                                </div>
                                <button className="gn-btn gn-btn--ghost">
                                    Use →
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div
                        className="gn-card"
                        style={{
                            padding: "2rem",
                            textAlign: "center",
                            color: "var(--text-muted)",
                        }}
                    >
                        No vouchers available right now.
                    </div>
                )}
            </div>

            {/* Next Tier Progress */}
            <div className="gn-section">
                <h3 className="gn-rewards__section-title">Next Tier Progress</h3>
                <div className="gn-card" style={{ padding: "1.5rem" }}>
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: "0.75rem",
                            fontSize: "var(--text-sm)",
                        }}
                    >
                        <span style={{ color: "var(--text-gold)" }}>{tier}</span>
                        <span style={{ color: "var(--text-muted)" }}>Diamond</span>
                    </div>
                    <div
                        style={{
                            height: 8,
                            borderRadius: 4,
                            background: "var(--bg-card-hover)",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                height: "100%",
                                width: "65%",
                                background: "linear-gradient(90deg, var(--gold-400), var(--gold-500))",
                                borderRadius: 4,
                            }}
                        />
                    </div>
                    <div
                        style={{
                            marginTop: "0.75rem",
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                        }}
                    >
                        3,500 more points to reach Diamond status
                    </div>
                </div>
            </div>
        </div>
    );
}
