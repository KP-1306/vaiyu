import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    Camera,
    CreditCard,
    Loader2,
    Lock,
    ShieldCheck,
    Receipt,
    Upload,
    CheckCircle2,
    ImageIcon,
    RefreshCw,
    ArrowRight,
    Users,
    X,
    Percent,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Bed
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { uploadIdentityDocuments } from "../../lib/storage";
import { CheckInStepper } from "../../components/CheckInStepper";
import type { DiscountReason, CompReason } from "../../types/rate";
import { DISCOUNT_REASON_LABELS, DISCOUNT_SOFT_CAP_PCT, COMP_REASON_LABELS } from "../../types/rate";
import { canGrantDiscount } from "../../services/rateService";
import { getPricingSettings } from "../../services/pricingService";
import {
    // Kept as type-only imports; runtime dispatch goes through the facade.
    RazorpayServiceError,
} from "../../services/razorpayService";
import { getRazorpayClient } from "../../services/razorpayClient";

export default function WalkInPayment() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const slug = searchParams.get('slug');

    const {
        guestDetails,
        stayDetails,
        roomSelections,  // [{room_id, room_type_id}] from Availability
        selectedRoomId,  // legacy single-room fallback
        pricing,
        roomNumber,
        roomType,
        hotelId
    } = location.state || {};

    const [processing, setProcessing] = useState(false);
    const [idType, setIdType] = useState(guestDetails?.id_type || "aadhaar");
    const [idNumber, setIdNumber] = useState(guestDetails?.id_number || "");
    const [idFromExistingDoc, setIdFromExistingDoc] = useState(false);

    // ─── Front-desk discount state ──────────────────────────
    // Keyed by room_id. Each entry is the per-night discount for that
    // booking_room. Reason+note are booking-level (one reason for the whole
    // discount transaction) — most real-world workflows treat the whole
    // walk-in as one negotiation, not per-room.
    const [discountsByRoom, setDiscountsByRoom] = useState<Record<string, number>>({});
    const [discountReason, setDiscountReason] = useState<DiscountReason | "">("");
    const [discountNote, setDiscountNote] = useState("");
    const [discountOpen, setDiscountOpen] = useState(false);
    const [discountError, setDiscountError] = useState<string | null>(null);
    // RBAC gate: only finance-manager-or-above can grant discretionary
    // discounts. Server enforces independently inside create_walkin_v2.
    const [canDiscount, setCanDiscount] = useState<boolean | null>(null);
    // Per-hotel discount cap from pricing_settings.max_discount_pct.
    // null = no cap (engine still warns at DISCOUNT_SOFT_CAP_PCT). Server
    // enforces independently — this is for fail-fast UX, not security.
    const [discountCapPct, setDiscountCapPct] = useState<number | null>(null);

    // ─── Payment mode ──────────────────────────────────────
    // Front-desk picks Cash or Online before they can authorize. Online is
    // disabled when the hotel hasn't been onboarded onto a Razorpay Linked
    // Account (razorpay_account_id missing).
    const [paymentMode, setPaymentMode] = useState<"CASH" | "ONLINE" | null>(null);
    const [hotelHasRazorpay, setHotelHasRazorpay] = useState<boolean>(false);
    // Razorpay mode picked by hotel in Owner Settings. NONE → online buttons stay
    // hidden; DIRECT → use hotel's own keys; ROUTE → platform Linked Account.
    const [razorpayMode, setRazorpayMode] = useState<"NONE" | "DIRECT" | "ROUTE">("NONE");
    const [paymentError, setPaymentError] = useState<string | null>(null);
    // Set when create_walkin_v3 reports the room type is reserved for an arriving
    // guest (over-commit). A manager can consciously override.
    const [reservationConflict, setReservationConflict] = useState<string | null>(null);

    // ─── Complimentary stay ────────────────────────────────
    // A comp is an authorized full waive (owner's guest, staff, service
    // recovery). Distinct from a discount; gated to finance managers
    // (`canDiscount`), bypasses the discount cap, server-audited. When on,
    // no payment is collected and the stay is flagged for reports.
    const [compMode, setCompMode] = useState(false);
    const [compReason, setCompReason] = useState<CompReason | "">("");

    useEffect(() => {
        let cancelled = false;
        if (!hotelId) {
            setCanDiscount(false);
            return;
        }
        canGrantDiscount(hotelId).then((ok) => {
            if (!cancelled) setCanDiscount(ok);
        });
        getPricingSettings(hotelId).then((s) => {
            if (!cancelled) setDiscountCapPct(s.max_discount_pct);
        }).catch(() => {
            // Settings row may not exist yet for fresh hotels; treat as no cap.
            if (!cancelled) setDiscountCapPct(null);
        });
        // Check whether this hotel is onboarded onto Razorpay Route. If
        // razorpay_account_id is set, we can offer the Online payment
        // option; otherwise the button stays disabled with a tooltip.
        supabase
            .from("hotels")
            .select("razorpay_mode, razorpay_account_id, razorpay_direct_key_id")
            .eq("id", hotelId)
            .maybeSingle()
            .then(({ data }) => {
                if (cancelled || !data) return;
                const mode = (data.razorpay_mode ?? "NONE") as "NONE" | "DIRECT" | "ROUTE";
                setRazorpayMode(mode);
                // Online button is enabled if EITHER mode is configured. Mode
                // dispatch happens at call time via getRazorpayClient(mode).
                setHotelHasRazorpay(
                    (mode === "ROUTE" && !!data.razorpay_account_id) ||
                    (mode === "DIRECT" && !!data.razorpay_direct_key_id),
                );
            });
        return () => {
            cancelled = true;
        };
    }, [hotelId]);

    const nights = stayDetails?.nights || 1;
    const selectionsList: Array<{ room_id: string; room_type_id: string | null; amount_per_night?: number; has_rate?: boolean }> =
        roomSelections || [{ room_id: selectedRoomId, room_type_id: null }];

    // A room is "unpriced" when Availability resolved no real rate for it.
    // Such a stay can only proceed as an authorized comp — otherwise we'd be
    // silently checking a guest in for free.
    const hasUnpriced = selectionsList.some((s) => !(Number(s.amount_per_night) > 0) && s.has_rate !== true);

    // Tax config flows from Availability via location.state.pricing.
    // Default 12% / exclusive matches the previous hardcoded behavior.
    const taxPct: number = Number(pricing?.taxPct ?? 12);
    const taxInclusive: boolean = !!pricing?.taxInclusive;

    // Recompute totals locally so the sidebar shows the discount in real time
    // instead of trusting the (now stale) `pricing` payload from Availability.
    const liveTotals = useMemo(() => {
        let gross = 0;
        let discount = 0;
        for (const sel of selectionsList) {
            const apn = sel.amount_per_night ?? 0;
            const dpn = discountsByRoom[sel.room_id] ?? 0;
            gross += apn * nights;
            discount += dpn * nights;
        }
        const net = Math.max(0, gross - discount);
        const taxes = taxInclusive ? 0 : net * (taxPct / 100);
        const totalPayable = taxInclusive ? net : net + taxes;
        const discountPct = gross > 0 ? (discount / gross) * 100 : 0;
        return { gross, discount, net, taxes, totalPayable, discountPct };
    }, [selectionsList, discountsByRoom, nights, taxPct, taxInclusive]);

    // Validate discount input on every change. Keeps the Authorize button
    // honest about whether the current state can actually be saved.
    useEffect(() => {
        if (liveTotals.discount === 0) {
            setDiscountError(null);
            return;
        }
        if (!discountReason) {
            setDiscountError("Pick a reason for the discount.");
            return;
        }
        for (const sel of selectionsList) {
            const apn = sel.amount_per_night ?? 0;
            const dpn = discountsByRoom[sel.room_id] ?? 0;
            if (dpn > apn) {
                setDiscountError("A discount can't exceed the room's nightly price.");
                return;
            }
            // Match the server-side cap inside create_walkin_v2 so we fail
            // fast in the UI instead of letting the RPC reject after submit.
            if (discountCapPct != null && apn > 0) {
                const pct = (dpn / apn) * 100;
                if (pct > discountCapPct) {
                    setDiscountError(
                        `Discount of ${pct.toFixed(1)}% exceeds the hotel's ${discountCapPct}% cap. Reduce or ask an authorized manager.`,
                    );
                    return;
                }
            }
        }
        setDiscountError(null);
    }, [liveTotals.discount, discountReason, discountsByRoom, selectionsList, discountCapPct]);

    // Document state
    const [frontImage, setFrontImage] = useState<File | null>(null);
    const [backImage, setBackImage] = useState<File | null>(null);
    const [existingFront, setExistingFront] = useState<string | null>(null);
    const [existingBack, setExistingBack] = useState<string | null>(null);
    const [existingProof, setExistingProof] = useState<any>(null);
    const [viewImage, setViewImage] = useState<string | null>(null);
    const [loadingDocs, setLoadingDocs] = useState(false);
    const [frontPreview, setFrontPreview] = useState<string | null>(null);
    const [backPreview, setBackPreview] = useState<string | null>(null);
    const [frontCleared, setFrontCleared] = useState(false);
    const [backCleared, setBackCleared] = useState(false);

    // Revoke blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (frontPreview) URL.revokeObjectURL(frontPreview);
            if (backPreview) URL.revokeObjectURL(backPreview);
        };
    }, [frontPreview, backPreview]);

    // Redirect if missing critical data
    useEffect(() => {
        if (!guestDetails || !stayDetails || !pricing) {
            navigate({ pathname: "../walkin", search: slug ? `?slug=${slug}` : "" });
        }
    }, [guestDetails, stayDetails, pricing, navigate]);

    // Fetch existing ID documents for returning guests
    useEffect(() => {
        async function fetchExistingDocs() {
            const mobile = guestDetails?.mobile;
            let gid = guestDetails?.id;

            // If no guest_id, try to look up guest by mobile_normalized
            if (!gid && mobile) {
                const cleanMobile = mobile.replace(/[^0-9]/g, '');
                // Handle India country code (91XXXXXXXXXX -> XXXXXXXXXX)
                const normalized = cleanMobile.length === 12 && cleanMobile.startsWith('91')
                    ? cleanMobile.slice(2)
                    : cleanMobile;

                const { data: guestRow } = await supabase
                    .from("guests")
                    .select("id")
                    .eq("mobile_normalized", normalized)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (guestRow?.id) {
                    gid = guestRow.id;
                }
            }

            if (!gid) {
                return;
            }

            // Guard: If we already have the URL or a local capture, skip the fetch
            if ((existingFront || frontPreview) && (existingBack || backPreview)) {
                return;
            }

            setLoadingDocs(true);
            try {
                // 1. Fetch the identity proof metadata via the gated RPC. We do
                //    NOT read guest_id_documents directly — that would hand the
                //    browser the document_number_hash (brute-forceable on a
                //    12-digit Aadhaar), raw storage paths, and verification
                //    internals. The RPC (active-staff-of-this-hotel only,
                //    audited) returns only { type, number(masked), storage_key }.
                //    front_image/back_image come back null by design so the
                //    returning-guest doc is not re-churned by upsert_guest_v2.
                if (!hotelId) {
                    setLoadingDocs(false);
                    return;
                }
                const { data: proof } = await supabase.rpc('get_guest_id_proof_for_checkin', {
                    p_guest_id: gid,
                    p_hotel_id: hotelId,
                });

                if (proof) {
                    setExistingProof(proof);
                }

                // Get the current session — only attempt doc fetch if authenticated
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.access_token) {
                    // No active staff session — skip fetching existing docs silently
                    return;
                }

                const headers = { Authorization: `Bearer ${session.access_token}` };

                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

                // Call secure Edge Function for both sides (JSON response)
                const fetchSide = async (side: 'front' | 'back') => {
                    // Internal Side Guard
                    if (side === 'front' && (existingFront || frontPreview || frontCleared)) return null;
                    if (side === 'back' && (existingBack || backPreview || backCleared)) return null;

                    const { data, error } = await supabase.functions.invoke('get-document-url', {
                        body: {
                            guest_id: gid,
                            side: side
                        }
                    });

                    if (error || !data) return null;

                    return {
                        docType: data.document_type,
                        docNumber: data.document_number,
                        url: data.url
                    };
                };

                const frontRes = await fetchSide('front');
                const backRes = await fetchSide('back');

                if (frontRes) {
                    if (frontRes.docType) setIdType(frontRes.docType);
                    if (frontRes.docNumber) {
                        setIdNumber(frontRes.docNumber);
                        setIdFromExistingDoc(true);
                    }
                    if (frontRes.url && !frontCleared) setExistingFront(frontRes.url);
                }
                if (backRes?.url && !backCleared) setExistingBack(backRes.url);
            } catch (err) {
                // Non-critical — silently ignore doc fetch errors
                console.warn("[WalkInPayment] Could not fetch existing docs:", err);
            } finally {
                setLoadingDocs(false);
            }
        }

        fetchExistingDocs();
    }, [guestDetails?.mobile, hotelId]);

    // resolveUrl now takes the secure path from RPC and signs it for exactly 120 seconds
    async function resolveUrl(path: string, setter: (url: string | null) => void) {
        if (!path) return;
        // If it's already a URL, use it directly
        if (path.startsWith("http") || path.startsWith("blob:")) {
            setter(path);
            return;
        }
        // It's a storage path, sign it with short expiry (120s)
        const { data } = await supabase.storage
            .from("identity_proofs")
            .createSignedUrl(path, 120);

        setter(data?.signedUrl || path);
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: "front" | "back") => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const previewUrl = URL.createObjectURL(file);

            if (side === "front") {
                if (frontPreview) URL.revokeObjectURL(frontPreview);
                setFrontImage(file);
                setFrontPreview(previewUrl);
                setExistingFront(null);
                setFrontCleared(false); // Reset cleared flag since we have new content
            } else {
                if (backPreview) URL.revokeObjectURL(backPreview);
                setBackImage(file);
                setBackPreview(previewUrl);
                setExistingBack(null);
                setBackCleared(false); // Reset cleared flag since we have new content
            }
        }
    };


    /**
     * Creates the booking + folio + charges via create_walkin_v2.
     * Does NOT record payment — that's a separate step (cash insert OR
     * Razorpay flow). Returns the booking metadata needed for the
     * downstream payment step.
     */
    const runCreateWalkInRpc = async (override = false): Promise<{
        bookingId: string;
        bookingCode: string;
        folioId: string;
        roomsCount: number;
        actorId: string | null;
    }> => {
        if (!hotelId) throw new Error("Hotel ID missing");

        // 1. Upload identity images (if newly captured)
        const uploadResult = await uploadIdentityDocuments({
            frontImage,
            backImage,
            existingFront: existingProof?.front_image,
            existingBack: existingProof?.back_image,
            storageKey: existingProof?.storage_key
        });

        // 2. Capture staff user id for audit
        const { data: { user: actorUser } } = await supabase.auth.getUser();
        const actorId = actorUser?.id ?? null;

        // 3. Build per-room selections with discount / comp fields. Comp is a
        //    booking-level decision here, so every room carries the same flag.
        //    A comp supersedes any discount (it's a full waive).
        const selections = selectionsList.map((sel) => {
            const dpn = compMode ? 0 : (discountsByRoom[sel.room_id] ?? 0);
            return {
                room_id: sel.room_id,
                room_type_id: sel.room_type_id,
                amount_per_night: sel.amount_per_night,
                discount_per_night: dpn > 0 ? dpn : undefined,
                discount_reason: dpn > 0 ? discountReason : undefined,
                discount_note: dpn > 0 ? (discountNote.trim() || undefined) : undefined,
                is_complimentary: compMode || undefined,
                comp_reason: compMode ? (compReason || undefined) : undefined,
            };
        });

        // 4. Run the RPC
        const { data, error } = await supabase.rpc("create_walkin_v3", {
            p_override: override,
            p_hotel_id: hotelId,
            p_guest_details: {
                ...guestDetails,
                id_type: (idType === 'aadhaar' || idType === 'passport' || idType === 'driving_license' || idType === 'other') ? idType : 'other',
                id_number: idNumber,
                front_image_path: uploadResult.frontPath,
                back_image_path: uploadResult.backPath,
                storage_key: uploadResult.storageKey,
                front_hash: uploadResult.frontHash,
                back_hash: uploadResult.backHash
            },
            p_room_selections: selections,
            p_checkin_date: stayDetails.checkin_date,
            p_checkout_date: stayDetails.checkout_date,
            p_adults: stayDetails.adults,
            p_children: stayDetails.children,
            p_actor_id: actorId,
        });

        if (error) throw error;
        if (!data?.booking_id || !data?.folio_id) {
            throw new Error("Walk-in succeeded but booking/folio id missing");
        }

        return {
            bookingId: data.booking_id,
            bookingCode: data.booking_code,
            folioId: data.folio_id,
            roomsCount: selections.length,
            actorId,
        };
    };

    const handlePayment = async (override = false) => {
        setReservationConflict(null);
        // Validation gates
        // Identity is mandatory at check-in (compliance) — the *'d fields on the form.
        if (!idType) { setPaymentError("Select an ID type."); return; }
        if (!idNumber.trim()) { setPaymentError("Enter the guest's ID number."); return; }
        if (idType === 'aadhaar' && idNumber.replace(/\D/g, '').length !== 12) {
            setPaymentError("Aadhaar number must be 12 digits."); return;
        }
        if (!frontImage && !existingFront) { setPaymentError("Capture the front of the guest's ID."); return; }
        if (compMode) {
            // Comp path: authorized full waive. No payment, no discount checks.
            if (!compReason) { setPaymentError("Pick a reason for the complimentary stay."); return; }
        } else {
            if (discountError) { setPaymentError(discountError); return; }
            // Block silent free check-ins: an unpriced room must be priced or comped.
            if (hasUnpriced) {
                setPaymentError("This room has no rate set. Set a rate in Pricing, or mark the stay complimentary.");
                return;
            }
            if (!paymentMode) { setPaymentError("Choose a settlement method to continue."); return; }
        }

        setProcessing(true);
        setPaymentError(null);

        let booking: { bookingId: string; bookingCode: string; folioId: string; roomsCount: number; actorId: string | null } | null = null;

        try {
            // Step 1 — booking + charges (RPC flags + audits the comp itself)
            booking = await runCreateWalkInRpc(override);

            // Step 2 — collect payment based on mode. Comp stays nett ₹0 — the
            // folio already balances, so there is nothing to collect and we
            // deliberately record NO payment row.
            if (compMode) {
                // nothing to collect
            } else if (paymentMode === "CASH") {
                // Direct insert. Trigger trg_payment_to_folio creates the
                // matching folio_entries PAYMENT row when status='COMPLETED'.
                const { error: payErr } = await supabase.from("payments").insert({
                    hotel_id: hotelId,
                    booking_id: booking.bookingId,
                    folio_id: booking.folioId,
                    amount: liveTotals.totalPayable,
                    currency: "INR",
                    method: "CASH",
                    status: "COMPLETED",
                    collected_by: booking.actorId,
                    notes: "Cash collected at front desk (walk-in)",
                });
                if (payErr) throw new Error(`Cash payment record failed: ${payErr.message}`);
            } else if (paymentMode === "ONLINE") {
                // Razorpay flow: facade dispatches to Route or Direct based on
                // the hotel's razorpay_mode (chosen in Owner Settings).
                const rzp = getRazorpayClient(razorpayMode);
                const order = await rzp.createWalkInOrder({
                    hotelId,
                    bookingId: booking.bookingId,
                });
                const checkoutResult = await rzp.openRazorpayCheckout(order);
                if (!checkoutResult.ok) {
                    if (checkoutResult.reason === "DISMISSED") {
                        throw new Error(
                            `Payment cancelled. Booking ${booking.bookingCode} is saved with balance due — retry payment or switch to cash.`,
                        );
                    } else {
                        const desc = checkoutResult.error?.description ?? "Razorpay rejected the payment";
                        throw new Error(`Payment failed: ${desc}. Booking ${booking.bookingCode} is saved with balance due.`);
                    }
                }
                await rzp.verifyWalkInPayment({
                    hotelId,
                    bookingId: booking.bookingId,
                    folioId: booking.folioId,
                    orderId: checkoutResult.orderId,
                    paymentId: checkoutResult.paymentId,
                    signature: checkoutResult.signature,
                });
            }

            // Step 3 — success
            navigate({ pathname: "../success", search: slug ? `?slug=${slug}` : "" }, {
                state: {
                    roomNumber: roomNumber || "Assigned",
                    bookingCode: booking.bookingCode,
                    roomsCount: booking.roomsCount,
                    hotelId,
                }
            });
        } catch (err: any) {
            console.error("Walk-in payment failed", err);
            const msg = err instanceof RazorpayServiceError
                ? err.message
                : (err?.message ?? "Payment/Check-in failed");
            if (/reservation_conflict/i.test(msg)) {
                setReservationConflict(
                    "This room type is reserved for an arriving guest on these dates — no inventory is free. A manager can override to place this walk-in anyway.",
                );
            } else {
                setPaymentError(msg);
            }
        } finally {
            setProcessing(false);
        }
    };

    if (!guestDetails || !pricing) return null;

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment & Verification"];

    return (
        <div className="checkin-container py-8 sm:py-16 px-6 sm:px-10">
            <div className="mx-auto max-w-7xl space-y-12 sm:space-y-16 pb-20">
                {/* ── Progress Identification ── */}
                <div className="flex justify-center">
                    <div className="w-full max-w-xl px-4">
                        <CheckInStepper steps={WALKIN_STEPS} currentStep={2} />
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-12 items-start">

                    {/* LEFT: Identity Section */}
                    <div className="flex-1 space-y-12 w-full">
                        <div className="space-y-8 pl-2">
                            <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-gold-400/5 border border-gold-400/20 text-gold-400 text-[9px] font-black uppercase tracking-[0.4em] backdrop-blur-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-pulse shadow-[0_0_12px_rgba(212,175,55,0.6)]" />
                                Security Protocol
                            </div>
                            <div className="space-y-3">
                                <h2 className="text-4xl sm:text-4xl font-light tracking-tighter text-white leading-[1.1]">
                                    Checkout & <span className="text-gold-400/80 font-medium">Verification</span>
                                </h2>
                                <div className="flex items-center gap-4 text-white/30 font-medium text-xs">
                                    <span className="w-8 h-px bg-white/10" />
                                    <span className="flex items-center gap-3">
                                        Secure provisioning for
                                        <span className="text-gold-400 font-black uppercase tracking-[0.2em] text-[9px] bg-gold-400/10 px-3 py-1 rounded-lg border border-gold-400/10">
                                            Unit {roomNumber || 'Selection'}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="gn-card premium-glass relative overflow-hidden group">
                            <div className="space-y-12">
                                <div className="flex items-center gap-6 border-b border-white/5 pb-10">
                                    <div className="w-14 h-14 rounded-2xl bg-gold-400/10 flex items-center justify-center text-gold-400 ring-1 ring-gold-400/20 shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                                        <ShieldCheck className="h-7 w-7" />
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-2xl font-light text-white tracking-tight">Identity Verification</h3>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                    <div className="space-y-3">
                                        <div className="flex h-6 items-center">
                                            <label className="mb-0">Id Type *</label>
                                        </div>
                                        <div className="relative group">
                                            <select
                                                required
                                                className="gn-input h-[52px] appearance-none bg-no-repeat bg-[right_1.5rem_center] transition-all group-hover:border-gold-400/50"
                                                value={idType}
                                                onChange={e => setIdType(e.target.value)}
                                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(212, 175, 55, 1)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundSize: '1.2em' }}
                                            >
                                                <option value="aadhaar" className="bg-slate-900">Aadhaar Card</option>
                                                <option value="passport" className="bg-slate-900">Passport</option>
                                                <option value="driving_license" className="bg-slate-900">Driving License</option>
                                                <option value="other" className="bg-slate-900">Voter ID / Other</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex h-6 items-center justify-between">
                                            <label className="mb-0">Id Number *</label>
                                            {idFromExistingDoc && (
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">Verified</span>
                                                </div>
                                            )}
                                        </div>
                                        {idFromExistingDoc ? (
                                            <div className="flex items-center gap-4 gn-input bg-white/[0.02] border-gold-400/20 h-[52px]">
                                                <Lock className="h-4 w-4 text-gold-400/40 shrink-0" />
                                                <span className="flex-1 font-mono text-gold-400 tracking-[0.4em] text-sm">
                                                    **** **** {idNumber.slice(-4)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => { setIdNumber(''); setIdFromExistingDoc(false); }}
                                                    className="text-[9px] font-black uppercase tracking-widest text-white/20 hover:text-white transition-colors"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        ) : (
                                            <input
                                                required
                                                className="gn-input h-[52px]"
                                                value={idNumber}
                                                onChange={e => setIdNumber(e.target.value)}
                                                placeholder={idType === 'aadhaar' ? 'XXXX-XXXX-XXXX' : 'Capture identifier number'}
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Document Capture Blocks */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                    {/* Front Side */}
                                    <div className="space-y-4">
                                        <div className="flex h-6 items-center">
                                            <label className="mb-0">Front Id *</label>
                                        </div>
                                        {loadingDocs ? (
                                            <div className="gn-card bg-white/5 border-dashed border-white/10 py-20 flex flex-col items-center justify-center gap-4">
                                                <Loader2 className="h-10 w-10 animate-spin text-gold-400/30" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-400/40">Synchronizing...</span>
                                            </div>
                                        ) : (existingFront || frontPreview) ? (
                                            <div className="relative overflow-hidden w-full bg-black/40 border border-white/10 rounded-3xl group/doc transition-all duration-500 hover:border-gold-400/30">
                                                {/* Full-Bleed Image Bar */}
                                                <div className="relative aspect-[3/2] w-full overflow-hidden bg-black/60 border-b border-white/5">
                                                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent opacity-60" />
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-40 group-hover/doc:opacity-100 transition-all z-20">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">{frontPreview ? 'New Capture' : 'Secure Archive'}</p>
                                                    </div>
                                                    <img src={frontPreview || existingFront || ''} alt="Front ID" className="h-full w-full object-cover blur-md opacity-60 transition-all duration-700 group-hover/doc:opacity-80 group-hover/doc:blur-none" />
                                                    <div className="absolute bottom-4 left-4 flex items-center gap-3 z-20">
                                                        <div className={`w-2 h-2 rounded-full ${frontPreview ? 'bg-green-400' : 'bg-gold-400'} shadow-[0_0_10px_rgba(212,175,55,0.8)]`} />
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/90">{frontPreview ? 'New Capture' : 'Archived Record'}</span>
                                                    </div>
                                                </div>
                                                {/* Edge-to-Edge Action Bar */}
                                                <div className="flex w-full divide-x divide-white/5 bg-white/[0.02]">
                                                    <button type="button" onClick={() => setViewImage(frontPreview || existingFront)} className="flex-1 py-5 text-[10px] font-black text-gold-100/60 hover:bg-white/5 hover:text-white transition-all uppercase tracking-[0.2em]">Preview</button>
                                                    <button type="button" onClick={() => { 
                                                        setExistingFront(null); 
                                                        setFrontImage(null); 
                                                        if (frontPreview) URL.revokeObjectURL(frontPreview);
                                                        setFrontPreview(null);
                                                        setFrontCleared(true);
                                                    }} className="flex-1 py-5 text-[10px] font-black text-gold-400 hover:bg-gold-400/[0.05] transition-all uppercase tracking-[0.2em]">Replace</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="relative group/upload h-full">
                                                <input type="file" accept="image/*" className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-10" onChange={(e) => handleFileChange(e, "front")} />
                                                <div className="gn-card border-dashed border-white/10 py-16 flex flex-col items-center justify-center gap-8 group-hover/upload:border-gold-400/40 group-hover/upload:bg-gold-400/[0.02] transition-all duration-500">
                                                    <div className="w-16 h-16 rounded-[1.5rem] bg-white/5 flex items-center justify-center text-gold-400/10 group-hover/upload:text-gold-400 group-hover/upload:bg-gold-400/10 transition-all duration-500">
                                                        <Camera className="h-8 w-8" />
                                                    </div>
                                                    <div className="text-center space-y-2">
                                                        <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/40 group-hover/upload:text-gold-400">Secure Capture</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Back Side */}
                                    <div className="space-y-4">
                                        <div className="flex h-6 items-center">
                                            <label className="mb-0">Back Id</label>
                                        </div>
                                        { (existingBack || backPreview) ? (
                                            <div className="relative overflow-hidden w-full bg-black/40 border border-white/10 rounded-3xl group/doc transition-all duration-500 hover:border-white/30">
                                                {/* Full-Bleed Image Bar */}
                                                <div className="relative aspect-[3/2] w-full overflow-hidden bg-black/60 border-b border-white/5">
                                                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent opacity-60" />
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-40 group-hover/doc:opacity-100 transition-all z-20">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">{backPreview ? 'New Capture' : 'Secure Archive'}</p>
                                                    </div>
                                                    <img src={backPreview || existingBack || ''} alt="Back ID" className="h-full w-full object-cover blur-md opacity-60 transition-all duration-700 group-hover/doc:opacity-80 group-hover/doc:blur-none" />
                                                    <div className="absolute bottom-4 left-4 flex items-center gap-3 z-20">
                                                        <div className={`w-2 h-2 rounded-full ${backPreview ? 'bg-green-400' : 'bg-gold-400'} shadow-[0_0_10px_rgba(212,175,55,0.8)]`} />
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/90">{backPreview ? 'New Capture' : 'Archived Record'}</span>
                                                    </div>
                                                </div>
                                                {/* Edge-to-Edge Action Bar */}
                                                <div className="flex w-full divide-x divide-white/5 bg-white/[0.02]">
                                                    <button type="button" onClick={() => setViewImage(backPreview || existingBack)} className="flex-1 py-5 text-[10px] font-black text-gold-100/60 hover:bg-white/5 hover:text-white transition-all uppercase tracking-[0.2em]">Preview</button>
                                                    <button type="button" onClick={() => {
                                                        setExistingBack(null);
                                                        setBackImage(null);
                                                        if (backPreview) URL.revokeObjectURL(backPreview);
                                                        setBackPreview(null);
                                                        setBackCleared(true);
                                                    }} className="flex-1 py-5 text-[10px] font-black text-white/40 hover:text-white transition-all uppercase tracking-[0.2em]">Replace</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="relative group/upload h-full">
                                                <input type="file" accept="image/*" className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-10" onChange={(e) => handleFileChange(e, "back")} />
                                                <div className="gn-card border-dashed border-white/10 py-16 flex flex-col items-center justify-center gap-8 group-hover/upload:border-gold-400/40 group-hover/upload:bg-gold-400/[0.02] transition-all duration-500">
                                                    <div className="w-16 h-16 rounded-[1.5rem] bg-white/5 flex items-center justify-center text-white/5 group-hover/upload:text-gold-400 group-hover/upload:bg-gold-400/10 transition-all duration-500">
                                                        <Upload className="h-8 w-8" />
                                                    </div>
                                                    <div className="text-center space-y-2">
                                                        <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/40 group-hover/upload:text-gold-400">Upload Inverse</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: Unified Financial Resolution Sidebar */}
                    <div className="w-full lg:w-[380px] shrink-0 sticky top-10 space-y-8">
                        <div className="gn-card premium-glass relative overflow-hidden border-gold-400/10 p-8 pt-0">
                            {/* ── Bill Narrative Section ── */}
                            <div className="flex items-center gap-5 border-b border-white/5 py-8">
                                <div className="w-12 h-12 rounded-2xl bg-gold-400/10 flex items-center justify-center text-gold-400 ring-1 ring-gold-400/20">
                                    <Receipt className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-xl font-light text-white tracking-tight">Financial Resolution</h3>
                                    <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-gold-400/30">Detailed valuation</p>
                                </div>
                            </div>

                            <div className="space-y-6 pt-8 pb-6">
                                <div className="flex justify-between items-center px-2">
                                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Base Rent</span>
                                    <span className="text-lg font-light text-white tracking-tight">₹{liveTotals.gross.toLocaleString()}</span>
                                </div>
                                {liveTotals.discount > 0 && (
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-400/80 flex items-center gap-1">
                                            <Percent className="h-3 w-3" />
                                            Discount {liveTotals.discountPct.toFixed(1)}%
                                        </span>
                                        <span className="text-lg font-light text-emerald-400 tracking-tight">−₹{liveTotals.discount.toLocaleString()}</span>
                                    </div>
                                )}
                                {!taxInclusive && taxPct > 0 && (
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Taxation ({taxPct}%)</span>
                                        <span className="text-lg font-light text-white tracking-tight">₹{liveTotals.taxes.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                    </div>
                                )}
                                {taxInclusive && (
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Tax (inclusive)</span>
                                        <span className="text-lg font-light text-white/40 tracking-tight">included</span>
                                    </div>
                                )}
                                <div className="pt-8 border-t border-gold-400/10 flex justify-between items-end px-2">
                                    <div className="space-y-1">
                                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-gold-400">Net Total</span>
                                        <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest">{compMode ? "Complimentary" : "Final Payable"}</p>
                                    </div>
                                    {compMode ? (
                                        <span className="text-4xl font-light text-emerald-300 tracking-tighter drop-shadow-2xl">₹0</span>
                                    ) : (
                                        <span className="text-4xl font-light text-white tracking-tighter shadow-gold-400/10 drop-shadow-2xl">
                                            ₹{Math.round(liveTotals.totalPayable).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* ── Front-desk discount panel — gated on canDiscount.
                                 Hidden under comp: a comp is a full waive, so a
                                 partial discount is meaningless (and the server
                                 ignores it). Avoids a stale, confusing display. ── */}
                            {canDiscount && !compMode && (
                            <div className="border-t border-white/5 pt-5 pb-2">
                                <button
                                    type="button"
                                    onClick={() => setDiscountOpen(v => !v)}
                                    className="w-full flex items-center justify-between text-left group"
                                    aria-expanded={discountOpen}
                                >
                                    <span className="flex items-center gap-2.5">
                                        <span className="w-7 h-7 rounded-lg bg-gold-400/10 ring-1 ring-gold-400/20 flex items-center justify-center">
                                            <Percent className="h-3.5 w-3.5 text-gold-400" />
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-400/80">
                                            Apply Discount
                                        </span>
                                        {liveTotals.discount > 0 && (
                                            <span className="rounded-full bg-emerald-500/15 text-emerald-300 px-2.5 py-0.5 text-[10px] font-bold normal-case tracking-normal">
                                                −₹{liveTotals.discount.toLocaleString()} ({liveTotals.discountPct.toFixed(0)}%)
                                            </span>
                                        )}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 group-hover:text-white/70 transition-colors">
                                        {discountOpen ? "Hide" : "Edit"}
                                        {discountOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </span>
                                </button>

                                {discountOpen && (
                                    <div className="mt-5 space-y-5">
                                        {/* Cap subtext — surfaces the per-hotel policy so staff
                                            knows the ceiling before typing rather than discovering
                                            it via a server reject after submit. */}
                                        <div className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2">
                                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                                                Hotel policy
                                            </span>
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                                                {discountCapPct != null
                                                    ? <>Max <span className="text-gold-400">{discountCapPct}%</span> per room</>
                                                    : <span className="text-white/40 normal-case tracking-normal">No cap configured</span>}
                                            </span>
                                        </div>

                                        {/* Per-room discount cards */}
                                        <div className="space-y-3">
                                            {selectionsList.map((sel, idx) => {
                                                const apn = sel.amount_per_night ?? 0;
                                                const dpn = discountsByRoom[sel.room_id] ?? 0;
                                                const pct = apn > 0 ? (dpn / apn) * 100 : 0;
                                                const lineTotalSaved = dpn * nights;
                                                // Effective ceiling: 100% by default, capped further by
                                                // pricing_settings.max_discount_pct when set. Both the
                                                // <input max> and the preset chips clamp to this.
                                                const effectiveMaxPct = Math.min(100, discountCapPct ?? 100);
                                                const atCap = discountCapPct != null && pct >= discountCapPct - 0.05;
                                                const nearCap = discountCapPct != null && !atCap && pct >= discountCapPct - 5;
                                                // Primary lever is %, but the API contract is rupees per
                                                // night, so we convert at the boundary. Storage stays in ₹
                                                // to preserve roundtripping with the server / folio.
                                                const setRoomDiscountPct = (newPct: number) => {
                                                    const cleaned = Math.max(0, Math.min(effectiveMaxPct, Number.isFinite(newPct) ? newPct : 0));
                                                    const rupees = +(apn * cleaned / 100).toFixed(2);
                                                    setDiscountsByRoom(prev => ({ ...prev, [sel.room_id]: rupees }));
                                                };
                                                const displayPct = apn > 0 ? +(dpn / apn * 100).toFixed(2) : 0;
                                                const PRESETS = [5, 10, 15, 20];
                                                const roomLabel =
                                                    (sel as any).room_number
                                                        ? `Room ${(sel as any).room_number}`
                                                        : `Room ${idx + 1}`;
                                                return (
                                                    <div
                                                        key={sel.room_id || idx}
                                                        className={
                                                            "rounded-2xl p-4 space-y-3 transition-colors border " +
                                                            (dpn > 0
                                                                ? "bg-emerald-500/[0.04] border-emerald-500/20"
                                                                : "bg-white/[0.02] border-white/[0.06]")
                                                        }
                                                    >
                                                        {/* Header: room + per-night rate */}
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <Bed className="h-3.5 w-3.5 text-white/30" />
                                                                <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">
                                                                    {roomLabel}
                                                                </span>
                                                            </div>
                                                            <span className="text-[11px] text-white/40 tabular-nums">
                                                                ₹{apn.toLocaleString()} / night
                                                            </span>
                                                        </div>

                                                        {/* Primary lever: percentage. Right cell shows the
                                                            resolved per-night ₹ so staff can quote the guest
                                                            both the % and the concrete savings. */}
                                                        {/* Color semantics: rose = actual error (above cap, blocks
                                                            submit); amber = at/near cap (valid but at policy limit);
                                                            emerald = active discount; neutral = no discount. */}
                                                        <div
                                                            className={
                                                                "flex items-stretch rounded-xl border bg-white/[0.04] focus-within:ring-2 transition " +
                                                                (atCap || nearCap
                                                                    ? "border-amber-500/40 focus-within:border-amber-500/60 focus-within:ring-amber-500/15"
                                                                    : dpn > 0
                                                                        ? "border-emerald-500/30 focus-within:border-gold-400/50 focus-within:ring-gold-400/15"
                                                                        : "border-white/[0.08] focus-within:border-gold-400/50 focus-within:ring-gold-400/15")
                                                            }
                                                        >
                                                            <input
                                                                type="number"
                                                                inputMode="decimal"
                                                                min={0}
                                                                max={effectiveMaxPct}
                                                                step={0.5}
                                                                value={displayPct || ""}
                                                                onChange={(e) => {
                                                                    const v = Number(e.target.value);
                                                                    setRoomDiscountPct(Number.isFinite(v) ? v : 0);
                                                                }}
                                                                placeholder="0"
                                                                className="flex-1 bg-transparent pl-4 pr-2 py-2.5 text-base text-white placeholder-white/25 focus:outline-none tabular-nums"
                                                                aria-label={`Discount percent for ${roomLabel}`}
                                                            />
                                                            <span
                                                                className={
                                                                    "pr-3 flex items-center text-base font-semibold " +
                                                                    (dpn === 0
                                                                        ? "text-white/40"
                                                                        : atCap || pct > DISCOUNT_SOFT_CAP_PCT
                                                                            ? "text-amber-400"
                                                                            : "text-emerald-300")
                                                                }
                                                            >
                                                                %
                                                            </span>
                                                            {dpn > 0 && (
                                                                <span className={
                                                                    "px-3 flex items-center text-xs font-bold tabular-nums border-l whitespace-nowrap " +
                                                                    (atCap
                                                                        ? "border-amber-500/30 text-amber-300"
                                                                        : "border-emerald-500/20 text-emerald-300")
                                                                }>
                                                                    −₹{Math.round(dpn).toLocaleString()}/n
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* At-cap is a valid state — server accepts equality.
                                                            We use amber (warning/limit-reached), NOT rose (error).
                                                            The Authorize button stays enabled because there's
                                                            nothing to fix; the message just informs staff that
                                                            this is the ceiling. */}
                                                        {dpn > 0 && atCap && discountCapPct != null && (
                                                            <div className="flex items-start gap-2 rounded-lg bg-amber-500/[0.08] border border-amber-500/25 px-3 py-2">
                                                                <Lock className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                                                <p className="text-[11px] text-amber-100 leading-relaxed">
                                                                    At the hotel's <span className="font-bold">{discountCapPct}%</span> ceiling — this is the highest discount allowed for this hotel. Raise the cap on the Pricing page if you need to go higher.
                                                                </p>
                                                            </div>
                                                        )}
                                                        {dpn > 0 && !atCap && nearCap && discountCapPct != null && (
                                                            <div className="flex items-start gap-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/20 px-3 py-2">
                                                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                                                <p className="text-[11px] text-amber-100 leading-relaxed">
                                                                    Close to the hotel's <span className="font-bold">{discountCapPct}%</span> ceiling.
                                                                </p>
                                                            </div>
                                                        )}

                                                        {/* Quick presets — fastest path for staff */}
                                                        <div className="flex flex-wrap gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => setRoomDiscountPct(0)}
                                                                disabled={dpn === 0}
                                                                className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:bg-white/[0.05] transition disabled:opacity-30 disabled:cursor-not-allowed"
                                                            >
                                                                Clear
                                                            </button>
                                                            {PRESETS.map(p => {
                                                                const isActive = apn > 0 && Math.round(pct) === p;
                                                                const overCap = p > effectiveMaxPct;
                                                                return (
                                                                    <button
                                                                        key={p}
                                                                        type="button"
                                                                        onClick={() => setRoomDiscountPct(p)}
                                                                        disabled={overCap}
                                                                        title={overCap ? `Above hotel cap of ${discountCapPct}%` : undefined}
                                                                        className={
                                                                            "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border transition disabled:cursor-not-allowed inline-flex items-center gap-1 " +
                                                                            (isActive
                                                                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                                                                                : overCap
                                                                                    ? "border-rose-500/15 bg-rose-500/[0.04] text-rose-300/50 line-through"
                                                                                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:bg-white/[0.05]")
                                                                        }
                                                                    >
                                                                        {overCap && <Lock className="h-2.5 w-2.5 no-underline" />}
                                                                        {p}%
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>

                                                        {/* Line preview — shows what's actually saved */}
                                                        {dpn > 0 && (
                                                            <div className="flex items-center justify-between text-[11px] pt-1">
                                                                <span className="text-white/40">
                                                                    × {nights} night{nights === 1 ? "" : "s"}
                                                                </span>
                                                                <span className="text-emerald-300 font-semibold tabular-nums">
                                                                    −₹{lineTotalSaved.toLocaleString()} off
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Aggregate discount preview when more than one room is discounted */}
                                        {liveTotals.discount > 0 && selectionsList.length > 1 && (
                                            <div className="flex items-center justify-between rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 px-4 py-2.5">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
                                                    Total Discount
                                                </span>
                                                <span className="text-base font-semibold text-emerald-300 tabular-nums">
                                                    −₹{liveTotals.discount.toLocaleString()}
                                                </span>
                                            </div>
                                        )}

                                        {liveTotals.discount > 0 && (
                                            <>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                                                        Reason <span className="text-rose-400">*</span>
                                                    </label>
                                                    <select
                                                        value={discountReason}
                                                        onChange={(e) => setDiscountReason(e.target.value as DiscountReason | "")}
                                                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-gold-400/50 focus:ring-2 focus:ring-gold-400/15 transition"
                                                    >
                                                        <option value="" className="bg-slate-900">Pick a reason…</option>
                                                        {(Object.keys(DISCOUNT_REASON_LABELS) as DiscountReason[]).map(k => (
                                                            <option key={k} value={k} className="bg-slate-900">
                                                                {DISCOUNT_REASON_LABELS[k]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                                                        Note <span className="font-normal normal-case text-white/30 tracking-normal">(optional · audit trail)</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={discountNote}
                                                        onChange={(e) => setDiscountNote(e.target.value)}
                                                        placeholder="e.g. Approved by Mr. Sharma"
                                                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-gold-400/50 focus:ring-2 focus:ring-gold-400/15 transition"
                                                    />
                                                </div>

                                                {liveTotals.discountPct > DISCOUNT_SOFT_CAP_PCT && (
                                                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 flex items-start gap-2.5">
                                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                                        <p className="text-[11px] text-amber-100 leading-relaxed">
                                                            Discount exceeds <span className="font-bold">{DISCOUNT_SOFT_CAP_PCT}%</span>. This will be flagged in finance reports — make sure the reason and note capture management approval.
                                                        </p>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {discountError && (
                                            <p className="text-xs text-rose-300 px-1">{discountError}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                            )}

                            {/* ── Complimentary / no-rate handling ── */}
                            {(hasUnpriced || compMode || canDiscount) && (
                            <div className="pt-8 border-t border-white/5 space-y-4">
                                {/* Unpriced warning when not comping */}
                                {hasUnpriced && !compMode && (
                                    <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
                                        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300 mb-1">No rate set</div>
                                            <div className="text-xs text-amber-200/90 leading-relaxed">
                                                This room has no rate configured. Set a rate in Pricing, or mark this stay complimentary{canDiscount ? " below" : ""}.
                                                {canDiscount === false && " A manager must authorize a complimentary stay."}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Comp toggle — finance managers only */}
                                {canDiscount && (
                                    <div className="space-y-4">
                                        <button
                                            type="button"
                                            onClick={() => { setCompMode((v) => !v); setPaymentError(null); }}
                                            aria-pressed={compMode}
                                            className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                                                compMode
                                                    ? "bg-emerald-500/10 border-emerald-500/50"
                                                    : "bg-white/[0.02] border-white/5 hover:border-emerald-500/30"
                                            }`}
                                        >
                                            <div className="space-y-0.5">
                                                <div className="text-sm font-medium text-white tracking-tight">Mark stay complimentary</div>
                                                <div className="text-[8px] font-bold uppercase tracking-widest text-emerald-300/40">Authorized full waive · no payment</div>
                                            </div>
                                            <div className={`w-10 h-6 rounded-full p-0.5 transition-all ${compMode ? "bg-emerald-400" : "bg-white/10"}`}>
                                                <div className={`w-5 h-5 rounded-full bg-white transition-transform ${compMode ? "translate-x-4" : ""}`} />
                                            </div>
                                        </button>

                                        {compMode && (
                                            <div className="space-y-2 pl-1">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                                                    Reason <span className="text-rose-400">*</span>
                                                </label>
                                                <select
                                                    value={compReason}
                                                    onChange={(e) => setCompReason(e.target.value as CompReason | "")}
                                                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/15 transition"
                                                >
                                                    <option value="" className="bg-slate-900">Pick a reason…</option>
                                                    {(Object.keys(COMP_REASON_LABELS) as CompReason[]).map((k) => (
                                                        <option key={k} value={k} className="bg-slate-900">{COMP_REASON_LABELS[k]}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[11px] text-white/40">No payment is collected. The stay is flagged complimentary and recorded in the audit log.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            )}

                            {/* ── Settlement & Payment Section ── */}
                            <div className="pt-8 border-t border-white/5 space-y-6">
                                {compMode ? (
                                    <div className="flex items-center justify-between p-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06]">
                                        <div className="text-sm font-medium text-white tracking-tight">Complimentary stay</div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">No payment · ₹0</div>
                                    </div>
                                ) : (
                                <>
                                <div className="flex items-center gap-4 px-2">
                                    <CreditCard className="h-4 w-4 text-gold-400/40" />
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Settlement Method</span>
                                </div>

                                <div className="space-y-4">
                                    {/* Cash — always available */}
                                    <button
                                        type="button"
                                        onClick={() => setPaymentMode("CASH")}
                                        aria-pressed={paymentMode === "CASH"}
                                        className={`w-full group/btn relative flex items-center justify-between p-5 rounded-2xl border transition-all duration-500 text-left ${
                                            paymentMode === "CASH"
                                                ? "bg-gold-400/10 border-gold-400/60 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]"
                                                : "bg-white/[0.02] border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30"
                                        }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500 ${
                                                paymentMode === "CASH"
                                                    ? "bg-gold-400/20 text-gold-400"
                                                    : "bg-white/5 text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10"
                                            }`}>
                                                <Receipt className="h-5 w-5" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-sm font-medium text-white tracking-tight">Cash</div>
                                                <div className="text-[8px] font-bold uppercase tracking-widest text-gold-400/30">Collected at desk</div>
                                            </div>
                                        </div>
                                        <div className={`w-4 h-4 rounded-full border-2 transition-all ${
                                            paymentMode === "CASH" ? "border-gold-400 bg-gold-400" : "border-white/10 group-hover/btn:border-gold-400/80"
                                        }`} />
                                    </button>

                                    {/* Pay Online — Razorpay (UPI/Card/Netbanking/Wallets) */}
                                    <button
                                        type="button"
                                        onClick={() => hotelHasRazorpay && setPaymentMode("ONLINE")}
                                        aria-pressed={paymentMode === "ONLINE"}
                                        disabled={!hotelHasRazorpay}
                                        title={hotelHasRazorpay ? "" : "Razorpay not configured for this hotel — contact ops to set up the Linked Account"}
                                        className={`w-full group/btn relative flex items-center justify-between p-5 rounded-2xl border transition-all duration-500 text-left ${
                                            !hotelHasRazorpay
                                                ? "bg-white/[0.01] border-white/5 opacity-40 cursor-not-allowed"
                                                : paymentMode === "ONLINE"
                                                    ? "bg-gold-400/10 border-gold-400/60 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]"
                                                    : "bg-white/[0.02] border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30"
                                        }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500 ${
                                                paymentMode === "ONLINE"
                                                    ? "bg-gold-400/20 text-gold-400"
                                                    : "bg-white/5 text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10"
                                            }`}>
                                                <CreditCard className="h-5 w-5" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-sm font-medium text-white tracking-tight">Pay Online</div>
                                                <div className="text-[8px] font-bold uppercase tracking-widest text-gold-400/30">
                                                    {hotelHasRazorpay ? "UPI / Card / Netbanking" : "Razorpay not configured"}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={`w-4 h-4 rounded-full border-2 transition-all ${
                                            paymentMode === "ONLINE" ? "border-gold-400 bg-gold-400" : "border-white/10 group-hover/btn:border-gold-400/80"
                                        }`} />
                                    </button>
                                </div>
                                </>
                                )}

                                {/* Inline error banner */}
                                {paymentError && (
                                    <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/[0.06]">
                                        <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold uppercase tracking-widest text-rose-300 mb-1">Payment issue</div>
                                            <div className="text-xs text-rose-200/90 leading-relaxed">{paymentError}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setPaymentError(null)}
                                            className="shrink-0 text-rose-400/60 hover:text-rose-300"
                                            aria-label="Dismiss error"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}

                                {/* Reservation over-commit — manager override */}
                                {reservationConflict && (
                                    <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
                                        <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold uppercase tracking-widest text-amber-300 mb-1">Room type reserved</div>
                                            <div className="text-xs text-amber-200/90 leading-relaxed mb-3">{reservationConflict}</div>
                                            <button
                                                type="button"
                                                onClick={() => handlePayment(true)}
                                                disabled={processing}
                                                className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black bg-amber-400 rounded-lg hover:bg-amber-300 transition disabled:opacity-50"
                                            >
                                                Override as manager
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setReservationConflict(null)}
                                            className="shrink-0 text-amber-400/60 hover:text-amber-300"
                                            aria-label="Dismiss"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* ── Execute Action ── */}
                            <div className="pt-10 space-y-4">
                                <button
                                    onClick={() => navigate({ pathname: "../availability", search: slug ? `?slug=${slug}` : "" }, { state: location.state })}
                                    className="w-full py-4 text-sm font-bold tracking-widest text-white/40 border border-white/5 rounded-2xl hover:bg-white/5 hover:text-white transition-all duration-300 uppercase"
                                >
                                    Back to Selection
                                </button>

                                <button
                                    onClick={() => handlePayment(false)}
                                    disabled={processing || (compMode ? !compReason : (!!discountError || !paymentMode || hasUnpriced))}
                                    className="w-full py-6 text-2xl font-light tracking-tight text-black bg-gold-400 rounded-2xl hover:bg-gold-300 transition-all duration-500 group relative overflow-hidden shadow-[0_20px_40px_-10px_rgba(212,175,55,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                                    {processing ? (
                                        <div className="flex items-center justify-center gap-4">
                                            <Loader2 className="h-6 w-6 animate-spin" />
                                            <span className="uppercase tracking-[0.2em] text-[9px] font-black">
                                                {(!compMode && paymentMode === "ONLINE") ? "Opening Razorpay..." : "Authorizing..."}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center gap-4">
                                            <span className="uppercase tracking-[0.15em] text-[10px] font-black">
                                                {compMode && "Complete Check-in"}
                                                {!compMode && paymentMode === "CASH" && `Collect Cash · ₹${Math.round(liveTotals.totalPayable).toLocaleString()}`}
                                                {!compMode && paymentMode === "ONLINE" && `Pay Online · ₹${Math.round(liveTotals.totalPayable).toLocaleString()}`}
                                                {!compMode && !paymentMode && (hasUnpriced ? "Set a rate or mark complimentary" : "Choose settlement method above")}
                                            </span>
                                            {(compMode || paymentMode) && <ArrowRight className="h-6 w-6 group-hover:translate-x-2 transition-transform" />}
                                        </div>
                                    )}
                                </button>

                                <div className="flex items-center justify-center gap-3 text-[8px] font-black uppercase tracking-[0.3em] text-white/10 pt-4">
                                    <Lock className="h-3 w-3" />
                                    End-to-End Cryptographic Security
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Document Viewer Modal */}
            {viewImage && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/95 backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300"
                    onClick={() => setViewImage(null)}
                >
                    <button
                        className="absolute top-8 right-8 text-white/40 hover:text-white p-3 rounded-full bg-white/5 transition-all"
                        onClick={() => setViewImage(null)}
                    >
                        <X className="w-10 h-10" />
                    </button>
                    <div className="relative group max-w-5xl w-full">
                        <img
                            src={viewImage}
                            className="w-full h-auto max-h-[85vh] object-contain rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10"
                            onClick={e => e.stopPropagation()}
                            alt="Document Preview"
                        />
                        <div className="absolute inset-x-0 -bottom-12 flex justify-center">
                            <div className="px-6 py-2 rounded-full bg-gold-400/10 border border-gold-400/20 backdrop-blur-xl">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-400">Digital Archive Access</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
