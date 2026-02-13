import { Check, Calendar, BedDouble, FileText, MapPin, Phone, MessageSquare } from "lucide-react";
import "./Step3Success.css";

interface Step3Props {
    booking: any;
    checkinFormatted: string;
    checkinTime: string;
}

export function Step3Success({ booking, checkinFormatted, checkinTime }: Step3Props) {
    // Helper for "Add to Calendar"
    const addToCalendar = () => {
        const start = booking.checkin_date ? new Date(booking.checkin_date) : new Date();
        const title = `Check-in: ${booking.hotel_name || "Hotel"}`;
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
            <h1 className="step3-hero-title">You’re All Set!</h1>
            <p className="step3-hero-subtitle">
                Pre-check-in complete. Just walk in and collect your key.
            </p>

            {/* Booking Details Card */}
            <div className="step3-card">
                <span className="step3-card-header">Booking Details</span>

                <div className="step3-details-grid">
                    {/* Check-in */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <Calendar className="step3-detail-icon" />
                            <span>Check-in:</span>
                        </div>
                        <div className="step3-detail-value">
                            {checkinFormatted} at {checkinTime}
                        </div>
                    </div>

                    {/* Room */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <BedDouble className="step3-detail-icon" />
                            <span>Room:</span>
                        </div>
                        <div className="step3-detail-value">
                            {booking.room_type || "To be assigned"}
                        </div>
                    </div>

                    {/* Booking Code */}
                    <div className="step3-detail-row">
                        <div className="step3-detail-label">
                            <FileText className="step3-detail-icon" />
                            <span>Booking:</span>
                        </div>
                        <div className="step3-detail-value">
                            {booking.booking_code}
                        </div>
                    </div>
                </div>

                {/* QR Code Section */}
                <div className="step3-qr-section">
                    <div className="step3-qr-box">
                        <div className="step3-qr-placeholder">
                            <div className="step3-qr-css" />
                        </div>
                    </div>
                    <span className="step3-qr-text">Show at reception</span>
                </div>
            </div>

            {/* Quick Tips */}
            <div className="step3-tips-section">
                <span className="step3-tips-header">Quick Tips</span>

                <div className="step3-tip-row">
                    <MapPin className="step3-tip-icon" />
                    <span className="step3-tip-text">Directions to Hotel</span>
                </div>

                <div className="step3-tip-row">
                    <Phone className="step3-tip-icon" />
                    <span className="step3-tip-text">Contact Number</span>
                </div>
            </div>

            {/* Actions */}
            <div className="step3-actions">
                <button onClick={addToCalendar} className="step3-btn-primary">
                    Add to Calendar
                </button>
                <button onClick={() => window.location.href = "/"} className="step3-btn-secondary">
                    Back to Home
                </button>
            </div>
        </div>
    );
}
