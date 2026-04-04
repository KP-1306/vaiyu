import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
    CheckCircle2,
    Wifi,
    Key,
    Coffee,
    ArrowRight,
    Sparkles,
    Loader2
} from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function CheckInSuccess() {
    const location = useLocation();
    const { hotelId, roomNumber } = location.state || {};

    const [hotelData, setHotelData] = useState<any>(null);
    const [guestInfo, setGuestInfo] = useState<any>(null);
    const [loading, setLoading] = useState(!!hotelId);

    useEffect(() => {
        if (!hotelId) return;

        async function fetchInfo() {
            try {
                // 1. Fetch Hotel Name from public view
                const { data: hData, error: hErr } = await supabase
                    .from('v_public_hotels')
                    .select('name, slug')
                    .eq('id', hotelId)
                    .maybeSingle();

                if (hData) setHotelData(hData);

                // 2. Fetch Guest Info (WiFi, Breakfast)
                const { data: gData, error: gErr } = await supabase
                    .from('hotel_guest_info')
                    .select('*')
                    .eq('hotel_id', hotelId)
                    .maybeSingle();

                if (gData) setGuestInfo(gData);
            } catch (err) {
                console.error("[CheckInSuccess] Load error:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchInfo();
    }, [hotelId]);

    const formatTime = (timeStr: string) => {
        if (!timeStr) return "";
        try {
            const [h, m] = timeStr.split(':');
            const hour = parseInt(h);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            return `${displayHour}:${m} ${ampm}`;
        } catch {
            return timeStr;
        }
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-20 min-h-[80vh] flex flex-col items-center justify-center relative overflow-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gold-400/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-1/4 right-0 w-96 h-96 bg-gold-400/5 rounded-full blur-[100px] pointer-events-none" />

            <div className="relative z-10 space-y-16 text-center w-full">
                {/* Success Icon & Heading */}
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                    <div className="relative mx-auto w-32 h-32">
                        <div className="absolute inset-0 bg-gold-400/20 rounded-full blur-2xl animate-pulse" />
                        <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-gold-400 to-gold-600 shadow-[0_0_50px_rgba(212,175,55,0.4)]">
                            <CheckCircle2 className="h-16 w-16 text-black" />
                        </div>
                        <div className="absolute -top-2 -right-2">
                            <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center">
                                <Sparkles className="h-5 w-5 text-gold-400 animate-bounce" />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-gold-400/5 border border-gold-400/20 text-gold-400 text-[11px] font-black uppercase tracking-[0.4em]">
                            Checkin Completed
                        </div>
                        <h1 className="text-6xl font-light tracking-tighter text-white">
                            Assigned & <span className="text-gold-400 italic font-medium">Secured.</span>
                        </h1>
                        <p className="text-gold-100/40 font-light text-xl max-w-lg mx-auto leading-relaxed">
                            {loading ? (
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-gold-400/40" />
                            ) : (
                                <>Residency at <span className="text-white font-medium">{hotelData?.name || "The Hotel"}</span> has been successfully provisioned. Guest in-house.</>
                            )}
                        </p>
                    </div>
                </div>

                {/* Utility Grid */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-300">
                    <div className="gn-card group p-10 space-y-6 hover:bg-gold-400/[0.03] transition-all">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gold-400/40 group-hover:text-gold-400 transition-colors">
                            <Key className="h-7 w-7" />
                        </div>
                        <div className="text-left space-y-1">
                            <h3 className="text-lg font-light text-white tracking-tight">Access Control</h3>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-400/40">
                                {roomNumber ? `Room ${roomNumber}` : 'Dispensed via terminal'}
                            </p>
                        </div>
                    </div>

                    <div className="gn-card group p-10 space-y-6 hover:bg-gold-400/[0.03] transition-all">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gold-400/40 group-hover:text-gold-400 transition-colors">
                            <Wifi className="h-7 w-7" />
                        </div>
                        <div className="text-left space-y-1">
                            <h3 className="text-lg font-light text-white tracking-tight">Digital Mesh</h3>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-400/40 whitespace-pre-wrap break-all leading-relaxed">
                                {guestInfo?.wifi_ssid ? (
                                    <>
                                        {guestInfo.wifi_ssid}
                                        {guestInfo.wifi_password && (
                                            <>
                                                <span className="mx-2 text-white/20">/</span>
                                                <span className="text-white/80">{guestInfo.wifi_password}</span>
                                            </>
                                        )}
                                    </>
                                ) : 'Vaiyu_Lounge / Guest99'}
                            </p>
                        </div>
                    </div>

                    <div className="gn-card group p-10 space-y-6 hover:bg-gold-400/[0.03] transition-all">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-gold-400/40 group-hover:text-gold-400 transition-colors">
                            <Coffee className="h-7 w-7" />
                        </div>
                        <div className="text-left space-y-1">
                            <h3 className="text-lg font-light text-white tracking-tight">Breakfast Time</h3>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gold-400/40 leading-relaxed">
                                {guestInfo?.breakfast_start ? `${formatTime(guestInfo.breakfast_start)} — ${formatTime(guestInfo.breakfast_end)}` : '07:00 — 10:30'}
                                <span className="block mt-0.5 opacity-60">Hourly Provisioning</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="pt-10 animate-in fade-in slide-in-from-bottom-20 duration-1000 delay-500">
                    <Link
                        to={{
                            pathname: "/checkin",
                            search: hotelData?.slug ? `?slug=${hotelData.slug}` : ""
                        }}
                        state={{ hotelId }}
                        className="gn-btn gn-btn--primary px-16 py-6 text-xl group relative overflow-hidden inline-flex items-center gap-3"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        <span className="uppercase tracking-[0.2em] font-black">Back to Checkin</span>
                        <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                </div>
            </div>

            {/* Subtle Signature */}
            <div className="absolute bottom-10 left-0 right-0 text-center text-gold-200/50">
                <p className="text-[9px] font-bold uppercase tracking-[0.5em]">Experience Crafted by VAIYU</p>
            </div>
        </div>
    );
}
