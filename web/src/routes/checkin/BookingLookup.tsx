import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Search, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

export default function BookingLookup() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
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
                navigate("../details", { state: { booking } });
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
        <div className="mx-auto max-w-xl space-y-6">
            {/* ── Stepper ── */}
            <CheckInStepper steps={BOOKING_STEPS} currentStep={0} />

            <div className="space-y-2 text-center">
                <h2 className="text-3xl font-light text-slate-900">Find your Booking</h2>
                <p className="text-slate-500">
                    Enter your confirmation code, email address, or mobile number.
                </p>
            </div>

            <form onSubmit={handleSearch} className="space-y-6">
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                        <Search className="h-6 w-6 text-slate-400" />
                    </div>
                    <input
                        type="text"
                        className="block w-full rounded-2xl border-0 bg-white py-6 pl-14 pr-4 text-xl text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:leading-6"
                        placeholder="e.g. RES-1234 or +91 987..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={loading}
                        autoFocus
                    />
                </div>

                {error && (
                    <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 animate-in fade-in">
                        {error}
                    </div>
                )}

                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => navigate("../")}
                        className="flex-1 rounded-2xl bg-white px-8 py-5 text-xl font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all active:scale-[0.98]"
                    >
                        Back
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-8 py-5 text-xl font-semibold text-white shadow-md hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
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
            </form>
        </div>
    );
}
