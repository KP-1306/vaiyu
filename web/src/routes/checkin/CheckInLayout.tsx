import React from "react";
import { Outlet } from "react-router-dom";

export default function CheckInLayout() {
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
