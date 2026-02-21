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
    X,
} from "lucide-react";
import { validatePrecheckinToken, submitPrecheckin, supa, lookupGuestProfile } from "../lib/api";
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
    scheduled_checkin_at?: string;
    scheduled_checkout_at?: string;
    booking_status?: string;
    hotel_id?: string;
    hotel_name?: string;
    room_type?: string;
    room_price?: number;
    adults?: number;
    children?: number;
    rooms_total?: number;
    qr_url?: string;
    nationality?: string;
    address?: string;
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
    front_file?: File;
    back_file?: File;
    front_image_url?: string;
    back_image_url?: string;
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

    // Add Guest Modal State
    const [isAddGuestModalOpen, setIsAddGuestModalOpen] = useState(false);
    const [tempGuest, setTempGuest] = useState<{ name: string; type: string; age?: string }>({
        name: "",
        type: "Adult",
        age: "",
    });

    // ─── Guest Lookup Logic ────────────────────────────────────
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupSource, setLookupSource] = useState<"mobile" | "email" | null>(null);
    const [emailConflictGuest, setEmailConflictGuest] = useState<any>(null); // Guest found via email but mobile mismatch

    // Helper to autofill
    const autofillGuest = (guest: any, source: "mobile" | "email") => {
        setGuestForm(prev => ({
            ...prev,
            guest_name: guest.full_name || prev.guest_name,
            nationality: guest.nationality || prev.nationality,
            address: guest.address || prev.address,
        }));
        setLookupSource(source);
    };

    const handleMobileBlur = async () => {
        if (!booking?.hotel_id || !guestForm.phone || guestForm.phone.length < 10) return;
        if (lookupSource === "mobile") return; // Already looked up

        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, guestForm.phone);
            if (res.found && res.match_type === 'mobile' && res.guest) {
                autofillGuest(res.guest, 'mobile');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLookupLoading(false);
        }
    };

    const handleEmailBlur = async () => {
        if (!booking?.hotel_id || !guestForm.email || !guestForm.phone) return;
        if (lookupSource === "mobile") return; // Mobile match takes precedence

        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, guestForm.phone, guestForm.email);
            if (res.found && res.match_type === 'email' && res.guest) {
                // Check conflict
                const storedMobile = res.guest.mobile?.replace(/[^0-9]/g, '');
                const currentMobile = guestForm.phone.replace(/[^0-9]/g, '');

                if (storedMobile && storedMobile !== currentMobile) {
                    // Conflict!
                    setEmailConflictGuest(res.guest);
                } else {
                    // No conflict (or mobile matches), safe to autofill
                    autofillGuest(res.guest, 'email');
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLookupLoading(false);
        }
    };

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
                        nationality: result.nationality || "Indian",
                        address: result.address || "",
                    }));

                    if (result.identity_proof) {
                        setIdForm({
                            id_type: result.identity_proof.type || "aadhaar",
                            id_number: result.identity_proof.number || "",
                            front_captured: !!result.identity_proof.front_image,
                            back_uploaded: !!result.identity_proof.back_image,
                            front_image_url: result.identity_proof.front_image,
                            back_image_url: result.identity_proof.back_image,
                        });
                    }
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
        if (!booking?.scheduled_checkin_at) return "";
        const d = new Date(booking.scheduled_checkin_at);
        return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.scheduled_checkin_at]);

    const checkoutFormatted = useMemo(() => {
        if (!booking?.scheduled_checkout_at) return "";
        const d = new Date(booking.scheduled_checkout_at);
        return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.scheduled_checkout_at]);

    const checkinTime = useMemo(() => {
        if (!booking?.scheduled_checkin_at) return "2:00 PM";
        const d = new Date(booking.scheduled_checkin_at);
        return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    }, [booking?.scheduled_checkin_at]);

    const nights = useMemo(() => {
        if (!booking?.scheduled_checkin_at || !booking?.scheduled_checkout_at) return 0;
        const ci = new Date(booking.scheduled_checkin_at);
        const co = new Date(booking.scheduled_checkout_at);
        return Math.max(1, Math.ceil((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24)));
    }, [booking?.scheduled_checkin_at, booking?.scheduled_checkout_at]);

    // ─── Submit Handler ────────────────────────────────────────
    const handleSubmit = async () => {
        if (!token) return;
        setSubmitting(true);
        setSubmitError("");

        try {
            // 1. Upload images if present
            let frontUrl = "";
            let backUrl = "";

            const supabase = supa();

            if (idForm.front_file && supabase) {
                const fileExt = idForm.front_file.name.split('.').pop();
                const fileName = `${booking?.booking_id}/front_${Date.now()}.${fileExt}`;
                const { data, error: uploadError } = await supabase.storage
                    .from('identity_proofs')
                    .upload(fileName, idForm.front_file);

                if (uploadError) {
                    console.error("Front image upload failed:", uploadError);
                    // Allow continuing even if upload fails? Maybe stricter is better.
                    // throw new Error("Failed to upload front image");
                } else {
                    frontUrl = data.path; // Store path, not public URL
                }
            }

            if (idForm.back_file && supabase) {
                const fileExt = idForm.back_file.name.split('.').pop();
                const fileName = `${booking?.booking_id}/back_${Date.now()}.${fileExt}`;
                const { data, error: uploadError } = await supabase.storage
                    .from('identity_proofs')
                    .upload(fileName, idForm.back_file);

                if (uploadError) {
                    console.error("Back image upload failed:", uploadError);
                } else {
                    backUrl = data.path; // Store path, not public URL
                }
            }

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
                front_image_url: frontUrl || idForm.front_image_url,
                back_image_url: backUrl || idForm.back_image_url,
            };

            const result = await submitPrecheckin(token, payload);

            if (result?.success) {
                // Merge the result (which contains qr_url) into the booking state
                setBooking(prev => prev ? { ...prev, ...result } : result);
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

                    {booking?.error === "Pre-check-in already completed" && (
                        <div className="pt-4">
                            <a
                                href="/guest"
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#d4af37] text-black font-bold text-sm hover:bg-[#b8942d] transition-colors"
                            >
                                Go to Stay Portal
                                <ChevronRight className="h-4 w-4" />
                            </a>
                        </div>
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
                                        {booking.rooms_total && booking.rooms_total > 1 ? (
                                            <span className="mr-2">{booking.rooms_total} Rooms |</span>
                                        ) : null}
                                        {booking.adults || 0} Adult{booking.adults !== 1 ? 's' : ''}, {booking.children || 0} Child{booking.children !== 1 ? 'ren' : ''}
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
                {/* Conflict Modal */}
                {emailConflictGuest && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-[#1c1c1e] w-full max-w-sm rounded-2xl border border-[#d4af37]/30 shadow-2xl p-6 space-y-6">
                            <div className="space-y-2 text-center">
                                <div className="mx-auto w-12 h-12 rounded-full bg-[#d4af37]/10 flex items-center justify-center mb-2">
                                    <User className="h-6 w-6 text-[#d4af37]" />
                                </div>
                                <h3 className="text-white text-lg font-bold">Existing Guest Found</h3>
                                <p className="text-[#8e8e93] text-xs leading-relaxed">
                                    We found a guest profile associated with <strong>{guestForm.email}</strong>.
                                    <br />Do you want to use the saved details?
                                </p>
                            </div>

                            <div className="bg-[#2c2c2e]/50 rounded-xl p-3 text-xs space-y-1 border border-white/5">
                                <div className="flex justify-between">
                                    <span className="text-[#8e8e93]">Name:</span>
                                    <span className="text-white font-medium">{emailConflictGuest.full_name}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#8e8e93]">Saved Mobile:</span>
                                    <span className="text-white font-medium">{emailConflictGuest.mobile || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setEmailConflictGuest(null)} // Cancel
                                    className="flex-1 py-3 rounded-xl border border-[#3a3a3c] text-[#8e8e93] text-sm font-semibold hover:bg-[#2c2c2e] transition-colors"
                                >
                                    No, Keep Mine
                                </button>
                                <button
                                    onClick={() => {
                                        autofillGuest(emailConflictGuest, 'email');
                                        setEmailConflictGuest(null);
                                    }}
                                    className="flex-1 py-3 rounded-xl bg-[#d4af37] text-black text-sm font-bold hover:bg-[#b8942d] transition-colors"
                                >
                                    Yes, Autofill
                                </button>
                            </div>
                        </div>
                    </div>
                )}

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

                        {/* Autofill Banner */}
                        {lookupSource && (
                            <div className="bg-[#1c1c1e]/50 border border-[#d4af37]/20 rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                <div className="mt-0.5">
                                    <div className="w-4 h-4 rounded-full bg-[#d4af37]/10 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-[#d4af37]" />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <p className="text-[#fceea7] text-xs font-medium">
                                        Details loaded from previous stay
                                    </p>
                                    <p className="text-[#7a756a] text-[10px]">
                                        Matched via {lookupSource === "mobile" ? "mobile number" : "email address"}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        setLookupSource(null);
                                        setGuestForm(prev => ({ ...prev, address: "", nationality: "Indian" })); // Clear filled? Or just hide banner?
                                    }}
                                    className="text-[#7a756a] hover:text-white"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

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
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                        setGuestForm({ ...guestForm, phone: val });
                                    }}
                                    onBlur={handleMobileBlur}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                    placeholder="9876543210"
                                />
                            </div>
                            {lookupLoading && <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" />}
                        </div>

                        {/* Email */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative">
                            <label className="block text-[#8e8e93] text-xs mb-1">Email</label>
                            <input
                                type="email"
                                value={guestForm.email}
                                onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })}
                                onBlur={handleEmailBlur}
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
                                            const updated = [...guestForm.additional_guests];
                                            updated.splice(i, 1);
                                            setGuestForm({ ...guestForm, additional_guests: updated });
                                        }}
                                    >
                                        <X className="h-3 w-3" /> Remove
                                    </button>
                                </div>
                            ))}

                            <button
                                onClick={() => {
                                    setTempGuest({ name: "", type: "Adult", age: "" });
                                    setIsAddGuestModalOpen(true);
                                }}
                                className="w-full flex items-center justify-center gap-2 text-[#d4af37] text-sm font-semibold pt-2"
                            >
                                <Plus className="h-4 w-4" /> Add Guest
                            </button>
                        </div>
                    </div>

                    {/* Add Guest Modal */}
                    {isAddGuestModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                            <div className="bg-[#1c1c1e] w-full max-w-sm rounded-2xl border border-[#d4af37]/30 shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in duration-200">
                                <div className="space-y-1 text-center">
                                    <h3 className="text-white text-lg font-bold">Add Guest</h3>
                                    <p className="text-[#8e8e93] text-xs">Enter details for the additional guest</p>
                                </div>

                                <div className="space-y-4">
                                    {/* Name Input */}
                                    <div className="space-y-1.5">
                                        <label className="text-[#8e8e93] text-xs font-medium ml-1">Full Name</label>
                                        <input
                                            type="text"
                                            value={tempGuest.name}
                                            onChange={(e) => setTempGuest({ ...tempGuest, name: e.target.value })}
                                            className="w-full bg-[#2c2c2e] text-white text-sm px-4 py-3 rounded-xl border border-[#3a3a3c] focus:border-[#d4af37] focus:outline-none transition-colors"
                                            placeholder="Guest Name"
                                            autoFocus
                                        />
                                    </div>

                                    {/* Type Selection */}
                                    <div className="space-y-1.5">
                                        <label className="text-[#8e8e93] text-xs font-medium ml-1">Guest Type</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {["Adult", "Child"].map((type) => (
                                                <button
                                                    key={type}
                                                    onClick={() => setTempGuest({ ...tempGuest, type })}
                                                    className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${tempGuest.type === type
                                                        ? "bg-[#d4af37]/10 border-[#d4af37] text-[#d4af37]"
                                                        : "bg-[#2c2c2e] border-[#3a3a3c] text-[#8e8e93] hover:bg-[#3a3a3c]"
                                                        }`}
                                                >
                                                    {type}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Age Input (Child Only) */}
                                    {tempGuest.type === "Child" && (
                                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                            <label className="text-[#8e8e93] text-xs font-medium ml-1">Age</label>
                                            <input
                                                type="number"
                                                value={tempGuest.age}
                                                onChange={(e) => setTempGuest({ ...tempGuest, age: e.target.value })}
                                                className="w-full bg-[#2c2c2e] text-white text-sm px-4 py-3 rounded-xl border border-[#3a3a3c] focus:border-[#d4af37] focus:outline-none transition-colors"
                                                placeholder="Age (e.g. 5)"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setIsAddGuestModalOpen(false)}
                                        className="flex-1 py-3 rounded-xl border border-[#3a3a3c] text-[#8e8e93] text-sm font-semibold hover:bg-[#2c2c2e] transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (!tempGuest.name.trim()) return;
                                            setGuestForm({
                                                ...guestForm,
                                                additional_guests: [
                                                    ...guestForm.additional_guests,
                                                    {
                                                        name: tempGuest.name,
                                                        type: tempGuest.type,
                                                        age: tempGuest.age ? parseInt(tempGuest.age) : undefined
                                                    }
                                                ]
                                            });
                                            setIsAddGuestModalOpen(false);
                                        }}
                                        disabled={!tempGuest.name.trim()}
                                        className="flex-1 py-3 rounded-xl bg-[#d4af37] text-black text-sm font-bold hover:bg-[#b8942d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add Guest
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Footer Button */}
                    <div className="pt-4">
                        <button
                            onClick={() => {
                                if (!guestForm.guest_name || !guestForm.phone) {
                                    alert("Please fill in name and phone number");
                                    return;
                                }
                                if (guestForm.phone.length !== 10) {
                                    alert("Please enter a valid 10-digit mobile number");
                                    return;
                                }
                                setStep(2);
                            }}
                            className="w-full py-4 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8942d] text-black font-bold text-lg shadow-lg shadow-[#d4af37]/20 hover:shadow-[#d4af37]/40 transition-all duration-300"
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
                token={token}
            />
        );
    }

    return null;
}
