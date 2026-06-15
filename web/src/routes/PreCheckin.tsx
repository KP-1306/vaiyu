// web/src/routes/PreCheckin.tsx
//
// Guest Self Pre-Check-In (Token-Based)
// Premium dark theme with gold accents, matching Vaiyu design language.
// 4-step flow: Welcome → Details → ID Proof → Success

import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localizeRoomType } from "../i18n/localizeRoomType";
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
import { uploadIdentityDocuments } from "../lib/storage";
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
    hotel_phone?: string;
    hotel_address?: string;
    hotel_latitude?: number;
    hotel_longitude?: number;
    room_type?: string;
    room_price?: number;
    adults?: number;
    children?: number;
    rooms_total?: number;
    qr_url?: string;
    nationality?: string;
    address?: string;
    identity_proof?: any;
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
    { value: "driving_license", label: "Driving License", placeholder: "DL-XXXXXXXXX" },
    { value: "voter_id", label: "Voter ID", placeholder: "ABC1234567" },
    { value: "other", label: "Other", placeholder: "Enter ID number" },
];

const STEP_KEYS = ["precheckin:step.guestDetails", "precheckin:step.idProof", "precheckin:step.done"];

// ─── Component ───────────────────────────────────────────────
export default function PreCheckin() {
    const { token } = useParams<{ token: string }>();
    const { t, i18n } = useTranslation(["precheckin", "common"]);
    const dateLocale = i18n.language?.split("-")[0] === "hi" ? "hi-IN-u-nu-latn" : "en-IN";

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
                        const incomingType = result.identity_proof.type || "aadhaar";
                        const id_type = (incomingType === 'aadhar') ? 'aadhaar' : incomingType;

                        setIdForm({
                            id_type: id_type,
                            id_number: (() => {
                                const num = result.identity_proof.number || "";
                                if (id_type === "aadhaar" && num.length > 4) {
                                    return `XXXX-XXXX-${num.slice(-4)}`;
                                }
                                return num;
                            })(),
                            front_captured: !!result.identity_proof.front_image,
                            back_uploaded: !!result.identity_proof.back_image,
                            front_image_url: result.identity_proof.front_image,
                            back_image_url: result.identity_proof.back_image,
                        });
                    }
                }
            } catch (err: any) {
                setBooking({ valid: false, error: err.message || t("precheckin:errors.validateFailed") });
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    // ─── Formatted dates ──────────────────────────────────────
    const checkinFormatted = useMemo(() => {
        if (!booking?.scheduled_checkin_at) return "";
        const d = new Date(booking.scheduled_checkin_at);
        return d.toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.scheduled_checkin_at, dateLocale]);

    const checkoutFormatted = useMemo(() => {
        if (!booking?.scheduled_checkout_at) return "";
        const d = new Date(booking.scheduled_checkout_at);
        return d.toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }, [booking?.scheduled_checkout_at, dateLocale]);

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
            // 1. Upload images using centralized secure logic
            const uploadResult = await uploadIdentityDocuments({
                frontImage: idForm.front_file,
                backImage: idForm.back_file,
                existingFront: booking?.identity_proof?.front_image,
                existingBack: booking?.identity_proof?.back_image,
                storageKey: booking?.identity_proof?.storage_key
            });

            const payload = {
                guest_name: guestForm.guest_name,
                phone: guestForm.phone,
                email: guestForm.email,
                nationality: guestForm.nationality,
                address: guestForm.address,
                additional_guests: guestForm.additional_guests,
                id_type: (idForm.id_type === 'aadhaar' || idForm.id_type === 'passport' || idForm.id_type === 'driving_license' || idForm.id_type === 'other') ? idForm.id_type : 'other',
                id_number: idForm.id_number.includes("XXXX") ? (booking?.identity_proof?.number || idForm.id_number) : idForm.id_number,
                front_captured: idForm.front_captured,
                back_uploaded: idForm.back_uploaded,
                front_image_url: uploadResult.frontPath,
                back_image_url: uploadResult.backPath,
                front_hash: uploadResult.frontHash,
                back_hash: uploadResult.backHash,
                storage_key: uploadResult.storageKey
            };

            const result = await submitPrecheckin(token, payload);

            if (result?.success) {
                // Merge the result (which contains qr_url) into the booking state
                setBooking(prev => prev ? { ...prev, ...result } : result);
                setStep(3); // Success
            } else {
                setSubmitError(result?.error || t("precheckin:errors.submissionFailed"));
            }
        } catch (err: any) {
            const raw = err.message || t("precheckin:errors.somethingWrong");
            // Friendly messages for constraint violations (match on the raw DB
            // constraint name — a code, not display text — then show translated copy).
            if (raw.includes("uq_global_guest_mobile") || raw.includes("mobile_normalized")) {
                setSubmitError(t("precheckin:errors.mobileTaken"));
            } else if (raw.includes("uq_global_guest_email") || raw.includes("email_normalized")) {
                setSubmitError(t("precheckin:errors.emailTaken"));
            } else if (raw.includes("duplicate key") || raw.includes("unique constraint") || raw.includes("violates unique")) {
                setSubmitError(t("precheckin:errors.duplicate"));
            } else {
                setSubmitError(raw);
            }
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
                    <p className="text-[#b8b3a8] text-sm">{t("precheckin:verifying")}</p>
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
                        {/* booking.error is a server CODE we compare on; show its translated title. */}
                        {booking?.error === "Pre-check-in already completed"
                            ? t("precheckin:errorTitle.alreadyCompleted")
                            : booking?.error === "This link has expired"
                                ? t("precheckin:errorTitle.linkExpired")
                                : t("precheckin:errorTitle.invalid")
                        }
                    </h1>
                    <p className="text-[#b8b3a8] text-sm">
                        {booking?.error === "Pre-check-in already completed"
                            ? t("precheckin:errorBody.alreadyCompleted")
                            : booking?.error === "This link has expired"
                                ? t("precheckin:errorBody.linkExpired")
                                : (booking?.error || t("precheckin:errorBody.invalidFallback"))
                        }
                    </p>
                    {booking?.completed_at && (
                        <p className="text-[#7a756a] text-xs">
                            {t("precheckin:completedOn", { date: new Date(booking.completed_at).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" }) })}
                        </p>
                    )}

                    {booking?.error === "Pre-check-in already completed" && (
                        <div className="pt-4">
                            <a
                                href="/guest"
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#d4af37] text-black font-bold text-sm hover:bg-[#b8942d] transition-colors"
                            >
                                {t("precheckin:goToPortal")}
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
            {STEP_KEYS.map((s, i) => {
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
                                {t(s)}
                            </span>
                        </div>
                        {i < STEP_KEYS.length - 1 && (
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
        const firstName = booking.guest_name?.split(" ")[0] || t("common:terms.guest");

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
                            {t("precheckin:welcomePrefix")} <span className="text-[#d4af37] font-medium">{firstName}</span>!
                        </h1>
                        <p className="text-[#b8b3a8] text-sm">{t("precheckin:welcomeSub")}</p>
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
                                        <Calendar className="h-4 w-4" /> {t("precheckin:checkin")}
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {checkinFormatted} <span className="text-[#d4af37]/70">|</span> {checkinTime}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Calendar className="h-4 w-4" /> {t("precheckin:checkout")}
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
                                        <Key className="h-4 w-4" /> {t("precheckin:roomType")}
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {localizeRoomType(booking.room_type || "Deluxe Suite", i18n.language)}
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-[#9ca3af] text-xs font-medium uppercase tracking-wide">
                                        <Users className="h-4 w-4" /> {t("precheckin:guests")}
                                    </div>
                                    <div className="text-[#fceea7] font-bold text-sm">
                                        {booking.rooms_total && booking.rooms_total > 1 ? (
                                            <span className="mr-2">{t("precheckin:rooms", { count: booking.rooms_total })} |</span>
                                        ) : null}
                                        {t("precheckin:adults", { count: booking.adults || 0 })}, {t("precheckin:children", { count: booking.children || 0 })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-[#ffffff]/10 flex items-center gap-4">
                            <div className="bg-white/10 p-2 rounded-lg border border-[#d4af37]/30">
                                <QrCode className="w-8 h-8 text-[#fceea7]" />
                            </div>
                            <div>
                                <div className="text-[#9ca3af] text-xs font-medium mb-0.5">{t("precheckin:bookingCode")}</div>
                                <div className="text-[#d4af37] font-bold text-lg tracking-wider leading-none">
                                    {booking.booking_code}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stepper Preview */}
                    <div className="flex items-center justify-center gap-4 text-xs text-[#7a756a]">
                        {STEP_KEYS.map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-[#d4af37] text-black" : "bg-[#1c1916] border border-[#d4af37]/15 text-[#7a756a]"
                                    }`}>
                                    {i + 1}
                                </div>
                                <span>{t(s)}</span>
                                {i < 2 && <ChevronRight className="h-3 w-3 text-[#3a3530]" />}
                            </div>
                        ))}
                    </div>

                    {/* CTA */}
                    <button
                        onClick={() => setStep(1)}
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8942d] text-black font-bold text-sm tracking-wide shadow-lg shadow-[#d4af37]/20 hover:shadow-[#d4af37]/40 transition-all duration-300 flex items-center justify-center gap-2"
                    >
                        {t("precheckin:startPrecheckin")}
                        <ChevronRight className="h-4 w-4" />
                    </button>

                    {/* Security note */}
                    <div className="flex items-center justify-center gap-1.5 text-[#7a756a] text-xs">
                        <Lock className="h-3 w-3" />
                        <span>{t("precheckin:encrypted")}</span>
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
                                <h3 className="text-white text-lg font-bold">{t("precheckin:existingGuest")}</h3>
                                <p className="text-[#8e8e93] text-xs leading-relaxed">
                                    {t("precheckin:existingGuestBody1")} <strong>{guestForm.email}</strong>.
                                    <br />{t("precheckin:existingGuestBody2")}
                                </p>
                            </div>

                            <div className="bg-[#2c2c2e]/50 rounded-xl p-3 text-xs space-y-1 border border-white/5">
                                <div className="flex justify-between">
                                    <span className="text-[#8e8e93]">{t("precheckin:nameLabel")}</span>
                                    <span className="text-white font-medium">{emailConflictGuest.full_name}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-[#8e8e93]">{t("precheckin:savedMobile")}</span>
                                    <span className="text-white font-medium">{emailConflictGuest.mobile || t("precheckin:na")}</span>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setEmailConflictGuest(null)} // Cancel
                                    className="flex-1 py-3 rounded-xl border border-[#3a3a3c] text-[#8e8e93] text-sm font-semibold hover:bg-[#2c2c2e] transition-colors"
                                >
                                    {t("precheckin:keepMine")}
                                </button>
                                <button
                                    onClick={() => {
                                        autofillGuest(emailConflictGuest, 'email');
                                        setEmailConflictGuest(null);
                                    }}
                                    className="flex-1 py-3 rounded-xl bg-[#d4af37] text-black text-sm font-bold hover:bg-[#b8942d] transition-colors"
                                >
                                    {t("precheckin:yesAutofill")}
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
                                {t("precheckin:stepOf", { current: 1, total: 3 })}
                            </span>
                            <span className="text-[#7a756a]">{t("precheckin:step.guestDetails")}</span>
                        </div>
                        <div className="flex gap-2 h-1">
                            <div className="flex-1 bg-[#d4af37] rounded-full" />
                            <div className="flex-1 bg-[#2c2c2e] rounded-full" />
                            <div className="flex-1 bg-[#2c2c2e] rounded-full" />
                        </div>
                    </div>

                    {/* Primary Guest Section */}
                    <div className="space-y-4">
                        <h2 className="text-[#d4af37] text-base font-semibold text-left">{t("precheckin:primaryGuest")}</h2>

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
                                        {t("precheckin:detailsLoaded")}
                                    </p>
                                    <p className="text-[#7a756a] text-[10px]">
                                        {t("precheckin:matchedVia", { method: lookupSource === "mobile" ? t("precheckin:matchMobile") : t("precheckin:matchEmail") })}
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
                                <label className="block text-[#8e8e93] text-xs mb-1">{t("precheckin:fullName")}</label>
                                <input
                                    type="text"
                                    value={guestForm.guest_name}
                                    onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                    placeholder={t("precheckin:enterName")}
                                />
                            </div>
                            {guestForm.guest_name && <Check className="h-5 w-5 text-[#d4af37]" />}
                        </div>

                        {/* Mobile */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative flex items-center justify-between">
                            <div className="flex-1">
                                <label className="block text-[#8e8e93] text-xs mb-1">{t("precheckin:mobile")}</label>
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
                            <label className="block text-[#8e8e93] text-xs mb-1">{t("precheckin:email")}</label>
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
                                <label className="block text-[#8e8e93] text-xs mb-1">{t("precheckin:nationality")}</label>
                                <select
                                    value={guestForm.nationality}
                                    onChange={(e) => setGuestForm({ ...guestForm, nationality: e.target.value })}
                                    className="w-full bg-transparent text-white text-base font-medium outline-none appearance-none"
                                >
                                    <option value="Indian">{t("precheckin:natIndian")}</option>
                                    <option value="Other">{t("precheckin:natOther")}</option>
                                </select>
                            </div>
                            <ChevronDown className="h-5 w-5 text-[#d4af37]" />
                        </div>

                        {/* Address */}
                        <div className="bg-[#1c1c1e] rounded-2xl border border-[#d4af37]/30 px-4 py-3 relative">
                            <label className="block text-[#8e8e93] text-xs mb-1">{t("precheckin:address")}</label>
                            <input
                                type="text"
                                value={guestForm.address}
                                onChange={(e) => setGuestForm({ ...guestForm, address: e.target.value })}
                                className="w-full bg-transparent text-white text-base font-medium outline-none placeholder-[#3a3a3c]"
                                placeholder={t("precheckin:addressPlaceholder")}
                            />
                        </div>
                    </div>

                    {/* Additional Guests Section */}
                    <div className="space-y-4">
                        <h2 className="text-[#d4af37] text-base font-semibold text-left">{t("precheckin:additionalGuests")}</h2>

                        <div className="bg-transparent border border-[#d4af37] rounded-3xl p-5 space-y-4">
                            {guestForm.additional_guests.map((g, i) => (
                                <div key={i} className="flex items-center justify-between pb-4 border-b border-[#3a3a3c] last:border-0 last:pb-0">
                                    <div>
                                        <div className="text-[#8e8e93] text-xs mb-1">{t("precheckin:guestN", { n: i + 2 })}</div>
                                        <div className="text-white text-base font-semibold">
                                            {/* g.type is the stored VALUE ("Adult"/"Child"); translate only for display */}
                                            {g.name} <span className="text-[#8e8e93] font-normal">({t(`precheckin:type.${g.type}`)}{g.age ? `, ${t("precheckin:ageWithValue", { age: g.age })}` : ""})</span>
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
                                        <X className="h-3 w-3" /> {t("precheckin:remove")}
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
                                <Plus className="h-4 w-4" /> {t("precheckin:addGuest")}
                            </button>
                        </div>
                    </div>

                    {/* Add Guest Modal */}
                    {isAddGuestModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                            <div className="bg-[#1c1c1e] w-full max-w-sm rounded-2xl border border-[#d4af37]/30 shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in duration-200">
                                <div className="space-y-1 text-center">
                                    <h3 className="text-white text-lg font-bold">{t("precheckin:addGuest")}</h3>
                                    <p className="text-[#8e8e93] text-xs">{t("precheckin:addGuestSub")}</p>
                                </div>

                                <div className="space-y-4">
                                    {/* Name Input */}
                                    <div className="space-y-1.5">
                                        <label className="text-[#8e8e93] text-xs font-medium ml-1">{t("precheckin:fullName")}</label>
                                        <input
                                            type="text"
                                            value={tempGuest.name}
                                            onChange={(e) => setTempGuest({ ...tempGuest, name: e.target.value })}
                                            className="w-full bg-[#2c2c2e] text-white text-sm px-4 py-3 rounded-xl border border-[#3a3a3c] focus:border-[#d4af37] focus:outline-none transition-colors"
                                            placeholder={t("precheckin:guestNamePlaceholder")}
                                            autoFocus
                                        />
                                    </div>

                                    {/* Type Selection — the value stays "Adult"/"Child" (used in logic
                                        and the submit payload); only the label is translated. */}
                                    <div className="space-y-1.5">
                                        <label className="text-[#8e8e93] text-xs font-medium ml-1">{t("precheckin:guestType")}</label>
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
                                                    {t(`precheckin:type.${type}`)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Age Input (Child Only) */}
                                    {tempGuest.type === "Child" && (
                                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                                            <label className="text-[#8e8e93] text-xs font-medium ml-1">{t("precheckin:ageLabel")}</label>
                                            <input
                                                type="number"
                                                value={tempGuest.age}
                                                onChange={(e) => setTempGuest({ ...tempGuest, age: e.target.value })}
                                                className="w-full bg-[#2c2c2e] text-white text-sm px-4 py-3 rounded-xl border border-[#3a3a3c] focus:border-[#d4af37] focus:outline-none transition-colors"
                                                placeholder={t("precheckin:agePlaceholder")}
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setIsAddGuestModalOpen(false)}
                                        className="flex-1 py-3 rounded-xl border border-[#3a3a3c] text-[#8e8e93] text-sm font-semibold hover:bg-[#2c2c2e] transition-colors"
                                    >
                                        {t("precheckin:cancel")}
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
                                        {t("precheckin:addGuest")}
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
                                    alert(t("precheckin:alertNamePhone"));
                                    return;
                                }
                                if (guestForm.phone.length !== 10) {
                                    alert(t("precheckin:alertValidMobile"));
                                    return;
                                }
                                setStep(2);
                            }}
                            className="w-full py-4 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b8942d] text-black font-bold text-lg shadow-lg shadow-[#d4af37]/20 hover:shadow-[#d4af37]/40 transition-all duration-300"
                        >
                            {t("precheckin:continueToId")}
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
                booking={booking}
                token={token}
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
