// web/src/routes/OwnerBookingDetail.tsx
// Per-booking detail + folio view for owners. Opens ANY booking (incl. checked-out
// / cancelled) — the universal target for the command palette's booking results.
//
// Reads everything via RLS-scoped table queries (bookings / folio_entries /
// payments / booking_rooms+rooms) — NO SECURITY DEFINER RPC, so there's no new
// auth-bypass surface; row scoping is enforced by RLS. The collect action reuses
// the hardened collect_payment RPC.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, Wallet, BedDouble, Phone, CalendarRange, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useOwnerT, useOwnerCommonT, useOwnerLocale, localizeCode } from "../i18n/useOwnerT";
import { OwnerLangToggle } from "../i18n/OwnerLangToggle";

type Booking = {
  id: string;
  code: string | null;
  status: string | null;
  guest_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  scheduled_checkin_at: string | null;
  scheduled_checkout_at: string | null;
  hotel_id?: string | null;
};
type FolioEntry = { id: string; entry_type: string; amount: number; description: string | null; created_at: string };
type Payment = { id: string; amount: number; method: string; status: string; created_at: string };

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (s: string | null | undefined, locale = "en-IN") =>
  s ? new Date(s).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const PAYABLE_STATUSES = new Set(["CHECKED_IN", "INHOUSE", "PRE_CHECKED_IN"]);

export default function OwnerBookingDetail() {
  const { slug, bookingId } = useParams<{ slug: string; bookingId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useOwnerT("owner-booking-detail");
  const tc = useOwnerCommonT();
  const locale = useOwnerLocale();
  const dt = (s: string | null | undefined) => fmtDate(s, locale);
  // The palette passes the clicked booking so the header renders instantly.
  const seed = (location.state as { booking?: any } | null)?.booking;

  const [booking, setBooking] = useState<Booking | null>(
    seed
      ? {
          id: seed.booking_id ?? seed.id,
          code: seed.code ?? null,
          status: seed.status ?? null,
          guest_name: seed.guest_name ?? null,
          phone: seed.phone ?? null,
          email: null,
          source: null,
          scheduled_checkin_at: seed.scheduled_checkin_at ?? null,
          scheduled_checkout_at: seed.scheduled_checkout_at ?? null,
        }
      : null,
  );
  const [entries, setEntries] = useState<FolioEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    setNotFound(false);
    setActionError(null);

    // Header — RLS-scoped. Empty result = doesn't exist OR no access (same UX).
    const { data: b } = await supabase
      .from("bookings")
      .select("id, code, status, guest_name, phone, email, source, scheduled_checkin_at, scheduled_checkout_at, hotel_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (!b) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setBooking(b as Booking);

    const [feRes, payRes, brRes] = await Promise.all([
      supabase.from("folio_entries").select("id, entry_type, amount, description, created_at").eq("booking_id", bookingId).order("created_at", { ascending: true }),
      supabase.from("payments").select("id, amount, method, status, created_at").eq("booking_id", bookingId).order("created_at", { ascending: true }),
      supabase.from("booking_rooms").select("room_id, rooms(number)").eq("booking_id", bookingId),
    ]);
    setEntries((feRes.data as FolioEntry[]) ?? []);
    setPayments((payRes.data as Payment[]) ?? []);
    setRooms(
      (((brRes.data as any[]) ?? [])
        .map((r) => {
          const rm = Array.isArray(r.rooms) ? r.rooms[0] : r.rooms; // embed may be object or array
          return rm?.number as string | undefined;
        })
        .filter((x): x is string => !!x)),
    );
    setLoading(false);
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const balance = useMemo(() => entries.reduce((s, e) => s + Number(e.amount || 0), 0), [entries]);
  const canCollect = balance > 0.005 && PAYABLE_STATUSES.has((booking?.status || "").toUpperCase());

  const collect = useCallback(async () => {
    if (!bookingId) return;
    setCollecting(true);
    setActionError(null);
    const { error } = await supabase.rpc("collect_payment", {
      p_booking_id: bookingId,
      p_amount: null, // settle the full outstanding balance, server-computed
      p_method: "CASH",
      p_idempotency_key: crypto.randomUUID(),
    });
    setCollecting(false);
    if (error) { setActionError(error.message); return; }
    await load();
  }, [bookingId, load]);

  const backToArrivals = () => navigate(`/owner/${slug}/arrivals`);

  return (
    <div className="vaiyu-owner min-h-screen w-full bg-[#0f1113] text-white font-['Outfit']">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-5">
        {/* Breadcrumb + back */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-medium">
            <Link to="/owner" className="text-slate-400 hover:text-white transition-colors">{t("breadcrumb.console", "Console")}</Link>
            <span className="text-slate-600">/</span>
            <Link to={`/owner/${slug}`} className="text-slate-400 hover:text-white transition-colors">{tc("nav.dashboard", "Dashboard")}</Link>
            <span className="text-slate-600">/</span>
            <span className="text-slate-100 font-semibold">{t("breadcrumb.booking", "Booking")}{booking?.code ? ` ${booking.code}` : ""}</span>
          </nav>
          <div className="flex items-center gap-2">
            <OwnerLangToggle />
            <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-indigo-500/40 transition">
              <ArrowLeft size={14} /> {tc("actions.back", "Back")}
            </button>
          </div>
        </div>

        {notFound ? (
          <div className="rounded-2xl border border-white/[0.06] bg-[#16181b] px-6 py-16 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-slate-600" />
            <h2 className="text-lg font-bold text-slate-200">{t("notFound.title", "Booking not found")}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              {t("notFound.body", "This booking doesn’t exist, or you don’t have access to it for this hotel.")}
            </p>
            <button onClick={backToArrivals} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20 transition">
              {t("notFound.cta", "Go to Arrivals")}
            </button>
          </div>
        ) : (
          <>
            {/* Header card */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#16181b] p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight text-white truncate">{booking?.guest_name || tc("terms.guest", "Guest")}</h1>
                    {booking?.status && (
                      <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                        {localizeCode(tc, "status", booking.status)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-xs text-slate-500">{booking?.code}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-slate-400"><CalendarRange size={15} className="text-slate-500 shrink-0" /><span>{dt(booking?.scheduled_checkin_at)} → {dt(booking?.scheduled_checkout_at)}</span></div>
                {rooms.length > 0 && <div className="flex items-center gap-2 text-slate-400"><BedDouble size={15} className="text-slate-500 shrink-0" /><span>{t("room", "Room {{rooms}}", { rooms: rooms.join(", ") })}</span></div>}
                {booking?.phone && <div className="flex items-center gap-2 text-slate-400"><Phone size={15} className="text-slate-500 shrink-0" /><span>{booking.phone}</span></div>}
                {booking?.source && <div className="text-slate-500 text-xs uppercase tracking-wide self-center">{t("via", "via {{source}}", { source: booking.source.replace(/_/g, " ") })}</div>}
              </div>
            </div>

            {/* Balance + collect */}
            <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#16181b] p-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${balance > 0.005 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : balance < -0.005 ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>
                    <Wallet size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {balance > 0.005 ? t("balance.outstanding", "Outstanding balance") : balance < -0.005 ? t("balance.refund", "Refund owed to guest") : t("balance.settled", "Settled")}
                    </div>
                    <div className={`font-mono text-lg font-bold ${balance > 0.005 ? "text-amber-300" : balance < -0.005 ? "text-sky-300" : "text-emerald-400"}`}>
                      {balance < -0.005 ? fmtINR(-balance) : fmtINR(balance)}
                    </div>
                  </div>
                </div>
                {canCollect && (
                  <button onClick={collect} disabled={collecting} className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 transition">
                    {collecting ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />}
                    {t("collect", "Collect {{amount}} · Cash", { amount: fmtINR(balance) })}
                  </button>
                )}
              </div>
              {actionError && <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{actionError}</div>}
            </div>

            {/* Folio */}
            <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#16181b] p-5">
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{tc("terms.folio", "Folio")}</h2>
              {loading && entries.length === 0 ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-white/[0.03] animate-pulse" />)}</div>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{t("folio.empty", "No folio entries yet.")}</p>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {entries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="block truncate text-slate-200">{e.description || e.entry_type}</span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-600">{e.entry_type.replace(/_/g, " ")} · {dt(e.created_at)}</span>
                      </div>
                      <span className={`font-mono shrink-0 ${Number(e.amount) < 0 ? "text-emerald-400" : "text-slate-200"}`}>{fmtINR(Number(e.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payments */}
            {payments.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#16181b] p-5">
                <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{t("payments.title", "Payments")}</h2>
                <div className="divide-y divide-white/[0.04]">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="block text-slate-200">{localizeCode(tc, "mode", p.method)}</span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-600">{p.status} · {dt(p.created_at)}</span>
                      </div>
                      <span className="font-mono shrink-0 text-slate-200">{fmtINR(Number(p.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
