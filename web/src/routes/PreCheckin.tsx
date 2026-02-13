// web/src/routes/PreCheckin.tsx
//
// Guest Self Pre-Check-In (Token-Based)
// Premium dark theme with gold accents, matching Vaiyu design language.
// 4-step flow: Welcome → Details → ID Proof → Success

import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
    Loader2,
    Check,
    AlertTriangle,
    Shield,
    Calendar,
    MapPin,
    Phone,
    Mail,
    User,
    Users,
    Camera,
    ChevronDown,
    Plus,
    Edit2,
    Upload,
    Lock,
    Building2,
    ChevronRight,
    CalendarPlus,
    ArrowLeft,
    Clock,
    BedDouble,
    QrCode,
    Key,
} from "lucide-react";
import { validatePrecheckinToken, submitPrecheckin } from "../lib/api";
import { Step2IdentityVerification } from "../components/precheckin/Step2IdentityVerification";
import { Step3Success } from "../components/precheckin/Step3Success";

// ─── Types ───────────────────────────────────────────────────
interface BookingInfo {
    valid: boolean;
    error?: string;
    completed_at?: string;
    token_id?: string;
    booking_id?: string;
    booking_code?: string;
    guest_name?: string;
    phone?: string;
    email?: string;
    checkin_date?: string;
    checkout_date?: string;
    booking_status?: string;
    hotel_id?: string;
    hotel_name?: string;
    room_type?: string;
    room_price?: number;
}

interface GuestForm {
    guest_name: string;
    phone: string;
    email: string;
    nationality: string;
    address: string;
    additional_guests: { name: string; type: string; age?: number }[];
}

interface IdForm {
    id_type: string;
    id_number: string;
    front_captured: boolean;
    back_uploaded: boolean;
}

const ID_TYPES = [
    { value: "aadhaar", label: "Aadhaar Card", placeholder: "XXXX-XXXX-XXXX" },
    { value: "passport", label: "Passport", placeholder: "A1234567" },
    { value: "driving_licence", label: "Driving Licence", placeholder: "DL-XXXXXXXXX" },
    { value: "voter_id", label: "Voter ID", placeholder: "ABC1234567" },
    { value: "other", label: "Other", placeholder: "Enter ID number" },
];

const STEPS = ["Details", "ID Proof", "Done"];

// ─── Component ───────────────────────────────────────────────
export default function PreCheckin() {
    const { token } = useParams<{ token: string }>();

    // State
    const [loading, setLoading] = useState(true);
    const [booking, setBooking] = useState<BookingInfo | null>(null);
    const [step, setStep] = useState(0); // 0=welcome, 1=details, 2=id, 3=success
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    // Form state
    const [guestForm, setGuestForm] = useState<GuestForm>({
        guest_name: "",
        phone: "",
        email: "",
        nationality: "Indian",
        address: "",
        additional_guests: [],
    });

    const [idForm, setIdForm] = useState<IdForm>({
        id_type: "aadhaar",
        id_number: "",
        front_captured: false,
        back_uploaded: false,
    });

    // ─── Token Validation ──────────────────────────────────────
    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        (async () => {
            try {
                const result = await validatePrecheckinToken(token);
                setBooking(result);

                // Pre-fill guest details from booking
                if (result?.valid) {
                    setGuestForm((prev) => ({
                        ...prev,
                        guest_name: result.guest_name || "",
                        phone: result.phone || "",
                        email: result.email || "",
                    }));
                }
            } catch (err: any) {
                setBooking({ valid: false, error: err.message || "Failed to validate token" });
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    // ─── Formatted dates ──────────────────────────────────────
    const checkinFormatted = useMemo(() => {
        if (!booking?.checkin_date) return "";
        const d = new Date(booking.checkin_date);
        return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.checkin_date]);

    const checkoutFormatted = useMemo(() => {
        if (!booking?.checkout_date) return "";
        const d = new Date(booking.checkout_date);
        return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.checkout_date]);

    const checkinTime = useMemo(() => {
        if (!booking?.checkin_date) return "2:00 PM";
        const d = new Date(booking.checkin_date);
        return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    }, [booking?.checkin_date]);

    const nights = useMemo(() => {
        if (!booking?.checkin_date || !booking?.checkout_date) return 0;
        const ci = new Date(booking.checkin_date);
        const co = new Date(booking.checkout_date);
        return Math.max(1, Math.ceil((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24)));
    }, [booking?.checkin_date, booking?.checkout_date]);

    // ─── Submit Handler ────────────────────────────────────────
    const handleSubmit = async () => {
        if (!token) return;
        setSubmitting(true);
        setSubmitError("");

        try {
            const payload = {
                guest_name: guestForm.guest_name,
                phone: guestForm.phone,
                email: guestForm.email,
                nationality: guestForm.nationality,
                address: guestForm.address,
                additional_guests: guestForm.additional_guests,
                id_type: idForm.id_type,
                id_number: idForm.id_number,
                front_captured: idForm.front_captured,
                back_uploaded: idForm.back_uploaded,
            };

            const result = await submitPrecheckin(token, payload);

            if (result?.success) {
                setStep(3); // Success
            } else {
                setSubmitError(result?.error || "Submission failed");
            }
        } catch (err: any) {
            setSubmitError(err.message || "Something went wrong");
        } finally {
            setSubmitting(false);
        }
    };

    // ─── Loading State ─────────────────────────────────────────
    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
                <div className="text-center space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin text-[#d4af37] mx-auto" />
                    <p className="text-[#b8b3a8] text-sm">Verifying your link...</p>
                </div>
            </div>
        );
    }

    // ─── Invalid / Expired / Already Used ──────────────────────
    if (!booking?.valid) {
        return (
            <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center px-4">
                <div className="text-center space-y-4 max-w-sm">
                    <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                        <AlertTriangle className="h-8 w-8 text-red-400" />
                    </div>
                    <h1 className="text-xl font-semibold text-white">
                        {booking?.error === "Pre-check-in already completed"
                            ? "Already Completed"
                            : booking?.error === "This link has expired"
                                ? "Link Expired"
                                : "Invalid Link"
                        }
                    </h1>
                    <p className="text-[#b8b3a8] text-sm">
                        {booking?.error || "This pre-check-in link is not valid. Please contact the hotel for a new link."}
                    </p>
                    {booking?.completed_at && (
                        <p className="text-[#7a756a] text-xs">
                            Completed on {new Date(booking.completed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // ─── Step Indicator ────────────────────────────────────────
    const StepIndicator = () => (
        <div className="flex items-center justify-center gap-3 py-6">
            {STEPS.map((s, i) => {
                const stepIdx = i + 1; // 1=details, 2=id, 3=done
                const isCompleted = step > stepIdx;
                const isCurrent = step === stepIdx;

                return (
                    <div key={i} className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${isCompleted
                                    ? "bg-[#d4af37] text-black"
                                    : isCurrent
                                        ? "bg-[#d4af37] text-black ring-4 ring-[#d4af37]/20"
                                        : "bg-[#1c1916] text-[#7a756a] border border-[#d4af37]/15"
                                    }`}
                            >
                                {isCompleted ? <Check className="h-4 w-4" /> : stepIdx}
                            </div>
                            <span className={`text-xs font-medium ${isCurrent ? "text-white" : "text-[#7a756a]"}`}>
                                {s}
                            </span>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div className="w-8 h-[2px] bg-[#1c1916]">
                                <div className={`h-full transition-all duration-500 ${step > stepIdx ? "bg-[#d4af37] w-full" : "w-0"}`} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    // ─── Welcome Screen (Step 0) ──────────────────────────────
    if (step === 0) {
        const firstName = booking.guest_name?.split(" ")[0] || "Guest";

        return (
            <div className="min-h-screen bg-[#0a0a0c] px-4 py-8">
                <div className="max-w-md mx-auto space-y-8">
                    {/* Logo */}
                    <div className="text-center space-y-1">
                        <div className="text-[#d4af37] text-3xl font-light tracking-[0.3em]">VAIYU</div>
                        <div className="h-[1px] w-12 bg-[#d4af37]/30 mx-auto" />
                    </div>

                    {/* Welcome */}
                    <div className="text-center space-y-2">
                        <h1 className="text-2xl font-light text-white">
                            Welcome, <span className="text-[#d4af37] font-medium">{firstName}</span>!
                        </h1>
                        <p className="text-[#b8b3a8] text-sm">Complete your pre-check-in to skip the front desk</p>
                    </div>

                    {/* Booking Card */}
                    <div className="bg-[#18181b] border border-[#d4af37]/40 rounded-2xl p-6 space-y-6 shadow-[0_0_15px_rgba(212,175,55,0.15)] relative overflow-hidden">
                        {/* Hotel Name Header */}
                        <div className="flex items-center gap-3 pb-4 border-b border-[#ffffff]/10">
                            <Building2 className="h-5 w-5 text-[#d4af37]" />
                            <span className="text-[#fceea7] font-bold text-lg">{booking.hotel_name || "Hotel"}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                            {/* Left Column: Dates */}
                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Calendar className="h-4 w-4" /> Check-in
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {checkinFormatted} <span className="text-[#d4af37]/70">|</span> {checkinTime}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Calendar className="h-4 w-4" /> Check-out
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {checkoutFormatted} <span className="text-[#d4af37]/70">|</span> 11:00 AM
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Room & Guests */}
                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Key className="h-4 w-4" /> Room Type
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {booking.room_type || "Deluxe Suite"}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Users className="h-4 w-4" /> Guests
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        2 Adults, 1 Child
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-[#ffffff]/10 flex items-center gap-4">
                            <div className="bg-white/10 p-2 rounded-lg border border-[#d4af37]/30">
                                <QrCode className="w-8 h-8 text-[#fceea7]" />
                            </div>
                            <div>
                                <div className="text-[#9ca3af] text-xs font-medium mb-0.5">Booking Code:</div>
                                <div className="text-[#d4af37] font-bold text-lg tracking-wider leading-none">
                                    {booking.booking_code}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stepper Preview */}
                    <div className="flex items-center justify-center gap-4 text-xs text-[#7a756a]">
                        {["Guest Details", "ID Proof", "Done"].map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-[#d4af37] text-black" : "bg-[#1c1916] border border-[#d4af37]/15 text-[#7a756a]"
                                    }`}>
                                    {i + 1}
                                </div>
                                <span>{s}</span>
                                {i < 2 && <ChevronRight className="h-3 w-3 text-[#3a3530]" />}
                            </div>
                        ))}
                    </div>

                    {/* CTA */}
                    <button
                        onClick={() => setStep(1)}
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8942d] text-black font-bold text-sm tracking-wide shadow-lg shadow-[#d4af37]/20 hover:shadow-[#d4af37]/40 transition-all duration-300 flex items-center justify-center gap-2"
                    >
                        Start Pre-Check-In
                        <ChevronRight className="h-4 w-4" />
                    </button>

                    {/* Security note */}
                    <div className="flex items-center justify-center gap-1.5 text-[#7a756a] text-xs">
                        <Lock className="h-3 w-3" />
                        <span>Your data is encrypted and secure</span>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Guest Details (Step 1) ────────────────────────────────
    if (step === 1) {
        return (
            <div className="min-h-screen bg-black px-5 py-8 font-sans">
                <div className="max-w-md mx-auto space-y-8">
                    {/* Header / Progress */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between text-[#d4af37] text-sm font-medium">
                            <span className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-[#d4af37] text-black flex items-center justify-center text-xs font-bold">1</span>
                                Step 1 of 3
                            </span>
                            <span className="text-[#7a756a]">Guest Details</span>
                        </div>
                        <div className="flex gap-2 h-1">
                            <div className="flex-1 bg-[#d4af37] rounded-full" />
                            <div className="flex-1 bg-[#2c2c2e] rounded-full" />
                            <div className="flex-1 bg-[#2c2c2e] rounded-full" />
                        </div>
                    </div>

                    {/* Primary Guest Section */}
                    <div className="space-y-4">
                        <h2 className="text-[#d4af37] text-base font-semibold text-left">Primary Guest</h2>

                        {/* Full Name */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative flex items-center justify-between">
                            <div className="flex-1">
                                <label className="block text-[#8e8e93] text-xs mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={guestForm.guest_name}
                                    onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                    placeholder="Enter Name"
                                />
                            </div>
                            {guestForm.guest_name && <Check className="h-5 w-5 text-[#d4af37]" />}
                        </div>

                        {/* Mobile */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative flex items-center justify-between">
                            <div className="flex-1">
                                <label className="block text-[#8e8e93] text-xs mb-1">Mobile</label>
                                <input
                                    type="tel"
                                    value={guestForm.phone}
                                    onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                    placeholder="+91 98765 43210"
                                />
                            </div>
                            {guestForm.phone && (
                                <div className="flex items-center gap-1 bg-[#2c4a34] px-2 py-1 rounded-md">
                                    <div className="w-3 h-3 rounded-full bg-[#4cd964] flex items-center justify-center">
                                        <Check className="h-2 w-2 text-black" />
                                    </div>
                                    <span className="text-[#4cd964] text-xs font-medium">Verified</span>
                                </div>
                            )}
                        </div>

                        {/* Email */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative">
                            <label className="block text-[#8e8e93] text-xs mb-1">Email</label>
                            <input
                                type="email"
                                value={guestForm.email}
                                onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })}
                                className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                placeholder="email@example.com"
                            />
                        </div>

                        {/* Nationality */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative flex items-center justify-between">
                            <div className="flex-1">
                                <label className="block text-[#8e8e93] text-xs mb-1">Nationality</label>
                                <select
                                    value={guestForm.nationality}
                                    onChange={(e) => setGuestForm({ ...guestForm, nationality: e.target.value })}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none appearance-none"
                                >
                                    <option value="Indian">Indian</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <ChevronDown className="h-5 w-5 text-[#d4af37]" />
                        </div>

                        {/* Address */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative">
                            <label className="block text-[#8e8e93] text-xs mb-1">Address</label>
                            <input
                                type="text"
                                value={guestForm.address}
                                onChange={(e) => setGuestForm({ ...guestForm, address: e.target.value })}
                                className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                placeholder="City, Country"
                            />
                        </div>
                    </div>

                    {/* Additional Guests Section */}
                    <div className="space-y-4">
                        <h2 className="text-[#d4af37] text-base font-semibold text-left">Additional Guests</h2>

                        <div className="bg-transparent border border-[#d4af37] rounded-3xl p-5 space-y-4">
                            {guestForm.additional_guests.map((g, i) => (
                                <div key={i} className="flex items-center justify-between pb-4 border-b border-[#3a3a3c] last:border-0 last:pb-0">
                                    <div>
                                        <div className="text-[#8e8e93] text-xs mb-1">Guest {i + 2}</div>
                                        <div className="text-white text-base font-semibold">
                                            {g.name} <span className="text-[#8e8e93] font-normal">({g.type}{g.age ? `, Age ${g.age}` : ""})</span>
                                        </div>
                                    </div>
                                    <button
                                        className="flex items-center gap-1 text-[#d4af37] text-xs font-medium"
                                        onClick={() => {
                                            // In a real app this would open a modal, for now we remove to simplify
                                            const updated = [...guestForm.additional_guests];
                                            updated.splice(i, 1);
                                            setGuestForm({ ...guestForm, additional_guests: updated });
                                        }}
                                    >
                                        <Edit2 className="h-3 w-3" /> Edit
                                    </button>
                                </div>
                            ))}

                            <button
                                onClick={() => {
                                    const name = prompt("Guest name:");
                                    if (!name) return;
                                    const type = prompt("Type (Adult/Child):", "Adult") || "Adult";
                                    const age = type === "Child" ? parseInt(prompt("Age:") || "0") : undefined;
                                    setGuestForm({
                                        ...guestForm,
                                        additional_guests: [...guestForm.additional_guests, { name, type, age }],
                                    });
                                }}
                                className="w-full flex items-center justify-center gap-2 text-[#d4af37] text-sm font-semibold pt-2"
                            >
                                <Plus className="h-4 w-4" /> Add Guest
                            </button>
                        </div>
                    </div>

                    {/* Footer Button */}
                    <div className="pt-4">
                        <button
                            onClick={() => {
                                if (!guestForm.guest_name || !guestForm.phone) {
                                    alert("Please fill in name and phone number");
                                    return;
                                }
                                setStep(2);
                            }}
                            className="w-full py-4 rounded-full bg-gradient-to-r from-[#d4af37] to-[#b8942d] text-black font-bold text-lg shadow-[0_4px_20px_rgba(212,175,55,0.3)] hover:opacity-90 transition-opacity"
                        >
                            Continue to ID Verification
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── Identity Proof (Step 2) ───────────────────────────────
    if (step === 2) {
        return (
            <Step2IdentityVerification
                idForm={idForm}
                setIdForm={setIdForm}
                handleSubmit={handleSubmit}
                submitting={submitting}
                submitError={submitError}
                setStep={setStep}
            />
        );
    }

    // ─── Success (Step 3) ──────────────────────────────────────
    if (step === 3) {
        return (
            <Step3Success
                booking={booking}
                checkinFormatted={checkinFormatted}
                checkinTime={checkinTime}
            />
        );
    }

    return null;
}
