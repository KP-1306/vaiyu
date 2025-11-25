// web/src/routes/OwnerGuestProfile.tsx

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SEO from "../components/SEO";
import { API } from "../lib/api";

/**
 * Types for the aggregated guest profile payload coming from the Edge Function.
 * The shape is intentionally tolerant so the backend can evolve without breaking the UI.
 */

type GuestProfileCore = {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  notes?: string | null;
  tags?: string[] | null;
  preferences?: Record<string, any> | null;
  total_stays?: number;
  total_nights?: number;
  lifetime_value_inr?: number | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
};

type GuestStay = {
  code: string;
  status?: string;
  check_in?: string;
  check_out?: string;
  room?: string | null;
  source?: string | null;
  review_rating?: number | null;
};

type GuestTicket = {
  id: string;
  service_key?: string | null;
  status?: string;
  room?: string | null;
  created_at?: string;
  closed_at?: string | null;
  sla_minutes?: number | null;
  late?: boolean | null;
};

type GuestOrderItem = {
  name?: string;
  qty?: number;
};

type GuestOrder = {
  id: string;
  status?: string;
  created_at?: string;
  total_price?: number | null;
  room?: string | null;
  booking_code?: string | null;
  items?: GuestOrderItem[];
};

type GuestReview = {
  id: string;
  booking_code?: string | null;
  rating?: number | null;
  title?: string | null;
  body?: string | null;
  created_at?: string;
};

type GuestCreditEntry = {
  id: string;
  amount: number;
  reason?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

type GuestCredits = {
  balance: number;
  currency?: string;
  items?: GuestCreditEntry[];
};

type GuestProfilePayload = {
  ok?: boolean;
  hotel_id?: string;
  guest_id?: string;
  profile?: GuestProfileCore;
  stays?: GuestStay[];
  tickets?: GuestTicket[];
  orders?: GuestOrder[];
  reviews?: GuestReview[];
  credits?: GuestCredits;
  stats?: {
    total_stays?: number;
    total_nights?: number;
    total_tickets?: number;
    total_orders?: number;
    total_reviews?: number;
    on_time_ratio?: number;
    lifetime_value_inr?: number;
    last_visit_at?: string;
  };
};

function buildDemoGuestProfile(
  hotelSlug?: string | undefined,
  guestId?: string | undefined
): GuestProfilePayload {
  const now = new Date();
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  return {
    ok: true,
    hotel_id: "demo-hotel-id",
    guest_id: guestId ?? "demo-guest-id",
    profile: {
      id: guestId ?? "demo-guest-id",
      full_name: "Demo Guest",
      phone: "+91-98765-43210",
      email: "guest@example.com",
      city: "Nainital",
      state: "Uttarakhand",
      country: "India",
      tags: ["Repeat guest", "High intent", "Direct booking"],
      preferences: {
        Diet: "Pure veg",
        "Pillow type": "Soft, extra pillow",
        "Room preference": "Upper floor, valley view",
        "Check-in style": "Early check-in when possible",
      },
      total_stays: 3,
      total_nights: 7,
      lifetime_value_inr: 45000,
      first_seen_at: daysAgo(180),
      last_seen_at: daysAgo(10),
      notes:
        "Prefers quiet rooms away from lift; appreciates handwritten welcome notes.",
    },
    stays: [
      {
        code: "VA-DM-001",
        status: "completed",
        check_in: daysAgo(30),
        check_out: daysAgo(27),
        room: "204",
        source: "Direct",
        review_rating: 5,
      },
      {
        code: "VA-DM-002",
        status: "completed",
        check_in: daysAgo(90),
        check_out: daysAgo(85),
        room: "305",
        source: "OTA",
        review_rating: 4,
      },
      {
        code: "VA-DM-003",
        status: "upcoming",
        check_in: daysAgo(-15),
        check_out: daysAgo(-18),
        room: null,
        source: "Direct",
        review_rating: null,
      },
    ],
    tickets: [
      {
        id: "T-DM-1",
        service_key: "room_cleaning",
        status: "closed",
        room: "204",
        created_at: daysAgo(29),
        closed_at: daysAgo(29),
        sla_minutes: 25,
        late: false,
      },
      {
        id: "T-DM-2",
        service_key: "extra_pillow",
        status: "closed",
        room: "305",
        created_at: daysAgo(88),
        closed_at: daysAgo(88),
        sla_minutes: 20,
        late: false,
      },
    ],
    orders: [
      {
        id: "O-DM-1",
        status: "delivered",
        created_at: daysAgo(29),
        room: "204",
        total_price: 640,
        items: [
          { name: "Masala Tea", qty: 2 },
          { name: "Veg Sandwich", qty: 2 },
        ],
      },
      {
        id: "O-DM-2",
        status: "delivered",
        created_at: daysAgo(87),
        room: "305",
        total_price: 280,
        items: [{ name: "French Fries", qty: 1 }],
      },
    ],
    reviews: [
      {
        id: "R-DM-1",
        booking_code: "VA-DM-001",
        rating: 5,
        title: "Peaceful stay & warm staff",
        body: "Rooms were spotless, view was great and staff handled all requests quickly.",
        created_at: daysAgo(26),
      },
    ],
    credits: {
      balance: 750,
      currency: "INR",
      items: [
        {
          id: "CR-1",
          amount: 500,
          reason: "Referral bonus",
          created_at: daysAgo(60),
          expires_at: daysAgo(-30),
        },
        {
          id: "CR-2",
          amount: 250,
          reason: "Goodwill gesture",
          created_at: daysAgo(25),
          expires_at: daysAgo(160),
        },
      ],
    },
    stats: {
      total_stays: 3,
      total_nights: 7,
      total_tickets: 2,
      total_orders: 2,
      total_reviews: 1,
      on_time_ratio: 1,
      lifetime_value_inr: 45000,
      last_visit_at: daysAgo(27),
    },
  };
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoneyINR(v?: number | null) {
  if (!v || !Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
}

export default function OwnerGuestProfile() {
  const { slug, guestId } = useParams<{
    slug?: string;
    guestId?: string;
  }>();

  const [data, setData] = useState<GuestProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const guestName =
    data?.profile?.full_name ||
    (data?.profile?.first_name ||
      data?.profile?.last_name
      ? `${data?.profile?.first_name ?? ""} ${
          data?.profile?.last_name ?? ""
        }`.trim()
      : data?.profile?.name) ||
    "Guest";

  const stats = data?.stats ?? {};
  const stays = data?.stays ?? [];
  const tickets = data?.tickets ?? [];
  const orders = data?.orders ?? [];
  const reviews = data?.reviews ?? [];
  const credits = data?.credits;

  const totalStays = stats.total_stays ?? data?.profile?.total_stays ?? stays.length;
  const totalNights = stats.total_nights ?? data?.profile?.total_nights ?? 0;
  const totalTickets = stats.total_tickets ?? tickets.length;
  const totalOrders = stats.total_orders ?? orders.length;
  const totalReviews = stats.total_reviews ?? reviews.length;
  const onTimeRatio = stats.on_time_ratio ?? null;
  const onTimePct =
    onTimeRatio != null ? Math.round(onTimeRatio * 100) : undefined;
  const lifetimeValueInr =
    stats.lifetime_value_inr ?? data?.profile?.lifetime_value_inr ?? null;

  const preferences = useMemo(
    () => data?.profile?.preferences ?? {},
    [data?.profile?.preferences]
  );
  const tags = data?.profile?.tags ?? [];

  useEffect(() => {
    const ac = new AbortController();

    if (!slug || !guestId) {
      setErr("Missing hotel or guest identifier.");
      setData(buildDemoGuestProfile(slug, guestId));
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        // Keep API flexible: backend may accept hotel_slug and/or hotel_id
        query.set("hotel_slug", slug);
        query.set("guest_id", guestId);

        const url = `${API}/guest-profile?${query.toString()}`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          signal: ac.signal,
        });

        if (!res.ok) {
          throw new Error(`Guest profile fetch failed (${res.status})`);
        }

        const json = (await res.json()) as GuestProfilePayload;
        setData(json);
        setErr(null);
      } catch (e: any) {
        if (ac.signal.aborted) return;
        console.warn("[OwnerGuestProfile] falling back to demo:", e);
        setErr(e?.message || "Failed to load guest profile; showing demo data.");
        setData(buildDemoGuestProfile(slug, guestId));
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [slug, guestId]);

  const isDemo = err != null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <SEO title="Guest profile" />

      {/* Header */}
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <Link to="/owner" className="text-sm text-sky-700 hover:underline">
            ← Back to Owner hub
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Guest profile
          </h1>
          <p className="text-sm text-gray-600 max-w-xl">
            Unified view of this guest across stays, tickets, orders, reviews
            and credits – owned by your hotel, not the OTA.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-1">
          {guestId && <div>Guest ID: {guestId}</div>}
          {slug && <div>Property: {slug}</div>}
          {isDemo && (
            <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700 border border-amber-200">
              <span aria-hidden>●</span> Demo data (profile API not connected)
            </div>
          )}
        </div>
      </header>

      {/* Hero card */}
      <section className="card p-4 md:p-5 bg-gradient-to-r from-sky-50 via-emerald-50 to-slate-50 border border-sky-100/70">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-white text-lg font-semibold shadow-sm">
              {guestName.charAt(0).toUpperCase()}
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold leading-tight">
                {guestName}
              </h2>
              <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                {data?.profile?.phone && (
                  <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 border border-slate-200">
                    📞 {data.profile.phone}
                  </span>
                )}
                {data?.profile?.email && (
                  <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 border border-slate-200">
                    ✉️ {data.profile.email}
                  </span>
                )}
                {(data?.profile?.city || data?.profile?.country) && (
                  <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 border border-slate-200">
                    📍{" "}
                    {[data.profile.city, data.profile.state, data.profile.country]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
              </div>
              {data?.profile?.notes && (
                <p className="mt-1 text-xs text-gray-700 max-w-xl">
                  {data.profile.notes}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2">
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 border border-sky-100"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-500">
              {data?.profile?.first_seen_at && (
                <div>
                  First seen: {formatDate(data.profile.first_seen_at)}
                </div>
              )}
              {(data?.profile?.last_seen_at || stats.last_visit_at) && (
                <div>
                  Last visit:{" "}
                  {formatDate(
                    data.profile?.last_seen_at ?? stats.last_visit_at ?? null
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Key metrics row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Total stays"
          value={totalStays}
          subtitle={`${totalNights} night${totalNights === 1 ? "" : "s"}`}
        />
        <MetricCard
          label="Room requests"
          value={totalTickets}
          subtitle={
            onTimePct != null
              ? `${onTimePct}% handled on time`
              : "SLA trend not available yet"
          }
        />
        <MetricCard
          label="Orders"
          value={totalOrders}
          subtitle={
            totalOrders > 0
              ? "F&B & services delivered"
              : "No orders recorded yet"
          }
        />
        <MetricCard
          label="Lifetime value"
          value={
            lifetimeValueInr != null ? formatMoneyINR(lifetimeValueInr) : "—"
          }
          subtitle={
            credits
              ? `${formatMoneyINR(credits.balance)} in credits available`
              : "No credits linked yet"
          }
        />
      </section>

      {/* Stays + Preferences & Credits */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Stays timeline */}
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Stay history
            </h3>
            <span className="text-xs text-gray-500">
              {totalStays > 0
                ? `${totalStays} stay${totalStays === 1 ? "" : "s"} recorded`
                : "No stays recorded yet"}
            </span>
          </div>

          {stays.length === 0 ? (
            <div className="text-xs text-gray-500">
              Once the guest completes their first stay, you’ll see the
              timeline here.
            </div>
          ) : (
            <ul className="space-y-3">
              {stays.map((s) => (
                <li
                  key={s.code}
                  className="flex gap-3 items-start rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <div className="mt-1 h-6 w-6 rounded-full bg-sky-100 flex items-center justify-center text-[11px] text-sky-700 font-semibold">
                    {s.status?.charAt(0).toUpperCase() ?? "S"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">
                        Stay #{s.code}
                      </div>
                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] border border-slate-200 text-slate-700">
                        {s.status ?? "—"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600 space-x-1">
                      <span>
                        {formatDate(s.check_in)} → {formatDate(s.check_out)}
                      </span>
                      {s.room && <span>• Room {s.room}</span>}
                      {s.source && <span>• {s.source}</span>}
                      {s.review_rating != null && (
                        <span>• ⭐ {s.review_rating}/5</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Preferences & Credits */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-sm font-semibold tracking-tight mb-2">
              Preferences & soft signals
            </h3>
            {preferences && Object.keys(preferences).length > 0 ? (
              <dl className="space-y-1.5 text-xs">
                {Object.entries(preferences).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-3"
                  >
                    <dt className="text-gray-500">{key}</dt>
                    <dd className="text-gray-800 text-right">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-gray-500">
                Capture preferences during check-in or in-stay interactions and
                they’ll appear here for future visits.
              </p>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-sm font-semibold tracking-tight mb-2">
              Credits & rewards
            </h3>
            {credits ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs text-gray-500">Current balance</div>
                  <div className="text-base font-semibold">
                    {credits.currency === "INR"
                      ? formatMoneyINR(credits.balance)
                      : `${credits.balance.toLocaleString()} ${
                          credits.currency ?? ""
                        }`}
                  </div>
                </div>
                {credits.items && credits.items.length > 0 ? (
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1 text-xs">
                    {credits.items.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-start justify-between gap-3 rounded-md bg-slate-50 px-2 py-1"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-800">
                            {credits.currency === "INR"
                              ? formatMoneyINR(c.amount)
                              : `${c.amount} ${credits.currency ?? ""}`}
                          </div>
                          {c.reason && (
                            <div className="text-[11px] text-gray-500">
                              {c.reason}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-[11px] text-gray-500">
                          {c.created_at && (
                            <div>Added: {formatDate(c.created_at)}</div>
                          )}
                          {c.expires_at && (
                            <div>Expires: {formatDate(c.expires_at)}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-500">
                    No individual credit entries recorded yet.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                When you start using VAiyu Credits, this guest’s rewards will
                be visible here.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Tickets, Orders, Reviews tri-column */}
      <section className="grid gap-4 md:grid-cols-3">
        {/* Tickets */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Room requests
            </h3>
            <span className="text-xs text-gray-500">
              {totalTickets} request{totalTickets === 1 ? "" : "s"}
            </span>
          </div>
          {tickets.length === 0 ? (
            <p className="text-xs text-gray-500">
              No tickets yet. Housekeeping and service tickets raised by this
              guest will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs max-h-56 overflow-y-auto pr-1">
              {tickets.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 rounded-md bg-slate-50 px-2 py-1"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">
                      {(t.service_key || "")
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (m) => m.toUpperCase()) || "Service"}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {t.room && <>Room {t.room} · </>}
                      {t.created_at && <>Raised {formatTime(t.created_at)}</>}
                      {t.sla_minutes && <> · SLA {t.sla_minutes}m</>}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-gray-600">
                    <div className="inline-flex items-center rounded-full bg-white px-2 py-0.5 border border-slate-200">
                      {t.status ?? "—"}
                    </div>
                    {t.late && (
                      <div className="mt-0.5 text-amber-600">SLA breach</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Orders */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold tracking-tight">Orders</h3>
            <span className="text-xs text-gray-500">
              {totalOrders} order{totalOrders === 1 ? "" : "s"}
            </span>
          </div>
          {orders.length === 0 ? (
            <p className="text-xs text-gray-500">
              Any in-room dining or service orders tied to this guest will be
              listed here.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs max-h-56 overflow-y-auto pr-1">
              {orders.map((o) => (
                <li
                  key={o.id}
                  className="flex items-start justify-between gap-3 rounded-md bg-slate-50 px-2 py-1"
                >
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-gray-800">
                        Order #{o.id.slice(0, 6).toUpperCase()}
                      </div>
                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 border border-slate-200 text-[11px] text-gray-700">
                        {o.status ?? "—"}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {o.created_at && (
                        <>
                          {formatDate(o.created_at)} · {formatTime(o.created_at)}
                        </>
                      )}
                      {o.room && <> · Room {o.room}</>}
                      {o.total_price != null && (
                        <> · {formatMoneyINR(o.total_price)}</>
                      )}
                    </div>
                    {o.items && o.items.length > 0 && (
                      <div className="text-[11px] text-gray-600">
                        {o.items
                          .map((i) =>
                            i.qty ? `${i.qty}× ${i.name ?? "Item"}` : i.name
                          )
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Reviews */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold tracking-tight">Reviews</h3>
            <span className="text-xs text-gray-500">
              {totalReviews} review{totalReviews === 1 ? "" : "s"}
            </span>
          </div>
          {reviews.length === 0 ? (
            <p className="text-xs text-gray-500">
              When the guest shares feedback, their reviews will appear here
              across stays.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs max-h-56 overflow-y-auto pr-1">
              {reviews.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md bg-slate-50 px-2 py-1.5 space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-gray-800">
                      {r.title || `Review for ${r.booking_code ?? "stay"}`}
                    </div>
                    {r.rating != null && (
                      <div className="text-[11px] text-amber-600">
                        ⭐ {r.rating}/5
                      </div>
                    )}
                  </div>
                  {r.body && (
                    <p className="text-[11px] text-gray-600 line-clamp-3">
                      {r.body}
                    </p>
                  )}
                  <div className="text-[11px] text-gray-400">
                    {r.created_at && formatDate(r.created_at)}
                    {r.booking_code && ` · Stay ${r.booking_code}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {loading && (
        <div className="text-xs text-gray-500">
          Loading latest data for this guest…
        </div>
      )}
    </div>
  );
}

function MetricCard(props: {
  label: string;
  value: number | string | null | undefined;
  subtitle?: string;
}) {
  const { label, value, subtitle } = props;
  const displayValue =
    typeof value === "number" ? value.toLocaleString() : value ?? "—";

  return (
    <div className="card px-3 py-2.5 border border-slate-100 bg-white/80">
      <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-lg font-semibold text-slate-900 leading-snug">
        {displayValue}
      </div>
      {subtitle && (
        <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
