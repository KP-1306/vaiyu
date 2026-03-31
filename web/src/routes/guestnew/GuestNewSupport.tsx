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
    const [hasActiveStay, setHasActiveStay] = useState(true);

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

                if (mounted && stays) {
                    if (stays.length === 0) {
                        setHasActiveStay(false);
                    }
                    else {
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
                        // Fetch from the public view to bypass RLS restrictions on the main table
                        const { data: hotelData, error } = await supabase
                            .from("v_public_hotels")
                            .select("phone, wa_display_number")
                            .eq("id", active.hotel_id)
                            .single();
                            
                        if (error) {
                            console.error("[DEBUG] Error fetching hotel from v_public_hotels:", error);
                            alert("Supabase API Error fetching Hotel Contact Info: " + error.message + "\n\n(Tip: if it says 'column not found', your local Supabase schema cache hasn't updated yet! Run: NOTIFY pgrst, reload_schema; in SQL)");
                        } else if (!hotelData) {
                             console.warn("[DEBUG] No hotel found in v_public_hotels for id:", active.hotel_id);
                        }

                        const phone = hotelData?.phone || active.hotel_phone;
                        const whatsapp = hotelData?.wa_display_number || active.hotel_whatsapp || hotelData?.phone || phone;
                        
                        if (phone) setHotelPhone(phone);
                        if (whatsapp) setHotelWhatsapp(whatsapp);
                    } else {
                        console.warn("[DEBUG] No active stay found in stays array", stays);
                    }
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

    const cleanWhatsapp = hotelWhatsapp ? hotelWhatsapp.replace(/\D/g, '') : '';

    const handleSendMessage = () => {
        if (!message.trim() || !cleanWhatsapp) return;

        const url = `https://wa.me/${cleanWhatsapp}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        setMessage("");
    };

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
            <div className="gn-section" style={{ opacity: hasActiveStay ? 1 : 0.5, pointerEvents: hasActiveStay ? "auto" : "none" }}>
                <h3 className="gn-section-title">Contact Us</h3>
                {!hasActiveStay && (
                    <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", marginBottom: "1rem" }}>
                        You do not have an active stay. Please book a room to access direct hotel support.
                    </p>
                )}
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
            <div className="gn-section" style={{ opacity: hasActiveStay ? 1 : 0.5, pointerEvents: hasActiveStay ? "auto" : "none" }}>
                <h3 className="gn-section-title">Send a Message</h3>
                <div 
                    className="gn-card" 
                    style={{ padding: "0", position: "relative", overflow: "hidden" }}
                >
                    <div style={{ padding: "1.5rem" }}>
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
                                    placeholder={cleanWhatsapp ? "How can we help you?" : "WhatsApp messaging is unavailable for this hotel"}
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    disabled={!cleanWhatsapp}
                                />
                                <button
                                    className="gn-btn gn-btn--primary"
                                    style={{ width: "100%", opacity: !cleanWhatsapp ? 0.5 : 1, cursor: !cleanWhatsapp ? 'not-allowed' : 'pointer' }}
                                    type="button"
                                    onClick={handleSendMessage}
                                    disabled={!message.trim() || !cleanWhatsapp}
                                >
                                    {cleanWhatsapp ? "Send via WhatsApp" : "Unavailable"}
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
