import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { ArrowRight, Search, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function BookingLookup() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const slug = searchParams.get("slug");
    const [query, setQuery] = useState(searchParams.get("code") || "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-search if code is present in URL
    useEffect(() => {
        const code = searchParams.get("code");
        if (code) {
            handleSearch();
        }
    }, []);

    async function handleSearch(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);

        try {
            // Get current hotel ID from context or URL?
            // Ideally checkin flow has a context. For now, we might need to hardcode or get from URL.
            // Assuming we are in a multi-tenant context, maybe we should have :slug param?
            // Since checkin is usually on-site, maybe we can fetch from a local config or assume text is enough for global unique if code?
            // BUT our RPC requires hotel_id.
            // Let's assume we can get it from the URL or a configured "Kiosk ID".
            // For this MVP, let's look up the hotel from the hostname or a fixed ID?
            // Let's use a placeholder ID for now or try to look it up.
            // Actually, standard practice for kiosk is to have a config page to set hotel_id.
            // Whatever, let's just use the first hotel or hardcoded for demo?
            // Wait, CheckInHome didn't ask for hotel.

            // FIX: We need to know which hotel we are checking in into!
            // Maybe the route should be /checkin/:slug?
            // Or simply we fetch the "current" hotel if we have a domain mapping.

            // Let's fetch ANY booking matching the code for now, but the RPC requires hotel_id.
            // I'll add a temporary "demo" hotel ID or fetch the first one.

            // const { data: hotelData } = await supabase
            //     .from("hotels")
            //     .select("id")
            //     .eq("slug", "TENANT1")
            //     .maybeSingle();

            const hotelId = null; // hotelData?.id || null; // Force global search for now

            const { data, error: rpcError } = await supabase.rpc("search_booking", {
                p_query: query,
                p_hotel_id: hotelId,
            });

            if (rpcError) throw rpcError;

            if (data && data.length > 0) {
                // Correct - found booking(s)
                // If 1, auto-select. If multiple, show list?
                // Let's just take the first one for now.
                const booking = data[0];
                navigate({ pathname: "../details", search: slug ? `?slug=${slug}` : "" }, { state: { booking } });
            } else {
                setError("No booking found with those details.");
            }

        } catch (err: any) {
            console.error(err);
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    }

    const BOOKING_STEPS = ["Find Booking", "Confirm Details", "Assign Room"];

    return (
        <div className="mx-auto max-w-2xl px-4">
            {/* ── Stepper ── */}
            <div className="mb-12">
                <CheckInStepper steps={BOOKING_STEPS} currentStep={0} />
            </div>

            <div className="gn-card premium-glass space-y-8 p-8 md:p-12">
                <div className="space-y-3 text-center">
                    <h2 className="text-4xl font-light tracking-tight text-white gn-page-title">
                        Find your <span className="text-gold-400 font-medium">Booking</span>
                    </h2>
                    <p className="text-white/60 text-lg">
                        Enter your confirmation code, email, or mobile number to begin.
                    </p>
                </div>

                <form onSubmit={handleSearch} className="space-y-10 pt-4">
                    <div className="space-y-4">
                        <label className="text-[11px] font-black uppercase tracking-[0.4em] text-gold-400/50 ml-1">
                            Search Criteria
                        </label>
                        <div className="relative group">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-7 transition-all duration-300 group-focus-within:text-gold-400 group-focus-within:scale-110">
                                <Search className="h-7 w-7 text-white/20 transition-colors group-focus-within:text-gold-400" />
                            </div>
                            <input
                                type="text"
                                className="gn-input !pl-20 text-2xl !bg-white/5 !border-white/10 focus:!border-gold-400/50 focus:!ring-gold-400/20 placeholder:text-white/10 placeholder:italic transition-all duration-300"
                                placeholder="RES-1234 or Mobile Number"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                disabled={loading}
                                autoFocus
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4 text-center text-red-400 animate-in fade-in slide-in-from-top-2">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4 pt-2">
                        <button
                            type="button"
                            onClick={() => navigate({ pathname: "../", search: slug ? `?slug=${slug}` : "" })}
                            className="flex-1 rounded-2xl bg-white/5 px-8 py-5 text-lg font-bold text-white/80 border border-white/10 hover:bg-white/10 hover:text-white transition-all active:scale-[0.98] uppercase tracking-widest"
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !query.trim()}
                            className="flex-[2] flex items-center justify-center gap-3 rounded-2xl bg-white px-8 py-5 text-lg font-black text-black shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:bg-gold-400 hover:text-black transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-widest"
                        >
                            {loading ? (
                                <Loader2 className="h-6 w-6 animate-spin" />
                            ) : (
                                <>
                                    Search Booking <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </button>
                    </div>

                    <div className="pt-4 text-center">
                        <p className="text-[10px] text-white/20 uppercase tracking-[0.3em] font-medium italic">
                            Secure Check-In System • v2.0
                        </p>
                    </div>
                </form>
            </div>
        </div>
    );
}
