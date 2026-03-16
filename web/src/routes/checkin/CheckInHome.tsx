import React from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
    Search,
    User,
    Luggage,
    Sparkles,
    ArrowRight
} from "lucide-react";

export default function CheckInHome() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const slug = searchParams.get("slug");
    const [hotelInfo, setHotelInfo] = React.useState<{ name: string; logo_url: string | null } | null>(null);

    React.useEffect(() => {
        async function fetchHotel() {
            if (!slug) return;
            const { data } = await supabase.from('hotels').select('*').ilike('slug', slug).maybeSingle();
            if (data) setHotelInfo(data);
        }
        fetchHotel();
    }, [slug]);

    return (
        <div className="max-w-4xl mx-auto space-y-12">
            {/* Header Section */}
            <div className="text-center space-y-8">
                <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-gold-400/5 border border-gold-400/20 text-gold-400 text-[10px] font-black uppercase tracking-[0.3em] backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-pulse shadow-[0_0_10px_#d4af37]" />
                    Seamless Arrival
                </div>
                {hotelInfo && (
                    <div className="flex flex-col items-center mb-6">
                        {hotelInfo.logo_url && (
                            <img 
                                src={hotelInfo.logo_url} 
                                alt={hotelInfo.name} 
                                className="h-24 w-auto object-contain mb-8 animate-in zoom-in duration-1000"
                            />
                        )}
                        <div 
                            className="inline-flex items-center gap-4 px-10 py-4 rounded-full shadow-[0_0_60px_rgba(212,175,55,0.15)] tracking-[0.4em] uppercase border border-gold-400/30 backdrop-blur-md"
                            style={{ backgroundColor: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', fontWeight: 900, fontSize: '0.875rem' }}
                        >
                            <span className="w-2.5 h-2.5 relative flex">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold-400"></span>
                            </span>
                            {hotelInfo.name}
                        </div>
                    </div>
                )}
                <div className="space-y-4">
                    <h1 className="text-5xl md:text-7xl font-light text-white tracking-tighter animate-in fade-in slide-in-from-bottom-4 duration-1000 leading-tight">
                        Welcome to <span className="text-gold-400 font-medium block sm:inline">{hotelInfo?.name || "Guest Check-in"}</span>
                    </h1>
                    <p className="text-gold-100/40 max-w-2xl mx-auto font-light text-lg leading-relaxed px-4">
                        Experience hospitality at its finest. Please choose your arrival method to begin the seamless check-in process.
                    </p>
                </div>
            </div>

            {/* Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto px-6">
                {/* 1. Check-in with Booking */}
                <button
                    onClick={() => navigate({ pathname: "booking", search: location.search })}
                    className="group relative gn-card p-12 flex flex-col items-center text-center transition-all duration-700 hover:-translate-y-3 hover:shadow-[0_40px_100px_rgba(212,175,55,0.1)] active:scale-95 overflow-hidden border-transparent hover:border-gold-400/20"
                >
                    {/* Decorative Gradient Glow */}
                    <div className="absolute top-0 right-0 w-48 h-48 bg-gold-400/5 blur-[100px] -mr-24 -mt-24 group-hover:bg-gold-400/10 transition-colors duration-700" />
                    
                    <div className="relative mb-10 p-8 rounded-[2rem] bg-gold-400/5 ring-1 ring-gold-400/10 group-hover:ring-gold-400/40 group-hover:-rotate-6 transition-all duration-700">
                        <div className="absolute inset-0 bg-gold-400/10 blur-2xl group-hover:blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
                        <Search className="h-14 w-14 text-gold-400 relative z-10" />
                    </div>

                    <h3 className="text-2xl font-light text-white mb-4 tracking-tight group-hover:text-gold-400 transition-colors">Digital Arrival</h3>
                    <p className="text-gold-100/30 text-base font-light mb-8 max-w-[200px]">
                        Find your existing reservation instantly.
                    </p>
                    
                    <div className="mt-auto flex items-center gap-3 text-gold-400 text-xs font-black uppercase tracking-[0.2em] opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 duration-700">
                        Start Now <ArrowRight className="h-4 w-4" />
                    </div>
                </button>

                {/* 2. Walk-in Guest */}
                <button
                    onClick={() => navigate({ pathname: "walkin", search: location.search })}
                    className="group relative gn-card p-12 flex flex-col items-center text-center transition-all duration-700 hover:-translate-y-3 hover:shadow-[0_40px_100px_rgba(212,175,55,0.1)] active:scale-95 overflow-hidden border-transparent hover:border-gold-400/20"
                >
                    {/* Decorative Gradient Glow */}
                    <div className="absolute top-0 right-0 w-48 h-48 bg-gold-400/5 blur-[100px] -mr-24 -mt-24 group-hover:bg-gold-400/10 transition-colors duration-700" />

                    <div className="relative mb-10 p-8 rounded-[2rem] bg-gold-400/5 ring-1 ring-gold-400/10 group-hover:ring-gold-400/40 group-hover:rotate-6 transition-all duration-700">
                        <div className="absolute inset-0 bg-gold-400/10 blur-2xl group-hover:blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
                        <Luggage className="h-14 w-14 text-gold-400 relative z-10" />
                    </div>

                    <h3 className="text-2xl font-light text-white mb-4 tracking-tight group-hover:text-gold-400 transition-colors">Instant Residency</h3>
                    <p className="text-gold-100/30 text-base font-light mb-8 max-w-[200px]">
                        New booking and room allocation.
                    </p>

                    <div className="mt-auto flex items-center gap-3 text-gold-400 text-xs font-black uppercase tracking-[0.2em] opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 duration-700">
                        Check Availability <ArrowRight className="h-4 w-4" />
                    </div>
                </button>
            </div>

            <div className="text-center pt-8">
                <p className="text-gold-100/30 text-xs font-medium">
                    Need assistance? Call reception at <span className="text-gold-100/50">+91 000 000 0000</span>
                </p>
            </div>
        </div>
    );
}
