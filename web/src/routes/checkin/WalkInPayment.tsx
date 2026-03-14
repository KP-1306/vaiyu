import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
    X
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { uploadIdentityDocuments } from "../../lib/storage";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function WalkInPayment() {
    const navigate = useNavigate();
    const location = useLocation();

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
    const [idType, setIdType] = useState(guestDetails?.id_type || "aadhar");
    const [idNumber, setIdNumber] = useState(guestDetails?.id_number || "");
    const [idFromExistingDoc, setIdFromExistingDoc] = useState(false);

    // Document state
    const [frontImage, setFrontImage] = useState<File | null>(null);
    const [backImage, setBackImage] = useState<File | null>(null);
    const [existingFront, setExistingFront] = useState<string | null>(null);
    const [existingBack, setExistingBack] = useState<string | null>(null);
    const [existingProof, setExistingProof] = useState<any>(null);
    const [viewImage, setViewImage] = useState<string | null>(null);
    const [loadingDocs, setLoadingDocs] = useState(false);

    // Redirect if missing critical data
    useEffect(() => {
        if (!guestDetails || !stayDetails || !pricing) {
            navigate("../walkin");
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

            setLoadingDocs(true);
            try {
                // 1. Fetch the identity proof record directly
                const { data: proof } = await supabase
                    .from('identity_proofs')
                    .select('*')
                    .eq('guest_id', gid)
                    .single();

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

                // Call secure Edge Function for both sides (using fetch to read metadata headers)
                const fetchSide = async (side: 'front' | 'back') => {
                    const res = await fetch(`${supabaseUrl}/functions/v1/get-document-url`, {
                        method: 'POST',
                        headers: {
                            ...headers,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                             guest_id: gid,
                             side: side
                        })
                    });

                    if (!res.ok) return null;

                    const docType = res.headers.get('X-Document-Type');
                    const docNumber = res.headers.get('X-Document-Number');
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);

                    return { docType, docNumber, url };
                };

                const frontRes = await fetchSide('front');
                const backRes = await fetchSide('back');

                if (frontRes) {
                    if (frontRes.docType) setIdType(frontRes.docType);
                    if (frontRes.docNumber) {
                        setIdNumber(frontRes.docNumber);
                        setIdFromExistingDoc(true);
                    }
                    if (frontRes.url) setExistingFront(frontRes.url);
                }
                if (backRes?.url) setExistingBack(backRes.url);
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
            if (side === "front") {
                setFrontImage(e.target.files[0]);
                setExistingFront(null);
            } else {
                setBackImage(e.target.files[0]);
                setExistingBack(null);
            }
        }
    };


    const handlePayment = async () => {
        setProcessing(true);

        try {
            // 1. Mock Payment Gateway Delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            if (!hotelId) throw new Error("Hotel ID missing");

            // 2. Upload Images if new ones selected
            const uploadResult = await uploadIdentityDocuments({
                frontImage,
                backImage,
                existingFront: existingProof?.front_image,
                existingBack: existingProof?.back_image,
                storageKey: existingProof?.storage_key
            });

            const frontPath = uploadResult.frontPath;
            const backPath = uploadResult.backPath;
            const storageKey = uploadResult.storageKey;
    

            // 3. Create Walk-In via v2 RPC (multi-room aware)
            const selections = roomSelections || [{ room_id: selectedRoomId, room_type_id: null }];

            const { data, error } = await supabase.rpc("create_walkin_v2", {
                p_hotel_id: hotelId,
                p_guest_details: {
                    ...guestDetails,
                    id_type: idType,
                    id_number: idNumber,
                    front_image_path: frontPath,
                    back_image_path: backPath,
                    storage_key: storageKey,
                    front_hash: uploadResult.frontHash,
                    back_hash: uploadResult.backHash
                },
                p_room_selections: selections,
                p_checkin_date: stayDetails.checkin_date,
                p_checkout_date: stayDetails.checkout_date,
                p_adults: stayDetails.adults,
                p_children: stayDetails.children,
                p_actor_id: null
            });

            if (error) throw error;

            // 3. Navigate to Success
            navigate("../success", {
                state: {
                    roomNumber: roomNumber || "Assigned",
                    bookingCode: data.booking_code,
                    roomsCount: selections.length
                }
            });

        } catch (err: any) {
            console.error(err);
            alert("Payment/Check-in failed: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    if (!guestDetails || !pricing) return null;

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];

    return (
        <div className="mx-auto max-w-xl space-y-6 pb-20">
            {/* ── Stepper ── */}
            <CheckInStepper steps={WALKIN_STEPS} currentStep={2} />

            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Payment & Confirm</h2>
                <p className="text-slate-500">Secure your stay at Room {roomNumber}</p>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5 space-y-8">

                {/* Bill Summary */}
                <div className="flex flex-col items-center justify-center py-6 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Payable</p>
                    <div className="text-5xl font-bold text-slate-900 mt-2 tracking-tight">
                        ₹{pricing.totalPayable.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full">
                        <span>{stayDetails.nights} Night(s)</span>
                        <span>•</span>
                        <span>{roomType}</span>
                    </div>
                </div>

                {/* Breakdown Toggle (Simulated) */}
                <div className="space-y-3 text-sm text-slate-600 bg-slate-50 p-4 rounded-xl">
                    <div className="flex justify-between">
                        <span>Room Charges</span>
                        <span>₹{pricing.roomTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Taxes & Fees (12%)</span>
                        <span>₹{pricing.taxes.toLocaleString()}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-200/60 flex justify-between font-medium text-slate-900">
                        <span>Grand Total</span>
                        <span>₹{pricing.totalPayable.toLocaleString()}</span>
                    </div>
                </div>

                {/* ── Identity Proof ── */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                    <h4 className="text-base font-semibold text-slate-900">Identity Proof</h4>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">ID Type <span className="text-red-500">*</span></label>
                        <select
                            required
                            className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                            value={idType}
                            onChange={e => setIdType(e.target.value)}
                        >
                            <option value="aadhar">Aadhaar Card</option>
                            <option value="passport">Passport</option>
                            <option value="driving_license">Driving License</option>
                            <option value="voter_id">Voter ID</option>
                            <option value="other">Other</option>
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">ID Number <span className="text-red-500">*</span></label>
                        {idFromExistingDoc ? (
                            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 py-3 px-4">
                                <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                                <span className="flex-1 font-mono text-slate-600 tracking-[0.25em] text-sm">
                                    **** **** {idNumber.slice(-4)}
                                </span>
                                <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="h-3 w-3" /> Verified
                                </span>
                                <button
                                    type="button"
                                    onClick={() => { setIdNumber(''); setIdFromExistingDoc(false); }}
                                    className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold underline underline-offset-2 transition-colors"
                                >
                                    Change
                                </button>
                            </div>
                        ) : (
                            <input
                                required
                                className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                                value={idNumber}
                                onChange={e => setIdNumber(e.target.value)}
                                placeholder={idType === 'aadhar' ? 'XXXX-XXXX-XXXX' : idType === 'passport' ? 'A1234567' : 'Enter ID number'}
                            />
                        )}
                    </div>

                    {/* Front Side Document */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">Front Side <span className="text-red-500">*</span></label>

                        {loadingDocs ? (
                            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                                <span className="text-sm text-slate-500">Loading existing documents...</span>
                            </div>
                        ) : existingFront ? (
                            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-4 transition-all">
                                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-indigo-100 border border-slate-200 shadow-sm">
                                    {existingFront.startsWith("http") || existingFront.startsWith("blob:") ? (
                                        <img src={existingFront} alt="Front ID" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="h-full w-full flex items-center justify-center text-indigo-600">
                                            <ImageIcon className="h-10 w-10" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">Existing Document</p>
                                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Previously uploaded
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                    {(existingFront.startsWith("http") || existingFront.startsWith("blob:")) && (
                                        <button
                                            type="button"
                                            onClick={() => setViewImage(existingFront)}
                                            className="flex justify-center items-center gap-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-100 hover:bg-indigo-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                                        >
                                            View
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setExistingFront(null)}
                                        className="flex justify-center items-center gap-1.5 text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-sm font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        Re-upload
                                    </button>
                                </div>
                            </div>
                        ) : frontImage ? (
                            <div className="relative rounded-2xl border-2 border-green-300 bg-green-50/50 p-4 flex items-center gap-4">
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white border border-green-200 shadow-sm">
                                    <img src={URL.createObjectURL(frontImage)} alt="New Front ID" className="h-full w-full object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-green-800 truncate">{frontImage.name}</p>
                                    <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                                        <CheckCircle2 className="h-3 w-3" /> Ready to upload
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setViewImage(URL.createObjectURL(frontImage))}
                                        className="flex justify-center items-center gap-1.5 text-green-700 hover:text-green-800 bg-green-100 hover:bg-green-200 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        Preview
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFrontImage(null)}
                                        className="flex justify-center items-center gap-1.5 text-slate-500 hover:text-slate-700 bg-white border border-slate-200 text-sm font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                                    >
                                        Change
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-10"
                                    onChange={(e) => handleFileChange(e, "front")}
                                />
                                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all">
                                    <div className="rounded-full bg-white p-3 shadow-sm">
                                        <Camera className="h-7 w-7 text-slate-400" />
                                    </div>
                                    <span className="text-sm font-medium text-slate-600">
                                        Capture Front Side <span className="text-red-500">*</span>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Back Side Document */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">Back Side <span className="text-slate-400 font-normal">(Optional)</span></label>

                        {existingBack ? (
                            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-4 transition-all">
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-indigo-100 border border-slate-200 shadow-sm">
                                    {existingBack.startsWith("http") || existingBack.startsWith("blob:") ? (
                                        <img src={existingBack} alt="Back ID" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="h-full w-full flex items-center justify-center text-indigo-600">
                                            <ImageIcon className="h-8 w-8" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">Existing Document</p>
                                    <p className="text-xs text-slate-500">Previously uploaded</p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                    {(existingBack.startsWith("http") || existingBack.startsWith("blob:")) && (
                                        <button
                                            type="button"
                                            onClick={() => setViewImage(existingBack)}
                                            className="flex justify-center items-center gap-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-100 hover:bg-indigo-200 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                                        >
                                            View
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setExistingBack(null)}
                                        className="flex justify-center items-center gap-1.5 text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-sm font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        Re-upload
                                    </button>
                                </div>
                            </div>
                        ) : backImage ? (
                            <div className="relative rounded-2xl border-2 border-green-300 bg-green-50/50 p-4 flex items-center gap-4">
                                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white border border-green-200 shadow-sm">
                                    <img src={URL.createObjectURL(backImage)} alt="New Back ID" className="h-full w-full object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-green-800 truncate">{backImage.name}</p>
                                    <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                                        <CheckCircle2 className="h-3 w-3" /> Ready to upload
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setViewImage(URL.createObjectURL(backImage))}
                                        className="flex justify-center items-center gap-1.5 text-green-700 hover:text-green-800 bg-green-100 hover:bg-green-200 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        Preview
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBackImage(null)}
                                        className="flex justify-center items-center gap-1.5 text-slate-500 hover:text-slate-700 bg-white border border-slate-200 text-sm font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                                    >
                                        Change
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative">
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-10"
                                    onChange={(e) => handleFileChange(e, "back")}
                                />
                                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all">
                                    <div className="rounded-full bg-white p-3 shadow-sm">
                                        <Upload className="h-7 w-7 text-slate-400" />
                                    </div>
                                    <span className="text-sm font-medium text-slate-500">
                                        Upload Back Side <span className="text-slate-400 font-normal">(Optional)</span>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Payment Methods */}
                <div className="space-y-4">
                    <p className="text-sm font-medium text-slate-700">Select Payment Method</p>

                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2.5 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700 transition-colors">
                                <CreditCard className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">Credit / Debit Card</div>
                                <div className="text-xs text-slate-500">Visa, Mastercard, Amex</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-[5px] transition-all" />
                    </button>

                    <button className="group relative w-full flex items-center justify-between rounded-2xl border border-slate-200 p-4 hover:border-indigo-600 hover:bg-indigo-50 transition-all">
                        <div className="flex items-center gap-3">
                            <div className="rounded-xl bg-slate-100 p-2 text-slate-600 group-hover:bg-indigo-200 group-hover:text-indigo-700 transition-colors">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <div className="font-semibold text-slate-900">UPI / QR Code</div>
                                <div className="text-xs text-slate-500">GPay, PhonePe, Paytm</div>
                            </div>
                        </div>
                        <div className="h-5 w-5 rounded-full border border-slate-300 group-hover:border-indigo-600 group-hover:border-[5px] transition-all" />
                    </button>
                </div>

                {/* Security Badge */}
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 pt-2">
                    <Lock className="h-3 w-3" />
                    Secure 256-bit encrypted transaction
                </div>

                {/* Confirm Button */}
                <button
                    onClick={handlePayment}
                    disabled={processing}
                    className="w-full rounded-2xl bg-indigo-600 px-8 py-5 text-xl font-bold text-white shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-3"
                >
                    {processing ? (
                        <>
                            <Loader2 className="h-6 w-6 animate-spin" />
                            Processing...
                        </>
                    ) : (
                        <>
                            Pay ₹{pricing.totalPayable.toLocaleString()}
                        </>
                    )}
                </button>
            </div>

            {/* Document Viewer Modal */}
            {viewImage && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/95 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setViewImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                        onClick={() => setViewImage(null)}
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <img
                        src={viewImage}
                        className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl ring-1 ring-white/10"
                        onClick={e => e.stopPropagation()}
                        alt="Document Preview"
                    />
                </div>
            )}
        </div>
    );
}
