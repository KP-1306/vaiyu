// GuestKYC.tsx Update
import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    ArrowRight,
    Camera,
    UploadCloud,
    Loader2,
    CheckCircle2,
    AlertCircle,
    User,
    Check,
    X,
    Lock,
    Phone,
    Mail,
    Globe,
    MapPin,
    ShieldCheck,
    Fingerprint,
    Shield,
    CreditCard,
    ChevronDown,
    Calendar,
    Users
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { uploadIdentityDocuments } from "../../lib/storage";
import { lookupGuestProfile } from "../../lib/api";

export default function GuestKYC() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const slug = searchParams.get("slug");
    const booking = location.state?.booking;

    const existingProof = booking?.identity_proof;

    const [formData, setFormData] = useState({
        full_name: booking?.guest_name || "",
        phone: booking?.phone || "",
        email: booking?.email || "",
        nationality: booking?.nationality || "Indian",
        address: booking?.address || "",
        id_type: existingProof?.type || "Aadhar",
        id_number: existingProof?.number || "",
        gender: "",
        date_of_birth: ""
    });

    const [idFromExistingDoc, setIdFromExistingDoc] = useState(!!existingProof?.number);
    const [frontImage, setFrontImage] = useState<File | null>(null);
    const [backImage, setBackImage] = useState<File | null>(null);
    const [viewImage, setViewImage] = useState<string | null>(null);
    const [existingFront, setExistingFront] = useState<string | null>(null);
    const [existingBack, setExistingBack] = useState<string | null>(null);
    const [hotelInfo, setHotelInfo] = useState<{ name: string; logo_url: string | null } | null>(null);
    const [uploading, setUploading] = useState(false);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupSource, setLookupSource] = useState<"mobile" | "email" | null>(null);
    const [emailConflictGuest, setEmailConflictGuest] = useState<any | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
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

    useEffect(() => {
        async function fetchHotel() {
            const hotelId = booking?.hotel_id;
            if (!hotelId) return;
            const { data } = await supabase.from('v_public_hotels').select('*').eq('id', hotelId).maybeSingle();
            if (data) setHotelInfo(data);
        }
        fetchHotel();
    }, [booking?.hotel_id]);

    useEffect(() => {
        if (!existingProof || !booking?.guest_id) return;

        const resolveUrl = async (side: "front" | "back") => {
            // 1. Logic Guards: Skip if manually cleared or ALREADY FETCHED in this session
            if (side === "front" && (frontCleared || existingFront)) return;
            if (side === "back" && (backCleared || existingBack)) return;

            const existingPath = side === "front"
                ? (existingProof.front_image || existingProof.has_front_image)
                : (existingProof.back_image || existingProof.has_back_image);

            if (typeof existingPath === 'string' && (existingPath.startsWith('http') || existingPath.startsWith('blob:'))) {
                if (side === "front") setExistingFront(existingPath);
                else setExistingBack(existingPath);
                return;
            }

            try {
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch(`${supabaseUrl}/functions/v1/get-document-url`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
                    },
                    body: JSON.stringify({
                        guest_id: booking.guest_id,
                        side: side,
                        hotel_id: booking.hotel_id
                    })
                });

                if (res.ok) {
                    const json = await res.json();
                    if (json.url) {
                        if (side === "front") setExistingFront(json.url);
                        else setExistingBack(json.url);
                    }
                }
            } catch (err) { console.warn(`[GuestKYC] Edge Function failed for ${side}:`, err); }
        };

        if (existingProof.front_image || existingProof.has_front_image) resolveUrl("front");
        if (existingProof.back_image || existingProof.has_back_image) resolveUrl("back");
    }, [existingProof, booking?.guest_id, booking?.hotel_id, frontCleared, backCleared, existingFront, existingBack]);

    const autofillGuest = (guest: any, source: "mobile" | "email") => {
        setFormData(prev => ({
            ...prev,
            full_name: guest.full_name || prev.full_name,
            email: guest.email || prev.email,
            nationality: guest.nationality || prev.nationality,
            address: guest.address || prev.address,
            phone: source === 'mobile' ? prev.phone : (guest.mobile || prev.phone)
        }));
        setLookupSource(source);
    };

    const handleMobileBlur = async () => {
        if (!booking?.hotel_id || !formData.phone || formData.phone.length < 8) return;
        if (lookupSource === "mobile") return;
        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, formData.phone);
            if (res.found && res.match_type === 'mobile' && res.guest) autofillGuest(res.guest, 'mobile');
        } catch (err) { console.error(err); } finally { setLookupLoading(false); }
    };

    const handleEmailBlur = async () => {
        if (!booking?.hotel_id || !formData.email || !formData.phone) return;
        if (lookupSource === "mobile") return;
        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(booking.hotel_id, formData.phone, formData.email);
            if (res.found && res.match_type === 'email' && res.guest) {
                const storedMobile = res.guest.mobile?.replace(/[^0-9]/g, '');
                const currentMobile = formData.phone.replace(/[^0-9]/g, '');
                if (storedMobile && storedMobile !== currentMobile) setEmailConflictGuest(res.guest);
                else autofillGuest(res.guest, 'email');
            }
        } catch (err) { console.error(err); } finally { setLookupLoading(false); }
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.full_name.trim()) newErrors.full_name = "Full Name is required";
        if (!formData.phone.trim()) newErrors.phone = "Phone is required";
        if (!formData.id_number.trim()) newErrors.id_number = "ID Number is required";
        if (!frontImage && !existingFront) newErrors.frontImage = "Front Image is required";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const previewUrl = URL.createObjectURL(file);

            if (side === 'front') {
                if (frontPreview) URL.revokeObjectURL(frontPreview);
                setFrontImage(file);
                setFrontPreview(previewUrl);
                setExistingFront(null);
                setErrors(prev => ({ ...prev, frontImage: '' }));
            } else {
                if (backPreview) URL.revokeObjectURL(backPreview);
                setBackImage(file);
                setBackPreview(previewUrl);
                setExistingBack(null);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validate()) return;
        setUploading(true);
        try {
            const uploadResult = await uploadIdentityDocuments({
                frontImage,
                backImage,
                existingFront: existingProof?.front_image,
                existingBack: existingProof?.back_image,
                storageKey: existingProof?.storage_key
            });
            let finalIdNumber = formData.id_number;
            if (finalIdNumber.includes('XXXX') && existingProof?.number) finalIdNumber = existingProof.number;
            const guestDetails = {
                ...formData,
                id_number: finalIdNumber,
                front_image: uploadResult.frontPath,
                back_image: uploadResult.backPath,
                storage_key: uploadResult.storageKey
            };
            navigate({ pathname: "../room-assignment", search: slug ? `?slug=${slug}` : "" }, { state: { booking, guestDetails } });
        } catch (err: any) { alert("Error: " + err.message); } finally { setUploading(false); }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-10 pb-20">
            {hotelInfo && (
                <div className="flex flex-col items-center mb-8">
                    {hotelInfo.logo_url && <img src={hotelInfo.logo_url} alt={hotelInfo.name} className="h-16 w-auto object-contain mb-4 animate-in zoom-in duration-500" />}
                    <div className="inline-flex items-center gap-3 px-6 py-2.5 rounded-full shadow-[0_0_30px_rgba(212,175,55,0.3)] tracking-[0.2em] uppercase bg-[#d4af37] text-black font-black text-sm">
                        <span className="w-2 h-2 relative flex"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span></span>
                        {hotelInfo.name}
                    </div>
                </div>
            )}

            <div className="text-center space-y-3">
                <h2 className="text-4xl font-light text-white tracking-tight">Guest Verification</h2>
                <p className="text-gold-100/60 font-light text-lg italic">Identity securement and profile validation</p>
            </div>

            {emailConflictGuest && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="gn-card w-full max-w-md p-8 space-y-8 border-gold-400/20 shadow-2xl">
                        <div className="space-y-3 text-center">
                            <div className="mx-auto w-16 h-16 rounded-2xl bg-gold-400/10 flex items-center justify-center ring-1 ring-gold-400/20 mb-4"><User className="h-8 w-8 text-gold-400" /></div>
                            <h3 className="text-white text-2xl font-light tracking-tight">Existing Profile Detected</h3>
                            <p className="text-gold-100/40 text-sm italic">We found a guest profile associated with <span className="text-gold-400 font-medium">{formData.email}</span>.</p>
                        </div>
                        <div className="flex gap-4">
                            <button type="button" onClick={() => setEmailConflictGuest(null)} className="flex-1 gn-btn gn-btn--secondary py-4">Keep Current</button>
                            <button type="button" onClick={() => { autofillGuest(emailConflictGuest, 'email'); setEmailConflictGuest(null); }} className="flex-1 gn-btn gn-btn--primary py-4">Sync Profile</button>
                        </div>
                    </div>
                </div>
            )}

            {lookupSource && (
                <div className="mx-auto max-w-2xl bg-gold-400/5 border border-gold-400/20 rounded-2xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-4 backdrop-blur-md">
                    <div className="shrink-0 flex items-center justify-center"><div className="w-8 h-8 rounded-full bg-gold-400/20 flex items-center justify-center ring-1 ring-gold-400/30"><Check className="w-4 h-4 text-gold-400" /></div></div>
                    <div className="flex-1"><p className="text-white text-sm font-medium">Profile details synchronized</p><p className="text-gold-400/60 text-xs font-light tracking-wide uppercase">Authenticated via {lookupSource}</p></div>
                    <button onClick={() => setLookupSource(null)} className="text-white/20 hover:text-white p-1 transition-colors"><X className="w-5 h-5" /></button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-10">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                    {/* Personal Information */}
                    <div className="gn-card gn-card--flush relative overflow-hidden group">
                        <div className="flex items-center gap-3 border-b border-white/5 py-4 px-8 bg-[#d4af37] shadow-[inset_0_1px_rgba(255,255,255,0.2)]">
                            <User className="h-4 w-4 text-black" /><span className="text-[11px] font-black uppercase tracking-[0.4em] text-black">Credential Module</span>
                        </div>
                        <div className="px-1 pt-6 pb-8 space-y-6">
                            <div className="space-y-5">
                                <div className="space-y-1.5 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Legal Full Name <span className="text-gold-400">*</span></label>
                                    <div className="relative"><User className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><input className={`gn-input pl-12 ${errors.full_name ? 'border-red-500/50 bg-red-500/5' : ''}`} value={formData.full_name} onChange={e => { setFormData({ ...formData, full_name: e.target.value }); if (errors.full_name) setErrors(prev => ({ ...prev, full_name: '' })); }} placeholder="John Doe" /></div>
                                    {errors.full_name && <p className="mt-1 text-[10px] text-red-400 flex items-center gap-1 ml-1 uppercase font-bold tracking-wider"><AlertCircle className="h-3 w-3" /> {errors.full_name}</p>}
                                </div>
                                <div className="space-y-1.5 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Digital Coordinates <span className="text-gold-400">*</span></label>
                                    <div className="relative"><Mail className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><input type="email" className={`gn-input pl-12 ${errors.email ? 'border-red-500/50 bg-red-500/5' : ''}`} value={formData.email} onChange={e => { setFormData({ ...formData, email: e.target.value }); if (errors.email) setErrors(prev => ({ ...prev, email: '' })); }} onBlur={handleEmailBlur} placeholder="john@example.com" /></div>
                                </div>
                                <div className="space-y-1.5 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Mobile Link <span className="text-gold-400">*</span></label>
                                    <div className="relative"><Phone className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><input type="tel" className={`gn-input pl-12 ${errors.phone ? 'border-red-500/50 bg-red-500/5' : ''}`} value={formData.phone} onChange={e => { setFormData({ ...formData, phone: e.target.value }); if (errors.phone) setErrors(prev => ({ ...prev, phone: '' })); }} onBlur={handleMobileBlur} placeholder="+91 12345 67890" /></div>
                                </div>
                                <div className="space-y-5">
                                    <div className="space-y-1.5 relative">
                                        <label className="block text-sm font-medium text-white/90 ml-1">Gender <span className="text-gold-400">*</span></label>
                                        <div className="relative"><Users className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><select className="gn-input pl-12 pr-10 appearance-none bg-black/40" value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })}><option value="" disabled>Select...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select><ChevronDown className="pointer-events-none absolute top-4 right-4 h-5 w-5 text-gold-400/40" /></div>
                                    </div>
                                    <div className="space-y-1.5 relative">
                                        <label className="block text-sm font-medium text-white/90 ml-1">Country <span className="text-gold-400">*</span></label>
                                        <div className="relative"><Globe className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><input className="gn-input pl-12" value={formData.nationality} onChange={e => setFormData({ ...formData, nationality: e.target.value })} placeholder="Country" /></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Digital Identification */}
                    <div className="gn-card gn-card--flush relative overflow-hidden group">
                        <div className="flex items-center gap-3 border-b border-white/5 py-4 px-8 bg-[#d4af37] shadow-[inset_0_1px_rgba(255,255,255,0.2)]">
                            <Shield className="h-4 w-4 text-black" /><span className="text-[11px] font-black uppercase tracking-[0.4em] text-black">Identification Node</span>
                        </div>
                        <div className="px-1 pt-6 pb-8 space-y-6">
                            <div className="space-y-1.5 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">Document Variant <span className="text-gold-400">*</span></label>
                                <div className="relative"><CreditCard className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" /><select className="gn-input pl-12 pr-10 appearance-none bg-black/40" value={formData.id_type} onChange={e => setFormData({ ...formData, id_type: e.target.value })}><option value="Aadhar">Aadhar Card</option><option value="Passport">Passport</option><option value="Driving License">Driving License</option><option value="Voter ID">Voter ID</option></select><ChevronDown className="pointer-events-none absolute top-4 right-4 h-5 w-5 text-gold-400/40" /></div>
                            </div>
                            <div className="space-y-1.5 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">ID Serial Number <span className="text-gold-400">*</span></label>
                                <div className="relative"><ShieldCheck className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                    {idFromExistingDoc ? (
                                        <div className="gn-input p-2 flex items-center justify-between gap-2 backdrop-blur-md bg-white/[0.02] border-gold-400/20 group/verified transition-all duration-500 hover:border-gold-400/40">
                                            <div className="flex items-center gap-5">
                                                <div className="shrink-0 w-12 h-12 rounded-2xl bg-gold-400/5 flex items-center justify-center ring-1 ring-gold-400/10 group-hover/verified:ring-gold-400/30 transition-all">
                                                    <Lock className="h-5 w-5 text-gold-400/60" />
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="font-mono text-gold-400/20 tracking-[0.6em] text-xs transition-colors group-hover/verified:text-gold-400/40">
                                                        **** ****
                                                    </div>
                                                    <div className="font-mono text-white/90 tracking-[0.6em] text-xs font-bold">
                                                        {formData.id_number.slice(-4)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-2 shrink-0">
                                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
                                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Verified</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => { setFormData(prev => ({ ...prev, id_number: '' })); setIdFromExistingDoc(false); }}
                                                    className="text-[10px] font-black text-gold-400 hover:text-white uppercase tracking-[0.2em] transition-all bg-gold-400/5 hover:bg-gold-400/20 px-4 py-2 rounded-xl border border-gold-400/10 hover:border-gold-400/30"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <input className={`gn-input pl-12 ${errors.id_number ? 'border-red-500/50 bg-red-500/5' : ''}`} value={formData.id_number} onChange={e => { setFormData({ ...formData, id_number: e.target.value.toUpperCase() }); if (errors.id_number) setErrors(prev => ({ ...prev, id_number: '' })); }} placeholder="•••• •••• ••••" />
                                    )}
                                </div>
                                {errors.id_number && <p className="mt-1 text-[10px] text-red-400 flex items-center gap-1 ml-1 uppercase font-bold tracking-wider"><AlertCircle className="h-3 w-3" /> {errors.id_number}</p>}
                            </div>
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end px-1"><label className="text-sm font-medium text-white/90">Primary ID Proof <span className="text-gold-400">*</span></label></div>
                                    { (existingFront || frontPreview) ? (
                                        <div className="relative overflow-hidden w-full bg-black/40 border border-white/10 rounded-3xl group transition-all duration-500 hover:border-gold-400/30">
                                            <div className="relative aspect-[4/1] w-full overflow-hidden bg-black/60 border-b border-white/5">
                                                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-all duration-700 z-10" />
                                                <img src={frontPreview || existingFront || ''} alt="Front ID" className="h-full w-full object-cover blur-md opacity-60 transition-all duration-700 group-hover:opacity-80 group-hover:blur-none" />
                                                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent opacity-60" />
                                                <div className="absolute bottom-4 left-4 flex items-center gap-3 z-20">
                                                    <div className={`w-2 h-2 rounded-full ${frontPreview ? 'bg-green-400' : 'bg-gold-400'} shadow-[0_0_10px_rgba(212,175,55,0.8)]`} />
                                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/90">
                                                        {frontImage ? 'New Capture' : 'Archived Record'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex w-full divide-x divide-white/5 bg-white/[0.02]">
                                                <button type="button" onClick={() => setViewImage(frontPreview || existingFront)} className="flex-1 py-5 text-[10px] font-black text-gold-100/60 hover:bg-white/5 hover:text-white transition-all uppercase tracking-[0.2em]">Review</button>
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
                                        <div className={`relative group block w-full rounded-2xl border-2 border-dashed p-4 text-center transition-all duration-300 ${errors.frontImage ? 'border-red-500/40 bg-red-500/[0.02]' : 'border-white/10 hover:border-gold-400/40 bg-white/[0.02] hover:bg-gold-400/[0.02]'}`}>
                                            <input type="file" accept="image/*" className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-20" onChange={(e) => handleFileChange(e, 'front')} />
                                            <div className="space-y-4">
                                                <Camera className="mx-auto h-10 w-10 text-gold-400/30 group-hover:text-gold-400" /><div className="space-y-1"><span className="block text-xs font-bold uppercase tracking-widest">Initiate Capture</span></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end px-1"><label className="text-sm font-medium text-white/90">Supporting ID View</label></div>
                                    { (existingBack || backPreview) ? (
                                        <div className="relative overflow-hidden w-full bg-black/40 border border-white/10 rounded-3xl group transition-all duration-500 hover:border-white/30">
                                            <div className="relative aspect-[4/1] w-full overflow-hidden bg-black/60 border-b border-white/5">
                                                <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-all duration-700 z-10" />
                                                <img src={backPreview || existingBack || ''} alt="Back ID" className="h-full w-full object-cover blur-md opacity-60 transition-all duration-700 group-hover:opacity-80 group-hover:blur-none" />
                                                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent opacity-60" />
                                                <div className="absolute bottom-4 left-4 flex items-center gap-3 z-20">
                                                    <div className={`w-2 h-2 rounded-full ${backPreview ? 'bg-green-400' : 'bg-gold-400'} shadow-[0_0_10px_rgba(212,175,55,0.8)]`} />
                                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/90">
                                                        {backImage ? 'New Capture' : 'Archived Record'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex w-full divide-x divide-white/5 bg-white/[0.02]">
                                                <button type="button" onClick={() => setViewImage(backPreview || existingBack)} className="flex-1 py-5 text-[10px] font-black text-gold-100/60 hover:bg-white/5 hover:text-white transition-all uppercase tracking-[0.2em]">Review</button>
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
                                        <div className="relative group block w-full rounded-2xl border-2 border-dashed p-3 text-center border-white/5 hover:border-gold-400/20 bg-white/[0.01] hover:bg-gold-400/[0.01]">
                                            <input type="file" accept="image/*" className="absolute inset-0 h-full w-full cursor-pointer opacity-0 z-20" onChange={(e) => handleFileChange(e, 'back')} />
                                            <div className="space-y-3"><UploadCloud className="mx-auto h-8 w-8 text-white/5 group-hover:text-gold-400/20" /><div className="space-y-1"><span className="block text-[10px] font-bold uppercase">Upload Inverse Side</span></div></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-8 flex flex-col items-center space-y-6">
                    <div className="flex gap-6 w-full">
                        <button type="button" onClick={() => navigate({ pathname: "../details", search: slug ? `?slug=${slug}` : "" }, { state: { booking } })} className="flex-1 gn-btn gn-btn--secondary py-5 text-lg">Return</button>
                        <button type="submit" disabled={uploading} className="flex-[2] gn-btn gn-btn--primary py-5 text-lg group overflow-hidden">
                            {uploading ? <div className="flex items-center gap-3 justify-center"><Loader2 className="h-6 w-6 animate-spin text-black" /><span className="uppercase tracking-widest font-bold">Securing Vault...</span></div> : <div className="flex items-center gap-3 justify-center"><span className="uppercase tracking-[0.15em] font-bold">Authorize & Advance</span><ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" /></div>}
                        </button>
                    </div>
                </div>
            </form>

            {viewImage && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl" onClick={() => setViewImage(null)}>
                    <div className="relative max-w-5xl w-full flex flex-col items-center">
                        <button className="absolute -top-16 right-0 text-white/40 hover:text-white p-3" onClick={() => setViewImage(null)}><X className="w-10 h-10" /></button>
                        <div className="relative w-full rounded-2xl overflow-hidden ring-1 ring-white/10">
                            <img src={viewImage} className="w-full h-auto max-h-[80vh] object-contain" onClick={e => e.stopPropagation()} alt="Preview" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-center"><p className="text-[10px] uppercase font-bold tracking-[0.3em] text-gold-400">Secure Document Review Node</p></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
