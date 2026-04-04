import React, { useEffect, useState } from "react";
import { Outlet, useSearchParams, useNavigate, Link, useLocation } from "react-router-dom";
import { Home, ChevronRight } from "lucide-react";
import { supabase } from "../../lib/supabase";
import Spinner from "../../components/Spinner";
import "../guestnew/guestnew.css";
import "./checkin-visibility.css";

export default function CheckInLayout() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [resolving, setResolving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const token = searchParams.get("tkn");
    const slug = searchParams.get("slug");


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
                    // Navigate to details with booking data, preserving slug
                    navigate({
                        pathname: "/checkin/details",
                        search: slug ? `?slug=${slug}` : ""
                    }, {
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
            <div className="guestnew flex flex-col items-center justify-center p-6 text-center">
                <div className="guestnew-content">
                    <Spinner label="Resolving QR Code..." />
                    <p className="mt-4 text-gold-200/60 text-sm">Please wait while we fetch your booking details.</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="guestnew flex flex-col items-center justify-center p-6 text-center">
                <div className="guestnew-content">
                    <div className="h-20 w-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6 ring-1 ring-red-500/20">
                        <span className="text-3xl font-bold">!</span>
                    </div>
                    <h2 className="text-2xl font-semibold text-white">QR Resolution Failed</h2>
                    <p className="mt-2 text-gold-100/60 max-w-sm">{error}</p>
                    <button
                        onClick={() => {
                            window.location.href = `/checkin?slug=${slug || ''}`;
                        }}
                        className="gn-btn gn-btn--primary mt-8"
                    >
                        Try Manual Search
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="guestnew checkin-container">
            {/* Header */}
            <header className="gn-header">
                <div className="flex items-center gap-4">
                    <Link 
                        to={slug ? `/owner/${slug}` : "/owner"} 
                        className="gn-header__logo"
                    >
                        <img 
                            src="/brand/vaiyu-logo.png" 
                            alt="VAiyu" 
                            className="h-9 w-auto object-contain"
                        />
                        <span className="hidden sm:inline font-medium tracking-tight text-white">
                            VAiyu
                        </span>
                    </Link>

                    {/* Simple Title instead of Owner Breadcrumbs */}
                    {location.pathname.includes('/walkin') && (
                        <div className="hidden md:flex items-center gap-3 pl-4 border-l border-white/10 text-sm text-gold-100/40 font-medium italic">
                            Walk-In Registration
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-6">
                    <button className="text-sm font-medium text-gold-100/40 hover:text-white transition-colors">
                        English (US)
                    </button>
                    <button className="text-sm font-medium text-gold-100/40 hover:text-white transition-colors">
                        Help
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="guestnew-content mx-auto max-w-5xl px-4 py-8 md:px-6 lg:py-12 animate-in fade-in duration-700">
                <Outlet />
            </main>

            {/* Footer */}
            <footer className="fixed bottom-0 left-0 right-0 py-4 text-center text-[10px] uppercase tracking-[0.2em] text-gold-200/50 bg-black/40 backdrop-blur-md border-t border-white/5 z-0">
                Powered by VAiyu Hospitality OS
            </footer>
        </div>
    );
}

