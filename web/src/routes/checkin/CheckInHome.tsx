import React from "react";
import { useNavigate } from "react-router-dom";
import {
    FileText,
    Search,
    User,
    Luggage
} from "lucide-react";

export default function CheckInHome() {
    const navigate = useNavigate();

    return (
        <div className="mx-auto max-w-4xl pt-16 px-6 text-center">
            {/* Header */}
            <h1 className="text-3xl font-normal text-slate-700 mb-16">
                Welcome to <span className="text-slate-400 mx-2">|</span> <span className="text-slate-600">Guest Check-in</span>
            </h1>

            {/* Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
                {/* 1. Check-in with Booking */}
                <button
                    onClick={() => navigate("booking")}
                    className="group relative flex flex-col items-center justify-center h-64 w-full rounded-2xl bg-white shadow-lg border border-slate-100 transition-all hover:-translate-y-1 hover:shadow-xl active:scale-95"
                >
                    {/* Icon Composition: Tablet + Mag Glass */}
                    <div className="relative mb-6">
                        {/* Blue Document/Tablet shape */}
                        <div className="h-20 w-16 bg-blue-600 rounded-md flex flex-col gap-2 p-3 shadow-sm">
                            <div className="h-1.5 w-full bg-blue-400/50 rounded-full" />
                            <div className="h-1.5 w-3/4 bg-blue-400/50 rounded-full" />
                            <div className="h-1.5 w-full bg-blue-400/50 rounded-full" />
                        </div>
                        {/* Magnifying Glass Overlay */}
                        <div className="absolute -bottom-2 -right-4 bg-white rounded-full p-1 shadow-sm">
                            <Search strokeWidth={3} className="h-10 w-10 text-blue-800 fill-blue-100" />
                        </div>
                    </div>

                    <span className="text-lg font-semibold text-slate-700">
                        Check-in with Booking
                    </span>
                </button>

                {/* 2. Walk-in Guest */}
                <button
                    onClick={() => navigate("walkin")}
                    className="group relative flex flex-col items-center justify-center h-64 w-full rounded-2xl bg-white shadow-lg border border-slate-100 transition-all hover:-translate-y-1 hover:shadow-xl active:scale-95"
                >
                    {/* Icon Composition: Person + Luggage */}
                    <div className="relative mb-6 flex items-end">
                        {/* Person - darker blue */}
                        <User strokeWidth={0} fill="currentColor" className="h-24 w-24 text-blue-900 z-10" />

                        {/* Luggage - behind, lighter blue */}
                        <div className="absolute left-14 bottom-1 z-0">
                            <Luggage strokeWidth={1.5} className="h-14 w-14 text-blue-600 fill-blue-100" />
                        </div>
                    </div>

                    <span className="text-lg font-semibold text-slate-700">
                        Walk-in Guest
                    </span>
                </button>
            </div>
        </div>
    );
}
