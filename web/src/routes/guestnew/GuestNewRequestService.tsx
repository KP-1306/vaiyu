// GuestNewRequestService.tsx — Request Service Flow (In-Stay Only)
//
// Submits a REAL service-request ticket via create_service_request (wrapped by
// lib/api.createTicket), linked to the guest's active in-house stay + room so it
// reaches the front desk, shows in Track Requests, and participates in the
// checkout "open requests" guard. The options are the hotel's actual `services`
// catalog (not hardcoded categories) so each maps to a real department + SLA.
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { createTicket } from "../../lib/api";

type Service = {
    id: string;
    label: string;
    description: string | null;
    requires_description: boolean;
};

type ActiveStay = {
    stay_id: string;
    hotel_id: string;
    room_id: string | null;
    room_number: string | null;
};

/** Lightweight emoji per service, derived from its label keyword (the catalog
 *  has no icon column). Purely cosmetic; falls back to a generic bell. */
function iconFor(label: string): string {
    const l = label.toLowerCase();
    if (/clean|housekeep|tidy/.test(l)) return "🧹";
    if (/towel|linen|sheet|bed/.test(l)) return "🛏️";
    if (/ac|cool|heat|temperature/.test(l)) return "❄️";
    if (/plumb|bath|water|toilet|leak/.test(l)) return "🚿";
    if (/food|dining|meal|breakfast|room service/.test(l)) return "🍽️";
    if (/laundry|wash|press|iron/.test(l)) return "👔";
    if (/wifi|internet|tv|electr|light|power/.test(l)) return "🔌";
    if (/maintenance|repair|fix|technical/.test(l)) return "🔧";
    return "🛎️";
}

export default function GuestNewRequestService() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const preselectedKey = searchParams.get("type");

    const [loading, setLoading] = useState(true);
    const [stay, setStay] = useState<ActiveStay | null>(null);
    const [services, setServices] = useState<Service[]>([]);
    const [selectedService, setSelectedService] = useState<string | null>(null);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Resolve the guest's active in-house stay, then load that hotel's services.
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const { data: stays } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false })
                    .limit(20);

                const active = (stays ?? []).find((s: any) =>
                    ["inhouse", "checked_in", "partially_arrived", "checkout_requested"].includes(
                        (s.status ?? "").toLowerCase(),
                    ),
                );
                if (!active) {
                    if (mounted) setLoading(false);
                    return;
                }

                // room_id isn't on the view — read it (plus hotel) from the stay row.
                const { data: stayRow } = await supabase
                    .from("stays")
                    .select("hotel_id, room_id")
                    .eq("id", active.id)
                    .single();

                const hotelId = stayRow?.hotel_id ?? active.hotel_id;
                if (mounted) {
                    setStay({
                        stay_id: active.id,
                        hotel_id: hotelId,
                        room_id: stayRow?.room_id ?? null,
                        room_number: active.room_number ?? null,
                    });
                }

                const { data: svc } = await supabase
                    .from("services")
                    .select("id, label, description, requires_description")
                    .eq("hotel_id", hotelId)
                    .eq("active", true)
                    .order("label", { ascending: true });

                if (mounted && svc) setServices(svc as Service[]);
            } catch (e: unknown) {
                if (mounted) setError(e instanceof Error ? e.message : "Could not load services.");
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    // Honour a ?type= deep-link once services are loaded (match by key/label).
    useEffect(() => {
        if (!preselectedKey || services.length === 0 || selectedService) return;
        const match = services.find(
            (s) => s.id === preselectedKey || s.label.toLowerCase().includes(preselectedKey.toLowerCase()),
        );
        if (match) setSelectedService(match.id);
    }, [preselectedKey, services, selectedService]);

    const selected = useMemo(
        () => services.find((s) => s.id === selectedService) ?? null,
        [services, selectedService],
    );

    const handleSubmit = async () => {
        if (!selectedService || !stay) return;
        if (!stay.room_id) {
            setError("No room is assigned to your stay yet. Please contact the front desk.");
            return;
        }
        if (selected?.requires_description && !notes.trim()) {
            setError("Please add a short description for this request.");
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            await createTicket({
                hotelId: stay.hotel_id,
                stayId: stay.stay_id,
                serviceId: selectedService,
                roomId: stay.room_id,
                details: notes.trim() || null,
                source: "GUEST",
                created_by_id: user?.id ?? null,
            });
            setSubmitted(true);
            setTimeout(() => navigate("/guest"), 2200);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Could not submit your request. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="gn-container" style={{ textAlign: "center", paddingTop: "4rem" }}>
                <div
                    style={{
                        width: 80, height: 80, borderRadius: "50%",
                        background: "rgba(34, 197, 94, 0.15)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "2.5rem", margin: "0 auto 1.5rem",
                    }}
                >
                    ✓
                </div>
                <h2 className="gn-page-title" style={{ marginBottom: "0.5rem" }}>Request Submitted</h2>
                <p style={{ color: "var(--text-muted)" }}>
                    The front desk has been notified{stay?.room_number ? ` for Room ${stay.room_number}` : ""}. We'll take care of it shortly.
                </p>
            </div>
        );
    }

    return (
        <div className="gn-container">
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                <Link to="/guest" className="gn-btn gn-btn--icon gn-btn--secondary">←</Link>
                <h1 className="gn-page-title" style={{ marginBottom: 0 }}>Request Service</h1>
            </div>

            {loading ? (
                <div className="gn-section" style={{ color: "var(--text-muted)" }}>Loading services…</div>
            ) : !stay ? (
                <div className="gn-card" style={{ padding: "1.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🛎️</div>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
                        No active stay
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                        Service requests are available during an in-progress stay.
                    </div>
                </div>
            ) : services.length === 0 ? (
                <div className="gn-card" style={{ padding: "1.5rem", textAlign: "center" }}>
                    <div style={{ color: "var(--text-muted)" }}>
                        No services are currently available to request. Please contact the front desk.
                    </div>
                </div>
            ) : (
                <>
                    {/* Service Selection */}
                    <div className="gn-section">
                        <h3 className="gn-section-title">What do you need?</h3>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                                gap: "0.75rem",
                            }}
                        >
                            {services.map((service) => (
                                <button
                                    key={service.id}
                                    className={`gn-card ${selectedService === service.id ? "gn-card--glow" : ""}`}
                                    style={{
                                        padding: "1.25rem",
                                        textAlign: "center",
                                        cursor: "pointer",
                                        border: selectedService === service.id
                                            ? "1px solid var(--border-gold)"
                                            : "1px solid var(--border-subtle)",
                                    }}
                                    onClick={() => { setSelectedService(service.id); setError(null); }}
                                >
                                    <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                                        {iconFor(service.label)}
                                    </div>
                                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                        {service.label}
                                    </div>
                                    {service.description && (
                                        <div
                                            style={{
                                                fontSize: "var(--text-xs)",
                                                color: "var(--text-muted)",
                                                marginTop: "0.25rem",
                                            }}
                                        >
                                            {service.description}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notes */}
                    {selectedService && (
                        <div className="gn-section">
                            <h3 className="gn-section-title">
                                {selected?.requires_description ? "Describe your request" : "Additional notes (optional)"}
                            </h3>
                            <textarea
                                className="gn-card"
                                style={{
                                    width: "100%",
                                    minHeight: "100px",
                                    padding: "1rem",
                                    background: "var(--bg-card)",
                                    border: "1px solid var(--border-subtle)",
                                    borderRadius: "var(--radius-lg)",
                                    color: "var(--text-primary)",
                                    fontSize: "var(--text-sm)",
                                    resize: "vertical",
                                }}
                                placeholder="Any special instructions..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </div>
                    )}

                    {error && (
                        <div
                            className="gn-section"
                            style={{
                                color: "#fca5a5",
                                background: "rgba(239,68,68,0.08)",
                                border: "1px solid rgba(239,68,68,0.25)",
                                borderRadius: "var(--radius-lg)",
                                padding: "0.75rem 1rem",
                                fontSize: "var(--text-sm)",
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Submit Button */}
                    <div style={{ marginTop: "2rem" }}>
                        <button
                            className="gn-btn gn-btn--primary"
                            style={{ width: "100%", padding: "1rem" }}
                            disabled={!selectedService || submitting}
                            onClick={handleSubmit}
                        >
                            {submitting ? "Submitting..." : "Submit Request"}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
