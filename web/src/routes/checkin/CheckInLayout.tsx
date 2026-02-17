import React, { useEffect, useState } from "react";
import { Outlet, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import Spinner from "../../components/Spinner";

export default function CheckInLayout() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [resolving, setResolving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const token = searchParams.get("tkn");

    useEffect(() => {
        async function resolveToken() {
            if (!token) return;

            setResolving(true);
            setError(null);

            try {
                // Call validate_precheckin_token with p_ignore_usage = true
                const { data, error: rpcError } = await supabase.rpc("validate_precheckin_token", {
                    p_token: token,
                    p_ignore_usage: true
                });

                if (rpcError) throw rpcError;

                if (data?.valid) {
                    // Navigate to details with booking data
                    navigate("/checkin/details", {
                        state: { booking: data },
                        replace: true // Prevent back button loop
                    });
                } else {
                    setError(data?.error || "Invalid QR Code");
                }
            } catch (err: any) {
                console.error("[CheckInLayout] Resolution error:", err);
                setError(err.message);
            } finally {
                setResolving(false);
            }
        }

        resolveToken();
    }, [token, navigate]);

    if (resolving) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <Spinner label="Resolving QR Code..." />
                <p className="mt-4 text-slate-500 text-sm">Please wait while we fetch your booking details.</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
                <div className="h-16 w-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                    <span className="text-2xl font-bold">!</span>
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">QR Resolution Failed</h2>
                <p className="mt-2 text-slate-600 max-w-sm">{error}</p>
                <button
                    onClick={() => {
                        window.location.href = "/checkin";
                    }}
                    className="mt-6 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                >
                    Try Manual Search
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-brand-gold selection:text-white">
            {/* Header */}
            <header className="sticky top-0 z-50 flex h-16 items-center justify-between bg-white px-6 shadow-sm border-b border-slate-100">
                <div className="flex items-center gap-2">
                    {/* Logo Placeholder - simplified for now */}
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-700 flex items-center justify-center text-white font-bold text-lg">
                        V
                    </div>
                    <span className="text-lg font-semibold tracking-tight text-slate-900">
                        VAiyu Guest
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                        English (US)
                    </button>
                    <button className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                        Help
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 lg:py-12 animate-in fade-in duration-500">
                <Outlet />
            </main>

            {/* Footer */}
            <footer className="fixed bottom-0 left-0 right-0 py-4 text-center text-xs text-slate-400 bg-white/50 backdrop-blur-sm border-t border-slate-100/50">
                Powered by VAiyu Hospitality OS
            </footer>
        </div>
    );
}

