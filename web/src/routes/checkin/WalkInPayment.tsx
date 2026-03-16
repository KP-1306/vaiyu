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
    ArrowRight,
    Users,
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
    const [idType, setIdType] = useState(guestDetails?.id_type || "aadhaar");
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
                    .from('guest_id_documents')
                    .select('*')
                    .eq('guest_id', gid)
                    .eq('is_active', true)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

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
                    id_type: (idType === 'aadhaar' || idType === 'passport' || idType === 'driving_license' || idType === 'other') ? idType : 'other',
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
                    roomsCount: selections.length,
                    hotelId: hotelId
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

                            <div className="space-y-6 pt-8 pb-10">
                                <div className="flex justify-between items-center px-2">
                                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Base Rent</span>
                                    <span className="text-lg font-light text-white tracking-tight">₹{pricing.roomTotal.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center px-2">
                                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Taxation (12%)</span>
                                    <span className="text-lg font-light text-white tracking-tight">₹{pricing.taxes.toLocaleString()}</span>
                                </div>
                                <div className="pt-8 border-t border-gold-400/10 flex justify-between items-end px-2">
                                    <div className="space-y-1">
                                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-gold-400">Net Total</span>
                                        <p className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Final Payable</p>
                                    </div>
                                    <span className="text-4xl font-light text-white tracking-tighter shadow-gold-400/10 drop-shadow-2xl">
                                        ₹{pricing.totalPayable.toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            {/* ── Settlement & Payment Section ── */}
                            <div className="pt-8 border-t border-white/5 space-y-6">
                                <div className="flex items-center gap-4 px-2">
                                    <CreditCard className="h-4 w-4 text-gold-400/40" />
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Settlement Method</span>
                                </div>

                                <div className="space-y-4">
                                    <button className="w-full group/btn relative flex items-center justify-between p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30 transition-all duration-500 text-left">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10 transition-all duration-500">
                                                <ImageIcon className="h-5 w-5" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-sm font-medium text-white tracking-tight">Digital Currency</div>
                                                <div className="text-[8px] font-bold uppercase tracking-widest text-gold-400/30">UPI / QR Transfer</div>
                                            </div>
                                        </div>
                                        <div className="w-4 h-4 rounded-full border-2 border-white/10 group-hover/btn:border-gold-400/80 transition-all" />
                                    </button>

                                    <button className="w-full group/btn relative flex items-center justify-between p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-gold-400/[0.04] hover:border-gold-400/30 transition-all duration-500 text-left">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-gold-400/20 group-hover/btn:text-gold-400 group-hover/btn:bg-gold-400/10 transition-all duration-500">
                                                <CreditCard className="h-5 w-5" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-sm font-medium text-white tracking-tight">Physical Card</div>
                                                <div className="text-[8px] font-bold uppercase tracking-widest text-gold-400/30">Visa / Mastercard</div>
                                            </div>
                                        </div>
                                        <div className="w-4 h-4 rounded-full border-2 border-white/10 group-hover/btn:border-gold-400/80 transition-all" />
                                    </button>
                                </div>
                            </div>

                            {/* ── Execute Action ── */}
                            <div className="pt-10">
                                <button
                                    onClick={handlePayment}
                                    disabled={processing}
                                    className="w-full py-6 text-2xl font-light tracking-tight text-black bg-gold-400 rounded-2xl hover:bg-gold-300 transition-all duration-500 group relative overflow-hidden shadow-[0_20px_40px_-10px_rgba(212,175,55,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                                    {processing ? (
                                        <div className="flex items-center justify-center gap-4">
                                            <Loader2 className="h-6 w-6 animate-spin" />
                                            <span className="uppercase tracking-[0.2em] text-[9px] font-black">Authorizing...</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center gap-4">
                                            <span className="uppercase tracking-[0.15em] text-[10px] font-black">Authorize ₹{pricing.totalPayable.toLocaleString()}</span>
                                            <ArrowRight className="h-6 w-6 group-hover:translate-x-2 transition-transform" />
                                        </div>
                                    )}
                                </button>

                                <div className="flex items-center justify-center gap-3 text-[8px] font-black uppercase tracking-[0.3em] text-white/10 pt-8">
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
