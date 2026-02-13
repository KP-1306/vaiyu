import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowRight,
    Calendar,
    Camera,
    User,
    Users,
    BedDouble,
    MessageSquare,
    Loader2,
    ShieldCheck,
    Upload,
    CheckCircle2,
    X
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function WalkInDetails() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
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
        special_requests: ""
    });

    const [roomTypes, setRoomTypes] = useState<{ id: string, name: string }[]>([]);

    // OTP State
    const [showOtp, setShowOtp] = useState(false);
    const [otp, setOtp] = useState(["", "", "", ""]);
    const [isVerified, setIsVerified] = useState(false);
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        async function fetchTypes() {
            const { data } = await supabase.from('room_types').select('id, name');
            if (data) setRoomTypes(data);
        }
        fetchTypes();
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
                nights: calculateNights()
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
                                <input required type="tel" className={`block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all ${isVerified ? 'border-green-500 bg-green-50' : ''}`} value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} placeholder="+91 98765..." disabled={isVerified} />
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
                            <input type="email" className="block w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="guest@..." />
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
