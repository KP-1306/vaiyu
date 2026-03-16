import React, { useState, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams, Link } from "react-router-dom";
import {
    ArrowRight,
    Calendar,
    Camera,
    Users,
    BedDouble,
    MessageSquare,
    Loader2,
    ShieldCheck,
    Upload,
    CheckCircle2,
    X,
    User,
    Check,
    ArrowLeft,
    Fingerprint,
    Mail,
    Globe,
    MapPin
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { lookupGuestProfile } from "../../lib/api";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function WalkInDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);

    const slug = searchParams.get('slug');
    const storageKey = `vaiyu_walkin_form_${slug || 'no-slug'}`;

    // Restore form data from location.state if navigating back (Modify Search)
    const restored = (location.state as any);

    const [formData, setFormData] = useState(() => {
        if (restored?.guestDetails && restored?.stayDetails) {
            return {
                full_name: restored.guestDetails.full_name || "",
                mobile: restored.guestDetails.mobile || "",
                email: restored.guestDetails.email || "",
                nationality: restored.guestDetails.nationality || "Indian",
                address: restored.guestDetails.address || "",
                id_type: (restored.guestDetails.id_type === 'aadhar' || !restored.guestDetails.id_type) ? "aadhaar" : restored.guestDetails.id_type,
                id_number: "",
                front_image_path: restored.guestDetails.front_image_path || "",
                checkin_date: restored.stayDetails.checkin_date || new Date().toISOString().split('T')[0],
                checkout_date: restored.stayDetails.checkout_date || new Date(Date.now() + 86400000).toISOString().split('T')[0],
                adults: restored.stayDetails.adults || 2,
                children: restored.stayDetails.children || 0,
                room_type_preference: restored.stayDetails.room_type_preference || "",
                special_requests: restored.stayDetails.special_requests || "",
                rooms_count: restored.stayDetails.rooms_count || 1
            };
        }

        try {
            const saved = sessionStorage.getItem(storageKey);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            // ignore
        }

        return {
            guest_id: null,
            full_name: "",
            mobile: "",
            email: "",
            nationality: "Indian",
            address: "",
            id_type: "aadhaar",
            id_number: "",
            front_image_path: "",
            checkin_date: new Date().toISOString().split('T')[0],
            checkout_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            adults: 2,
            children: 0,
            room_type_preference: "",
            special_requests: "",
            rooms_count: 1
        };
    });

    useEffect(() => {
        sessionStorage.setItem(storageKey, JSON.stringify(formData));
    }, [formData, storageKey]);

    const [roomTypes, setRoomTypes] = useState<{ id: string, name: string }[]>([]);

    // OTP State
    const [showOtp, setShowOtp] = useState(false);
    const [otp, setOtp] = useState(["", "", "", ""]);
    const [isVerified, setIsVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);

    // Lookup State
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [hotelName, setHotelName] = useState<string | null>(null);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupSource, setLookupSource] = useState<"mobile" | "email" | null>(null);
    const [emailConflictGuest, setEmailConflictGuest] = useState<any | null>(null);

    const autofillGuest = (guest: any, source: "mobile" | "email") => {
        setFormData((prev: any) => ({
            ...prev,
            guest_id: guest.id || prev.guest_id,
            full_name: guest.full_name || prev.full_name,
            email: guest.email || prev.email,
            nationality: guest.nationality || prev.nationality,
            address: guest.address || prev.address,
            mobile: source === 'mobile' ? prev.mobile : (guest.mobile || prev.mobile)
        }));
        setLookupSource(source);
    };

    const handleMobileBlur = async () => {
        if (!hotelId || !formData.mobile || formData.mobile.length < 8) return;
        if (lookupSource === "mobile") return;

        setLookupLoading(true);
        try {
            const res = await lookupGuestProfile(hotelId, formData.mobile);
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
        if (!hotelId || !formData.email || !formData.mobile) return;
        if (lookupSource === "mobile") return;

        setLookupLoading(true);
        try {
            // Note: formData.mobile might be partial if user skipped it? 
            // But usually they fill mobile first.
            const res = await lookupGuestProfile(hotelId, formData.mobile, formData.email);
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

    useEffect(() => {
        async function fetchData() {
            // Fetch Room Types
            const { data: rtData } = await supabase.from('room_types').select('id, name');
            if (rtData) setRoomTypes(rtData);

            // Fetch Hotel Address for default
            let resolvedHotelId = hotelId;
            if (!formData.address || !hotelId) {
                // Use robust fetch with ilike for case-insensitivity
                const { data: hData } = await supabase.from('hotels')
                    .select('*')
                    .ilike('slug', slug || '')
                    .maybeSingle();
                
                if (hData) {
                    resolvedHotelId = hData.id;
                    setHotelId(hData.id);
                    setHotelName(hData.name);
                    // Store logo in formData for consistent access as hotel_logo
                    setFormData((prev: any) => ({ ...prev, hotel_logo: hData.logo_url }));
                    
                    // Construction logic: Address, City, State
                    const parts = [];
                    if (hData.city) parts.push(hData.city);
                    if (hData.state) parts.push(hData.state);

                    // Fallback to address column if city/state missing
                    const fullAddr = parts.length > 0 ? parts.join(', ') : (hData.address || '');

                    if (fullAddr) {
                        setFormData((prev: any) => ({ ...prev, address: fullAddr, hotel_logo: hData.logo_url }));
                    } else {
                        setFormData((prev: any) => ({ ...prev, hotel_logo: hData.logo_url }));
                    }
                }
            }

            // Auto-lookup guest if mobile is pre-filled but guest_id is missing
            // (happens when data was restored from sessionStorage without guest_id)
            if (resolvedHotelId && formData.mobile && formData.mobile.length >= 10 && !formData.guest_id) {
                try {
                    const res = await lookupGuestProfile(resolvedHotelId, formData.mobile);
                    if (res.found && res.guest?.id) {
                        setFormData((prev: any) => ({ ...prev, guest_id: res.guest.id }));
                    }
                } catch (err) {
                    console.error("[WalkInDetails] Auto-lookup failed:", err);
                }
            }
        }
        fetchData();
    }, []);

    const calculateNights = () => {
        const start = new Date(formData.checkin_date);
        const end = new Date(formData.checkout_date);
        return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));
    };

    const handleSendOtp = () => {
        if (formData.mobile.length < 10) { alert("Please enter a valid mobile number"); return; }
        setShowOtp(true);
    };

    const handleVerifyOtp = () => {
        setVerifying(true);
        setTimeout(() => { setVerifying(false); setIsVerified(true); setShowOtp(false); }, 1500);
    };

    const handleOtpChange = (index: number, value: string) => {
        if (value.length > 1) return;
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);
        if (value && index < 3) document.getElementById(`otp-${index + 1}`)?.focus();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const payload = {
            guestDetails: {
                id: formData.guest_id,
                full_name: formData.full_name,
                mobile: formData.mobile,
                email: formData.email,
                nationality: formData.nationality,
                address: formData.address,
                id_type: (formData.id_type === 'aadhaar' || formData.id_type === 'passport' || formData.id_type === 'driving_license' || formData.id_type === 'other') ? formData.id_type : 'other',
                front_image_path: formData.front_image_path,
            },
            stayDetails: {
                checkin_date: formData.checkin_date,
                checkout_date: formData.checkout_date,
                adults: formData.adults,
                children: formData.children,
                room_type_preference: formData.room_type_preference,
                special_requests: formData.special_requests,
                nights: calculateNights(),
                rooms_count: formData.rooms_count
            }
        };

        setTimeout(() => {
            setLoading(false);
            navigate({ pathname: "../availability", search: location.search }, { state: payload });
        }, 600);
    };

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];

    return (
        <div className="mx-auto max-w-5xl space-y-10 pb-24">


            <div className="text-center space-y-4">
                {hotelName && (
                    <div className="flex flex-col items-center mb-8">
                        {formData.hotel_logo && (
                            <img 
                                src={formData.hotel_logo} 
                                alt={hotelName} 
                                className="h-16 w-auto object-contain mb-4 animate-in zoom-in duration-500"
                            />
                        )}
                        <div 
                            className="inline-flex items-center gap-3 px-6 py-2.5 rounded-full shadow-[0_0_30px_rgba(212,175,55,0.3)] tracking-[0.2em] uppercase"
                            style={{ backgroundColor: '#d4af37', color: '#000000', fontWeight: 900, fontSize: '0.875rem' }}
                        >
                            <span className="w-2 h-2 relative flex">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
                            </span>
                            {hotelName}
                        </div>
                    </div>
                )}
                <div className="text-center space-y-3">
                    <h2 className="text-4xl font-light text-white tracking-tight">Guest Registration</h2>
                    <p className="text-gold-100/60 font-light text-lg italic">Secure stay provisioning and profile establishment</p>
                </div>
            </div>

            {/* Email Conflict Modal */}
            {emailConflictGuest && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
                    <div className="gn-card w-full max-w-md p-8 space-y-8 border-gold-400/20 shadow-2xl">
                        <div className="space-y-3 text-center">
                            <div className="mx-auto w-16 h-16 rounded-2xl bg-gold-400/10 flex items-center justify-center ring-1 ring-gold-400/20 mb-4">
                                <User className="h-8 w-8 text-gold-400" />
                            </div>
                            <h3 className="text-white text-2xl font-light tracking-tight">Existing Profile Detected</h3>
                            <p className="text-gold-100/40 text-sm leading-relaxed font-light">
                                We found a guest profile associated with <span className="text-gold-400 font-medium">{formData.email}</span>.
                                <br />Would you like to synchronize with your saved details?
                            </p>
                        </div>

                        <div className="bg-white/5 rounded-2xl p-5 text-sm space-y-3 border border-white/5 backdrop-blur-md">
                            <div className="flex justify-between items-center">
                                <span className="text-gold-100/30 uppercase tracking-widest text-[10px] font-bold">Full Name</span>
                                <span className="text-white font-medium">{emailConflictGuest.full_name}</span>
                            </div>
                            <div className="w-full h-px bg-white/5" />
                            <div className="flex justify-between items-center">
                                <span className="text-gold-100/30 uppercase tracking-widest text-[10px] font-bold">Mobile Link</span>
                                <span className="text-white font-medium">{emailConflictGuest.mobile || 'N/A'}</span>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button
                                type="button"
                                onClick={() => setEmailConflictGuest(null)}
                                className="flex-1 gn-btn gn-btn--secondary py-4"
                            >
                                Keep Current
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    autofillGuest(emailConflictGuest, 'email');
                                    setEmailConflictGuest(null);
                                }}
                                className="flex-1 gn-btn gn-btn--primary py-4"
                            >
                                Sync Profile
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Autofill Banner */}
            {lookupSource && (
                <div className="mx-auto max-w-2xl bg-gold-400/5 border border-gold-400/20 rounded-2xl p-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-4 backdrop-blur-md">
                    <div className="shrink-0">
                        <div className="w-8 h-8 rounded-full bg-gold-400/20 flex items-center justify-center ring-1 ring-gold-400/30">
                            <Check className="w-4 h-4 text-gold-400" />
                        </div>
                    </div>
                    <div className="flex-1">
                        <p className="text-white text-sm font-medium">Profile detailes synchronized</p>
                        <p className="text-gold-400/60 text-xs font-light tracking-wide uppercase">
                            Authenticated via {lookupSource === "mobile" ? "mobile linkage" : "secure email"}
                        </p>
                    </div>
                    <button
                        onClick={() => setLookupSource(null)}
                        className="text-white/20 hover:text-white p-1 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-10 lg:grid-cols-2">

                {/* ── LEFT: GUEST INFO ── */}
                <div className="gn-card relative overflow-hidden group">
                    {/* Decorative Background Motif */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gold-400/5 blur-3xl rounded-full -mr-10 -mt-10 group-hover:bg-gold-400/10 transition-colors" />
                    
                    <div className="flex items-center gap-3 border-b border-white/5 py-4 px-10 bg-white/[0.03] mb-8">
                        <div className="h-10 w-10 rounded-xl bg-gold-400/10 flex items-center justify-center ring-1 ring-gold-400/20">
                            <Fingerprint className="h-5 w-5 text-gold-400" />
                        </div>
                        <h3 className="text-lg font-medium text-white tracking-tight">Identity Details</h3>
                    </div>

                    <div className="p-10 pt-0 space-y-8">
                        <div className="space-y-6">
                            {/* Mobile + Verify */}
                            <div className="space-y-2 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">Contact Link</label>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <input 
                                            required 
                                            type="tel" 
                                            className={`gn-input w-full ${isVerified ? 'border-gold-400/40 bg-gold-400/[0.02]' : ''} ${formData.mobile && !/^[0-9]{10}$/.test(formData.mobile) ? 'border-red-500/50' : ''}`} 
                                            value={formData.mobile} 
                                            onBlur={handleMobileBlur} 
                                            onChange={e => {
                                                const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                                                setFormData({ ...formData, mobile: val });
                                            }} 
                                            placeholder="10-digit mobile number" 
                                            disabled={isVerified} 
                                        />
                                        {formData.mobile && !/^[0-9]{10}$/.test(formData.mobile) && (
                                            <div className="absolute -bottom-5 left-1 text-[10px] font-bold text-red-500 uppercase tracking-widest animate-in fade-in slide-in-from-top-1">
                                                Enter 10-digit number
                                            </div>
                                        )}
                                    </div>
                                    {isVerified ? (
                                        <div className="flex items-center justify-center px-5 rounded-2xl bg-gold-400/10 text-gold-400 ring-1 ring-gold-400/20"><CheckCircle2 className="h-6 w-6" /></div>
                                    ) : (
                                        <button 
                                            type="button" 
                                            onClick={handleSendOtp} 
                                            disabled={!/^[0-9]{10}$/.test(formData.mobile)}
                                            className="gn-btn gn-btn--primary px-6 py-4 text-xs whitespace-nowrap disabled:opacity-30 disabled:grayscale transition-all"
                                        >
                                            Auth Code
                                        </button>
                                    )}
                                </div>
                                {lookupLoading && <span className="text-[10px] font-bold text-gold-400 absolute right-32 bottom-4 uppercase animate-pulse">Syncing...</span>}
                            </div>

                            {/* Full Name */}
                            <div className="space-y-2 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">Legal Name</label>
                                <div className="relative">
                                    <User className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                    <input 
                                        required 
                                        className="gn-input pl-12" 
                                        value={formData.full_name} 
                                        onChange={e => setFormData({ ...formData, full_name: e.target.value })} 
                                        placeholder="Enter your full legal name" 
                                    />
                                </div>
                            </div>

                            {/* OTP Overlay */}
                            {showOtp && (
                                <div className="absolute inset-0 z-[60] flex items-center justify-center rounded-[2.5rem] bg-black/60 backdrop-blur-xl animate-in fade-in duration-300">
                                    <div className="gn-card w-full max-w-[280px] p-8 space-y-8 border-gold-400/20 shadow-2xl">
                                        <div className="flex justify-between items-center">
                                            <div className="space-y-1">
                                                <h4 className="text-xl font-light text-white">Verify</h4>
                                                <p className="text-[9px] uppercase tracking-widest font-bold text-gold-100/30">OTP sent to link</p>
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={() => setShowOtp(false)} 
                                                className="text-white/20 hover:text-white p-2 hover:bg-white/5 rounded-xl transition-all"
                                            >
                                                <X className="h-5 w-5" />
                                            </button>
                                        </div>
                                        <div className="flex gap-3 justify-center">
                                            {otp.map((digit, idx) => (
                                                <input 
                                                    key={idx} 
                                                    id={`otp-${idx}`} 
                                                    type="text" 
                                                    maxLength={1} 
                                                    className="h-12 w-10 rounded-xl bg-white/5 border border-white/10 text-center text-xl font-mono text-gold-400 focus:border-gold-400/60 focus:ring-0 outline-none transition-all" 
                                                    value={digit} 
                                                    onChange={(e) => handleOtpChange(idx, e.target.value)} 
                                                />
                                            ))}
                                        </div>
                                        <button 
                                            type="button" 
                                            onClick={handleVerifyOtp} 
                                            className="w-full gn-btn gn-btn--primary py-4 text-sm"
                                        >
                                            {verifying ? <Loader2 className="h-5 w-5 animate-spin mx-auto text-black" /> : "Authorize"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Email */}
                            <div className="space-y-2 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">Mail Identification</label>
                                <div className="relative">
                                    <Mail className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                    <input 
                                        required 
                                        type="email" 
                                        className="gn-input pl-12" 
                                        value={formData.email} 
                                        onBlur={handleEmailBlur} 
                                        onChange={e => setFormData({ ...formData, email: e.target.value })} 
                                        placeholder="email@example.com" 
                                    />
                                </div>
                            </div>

                            {/* Nationality & Address */}
                            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Origin</label>
                                    <div className="relative">
                                        <Globe className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                        <select 
                                            className="gn-input pl-12 appearance-none bg-no-repeat bg-[right_1rem_center]" 
                                            value={formData.nationality} 
                                            onChange={e => setFormData({ ...formData, nationality: e.target.value })}
                                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(212, 175, 55, 0.4)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundSize: '1.2em', backgroundRepeat: 'no-repeat' }}
                                        >
                                            <option value="Indian" className="bg-slate-900">Indian</option>
                                            <option value="Other" className="bg-slate-900">International</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Residence</label>
                                    <div className="relative">
                                        <MapPin className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                        <input 
                                            required 
                                            className="gn-input pl-12" 
                                            value={formData.address} 
                                            onChange={e => setFormData({ ...formData, address: e.target.value })} 
                                            placeholder="City, State" 
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── RIGHT: STAY DETAILS ── */}
                <div className="gn-card relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gold-400/5 blur-3xl rounded-full -mr-10 -mt-10 group-hover:bg-gold-400/10 transition-colors" />

                    <div className="flex items-center gap-3 border-b border-white/5 py-4 px-10 bg-white/[0.03] mb-8">
                        <div className="h-10 w-10 rounded-xl bg-gold-400/10 flex items-center justify-center ring-1 ring-gold-400/20">
                            <BedDouble className="h-5 w-5 text-gold-400" />
                        </div>
                        <h3 className="text-lg font-medium text-white tracking-tight">Stay Provisions</h3>
                    </div>

                    <div className="p-10 pt-0 space-y-8">
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Arrival Date</label>
                                    <div className="relative">
                                        <Calendar className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                        <input type="date" required className="gn-input pl-12" value={formData.checkin_date} onChange={e => setFormData({ ...formData, checkin_date: e.target.value })} />
                                    </div>
                                </div>
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Departure</label>
                                    <div className="relative">
                                        <Calendar className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400 z-10" />
                                        <input type="date" required min={formData.checkin_date} className="gn-input pl-12" value={formData.checkout_date} onChange={e => setFormData({ ...formData, checkout_date: e.target.value })} />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Adult Occupancy</label>
                                    <div className="relative">
                                        <Users className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400" />
                                        <input type="number" min={1} max={5} className="gn-input pl-12" value={formData.adults} onChange={e => setFormData({ ...formData, adults: parseInt(e.target.value) })} />
                                    </div>
                                </div>
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Minor Occupancy</label>
                                    <div className="relative">
                                        <Users className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400" />
                                        <input type="number" min={0} max={5} className="gn-input pl-12" value={formData.children} onChange={e => setFormData({ ...formData, children: parseInt(e.target.value) })} />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Unit Count</label>
                                    <div className="relative">
                                        <BedDouble className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400" />
                                        <input type="number" min={1} max={10} className="gn-input pl-12" value={formData.rooms_count} onChange={e => setFormData({ ...formData, rooms_count: Math.max(1, parseInt(e.target.value) || 1) })} />
                                    </div>
                                </div>
                                <div className="space-y-2 relative">
                                    <label className="block text-sm font-medium text-white/90 ml-1">Unit Preference</label>
                                    <div className="relative">
                                        <BedDouble className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400" />
                                        <select 
                                            className="gn-input pl-12 appearance-none bg-no-repeat bg-[right_1rem_center]" 
                                            value={formData.room_type_preference} 
                                            onChange={e => setFormData({ ...formData, room_type_preference: e.target.value })}
                                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(212, 175, 55, 0.4)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundSize: '1.2em', backgroundRepeat: 'no-repeat' }}
                                        >
                                            <option value="" className="bg-slate-900">Standard / No Preference</option>
                                            {roomTypes.map(rt => (<option key={rt.id} value={rt.id} className="bg-slate-900">{rt.name}</option>))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2 relative">
                                <label className="block text-sm font-medium text-white/90 ml-1">Bespoke Requirements</label>
                                <div className="relative">
                                    <MessageSquare className="pointer-events-none absolute top-4 left-4 h-5 w-5 text-gold-400" />
                                    <textarea 
                                        rows={3} 
                                        className="gn-input pl-12 min-h-[120px] resize-none pt-4" 
                                        value={formData.special_requests} 
                                        onChange={e => setFormData({ ...formData, special_requests: e.target.value })} 
                                        placeholder="e.g. Early check-in, dietary considerations, extra bedding..." 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className="lg:col-span-2 flex flex-col sm:flex-row gap-6 items-center justify-between pt-10 border-t border-white/5">
                    <button
                        type="button"
                        onClick={() => navigate({ pathname: "../", search: location.search })}
                        className="w-full sm:w-auto gn-btn gn-btn--secondary px-10 py-4 text-sm uppercase tracking-widest font-bold"
                    >
                        Back to Selection
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !/^[0-9]{10}$/.test(formData.mobile)}
                        className="group w-full sm:w-auto gn-btn gn-btn--primary px-16 py-5 text-xl font-black relative overflow-hidden disabled:opacity-50 disabled:grayscale"
                    >
                        {loading ? (
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-6 w-6 animate-spin text-black" />
                                <span className="uppercase tracking-widest">Validating Units...</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <span className="uppercase tracking-[0.15em]">Check Availability</span>
                                <ArrowRight className="h-6 w-6 transition-transform group-hover:translate-x-1" />
                            </div>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
