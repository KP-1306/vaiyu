// GuestKYC.tsx Update
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    Camera,
    UploadCloud,
    Loader2,
    CheckCircle2,
    AlertCircle,
    RefreshCw,
    ImageIcon,
    User, // Added for modal
    Check, // Added for banner
    X // Added for banner
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { lookupGuestProfile } from "../../lib/api";

export default function GuestKYC() {
    const navigate = useNavigate();
    const location = useLocation();
    const booking = location.state?.booking;

    // Pre-filled Identity Proof
    const existingProof = booking?.identity_proof;

    // Form State
    const [formData, setFormData] = useState({
        full_name: booking?.guest_name || "",
        mobile: booking?.phone || "",
        email: booking?.email || "",
        nationality: booking?.nationality || "Indian",
        address: booking?.address || "",
        id_type: existingProof?.type || "aadhaar",
        id_number: existingProof?.number || "",
    });

    const [frontImage, setFrontImage] = useState<File | null>(null);
    const [backImage, setBackImage] = useState<File | null>(null);

    // Existing Image URLs (if pre-filled)
    const [existingFront, setExistingFront] = useState<string | null>(existingProof?.front_image || null);
    const [existingBack, setExistingBack] = useState<string | null>(existingProof?.back_image || null);

    const [uploading, setUploading] = useState(false);

    // Lookup State
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupSource, setLookupSource] = useState<"mobile" | "email" | null>(null);
    const [emailConflictGuest, setEmailConflictGuest] = useState<any | null>(null);

    const autofillGuest = (guest: any, source: "mobile" | "email") => {
        setFormData(prev => ({
            ...prev,
            full_name: guest.full_name || prev.full_name,
            email: guest.email || prev.email,
            nationality: guest.nationality || prev.nationality,
            address: guest.address || prev.address,
            // If source is mobile, we definitely keep the mobile. 
            // If source is email, we utilize the lookup result's mobile if we want to sync, 
            // but user might be updating it? Let's assume we want to sync profile.
            mobile: source === 'mobile' ? prev.mobile : (guest.mobile || prev.mobile)
        }));
        setLookupSource(source);
    };

    const handleMobileBlur = async () => {
        if (!booking?.hotel_id || !formData.mobile || formData.mobile.length < 8) return;
        if (lookupSource === "mobile") return;

        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, formData.mobile);
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
        if (!booking?.hotel_id || !formData.email || !formData.mobile) return;
        if (lookupSource === "mobile") return;

        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, formData.mobile, formData.email);
            if (res.found && res.match_type === 'email' && res.guest) {
                const storedMobile = res.guest.mobile?.replace(/[^0-9]/g, '');
                const currentMobile = formData.mobile.replace(/[^0-9]/g, '');

                if (storedMobile && storedMobile !== currentMobile) {
                    setEmailConflictGuest(res.guest);
                } else {
                    autofillGuest(res.guest, 'email');
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLookupLoading(false);
        }
    };

    // Validation State
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Resolve signed URLs for existing paths
    useEffect(() => {
        if (!existingProof) return;

        const resolveUrl = async (path: string | null, setter: (url: string | null) => void) => {
            if (!path) return;
            // If it's already a URL (legacy or blob), leave it
            if (path.startsWith('http') || path.startsWith('blob:')) return;

            // It's a path, sign it
            const { data, error } = await supabase.storage
                .from('identity_proofs')
                .createSignedUrl(path, 3600); // 1 hour link

            if (data?.signedUrl) {
                setter(data.signedUrl);
            } else if (error) {
                console.error("Failed to sign URL for", path, error);
            }
        };

        if (existingProof.front_image && !existingProof.front_image.startsWith('http')) {
            resolveUrl(existingProof.front_image, setExistingFront);
        }
        if (existingProof.back_image && !existingProof.back_image.startsWith('http')) {
            resolveUrl(existingProof.back_image, setExistingBack);
        }
    }, [existingProof]);

    useEffect(() => {
        if (!booking) return;
        // Auto-mask ID number if pre-filled and valid length
        if (existingProof?.number && existingProof.number.length > 4 && !formData.id_number.includes('X')) {
            // Simple masking: XXXX-XXXX-1234
            const last4 = existingProof.number.slice(-4);
            const masked = `XXXX-XXXX-${last4}`;
            setFormData(prev => ({ ...prev, id_number: masked }));
        }
    }, [booking]);

    if (!booking) {
        return (
            <div className="text-center pt-20">
                <h2 className="text-xl font-semibold text-slate-800">Session expired</h2>
                <button onClick={() => navigate("../booking")} className="mt-4 text-indigo-600 underline font-medium">Restart Check-in</button>
            </div>
        );
    }

    const validate = () => {
        const newErrors: Record<string, string> = {};

        // Name
        if (!formData.full_name.trim()) newErrors.full_name = "Full Name is required";
        else if (formData.full_name.trim().length < 3) newErrors.full_name = "Name must be at least 3 characters";

        // Mobile
        if (!formData.mobile.trim()) newErrors.mobile = "Mobile Number is required";
        else if (!/^\d{10}$/.test(formData.mobile.replace(/\D/g, ''))) newErrors.mobile = "Enter a valid 10-digit mobile number";

        // Email (Optional but valid if entered)
        if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = "Enter a valid email address";
        }

        // Address
        if (!formData.address.trim()) newErrors.address = "Address is required";
        else if (formData.address.trim().length < 5) newErrors.address = "Address is too short";

        // ID Number
        if (!formData.id_number.trim()) {
            newErrors.id_number = "ID Number is required";
        } else {
            // If masked, assume valid (unless changed)
            if (!formData.id_number.includes('XXXX')) {
                if (formData.id_type === 'aadhaar' && !/^\d{12}$/.test(formData.id_number.replace(/\s/g, ''))) {
                    newErrors.id_number = "Enter valid 12-digit Aadhaar number";
                } else if (formData.id_type === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.id_number)) {
                    newErrors.id_number = "Enter valid PAN format (e.g. ABCDE1234F)";
                }
            }
        }

        // Front Image - Valid if new file selected OR existing image available
        if (!frontImage && !existingFront) newErrors.frontImage = "Front side ID photo is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
        if (e.target.files && e.target.files[0]) {
            if (side === 'front') {
                setFrontImage(e.target.files[0]);
                setExistingFront(null); // Clear existing if new selected
                setErrors(prev => ({ ...prev, frontImage: '' }));
            }
            else {
                setBackImage(e.target.files[0]);
                setExistingBack(null);
            }
        }
    };

    async function uploadFile(file: File, path: string) {
        const { data, error } = await supabase.storage
            .from('identity_proofs')
            .upload(path, file);
        if (error) throw error;
        return data.path;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setUploading(true);

        try {
            // 1. Upload Images (Only if new files selected)
            let frontPath = existingFront; // Default to existing
            let backPath = existingBack;
            const timestamp = Date.now();

            if (frontImage) {
                const folderId = booking.guest_id || booking.id;
                const path = `${booking.hotel_id}/kiosk/${folderId}/front_${timestamp}_${frontImage.name}`;
                frontPath = await uploadFile(frontImage, path);
            }

            if (backImage) {
                const folderId = booking.guest_id || booking.id;
                const path = `${booking.hotel_id}/kiosk/${folderId}/back_${timestamp}_${backImage.name}`;
                backPath = await uploadFile(backImage, path);
            }

            // 2. Prepare Guest Details Object
            // If ID is masked, send the ORIGINAL number (passed via state/props ideally, but for now we assume checkin logic handles it 
            // OR we just strictly rely on frontend validation. 
            // Actually, if masked, we should probably NOT send it to update, referencing existing doc.
            // But simplify: If masked, send the existing number from `existingProof.number`.

            let finalIdNumber = formData.id_number;
            if (finalIdNumber.includes('XXXX') && existingProof?.number) {
                finalIdNumber = existingProof.number;
            }

            const guestDetails = {
                ...formData,
                id_number: finalIdNumber,
                front_image_path: frontPath, // Matches DB column logic in RPC? No, RPC expects `front_image_path` key in JSON
                back_image_path: backPath,
            };

            navigate("../room-assignment", {
                state: {
                    booking,
                    guestDetails
                }
            });

        } catch (err: any) {
            console.error(err);
            alert("Error uploading documents: " + err.message);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="mx-auto max-w-3xl space-y-8 pb-12">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Guest Details & KYC</h2>
                <p className="text-slate-500">Please provide your identification details.</p>
            </div>

            {/* Email Conflict Modal */}
            {emailConflictGuest && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-6">
                        <div className="space-y-2 text-center">
                            <div className="mx-auto w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mb-2">
                                <User className="h-6 w-6 text-indigo-600" />
                            </div>
                            <h3 className="text-slate-900 text-lg font-bold">Existing Guest Found</h3>
                            <p className="text-slate-500 text-sm leading-relaxed">
                                We found a guest profile associated with <strong>{formData.email}</strong>.
                                <br />Do you want to use the saved details?
                            </p>
                        </div>

                        <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1 border border-slate-200">
                            <div className="flex justify-between">
                                <span className="text-slate-500">Name:</span>
                                <span className="text-slate-900 font-medium">{emailConflictGuest.full_name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Saved Mobile:</span>
                                <span className="text-slate-900 font-medium">{emailConflictGuest.mobile || 'N/A'}</span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setEmailConflictGuest(null)}
                                className="flex-1 py-3 rounded-xl border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
                            >
                                No, Keep Mine
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    autofillGuest(emailConflictGuest, 'email');
                                    setEmailConflictGuest(null);
                                }}
                                className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                            >
                                Yes, Autofill
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Autofill Banner */}
            {lookupSource && (
                <div className="mx-auto max-w-2xl bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="mt-0.5">
                        <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                            <Check className="w-3 h-3 text-indigo-600" />
                        </div>
                    </div>
                    <div className="flex-1">
                        <p className="text-indigo-900 text-sm font-medium">
                            Details loaded from previous stay
                        </p>
                        <p className="text-indigo-600 text-xs">
                            Matched via {lookupSource === "mobile" ? "mobile number" : "email address"}
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setLookupSource(null);
                            // Optional: Clear? Or just dismiss banner.
                        }}
                        className="text-indigo-400 hover:text-indigo-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {/* Personal Info */}
                    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Personal Information</h3>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Full Name <span className="text-red-500">*</span></label>
                            <input
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.full_name ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.full_name}
                                onChange={e => {
                                    setFormData({ ...formData, full_name: e.target.value });
                                    if (errors.full_name) setErrors(prev => ({ ...prev, full_name: '' }));
                                }}
                            />
                            {errors.full_name && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.full_name}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Mobile Number <span className="text-red-500">*</span></label>
                            <input
                                type="tel"
                                maxLength={10}
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.mobile ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.mobile}
                                onBlur={handleMobileBlur}
                                onChange={e => {
                                    setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, '') });
                                    if (errors.mobile) setErrors(prev => ({ ...prev, mobile: '' }));
                                }}
                            />
                            {lookupLoading && <span className="text-xs text-indigo-500 absolute top-0 right-0 mt-8 mr-10">Checking...</span>}
                            {errors.mobile && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.mobile}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Email</label>
                            <input
                                type="email"
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.email ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.email}
                                onBlur={handleEmailBlur}
                                onChange={e => {
                                    setFormData({ ...formData, email: e.target.value });
                                    if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
                                }}
                            />
                            {errors.email && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.email}</p>}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Nationality <span className="text-red-500">*</span></label>
                            <select
                                className="mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={formData.nationality}
                                onChange={e => setFormData({ ...formData, nationality: e.target.value })}
                            >
                                <option value="Indian">Indian</option>
                                <option value="Other">Other (International)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">Address <span className="text-red-500">*</span></label>
                            <textarea
                                rows={2}
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.address ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.address}
                                onChange={e => {
                                    setFormData({ ...formData, address: e.target.value });
                                    if (errors.address) setErrors(prev => ({ ...prev, address: '' }));
                                }}
                            />
                            {errors.address && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.address}</p>}
                        </div>
                    </div>

                    {/* ID Proof */}
                    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Identity Proof</h3>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">ID Type <span className="text-red-500">*</span></label>
                            <select
                                className="mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={formData.id_type}
                                onChange={e => setFormData({ ...formData, id_type: e.target.value })}
                            >
                                <option value="aadhaar">Aadhaar Card</option>
                                <option value="pan">PAN Card</option>
                                <option value="passport">Passport</option>
                                <option value="driving_license">Driving License</option>
                                <option value="other">Other</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700">ID Number <span className="text-red-500">*</span></label>
                            <input
                                className={`mt-1 block w-full rounded-xl border-slate-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${errors.id_number ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                                value={formData.id_number}
                                onChange={e => {
                                    setFormData({ ...formData, id_number: e.target.value.toUpperCase() });
                                    if (errors.id_number) setErrors(prev => ({ ...prev, id_number: '' }));
                                }}
                                placeholder="XXXX-XXXX-XXXX"
                            />
                            {errors.id_number && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.id_number}</p>}
                        </div>

                        <div className="pt-4 space-y-4">
                            {/* Front Image */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Front Side <span className="text-red-500">*</span></label>

                                {existingFront ? (
                                    <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                                        {/* Display Image if available */}
                                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-indigo-100 border border-slate-200">
                                            {existingFront.startsWith('http') || existingFront.startsWith('blob:') ? (
                                                <img src={existingFront} alt="Front ID" className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="h-full w-full flex items-center justify-center text-indigo-600">
                                                    <ImageIcon className="h-8 w-8" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-900 truncate">Existing Document</p>
                                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                                <CheckCircle2 className="h-3 w-3 text-green-500" /> Verified
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setExistingFront(null)}
                                            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium px-2 py-1"
                                        >
                                            Retake
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {/* If ID Number is pre-filled but image is missing, show specific prompt */}
                                        {existingProof?.number && !existingFront && (
                                            <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 flex gap-2 items-start">
                                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                                <span>We have your ID number, but the document image is missing. Please capture it again.</span>
                                            </div>
                                        )}

                                        <div className={`relative block w-full rounded-xl border-2 border-dashed p-4 text-center hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${errors.frontImage ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                                onChange={(e) => handleFileChange(e, 'front')}
                                            />
                                            {frontImage ? (
                                                <div className="flex items-center justify-center gap-2 text-green-600">
                                                    <CheckCircle2 className="h-5 w-5" />
                                                    <span className="text-sm font-medium truncate">{frontImage.name}</span>
                                                </div>
                                            ) : (
                                                <div className="text-slate-500">
                                                    <Camera className={`mx-auto h-8 w-8 ${errors.frontImage ? 'text-red-400' : 'text-slate-400'}`} />
                                                    <span className={`mt-2 block text-sm font-medium ${errors.frontImage ? 'text-red-600' : ''}`}>Capture Front Side <span className="text-red-500">*</span></span>
                                                </div>
                                            )}
                                        </div>
                                        {errors.frontImage && <p className="mt-1 text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errors.frontImage}</p>}
                                    </>
                                )}
                            </div>

                            {/* Back Image */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Back Side (Optional)</label>

                                {existingBack ? (
                                    <div className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                                        <div className="h-12 w-12 shrink-0 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                                            <ImageIcon className="h-6 w-6" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-900 truncate">Existing Document</p>
                                            <p className="text-xs text-slate-500">Verified</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setExistingBack(null)}
                                            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium px-2 py-1"
                                        >
                                            Retake
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative block w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-center hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                            onChange={(e) => handleFileChange(e, 'back')}
                                        />
                                        {backImage ? (
                                            <div className="flex items-center justify-center gap-2 text-green-600">
                                                <CheckCircle2 className="h-5 w-5" />
                                                <span className="text-sm font-medium truncate">{backImage.name}</span>
                                            </div>
                                        ) : (
                                            <div className="text-slate-500">
                                                <UploadCloud className="mx-auto h-8 w-8 text-slate-400" />
                                                <span className="mt-2 block text-sm font-medium">Upload Back Side</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-4">
                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={() => navigate("../details", { state: { booking } })}
                            className="flex-1 rounded-2xl bg-white px-8 py-4 text-lg font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all active:scale-[0.99]"
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            disabled={uploading}
                            className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-md hover:bg-indigo-500 disabled:opacity-50 transition-all active:scale-[0.99]"
                        >
                            {uploading ? (
                                <Loader2 className="h-6 w-6 animate-spin" />
                            ) : (
                                <>
                                    Continue to Room Selection <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </button>
                    </div>
                    {Object.keys(errors).length > 0 && (
                        <p className="mt-3 text-center text-sm text-red-600">Please fix the errors above to continue.</p>
                    )}
                </div>
            </form>
        </div>
    );
}
