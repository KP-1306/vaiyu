// GuestNewSupport.tsx — Support Screen
import { Link } from "react-router-dom";
import { useState } from "react";

export default function GuestNewSupport() {
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSendMessage = async () => {
        if (!message.trim()) return;

        setSending(true);

        // Simulate sending message
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setSent(true);
        setSending(false);
        setMessage("");

        // Reset after a few seconds
        setTimeout(() => setSent(false), 3000);
    };

    return (
        <div className="gn-container">
            {/* Page Header */}
            <h1 className="gn-page-title">Support</h1>
            <p className="gn-section-subtitle">We're here to help 24/7</p>

            {/* Quick Contact Options */}
            <div className="gn-section">
                <h3 className="gn-section-title">Contact Us</h3>
                <div className="gn-support-options">
                    <a href="tel:+911772345678" className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">📞</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">Call Guest Services</div>
                            <div className="gn-support-option__subtitle">+91 177 234 5678</div>
                        </div>
                    </a>

                    <a href="https://wa.me/911772345678" target="_blank" rel="noopener noreferrer" className="gn-card gn-support-option">
                        <div className="gn-support-option__icon">💬</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">WhatsApp</div>
                            <div className="gn-support-option__subtitle">Quick chat support</div>
                        </div>
                        <span className="gn-support-option__arrow">›</span>
                    </a>
                </div>
            </div>

            {/* Chat Message */}
            <div className="gn-section">
                <h3 className="gn-section-title">Send a Message</h3>
                <div className="gn-card" style={{ padding: "1.5rem" }}>
                    {sent ? (
                        <div style={{ textAlign: "center", padding: "1rem" }}>
                            <div
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: "50%",
                                    background: "rgba(34, 197, 94, 0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "1.5rem",
                                    margin: "0 auto 1rem",
                                }}
                            >
                                ✓
                            </div>
                            <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
                                Message Sent
                            </div>
                            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                                We'll respond shortly.
                            </div>
                        </div>
                    ) : (
                        <>
                            <textarea
                                style={{
                                    width: "100%",
                                    minHeight: "120px",
                                    padding: "1rem",
                                    background: "var(--bg-card-hover)",
                                    border: "1px solid var(--border-subtle)",
                                    borderRadius: "var(--radius-lg)",
                                    color: "var(--text-primary)",
                                    fontSize: "var(--text-sm)",
                                    resize: "vertical",
                                    marginBottom: "1rem",
                                }}
                                placeholder="How can we help you?"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                            />
                            <button
                                className="gn-btn gn-btn--primary"
                                style={{ width: "100%" }}
                                disabled={!message.trim() || sending}
                                onClick={handleSendMessage}
                            >
                                {sending ? "Sending..." : "Send Message"}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* FAQ */}
            <div className="gn-section">
                <h3 className="gn-section-title">Frequently Asked</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {[
                        { q: "How do I request early check-in?", a: "/guest/request-service" },
                        { q: "What's included in my stay?", a: "/guest/trips" },
                        { q: "How do I download my invoice?", a: "/guest/trips" },
                        { q: "How do I redeem my rewards?", a: "/guest/rewards" },
                    ].map((faq, i) => (
                        <Link
                            key={i}
                            to={faq.a}
                            className="gn-card"
                            style={{
                                padding: "1rem",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                textDecoration: "none",
                            }}
                        >
                            <span style={{ fontSize: "var(--text-sm)" }}>{faq.q}</span>
                            <span style={{ color: "var(--text-gold)" }}>›</span>
                        </Link>
                    ))}
                </div>
            </div>

            {/* Emergency */}
            <div className="gn-card" style={{ padding: "1rem", marginTop: "2rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontSize: "1.25rem" }}>🚨</span>
                    <div>
                        <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                            Emergency?
                        </div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                            Call the front desk directly: +91 177 234 5678
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
