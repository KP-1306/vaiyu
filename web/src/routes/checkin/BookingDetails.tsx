import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    CheckCircle,
    ArrowRight,
    User,
    CalendarDays,
    BedDouble,
    Users,
    CreditCard,
    ArrowLeft,
    Moon,
    Globe,
    Building2
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";
import "./BookingDetails.css";

export default function BookingDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const booking = location.state?.booking;
    const [hotelData, setHotelData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(!!booking?.hotel_id);

    React.useEffect(() => {
        if (!booking?.hotel_id) return;

        async function fetchData() {
            try {
                // Fetch Hotel Details
                const { data: hData } = await supabase
                    .from('hotels')
                    .select('name, default_checkin_time, default_checkout_time')
                    .eq('id', booking.hotel_id)
                    .maybeSingle();
                
                if (hData) setHotelData(hData);
            } catch (err) {
                console.error("Error fetching dynamic data:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [booking?.hotel_id]);

    const formatTime = (timeStr: string) => {
        if (!timeStr) return "";
        try {
            const [h, m] = timeStr.split(':');
            const hour = parseInt(h);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            return `${displayHour}:${m} ${ampm}`;
        } catch {
            return timeStr;
        }
    };

    if (!booking) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center">
                <div className="rounded-full bg-white/5 p-4 border border-white/10 shadow-2xl backdrop-blur-3xl">
                    <CalendarDays className="h-8 w-8 text-gold-400" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-widest uppercase">No booking selected</h2>
                <button
                    onClick={() => navigate("../booking")}
                    className="text-gold-400 hover:text-gold-300 font-black uppercase tracking-[0.2em] transition-colors"
                >
                    &larr; Return to search
                </button>
            </div>
        );
    }

    // Date Logic
    const start = new Date(booking.scheduled_checkin_at);
    const end = new Date(booking.scheduled_checkout_at);
    const nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Formatters
    const formatDateFull = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: '2-digit' 
        });
    };

    const BOOKING_STEPS = ["Find Booking", "Confirm Details", "Check-in"];

    return (
        <div className="gn-details-container">
            {/* ── Progress Stepper ── */}
            <div className="mb-12">
                <CheckInStepper steps={BOOKING_STEPS} currentStep={1} />
            </div>

            {/* Title Section */}
            <div className="gn-details-title-section">
                <div className="flex items-center gap-3">
                    <div className="h-0.5 w-12 bg-gold-400" />
                    <span className="text-[10px] uppercase tracking-[0.4em] font-black text-gold-400">Reservation Audit</span>
                </div>
                <div className="space-y-2">
                    <h1 className="gn-details-title">Booking Confirmation</h1>
                    <p className="gn-details-subtitle">Examine and authorize your accommodations below.</p>
                </div>
            </div>

            {/* Main Premium Card */}
            <div className="gn-details-card">
                
                {/* 1. Header Section */}
                <div className="gn-details-header">
                    {/* Background Shine */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[80px] -mr-32 -mt-32 pointer-events-none" />
                    
                    <div className="flex items-center gap-6 relative z-10 w-full sm:w-auto">
                        {/* Avatar */}
                        <div className="gn-details-avatar-frame">
                            <div className="gn-details-avatar-inner">
                                <User className="h-8 w-8 text-white/40" />
                            </div>
                        </div>

                        {/* Guest Details */}
                        <div className="space-y-1">
                            <h3 className="gn-details-guest-name">{booking.guest_name}</h3>
                            <div className="flex items-center gap-2">
                                <span className="gn-details-guest-email">{booking.email || booking.phone}</span>
                            </div>
                        </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0 relative z-10">
                        {(booking.source === 'pms_sync' || booking.source === 'ota') ? (
                            <div className="gn-details-status-badge gn-details-status-paid">
                                <CheckCircle className="h-4 w-4" /> Paid in Full
                            </div>
                        ) : (
                            <div className="gn-details-status-badge gn-details-status-unpaid">
                                <CreditCard className="h-4 w-4" /> Pay at Hotel
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Content Body */}
                <div className="gn-details-body">
                    <div className="p-4 space-y-4">
                        
                        {/* Dates Grid Section */}
                        <div className="gn-details-dates-card">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-12 relative z-10">
                                {/* Check-in Column */}
                                <div className="flex-1 space-y-4 text-center md:text-left">
                                    <div className="flex items-center justify-center md:justify-start gap-2">
                                        <span className="gn-details-date-label">Check-in</span>
                                    </div>
                                    <div className="flex items-center justify-center md:justify-start gap-6">
                                        <div className="gn-details-icon-wrapper text-blue-500">
                                            <CalendarDays className="h-7 w-7" />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="gn-details-date-value">{formatDateFull(start)}</div>
                                            <div className="gn-details-date-subtext">
                                                After &bull; {hotelData?.default_checkin_time ? formatTime(hotelData.default_checkin_time) : "14:00 PM"}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Nights Middle Badge */}
                                <div className="shrink-0">
                                    <div className="gn-details-nights-badge">
                                        <div className="gn-details-nights-text">{nights} {nights > 1 ? 'Nights' : 'Night'}</div>
                                        {/* Desktop Connector Lines */}
                                        <div className="absolute left-full top-1/2 w-64 h-px bg-gradient-to-r from-white/10 to-transparent hidden md:block" />
                                        <div className="absolute right-full top-1/2 w-64 h-px bg-gradient-to-l from-white/10 to-transparent hidden md:block" />
                                    </div>
                                </div>

                                {/* Check-out Column */}
                                <div className="flex-1 space-y-4 text-center md:text-right">
                                    <div className="flex items-center justify-center md:justify-end gap-2">
                                        <span className="gn-details-date-label">Check-out</span>
                                    </div>
                                    <div className="flex items-center justify-center md:justify-start gap-6 md:flex-row-reverse">
                                        <div className="gn-details-icon-wrapper text-blue-500">
                                            <CalendarDays className="h-7 w-7" />
                                        </div>
                                        <div className="space-y-1 text-center md:text-right">
                                            <div className="gn-details-date-value">{formatDateFull(end)}</div>
                                            <div className="gn-details-date-subtext">
                                                By &bull; {hotelData?.default_checkout_time ? formatTime(hotelData.default_checkout_time) : "11:00 AM"}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Information Details Widget (Unified) */}
                        <div className="gn-details-grid">
                            {/* Room Type Details */}
                            <div className="gn-details-info-item">
                                <div className="gn-details-icon-wrapper">
                                    <BedDouble size={28} />
                                </div>
                                <div className="space-y-1">
                                    <p className="gn-details-item-label">Room Type</p>
                                    <p className="gn-details-item-value">{booking.room_type || "Standard Residence"}</p>
                                    <p className="gn-details-item-subtext">Premium Collection</p>
                                </div>
                            </div>

                            {/* Guest Census Details */}
                            <div className="gn-details-info-item">
                                <div className="gn-details-icon-wrapper">
                                    <Users size={28} />
                                </div>
                                <div className="space-y-1">
                                    <p className="gn-details-item-label">Guests</p>
                                    <p className="gn-details-item-value">
                                        {booking.adults || 1} {booking.adults > 1 ? 'Adults' : 'Adult'}
                                        {booking.children ? `, ${booking.children} Child` : ''}
                                    </p>
                                    <p className="gn-details-item-subtext">Occupancy Capacity</p>
                                </div>
                            </div>

                            {/* Booking Origin Details */}
                            <div className="gn-details-info-item">
                                <div className="gn-details-icon-wrapper">
                                    <Globe size={28} />
                                </div>
                                <div className="space-y-1">
                                    <p className="gn-details-item-label">Booking Source</p>
                                    <p className="gn-details-item-value capitalize">
                                        {booking.source === 'pms_sync' ? 'Synced (PMS)' : (booking.source || 'Direct')}
                                    </p>
                                    <p className="gn-details-item-subtext">Channel Partner</p>
                                </div>
                            </div>

                            {/* Property Information Details */}
                            <div className="gn-details-info-item">
                                <div className="gn-details-icon-wrapper">
                                    <Building2 size={28} />
                                </div>
                                <div className="space-y-1">
                                    <p className="gn-details-item-label">Property</p>
                                    <p className="gn-details-item-value">
                                        {loading ? "Loading..." : (hotelData?.name || "Verified Residence")}
                                    </p>
                                    <p className="gn-details-item-subtext">Verified Residence</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Footer Control Actions */}
                <div className="gn-details-footer">
                    <button
                        onClick={() => navigate("../booking")}
                        className="gn-details-btn-secondary"
                    >
                        <ArrowLeft className="h-4 w-4" /> Return to Search
                    </button>

                    <button
                        onClick={() => navigate(`../kyc${location.search}`, { state: { booking } })}
                        className="gn-details-btn-primary"
                    >
                        {/* Dynamic Interactive Layer */}
                        <div className="absolute inset-0 bg-gold-400 opacity-90 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent pointer-events-none" />

                        <div className="gn-details-btn-primary-content">
                            Authorize Check-in <ArrowRight className="h-5 w-5" />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
