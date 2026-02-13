import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    CheckCircle,
    XCircle,
    ArrowRight,
    User,
    CalendarDays,
    BedDouble,
    Users,
    Globe,
    CreditCard,
    Building2,
    MapPin
} from "lucide-react";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function BookingDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const booking = location.state?.booking;

    if (!booking) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center">
                <div className="rounded-full bg-slate-100 p-4">
                    <CalendarDays className="h-8 w-8 text-slate-400" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">No booking selected</h2>
                <button
                    onClick={() => navigate("../booking")}
                    className="text-indigo-600 hover:text-indigo-700 font-medium"
                >
                    Go back to search
                </button>
            </div>
        );
    }

    // Date Logic
    const start = new Date(booking.scheduled_checkin_at);
    const end = new Date(booking.scheduled_checkout_at);
    const nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Formatters
    const formatDate = (date: Date) => date.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: '2-digit'
    });

    const BOOKING_STEPS = ["Find Booking", "Confirm Details", "Assign Room"];

    return (
        <div className="mx-auto max-w-3xl px-4 pb-12">

            {/* ── Stepper ── */}
            <CheckInStepper steps={BOOKING_STEPS} currentStep={1} />

            {/* Title */}
            <div className="mb-6 text-center sm:text-left">
                <h2 className="text-2xl font-semibold text-slate-900">Booking Confirmation</h2>
                <p className="text-slate-500">Please review your reservation before proceeding.</p>
            </div>

            {/* Main Card */}
            <div className="overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">

                {/* 1. Header (Deep Blue / Gradient) */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-6 text-white sm:px-8">
                    <div className="flex items-center gap-5">
                        {/* Avatar */}
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-white/20 bg-white/10 p-1">
                            <div className="h-full w-full rounded-full bg-slate-200 flex items-center justify-center">
                                <User className="h-8 w-8 text-slate-500" />
                            </div>
                        </div>

                        {/* Guest Name & Payment Status */}
                        <div className="flex-1 min-w-0">
                            <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl truncate">{booking.guest_name}</h3>
                            <div className="mt-1 flex items-center gap-3 text-indigo-200 text-sm">
                                <span className="truncate">{booking.email || booking.phone}</span>
                            </div>
                        </div>

                        {/* Status Badge (Large Screens) */}
                        <div className="hidden sm:block">
                            {(booking.source === 'pms_sync' || booking.source === 'ota') ? (
                                <div className="flex items-center gap-1.5 rounded-full bg-green-500/20 px-3 py-1 text-sm font-medium text-green-300 ring-1 ring-inset ring-green-500/40">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Paid in Full</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 rounded-full bg-yellow-500/20 px-3 py-1 text-sm font-medium text-yellow-300 ring-1 ring-inset ring-yellow-500/40">
                                    <CreditCard className="h-4 w-4" />
                                    <span>Pay at Hotel</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Mobile Status Badge */}
                    <div className="mt-4 sm:hidden">
                        {(booking.source === 'pms_sync' || booking.source === 'ota') ? (
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-300 ring-1 ring-inset ring-green-500/40">
                                <CheckCircle className="h-3.5 w-3.5" />
                                <span>Paid in Full</span>
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-300 ring-1 ring-inset ring-yellow-500/40">
                                <CreditCard className="h-3.5 w-3.5" />
                                <span>Pay at Hotel</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Content Body */}
                <div className="p-6 sm:p-8 space-y-8 bg-slate-50/30">

                    {/* Dates Row (Prominent) */}
                    <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                        <div className="flex-1 text-center sm:text-left">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Check-in</p>
                            <div className="flex items-center justify-center sm:justify-start gap-2">
                                <CalendarDays className="h-5 w-5 text-indigo-600" />
                                <span className="text-lg font-bold text-slate-900">{formatDate(start)}</span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">After 2:00 PM</p>
                        </div>

                        {/* Divider / Nights */}
                        <div className="relative flex items-center justify-center w-full sm:w-auto px-4 py-2 sm:py-0">
                            <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                <div className="w-full border-t border-slate-200 sm:border-t-0 sm:border-l sm:h-full sm:w-px"></div>
                            </div>
                            <div className="relative bg-white px-3 py-1 text-xs font-medium text-slate-500 rounded-full ring-1 ring-slate-200">
                                {nights} Night{nights > 1 ? 's' : ''}
                            </div>
                        </div>

                        <div className="flex-1 text-center sm:text-right">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Check-out</p>
                            <div className="flex items-center justify-center sm:justify-end gap-2">
                                <span className="text-lg font-bold text-slate-900">{formatDate(end)}</span>
                                <CalendarDays className="h-5 w-5 text-indigo-600" />
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">By 11:00 AM</p>
                        </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                        {/* Room */}
                        <div className="flex items-start gap-4">
                            <BedDouble className="h-5 w-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-500">Room Type</p>
                                <p className="text-base font-semibold text-slate-900">{booking.room_type || "Standard Room"}</p>
                                <p className="text-xs text-slate-400">1 Bedroom</p>
                            </div>
                        </div>

                        {/* Guests */}
                        <div className="flex items-start gap-4">
                            <Users className="h-5 w-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-500">Guests</p>
                                <p className="text-base font-semibold text-slate-900">
                                    {booking.adults || 1} Adult{booking.adults > 1 ? 's' : ''}
                                </p>
                                <p className="text-xs text-slate-400">
                                    {booking.children ? `${booking.children} Children` : 'No Children'}
                                </p>
                            </div>
                        </div>

                        {/* Source */}
                        <div className="flex items-start gap-4">
                            <Globe className="h-5 w-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-500">Booking Source</p>
                                <p className="text-base font-semibold text-slate-900 capitalize">
                                    {booking.source === 'pms_sync' ? 'Synced (PMS)' : (booking.source || 'Direct')}
                                </p>
                            </div>
                        </div>

                        {/* Hotel Info (Static for now) */}
                        <div className="flex items-start gap-4">
                            <Building2 className="h-5 w-5 text-slate-400 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-slate-500">Property</p>
                                <p className="text-base font-semibold text-slate-900">Hotel Vaiyu</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Footer Actions */}
                <div className="bg-slate-50 px-6 py-6 sm:px-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">

                    <div className="flex flex-col sm:flex-row items-center gap-2 text-sm text-slate-500 w-full sm:w-auto text-center sm:text-left">
                        <span className="font-medium text-slate-700">Check-in Source:</span>
                        <div className="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200">
                            <span className="text-indigo-600 font-bold">$0.00</span>
                            <span className="text-xs text-slate-400">Due</span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full sm:w-auto">
                        <button
                            onClick={() => navigate("../booking")}
                            className="flex-1 sm:flex-none rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 active:scale-[0.98] transition-all"
                        >
                            Cancel Check-In
                        </button>
                        <button
                            onClick={() => navigate("../kyc", { state: { booking } })}
                            className="flex-1 sm:flex-none rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Confirm & Continue
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
