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
    LogOut,
    AlertCircle,
    Clock,
    ShieldCheck,
    ShieldAlert,
    MessageCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { initialsOf } from "../utils/initials";
import { computeCheckoutState } from "../utils/checkoutState";
import { useOwnerT, useOwnerLocale } from "../i18n/useOwnerT";

interface GuestDetailsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    arrival: any; // The row from v_arrival_dashboard_rows
    onOpenFolio?: (arrival: any) => void;
    /** Staff-initiated checkout for an in-house guest. The parent (OwnerArrivals)
     *  owns the balance guard + CTD precheck + confirm modal, so the drawer just
     *  signals intent and closes. */
    onCheckout?: (arrival: any) => void;
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
    verification?: "pending" | "verified" | "rejected" | null;
};

/** Doc-type → i18n key (+ English fallback). Resolved via t() at render so the
 *  literal type code (passport/aadhaar/…) is never translated, only the label. */
const DOC_TYPE_LABELS: Record<string, { key: string; en: string }> = {
    passport: { key: "guestDrawer.docPassport", en: "Passport" },
    aadhaar: { key: "guestDrawer.docAadhaar", en: "Aadhaar" },
    driving_license: { key: "guestDrawer.docDrivingLicense", en: "Driving Licence" },
    other: { key: "guestDrawer.docOther", en: "Other ID" },
};

/** Compact operational-status pill mirroring the board's StatusBadge, restyled
 *  for the dark drawer. Labels reuse the board's owner-arrivals statusBadge keys
 *  (consistency); business logic lives elsewhere — this is display-only. */
const STATUS_META: Record<string, { key: string; en: string; cls: string }> = {
    CHECKED_IN: { key: "statusBadge.checkedIn", en: "Checked In", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
    CHECKOUT_REQUESTED: { key: "statusBadge.checkoutRequested", en: "Checkout Requested", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    PARTIALLY_ARRIVED: { key: "statusBadge.partiallyArrived", en: "Partially Arrived", cls: "bg-orange-400/15 text-orange-300 border-orange-400/30" },
    WAITING_HOUSEKEEPING: { key: "statusBadge.waitingHousekeeping", en: "Waiting Housekeeping", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
    WAITING_ROOM_ASSIGNMENT: { key: "statusBadge.waitingAllocation", en: "Waiting Allocation", cls: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30" },
    READY_TO_CHECKIN: { key: "statusBadge.ready", en: "Ready", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    EXPECTED: { key: "guestDrawer.expected", en: "Expected", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
    NO_ROOMS: { key: "statusBadge.noRooms", en: "No Rooms", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
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

export default function GuestDetailsDrawer({ isOpen, onClose, arrival, onOpenFolio, onCheckout }: GuestDetailsDrawerProps) {
    const navigate = useNavigate();
    const t = useOwnerT("owner-arrivals");
    const locale = useOwnerLocale();
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
        new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short" });

    // Pax: the arrivals view exposes adults_total/children_total; the booking
    // fetch is the fallback for callers passing an older row shape.
    const adults = arrival.adults_total ?? details?.adults_total ?? null;
    const children = arrival.children_total ?? details?.children_total ?? null;
    const paxLabel = adults == null
        ? null
        : `${t("guestDrawer.adults", "{{count}} Adults", { count: adults })}${children ? ` · ${t("guestDrawer.children", "{{count}} Children", { count: children })}` : ""}`;

    const pending = Number(arrival.pending_amount || 0);
    const paid = Number(arrival.paid_amount || 0);

    const canCheckIn =
        arrival.primary_action === "CHECKIN" &&
        arrival.arrival_operational_state !== "CHECKED_IN" &&
        arrival.arrival_operational_state !== "CHECKOUT_REQUESTED";

    // In-house guests can be checked out from here (parent owns the guard).
    const isInHouse =
        arrival.arrival_operational_state === "CHECKED_IN" ||
        arrival.arrival_operational_state === "CHECKOUT_REQUESTED";

    // Operational status + departure urgency — the context the board row shows,
    // carried into the detail view (computed from the same shared util).
    const statusMeta = STATUS_META[arrival.arrival_operational_state] ?? null;
    const checkout = computeCheckoutState(arrival, new Date());

    // WhatsApp is the operative channel in this market. Normalise to a wa.me
    // link: strip non-digits, prefix 91 for a bare 10-digit Indian number.
    const phoneDigits = (arrival.phone ?? "").replace(/\D/g, "");
    const waNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;

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
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#8C5D35] to-[#4A2E1A] border-2 border-[#D4A373] shadow-lg flex items-center justify-center text-[#F3E6D0] font-bold text-lg tracking-wide shrink-0">
                            {initialsOf(arrival.guest_name)}
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

                    {/* Operational status + departure urgency — never show less
                        context than the board row this opened from. */}
                    {(statusMeta || checkout.state === "overdue" || checkout.state === "today") && (
                        <div className="flex items-center gap-2 flex-wrap mt-3">
                            {statusMeta && (
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${statusMeta.cls}`}>
                                    {arrival.arrival_operational_state === "CHECKED_IN" && <CheckCircle2 className="w-3 h-3" />}
                                    {t(statusMeta.key, statusMeta.en)}
                                </span>
                            )}
                            {checkout.state === "overdue" && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border bg-rose-500/15 text-rose-300 border-rose-500/30">
                                    <AlertCircle className="w-3 h-3" />
                                    {t("departure.overdue", "Overdue · {{late}}", {
                                        late: checkout.daysLate >= 1
                                            ? t("departure.daysLate", "{{count}}d late", { count: checkout.daysLate })
                                            : t("departure.hoursLate", "{{count}}h late", { count: checkout.hoursLate }),
                                    })}
                                </span>
                            )}
                            {checkout.state === "today" && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border bg-amber-500/15 text-amber-300 border-amber-500/30">
                                    <LogOut className="w-3 h-3" />
                                    {t("departure.departingToday", "Departing today")}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 px-6 py-4 space-y-5">
                    {/* Stay */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<CalendarDays className="w-4 h-4" />} label={t("guestDrawer.labelStay", "Stay")}>
                            {fmtDate(arrival.scheduled_checkin_at)} → {fmtDate(arrival.scheduled_checkout_at)} · {t("guestDrawer.nights", "{{count}} Nights", { count: nights })}
                        </DetailLine>
                        <DetailLine icon={<BedDouble className="w-4 h-4" />} label={t("guestDrawer.labelRooms", "Rooms")}>
                            {arrival.room_numbers || t("guestDrawer.unassigned", "Unassigned")} ({t("guestDrawer.roomsCount", "{{count}} rooms", { count: arrival.rooms_total })})
                        </DetailLine>
                        <DetailLine icon={<Users className="w-4 h-4" />} label={t("guestDrawer.labelGuests", "Guests")}>
                            {paxLabel}
                        </DetailLine>
                    </div>

                    {/* Contact */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<Phone className="w-4 h-4" />} label={t("guestDrawer.labelPhone", "Phone")}>
                            {arrival.phone ? (
                                <span className="flex items-center gap-3 flex-wrap">
                                    <a href={`tel:${arrival.phone}`} className="text-[#D4A373] hover:text-[#E8BA87] hover:underline">{arrival.phone}</a>
                                    {waNumber && (
                                        <a
                                            href={`https://wa.me/${waNumber}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition"
                                        >
                                            <MessageCircle className="w-3 h-3" /> WhatsApp
                                        </a>
                                    )}
                                </span>
                            ) : null}
                        </DetailLine>
                        <DetailLine icon={<Mail className="w-4 h-4" />} label={t("guestDrawer.labelEmail", "Email")}>
                            {loading && !details ? (
                                <span className="text-[#F3E6D0]/30">{t("guestDrawer.loading", "Loading…")}</span>
                            ) : details?.email ? (
                                <a href={`mailto:${details.email}`} className="text-[#D4A373] hover:text-[#E8BA87] hover:underline">{details.email}</a>
                            ) : null}
                        </DetailLine>
                    </div>

                    {/* Identity */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                        <DetailLine icon={<IdCard className="w-4 h-4" />} label={t("guestDrawer.labelId", "ID Document")}>
                            {loading ? (
                                <span className="text-[#F3E6D0]/30">{t("guestDrawer.loading", "Loading…")}</span>
                            ) : idDoc ? (
                                <span className="flex items-center gap-2 flex-wrap">
                                    {DOC_TYPE_LABELS[idDoc.type] ? t(DOC_TYPE_LABELS[idDoc.type].key, DOC_TYPE_LABELS[idDoc.type].en) : idDoc.type}
                                    {idDoc.number && <span className="font-mono text-[#F3E6D0]/60">{idDoc.number}</span>}
                                    {idDoc.verification === "verified" && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                            <ShieldCheck className="w-3 h-3" /> {t("guestDrawer.verified", "Verified")}
                                        </span>
                                    )}
                                    {idDoc.verification === "rejected" && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                            <ShieldAlert className="w-3 h-3" /> {t("guestDrawer.rejected", "Rejected")}
                                        </span>
                                    )}
                                    {(!idDoc.verification || idDoc.verification === "pending") && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                            <Clock className="w-3 h-3" /> {t("guestDrawer.pending", "Pending")}
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span className="text-[#F3E6D0]/50">{t("guestDrawer.noId", "No ID on file")}</span>
                            )}
                        </DetailLine>
                    </div>

                    {/* Special requests */}
                    {details?.special_requests && (
                        <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-2">
                            <DetailLine icon={<FileText className="w-4 h-4" />} label={t("guestDrawer.labelSpecialRequests", "Special Requests")}>
                                {details.special_requests}
                            </DetailLine>
                        </div>
                    )}

                    {/* Balance */}
                    <div className="bg-[#1A130C] rounded-xl border border-orange-900/20 px-4 py-3 flex items-center justify-between">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[#F3E6D0]/40">{t("guestDrawer.labelBalance", "Balance")}</div>
                            <div className={`text-lg font-bold ${pending > 0 ? "text-[#E65F5C]" : "text-[#78B48B]"}`}>
                                {pending > 0 ? t("guestDrawer.amountDue", "₹{{amount}} due", { amount: pending.toLocaleString("en-IN") }) : t("guestDrawer.settled", "Settled")}
                            </div>
                            {paid > 0 && (
                                <div className="text-[11px] text-[#F3E6D0]/40">{t("guestDrawer.amountPaid", "₹{{amount}} paid", { amount: paid.toLocaleString("en-IN") })}</div>
                            )}
                        </div>
                        {onOpenFolio && (
                            <button
                                onClick={() => onOpenFolio(arrival)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C5D35]/30 hover:bg-[#8C5D35]/50 border border-[#D4A373]/40 text-[#E8BA87] text-xs font-bold uppercase tracking-widest transition"
                            >
                                <Wallet className="w-4 h-4" /> {pending > 0 ? t("guestDrawer.collect", "Collect") : t("guestDrawer.folio", "Folio")}
                            </button>
                        )}
                    </div>
                </div>

                {/* Footer — the next action, not a dead end */}
                {canCheckIn && (
                    <div className="px-6 py-4 border-t border-orange-900/30">
                        <button
                            onClick={() => navigate(`/checkin/booking?code=${arrival.booking_code}`)}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#D4A373] to-[#8C5D35] text-[#231A13] text-sm font-black uppercase tracking-widest hover:opacity-90 transition"
                        >
                            <CheckCircle2 className="w-4 h-4" /> {t("guestDrawer.checkInGuest", "Check-In Guest")}
                        </button>
                    </div>
                )}
                {isInHouse && onCheckout && (
                    <div className="px-6 py-4 border-t border-orange-900/30">
                        <button
                            onClick={() => onCheckout(arrival)}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#D4A373] to-[#8C5D35] text-[#231A13] text-sm font-black uppercase tracking-widest hover:opacity-90 transition"
                        >
                            <LogOut className="w-4 h-4" />
                            {arrival.arrival_operational_state === "CHECKOUT_REQUESTED" ? t("guestDrawer.approveCheckout", "Approve Checkout") : t("guestDrawer.checkoutGuest", "Checkout Guest")}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
