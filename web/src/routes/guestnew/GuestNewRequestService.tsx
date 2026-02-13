// GuestNewRequestService.tsx — Request Service Flow (In-Stay Only)
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";

type ServiceType = {
    id: string;
    name: string;
    icon: string;
    description: string;
};

const services: ServiceType[] = [
    {
        id: "room-cleaning",
        name: "Room Cleaning",
        icon: "🧹",
        description: "Housekeeping and room tidying",
    },
    {
        id: "room-service",
        name: "Room Service",
        icon: "🍽️",
        description: "Food and beverage delivery",
    },
    {
        id: "laundry",
        name: "Laundry",
        icon: "👔",
        description: "Clothes washing and pressing",
    },
    {
        id: "maintenance",
        name: "Maintenance",
        icon: "🔧",
        description: "Repairs and technical support",
    },
];

export default function GuestNewRequestService() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const preselectedType = searchParams.get("type");
    const [selectedService, setSelectedService] = useState<string | null>(preselectedType);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async () => {
        if (!selectedService) return;

        setSubmitting(true);

        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setSubmitted(true);
        setSubmitting(false);

        // Navigate back after showing success
        setTimeout(() => {
            navigate("/guestnew");
        }, 2000);
    };

    if (submitted) {
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
                    Request Submitted
                </h2>
                <p style={{ color: "var(--text-muted)" }}>
                    We'll take care of it shortly.
                </p>
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
                    Request Service
                </h1>
            </div>

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
                            onClick={() => setSelectedService(service.id)}
                        >
                            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                                {service.icon}
                            </div>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                {service.name}
                            </div>
                            <div
                                style={{
                                    fontSize: "var(--text-xs)",
                                    color: "var(--text-muted)",
                                    marginTop: "0.25rem",
                                }}
                            >
                                {service.description}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Notes */}
            {selectedService && (
                <div className="gn-section">
                    <h3 className="gn-section-title">Additional notes (optional)</h3>
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
        </div>
    );
}
