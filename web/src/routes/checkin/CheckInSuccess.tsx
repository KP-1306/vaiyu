import React from "react";
import { Link } from "react-router-dom";
import {
    CheckCircle,
    Wifi,
    Key,
    Coffee
} from "lucide-react";

export default function CheckInSuccess() {
    return (
        <div className="mx-auto max-w-xl text-center space-y-10 py-10">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-12 w-12 text-green-600" />
            </div>

            <div className="space-y-2">
                <h1 className="text-4xl font-bold text-slate-900">You are all set!</h1>
                <p className="text-lg text-slate-600">
                    Welcome to The Grand Hotel. We hope you enjoy your stay.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                    <Key className="mx-auto h-8 w-8 text-indigo-600 mb-3" />
                    <h3 className="font-semibold text-slate-900">Room Key</h3>
                    <p className="text-xs text-slate-500 mt-1">Dispensed below</p>
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                    <Wifi className="mx-auto h-8 w-8 text-indigo-600 mb-3" />
                    <h3 className="font-semibold text-slate-900">Wi-Fi</h3>
                    <p className="text-xs text-slate-500 mt-1">GrandGuest / Hotel123</p>
                </div>
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
                    <Coffee className="mx-auto h-8 w-8 text-indigo-600 mb-3" />
                    <h3 className="font-semibold text-slate-900">Breakfast</h3>
                    <p className="text-xs text-slate-500 mt-1">7:00 AM - 10:30 AM</p>
                </div>
            </div>

            <div className="pt-8">
                <Link
                    to="/checkin"
                    className="inline-flex rounded-2xl bg-slate-900 px-8 py-4 text-base font-semibold text-white hover:bg-slate-800 transition-all"
                >
                    Back to Home
                </Link>
            </div>
        </div>
    );
}
