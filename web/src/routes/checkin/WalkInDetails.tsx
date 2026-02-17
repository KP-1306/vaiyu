import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
    Check
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { lookupGuestProfile } from "../../lib/api";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function WalkInDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(false);

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
                id_type: restored.guestDetails.id_type || "aadhar",
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
        return {
            full_name: "",
            mobile: "",
            email: "",
            nationality: "Indian",
            address: "",
            id_type: "aadhar",
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

    const [roomTypes, setRoomTypes] = useState<{ id: string, name: string }[]>([]);

    // OTP State
    const [showOtp, setShowOtp] = useState(false);
    const [otp, setOtp] = useState(["", "", "", ""]);
    const [isVerified, setIsVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);

    // Lookup State
    const [hotelId, setHotelId] = useState<string | null>(null);
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
            if (!formData.address || !hotelId) {
                const { data: hData } = await supabase.from('hotels').select('id, city, state, address, name').limit(1).single();
                if (hData) {
                    setHotelId(hData.id);
                    // Construction logic: Address, City, State
                    const parts = [];
                    if (hData.city) parts.push(hData.city);
                    if (hData.state) parts.push(hData.state);

                    // Fallback to address column if city/state missing
                    const fullAddr = parts.length > 0 ? parts.join(', ') : (hData.address || '');

                    if (fullAddr) {
                        setFormData(prev => ({ ...prev, address: fullAddr }));
                    }
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
                full_name: formData.full_name,
                mobile: formData.mobile,
                email: formData.email,
                nationality: formData.nationality,
                address: formData.address,
                id_type: formData.id_type,
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
            navigate("../availability", { state: payload });
        }, 600);
    };

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];

    return (
        <div className="mx-auto max-w-5xl space-y-6 pb-20">

            {/* ── Stepper ── */}
            <CheckInStepper steps={WALKIN_STEPS} currentStep={0} />

            <div className="text-center space-y-3">
                <h2 className="text-4xl font-light tracking-tight text-slate-900">New Walk-In Registration</h2>
                <p className="text-lg text-slate-500">Enter guest and stay details to check availability.</p>
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
                        }}
                        className="text-indigo-400 hover:text-indigo-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-8 lg:grid-cols-2">

                {/* ── LEFT: GUEST INFO ── */}
                <div className="space-y-6 rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5 relative">
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                        <div className="rounded-full bg-indigo-50 p-2 text-indigo-600"><User className="h-6 w-6" /></div>
                        <h3 className="text-xl font-semibold text-slate-900">Guest Information</h3>
                    </div>

                    <div className="space-y-5">
                        {/* Full Name */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Full Name</label>
                            <input required className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} placeholder="e.g. Aditi Sharma" />
                        </div>

                        {/* Mobile + Verify */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Mobile Number</label>
                            <div className="flex gap-2">
                                <input required type="tel" className={`block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all ${isVerified ? 'border-green-500 bg-green-50' : ''}`} value={formData.mobile} onBlur={handleMobileBlur} onChange={e => setFormData({ ...formData, mobile: e.target.value })} placeholder="+91 98765..." disabled={isVerified} />
                                {lookupLoading && <span className="text-xs text-indigo-500 absolute top-3 right-36 bg-white px-1">Checking...</span>}
                                {isVerified ? (
                                    <div className="flex items-center justify-center px-4 rounded-xl bg-green-100 text-green-700"><CheckCircle2 className="h-6 w-6" /></div>
                                ) : (
                                    <button type="button" onClick={handleSendOtp} className="whitespace-nowrap rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-all">Verify OTP</button>
                                )}
                            </div>
                        </div>

                        {/* OTP Overlay */}
                        {showOtp && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/90 backdrop-blur-sm">
                                <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-lg font-bold text-slate-900">Enter OTP</h4>
                                        <button type="button" onClick={() => setShowOtp(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
                                    </div>
                                    <p className="text-sm text-slate-500">Sent to {formData.mobile}</p>
                                    <div className="flex gap-2 justify-center">
                                        {otp.map((digit, idx) => (
                                            <input key={idx} id={`otp-${idx}`} type="text" maxLength={1} className="h-12 w-12 rounded-lg border-2 border-slate-200 text-center text-xl font-bold focus:border-indigo-600 focus:ring-0" value={digit} onChange={(e) => handleOtpChange(idx, e.target.value)} />
                                        ))}
                                    </div>
                                    <button type="button" onClick={handleVerifyOtp} className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 flex justify-center items-center">
                                        {verifying ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verify"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Email */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Email <span className="text-slate-400 font-normal">(Opt)</span></label>
                            <input type="email" className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.email} onBlur={handleEmailBlur} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="guest@..." />
                        </div>

                        {/* Nationality & Address */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Nationality</label>
                                <select className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.nationality} onChange={e => setFormData({ ...formData, nationality: e.target.value })}>
                                    <option value="Indian">Indian</option>
                                    <option value="Other">International</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Address</label>
                                <input required className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} placeholder="City, State" />
                            </div>
                        </div>

                    </div>
                </div>

                {/* ── RIGHT: STAY DETAILS ── */}
                <div className="space-y-6 rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-900/5">
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                        <div className="rounded-full bg-emerald-50 p-2 text-emerald-600"><Calendar className="h-6 w-6" /></div>
                        <h3 className="text-xl font-semibold text-slate-900">Stay Details</h3>
                    </div>

                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Check-In</label>
                                <input type="date" required className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.checkin_date} onChange={e => setFormData({ ...formData, checkin_date: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Check-Out</label>
                                <input type="date" required min={formData.checkin_date} className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.checkout_date} onChange={e => setFormData({ ...formData, checkout_date: e.target.value })} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Adults</label>
                                <div className="relative">
                                    <Users className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-slate-400" />
                                    <input type="number" min={1} max={5} className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.adults} onChange={e => setFormData({ ...formData, adults: parseInt(e.target.value) })} />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Children</label>
                                <div className="relative">
                                    <Users className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-slate-400" />
                                    <input type="number" min={0} max={5} className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.children} onChange={e => setFormData({ ...formData, children: parseInt(e.target.value) })} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Number of Rooms</label>
                            <div className="relative">
                                <BedDouble className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-slate-400" />
                                <input type="number" min={1} max={10} className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.rooms_count} onChange={e => setFormData({ ...formData, rooms_count: Math.max(1, parseInt(e.target.value) || 1) })} />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Preferred Room Type</label>
                            <div className="relative">
                                <BedDouble className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-slate-400" />
                                <select className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 pl-12 pr-10 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all appearance-none" value={formData.room_type_preference} onChange={e => setFormData({ ...formData, room_type_preference: e.target.value })}>
                                    <option value="">No Preference / Any</option>
                                    {roomTypes.map(rt => (<option key={rt.id} value={rt.id}>{rt.name}</option>))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-slate-700">Special Requests</label>
                            <div className="relative">
                                <MessageSquare className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-slate-400" />
                                <textarea rows={3} className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all resize-none" value={formData.special_requests} onChange={e => setFormData({ ...formData, special_requests: e.target.value })} placeholder="e.g. Early check-in, Extra bed..." />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className="lg:col-span-2 flex flex-col sm:flex-row gap-4 items-center justify-between pt-6 border-t border-slate-200">
                    <button type="button" onClick={() => navigate("../")} className="w-full sm:w-auto text-slate-600 font-semibold hover:text-slate-900 px-6 py-3 rounded-xl hover:bg-slate-100 transition-all">Cancel</button>
                    <button type="submit" disabled={loading} className="group w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-12 py-4 text-xl font-bold text-white shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 hover:scale-[1.02] disabled:opacity-70 disabled:scale-100 active:scale-[0.98] transition-all">
                        {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
                            <>Check Availability & Rates <ArrowRight className="h-6 w-6 transition-transform group-hover:translate-x-1" /></>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
