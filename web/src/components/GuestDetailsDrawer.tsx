// web/src/components/GuestDetailsDrawer.tsx
// Quick-glance guest + booking context for the arrivals board. Sibling of
// FolioDrawer (same slide-over shell + palette); FolioDrawer owns money,
// this owns identity/contact/stay. Deliberately NOT a CRM guest-360 — no
// notes editing, tags or preferences. ID metadata comes through the gated
// get_guest_id_proof_for_checkin RPC (hotel-scoped, audited, masked number
// only — never the hash or raw image paths); image bytes stay behind the
// get-document-url Edge Function.

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
    X,
    Phone,
    Mail,
    BedDouble,
    Users,
    CalendarDays,
    FileText,
    IdCard,
    CheckCircle2,
    Wallet,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface GuestDetailsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    arrival: any; // The row from v_arrival_dashboard_rows
    onOpenFolio?: (arrival: any) => void;
}

type BookingDetails = {
    email: string | null;
    special_requests: string | null;
    adults_total: number | null;
    children_total: number | null;
    guest_id: string | null;
    source: string | null;
    external_source: string | null;
};

/** Shape returned by the get_guest_id_proof_for_checkin RPC (jsonb). */
type IdProof = {
    type: string;
    number: string | null;
};

const DOC_TYPE_LABELS: Record<string, string> = {
    passport: "Passport",
    aadhaar: "Aadhaar",
    driving_license: "Driving Licence",
    other: "Other ID",
};

/** Label/value line; renders an em-dash when the value is missing. */
const DetailLine = ({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) => (
    <div className="flex items-start gap-3 py-2">
        <div className="mt-0.5 text-[#D4A373]/70">{icon}</div>
        <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#F3E6D0]/40">{label}</div>
            <div className="text-sm text-[#F3E6D0]/90 font-medium break-words">{children ?? "—"}</div>
        </div>
    </div>
);

export default function GuestDetailsDrawer({ isOpen, onClose, arrival, onOpenFolio }: GuestDetailsDrawerProps) {
    const navigate = useNavigate();
    const [details, setDetails] = useState<BookingDetails | null>(null);
    const [idDoc, setIdDoc] = useState<IdProof | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen || !arrival?.booking_id) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setDetails(null);
            setIdDoc(null);
            try {
                const { data: booking } = await supabase
                    .from("bookings")
                    .select("email, special_requests, adults_total, children_total, guest_id, source, external_source")
                    .eq("id", arrival.booking_id)
                    .maybeSingle();
                if (cancelled) return;
                if (booking) setDetails(booking as BookingDetails);

                if (booking?.guest_id) {
                    const { data: proof } = await supabase.rpc("get_guest_id_proof_for_checkin", {
                        p_guest_id: booking.guest_id,
                        p_hotel_id: arrival.hotel_id,
                    });
                    if (!cancelled && proof) setIdDoc(proof as IdProof);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, arrival?.booking_id]);

    if (!isOpen || !arrival) return null;

    const nights = Math.max(1, Math.round(
        (new Date(arrival.scheduled_checkout_at).getTime() - new Date(arrival.scheduled_checkin_at).getTime()) / 86_400_000,
    ));
    const fmtDate = (d: string) =>
        new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    // Pax: the arrivals view exposes adults_total/children_total; the booking
    // fetch is the fallback for callers passing an older row shape.
    const adults = arrival.adults_total ?? details?.adults_total ?? null;
    const children = arrival.children_total ?? details?.children_total ?? null;
    const paxLabel = adults == null
        ? null
        : `${adults} Adult${adults === 1 ? "" : "s"}${children ? ` · ${children} Child${children === 1 ? "" : "ren"}` : ""}`;

    const pending = Number(arrival.pending_amount || 0);
    const paid = Number(arrival.paid_amount || 0);

    const canCheckIn =
        arrival.primary_action === "CHECKIN" &&
        arrival.arrival_operational_state !== "CHECKED_IN" &&
        arrival.arrival_operational_state !== "CHECKOUT_REQUESTED";

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="relative w-full max-w-md bg-[#231A13] text-[#F3E6D0] h-full flex flex-col shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="px-6 py-5 border-b border-orange-900/30">
                    <button onClick={onClose} className="absolute top-5 right-5 text-orange-200/50 hover:text-orange-200 transition">
                        <X className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#8C5D35] to-[#4A2E1A] border-2 border-[#D4A373] p-0.5 shadow-lg overflow-hidden flex items-center justify-center">
                            <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(arrival.guest_name)}&background=8C5D35&color=F3E6D0`} alt={arrival.guest_name} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl font-bold tracking-tight text-white mb-0.5 truncate">{arrival.guest_name}</h2>
                            <p className="text-xs text-[#D4A373] font-medium flex items-center gap-1.5 opacity-90 flex-wrap">
                                <span className="font-mono">{arrival.booking_code}</span>
                                {arrival.vip_flag && (
                                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-black uppercase tracking-widest">VIP</span>
                                )}
                                {arrival.arrival_badge === "OTA" && (
                                    <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[9px] font-black uppercase tracking-widest">OTA</span>
                                )}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 px-6 py-4 space-y-5">
                    {/* Stay */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<CalendarDays className="w-4 h-4" />} label="Stay">
                            {fmtDate(arrival.scheduled_checkin_at)} → {fmtDate(arrival.scheduled_checkout_at)} · {nights} Night{nights === 1 ? "" : "s"}
                        </DetailLine>
                        <DetailLine icon={<BedDouble className="w-4 h-4" />} label="Rooms">
                            {arrival.room_numbers || "Unassigned"} ({arrival.rooms_total} room{arrival.rooms_total === 1 ? "" : "s"})
                        </DetailLine>
                        <DetailLine icon={<Users className="w-4 h-4" />} label="Guests">
                            {paxLabel}
                        </DetailLine>
                    </div>

                    {/* Contact */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<Phone className="w-4 h-4" />} label="Phone">
                            {arrival.phone ? (
                                <a href={`tel:${arrival.phone}`} className="text-[#D4A373] hover:text-[#E8BA87] hover:underline">{arrival.phone}</a>
                            ) : null}
                        </DetailLine>
                        <DetailLine icon={<Mail className="w-4 h-4" />} label="Email">
                            {loading && !details ? <span className="text-[#F3E6D0]/30">Loading…</span> : details?.email}
                        </DetailLine>
                    </div>

                    {/* Identity */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<IdCard className="w-4 h-4" />} label="ID Document">
                            {loading ? (
                                <span className="text-[#F3E6D0]/30">Loading…</span>
                            ) : idDoc ? (
                                <span className="flex items-center gap-2 flex-wrap">
                                    {DOC_TYPE_LABELS[idDoc.type] ?? idDoc.type}
                                    {idDoc.number && <span className="font-mono text-[#F3E6D0]/60">{idDoc.number}</span>}
                                </span>
                            ) : (
                                <span className="text-[#F3E6D0]/50">No ID on file</span>
                            )}
                        </DetailLine>
                    </div>

                    {/* Special requests */}
                    {details?.special_requests && (
                        <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                            <DetailLine icon={<FileText className="w-4 h-4" />} label="Special Requests">
                                {details.special_requests}
                            </DetailLine>
                        </div>
                    )}

                    {/* Balance */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-3 flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[#F3E6D0]/40">Balance</div>
                            <div className={`text-lg font-bold ${pending > 0 ? "text-[#E65F5C]" : "text-[#78B48B]"}`}>
                                {pending > 0 ? `₹${pending.toLocaleString("en-IN")} due` : "Settled"}
                            </div>
                            {paid > 0 && (
                                <div className="text-[11px] text-[#F3E6D0]/40">₹{paid.toLocaleString("en-IN")} paid</div>
                            )}
                        </div>
                        {onOpenFolio && (
                            <button
                                onClick={() => onOpenFolio(arrival)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C5D35]/30 hover:bg-[#8C5D35]/50 border border-[#D4A373]/40 text-[#E8BA87] text-xs font-bold uppercase tracking-widest transition"
                            >
                                <Wallet className="w-4 h-4" /> {pending > 0 ? "Collect" : "Folio"}
                            </button>
                        )}
                    </div>
                </div>

                {/* Footer */}
                {canCheckIn && (
                    <div className="px-6 py-4 border-t border-orange-900/30">
                        <button
                            onClick={() => navigate(`/checkin/booking?code=${arrival.booking_code}`)}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#D4A373] to-[#8C5D35] text-[#231A13] text-sm font-black uppercase tracking-widest hover:opacity-90 transition"
                        >
                            <CheckCircle2 className="w-4 h-4" /> Check-In Guest
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
