// GuestNewCheckout.tsx — Express Checkout Flow
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";

type Stay = {
    id: string;
    hotel: {
        name: string;
    };
    check_out: string;
    bill_total?: number | null;
    room_charge?: number;
    city_tax?: number;
};

export default function GuestNewCheckout() {
    const navigate = useNavigate();
    const [stay, setStay] = useState<Stay | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [completed, setCompleted] = useState(false);

    // Fetch current stay
    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                const { data } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (mounted && data) {
                    setStay({
                        id: data.id,
                        hotel: {
                            name: data.hotel_name || data.hotel?.name || "Hotel",
                        },
                        check_out: data.check_out,
                        bill_total: data.bill_total,
                        room_charge: data.room_charge || (data.bill_total ? data.bill_total * 0.97 : 0),
                        city_tax: data.city_tax || (data.bill_total ? data.bill_total * 0.03 : 0),
                    });
                }
            } catch (err) {
                console.error("[GuestNewCheckout] Error:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    // Format currency
    const formatCurrency = (amount: number | null | undefined) => {
        if (!amount && amount !== 0) return "—";
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const handleCheckout = async () => {
        setProcessing(true);

        // Simulate checkout process
        await new Promise((resolve) => setTimeout(resolve, 2000));

        setCompleted(true);
        setProcessing(false);

        // Navigate home after showing success
        setTimeout(() => {
            navigate("/guestnew");
        }, 3000);
    };

    if (loading) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title" style={{ opacity: 0.5 }}>Loading...</div>
            </div>
        );
    }

    if (completed) {
        return (
            <div className="gn-container" style={{ textAlign: "center", paddingTop: "4rem" }}>
                <div
                    style={{
                        width: 80,
                        height: 80,
                        borderRadius: "50%",
                        background: "rgba(34, 197, 94, 0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "2.5rem",
                        margin: "0 auto 1.5rem",
                    }}
                >
                    ✓
                </div>
                <h2 className="gn-page-title" style={{ marginBottom: "0.5rem" }}>
                    Checkout Complete
                </h2>
                <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
                    Thank you for staying with us!
                </p>
                <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                    A receipt has been sent to your email.
                </p>
            </div>
        );
    }

    if (!stay) {
        return (
            <div className="gn-container" style={{ paddingTop: "2rem" }}>
                <div className="gn-page-title">No active stay</div>
                <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>
                    You don't have an active stay to check out from.
                </p>
                <Link to="/guestnew" className="gn-btn gn-btn--secondary">
                    Back to Home
                </Link>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                <Link to="/guestnew" className="gn-btn gn-btn--icon gn-btn--secondary">
                    ←
                </Link>
                <h1 className="gn-page-title" style={{ marginBottom: 0 }}>
                    Express Checkout
                </h1>
            </div>

            {/* Stay Info */}
            <div className="gn-card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "1.5rem" }}>🏨</span>
                    <div>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                            {stay.hotel.name}
                        </div>
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                            Checking out today
                        </div>
                    </div>
                </div>
            </div>

            {/* Bill Summary */}
            <div className="gn-card gn-bill">
                <h3 className="gn-bill__title">Final Bill</h3>

                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">Room Charges</span>
                    <span className="gn-bill__row--value">{formatCurrency(stay.room_charge)}</span>
                </div>
                <div className="gn-bill__row">
                    <span className="gn-bill__row--label">City Tax</span>
                    <span className="gn-bill__row--value">{formatCurrency(stay.city_tax)}</span>
                </div>
                <div className="gn-bill__row gn-bill__row--total">
                    <span className="gn-bill__row--label">Total Due</span>
                    <span className="gn-bill__row--value">{formatCurrency(stay.bill_total)}</span>
                </div>
            </div>

            {/* Payment Info */}
            <div className="gn-card" style={{ padding: "1rem", marginTop: "1rem", marginBottom: "2rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ color: "var(--text-gold)" }}>💳</span>
                    <div>
                        <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                            Charged to card on file
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                            •••• •••• •••• 4242
                        </div>
                    </div>
                </div>
            </div>

            {/* Checkout Button */}
            <button
                className="gn-btn gn-btn--primary"
                style={{ width: "100%", padding: "1rem" }}
                disabled={processing}
                onClick={handleCheckout}
            >
                {processing ? "Processing..." : "Confirm Checkout"}
            </button>

            <p
                style={{
                    textAlign: "center",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    marginTop: "1rem",
                }}
            >
                By confirming, you agree to the final charges and checkout terms.
            </p>
        </div>
    );
}
