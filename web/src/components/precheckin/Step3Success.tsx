import { Check, Calendar, BedDouble, FileText, MapPin, Phone, MessageSquare } from "lucide-react";
import QRCode from "react-qr-code";
import { useTranslation } from "react-i18next";
import "./Step3Success.css";

interface Step3Props {
    booking: any;
    checkinFormatted: string;
    checkinTime: string;
    token?: string;
}

export function Step3Success({ booking, checkinFormatted, checkinTime, token }: Step3Props) {
    const { t } = useTranslation(["precheckin", "common"]);
    // Helper for "Add to Calendar"
    const addToCalendar = () => {
        const start = booking.scheduled_checkin_at ? new Date(booking.scheduled_checkin_at) : new Date();
        const title = t("precheckin:calendarTitle", { hotel: booking.hotel_name || t("common:terms.hotel") });
        const icsContent = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            `DTSTART:${start.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
            `SUMMARY:${title}`,
            `DESCRIPTION:Booking: ${booking.booking_code}`,
            "END:VEVENT",
            "END:VCALENDAR",
        ].join("\n");
        const blob = new Blob([icsContent], { type: "text/calendar" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "checkin.ics";
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="step3-page">
            {/* Success Icon */}
            <div className="step3-success-icon-wrapper">
                <div className="step3-success-glow" />
                <div className="step3-success-circle">
                    <Check className="step3-success-check" />
                </div>
            </div>

            {/* Headings */}
            <h1 className="step3-hero-title">{t("precheckin:allSet")}</h1>
            <p className="step3-hero-subtitle">
                {t("precheckin:allSetSub")}
            </p>

            {/* Booking Details Card */}
            <div className="step3-card">
                <span className="step3-card-header">{t("precheckin:bookingDetails")}</span>

                <div className="step3-details-grid">
                    {/* Check-in */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <Calendar className="step3-detail-icon" />
                            <span>{t("precheckin:checkinColon")}</span>
                        </div>
                        <div className="step3-detail-value">
                            {t("precheckin:atTime", { date: checkinFormatted, time: checkinTime })}
                        </div>
                    </div>

                    {/* Room */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <BedDouble className="step3-detail-icon" />
                            <span>{t("precheckin:roomColon")}</span>
                        </div>
                        <div className="step3-detail-value">
                            {booking.room_type || t("precheckin:toBeAssigned")}
                        </div>
                    </div>

                    {/* Booking Code */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <FileText className="step3-detail-icon" />
                            <span>{t("precheckin:bookingColon")}</span>
                        </div>
                        <div className="step3-detail-value">
                            {booking.booking_code}
                        </div>
                    </div>
                </div>

                {/* QR Code Section */}
                <div className="step3-qr-section">
                    <div className="step3-qr-box">
                        <div className="step3-qr-container">
                            {token || booking.qr_url ? (
                                <QRCode
                                    value={booking.qr_url || `https://staff.vaiyu.app/checkin?tkn=${token}`}
                                    size={160}
                                    bgColor="#ffffff"
                                    fgColor="#000000"
                                    level="M"
                                />
                            ) : (
                                <div className="step3-qr-placeholder">
                                    <div className="step3-qr-css" />
                                </div>
                            )}
                        </div>
                    </div>
                    <span className="step3-qr-text">{t("precheckin:showReception")}</span>
                </div>
            </div>

            {/* Quick Tips */}
            <div className="step3-tips-section">
                <span className="step3-tips-header">{t("precheckin:quickTips")}</span>

                {(booking.hotel_latitude && booking.hotel_longitude) || booking.hotel_address ? (
                    <a
                        href={
                            booking.hotel_latitude && booking.hotel_longitude
                                ? `https://www.google.com/maps/search/?api=1&query=${booking.hotel_latitude},${booking.hotel_longitude}`
                                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.hotel_address || booking.hotel_name || "Hotel")}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="step3-tip-row"
                        style={{ textDecoration: 'none' }}
                    >
                        <MapPin className="step3-tip-icon" />
                        <span className="step3-tip-text">{t("precheckin:directions")}</span>
                    </a>
                ) : (
                    <div className="step3-tip-row">
                        <MapPin className="step3-tip-icon" />
                        <span className="step3-tip-text">{t("precheckin:directions")}</span>
                    </div>
                )}

                {booking.hotel_phone ? (
                    <a
                        href={`tel:${booking.hotel_phone.replace(/[^0-9+]/g, '')}`}
                        className="step3-tip-row"
                        style={{ textDecoration: 'none' }}
                    >
                        <Phone className="step3-tip-icon" />
                        <span className="step3-tip-text">{booking.hotel_phone}</span>
                    </a>
                ) : (
                    <div className="step3-tip-row">
                        <Phone className="step3-tip-icon" />
                        <span className="step3-tip-text">{t("precheckin:contactNumber")}</span>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="step3-actions">
                <button
                    onClick={() => window.location.href = "/guest"}
                    className="step3-btn-primary"
                    style={{ background: "#d4af37", color: "black", marginBottom: "12px" }}
                >
                    {t("precheckin:goToPortal")}
                </button>
                <button onClick={addToCalendar} className="step3-btn-secondary">
                    {t("precheckin:addToCalendar")}
                </button>
                <button onClick={() => window.location.href = "/"} className="step3-btn-secondary">
                    {t("precheckin:backToHome")}
                </button>
            </div>
        </div>
    );
}
