// GuestNewSupport.tsx — Support Screen
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

export default function GuestNewSupport() {
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    
    // Accordion State
    const [openFaq, setOpenFaq] = useState<number | null>(null);
    
    // Dynamic Hotel Data
    const [hotelPhone, setHotelPhone] = useState<string>("Contact Front Desk");
    const [hotelWhatsapp, setHotelWhatsapp] = useState<string>("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const fetchStayAndHotelDates = async () => {
            try {
                const { data: sessionData } = await supabase.auth.getSession();
                const user = sessionData.session?.user;

                if (!user) {
                    if (mounted) setLoading(false);
                    return;
                }

                const { data: stays } = await supabase
                    .from("user_recent_stays")
                    .select("*")
                    .order("check_in", { ascending: false })
                    .limit(20);

                if (mounted && stays && stays.length > 0) {
                    const now = new Date();
                    
                    // Prioritize active stays
                    let active = stays.find((s: any) =>
                        ["inhouse", "checked_in", "partially_arrived", "checkout_requested"].includes(s.status?.toLowerCase() || "")
                    );

                    // Fallback to upcoming stay
                    if (!active) {
                        active = stays.find((s: any) => {
                            const checkout = new Date(s.check_out);
                            const isPast = ["checked_out", "cancelled"].includes(s.status?.toLowerCase() || "");
                            return !isPast && (
                                ["arriving", "expected", "confirmed"].includes(s.status?.toLowerCase() || "") ||
                                checkout >= now
                            );
                        });
                    }

                    // Fallback to most recent stay
                    if (!active) {
                        active = stays[0];
                    }

                    if (active) {
                        const phone = active.hotel_phone || active.hotel?.phone;
                        const whatsapp = active.hotel_whatsapp || active.hotel?.wa_display_number || phone;
                        
                        if (phone) setHotelPhone(phone);
                        if (whatsapp) setHotelWhatsapp(whatsapp);
                    }
                }
            } catch (err) {
                console.error("[GuestNewSupport] Error fetching hotel data:", err);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchStayAndHotelDates();

        return () => {
            mounted = false;
        };
    }, []);

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
    
    // Format whatsapp string for URL (strip non-digits)
    const cleanWhatsapp = hotelWhatsapp ? hotelWhatsapp.replace(/\D/g, '') : '';

    return (
        <div className="gn-container">
            {/* Breadcrumb Navigation */}
            <div className="gn-breadcrumb">
                <Link to="/guest" className="gn-breadcrumb__link">
                    ← Home
                </Link>
                <span className="gn-breadcrumb__sep">/</span>
                <span className="gn-breadcrumb__current">Support</span>
            </div>

            {/* Page Header */}
            <h1 className="gn-page-title">Support</h1>
            <p className="gn-section-subtitle">We're here to help 24/7</p>

            {/* Quick Contact Options */}
            <div className="gn-section">
                <h3 className="gn-section-title">Contact Us</h3>
                <div className="gn-support-options">
                    <a href={hotelPhone !== "Contact Front Desk" ? `tel:${hotelPhone}` : "#"} className="gn-card gn-support-option" onClick={(e) => hotelPhone === "Contact Front Desk" && e.preventDefault()}>
                        <div className="gn-support-option__icon">📞</div>
                        <div className="gn-support-option__text">
                            <div className="gn-support-option__title">Call Guest Services</div>
                            <div className="gn-support-option__subtitle">{hotelPhone}</div>
                        </div>
                    </a>

                    <a href={cleanWhatsapp ? `https://wa.me/${cleanWhatsapp}` : "#"} onClick={(e) => !cleanWhatsapp && e.preventDefault()} target={cleanWhatsapp ? "_blank" : "_self"} rel="noopener noreferrer" className="gn-card gn-support-option" style={{ opacity: cleanWhatsapp ? 1 : 0.5, cursor: cleanWhatsapp ? 'pointer' : 'not-allowed' }}>
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
                <div 
                    className="gn-card" 
                    style={{ padding: "0", position: "relative", opacity: 0.6, cursor: "not-allowed", overflow: "hidden" }}
                >
                    {/* Invisible overlay button to catch clicks effortlessly */}
                    <button 
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            width: "100%",
                            height: "100%",
                            opacity: 0,
                            zIndex: 10,
                            cursor: "not-allowed",
                            background: "transparent",
                            border: "none",
                            appearance: "none",
                            margin: 0,
                            padding: 0
                        }}
                        onClick={() => alert("This feature will be coming soon!\n\nPlease raise a service request directly using the 'Request Service' button on your dashboard.")}
                        title="This feature will be coming soon! Please raise a service request directly using the 'Request Service' button on your dashboard."
                    />
                    
                    {/* Visual forms (Un-clickable) */}
                    <div style={{ padding: "1.5rem", pointerEvents: "none" }}>
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
                            value=""
                            readOnly
                        />
                        <button
                            className="gn-btn gn-btn--primary"
                            style={{ width: "100%" }}
                            type="button"
                        >
                            Send Message
                        </button>
                    </div>
                </div>
            </div>

            {/* FAQ */}
            <div className="gn-section">
                <h3 className="gn-section-title">Frequently Asked</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {[
                        { 
                            q: "How do I request early check-in?", 
                            a: "Head to the 'Home' tab on your dashboard. If you have an upcoming stay, you can click the 'Request Service' or 'Modify Booking' buttons to notify the hotel of your arrival time." 
                        },
                        { 
                            q: "What's included in my stay?", 
                            a: "You can view all property amenities and your booked room details by tapping on your active stay card on the Home dashboard, or by navigating to the Trips tab to view your full booking history." 
                        },
                        { 
                            q: "How do I download my invoice?", 
                            a: "Navigate to the 'Trips' tab from the bottom menu. Select your past or current stay to view the Stay Details page. From there, click the 'Download invoice' button under your Bill Summary to get a PDF copy." 
                        },
                        { 
                            q: "How do I redeem my rewards?", 
                            a: "The Vaiyu Rewards program is currently being revamped. Once active, your eligible stays will automatically accrue points that can be redeemed during checkout or when booking your next stay directly through the platform." 
                        },
                    ].map((faq, i) => {
                        const isOpen = openFaq === i;
                        return (
                            <div
                                key={i}
                                className="gn-card"
                                style={{
                                    padding: "1rem",
                                    display: "flex",
                                    flexDirection: "column",
                                    cursor: "pointer",
                                }}
                                onClick={() => setOpenFaq(isOpen ? null : i)}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: "var(--text-sm)", fontWeight: isOpen ? 600 : 400 }}>{faq.q}</span>
                                    <span style={{ 
                                        color: "var(--text-gold)",
                                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                                        transition: "transform 0.2s ease"
                                    }}>›</span>
                                </div>
                                {isOpen && (
                                    <div style={{ 
                                        marginTop: "0.75rem", 
                                        paddingTop: "0.75rem", 
                                        borderTop: "1px solid var(--border-subtle)",
                                        fontSize: "0.875rem",
                                        color: "var(--text-muted)",
                                        lineHeight: 1.5
                                    }}>
                                        {faq.a}
                                    </div>
                                )}
                            </div>
                        );
                    })}
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
                            Call the front desk directly: {hotelPhone}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
