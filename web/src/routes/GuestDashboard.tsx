// web/src/routes/GuestDashboard.tsx
import { useEffect, useMemo, useState, memo } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../lib/auth"; // was "@/lib/auth"
import { API } from "../lib/api";      // was "@/lib/api"


type Stay = {
  id: string;
  hotel: { name: string; city?: string };
  check_in: string;
  check_out: string;
  bill_total?: number | null;
};
type Booking = {
  id: string;
  code: string;
  hotel: { name: string; city?: string };
  scheduled_for: string; // ISO date
  room?: string | null;
};
type Review = {
  id: string;
  hotel: { name: string };
  rating: number;
  title?: string | null;
  created_at: string; // ISO date
};
type Spend = { year: number; total: number };

export default function GuestDashboard() {
  const { user, profile } = useAuth();
  const [upcoming, setUpcoming] = useState<Booking | null>(null);
  const [recentStays, setRecentStays] = useState<Stay[]>([]);
  const [recentReviews, setRecentReviews] = useState<Review[]>([]);
  const [spend, setSpend] = useState<Spend[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [b, s, r, p] = await Promise.all([
          safeJson(`${API}/me/bookings?status=upcoming&limit=1`),
          safeJson(`${API}/me/stays?limit=5`),
          safeJson(`${API}/me/reviews?limit=5`),
          safeJson(`${API}/me/spend?years=5`),
        ]);

        if (!cancelled) {
          setUpcoming(b?.items?.[0] ?? null);
          setRecentStays(Array.isArray(s?.items) ? s.items : []);
          setRecentReviews(Array.isArray(r?.items) ? r.items : []);
          setSpend(Array.isArray(p?.items) ? p.items : []);
        }
      } catch (e: any) {
        if (!cancelled) {
          setErr("We couldn’t load your dashboard. Showing a quick preview.");
          // Friendly demo fallback
          setUpcoming(null);
          setRecentStays(demoStays());
          setRecentReviews(demoReviews());
          setSpend(demoSpend());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName =
    (profile?.name || user?.email || "").split(" ")[0] || "Guest";

  const lastStay = recentStays[0];
  const welcomeText = useMemo(() => {
    if (lastStay?.hotel) {
      const city = lastStay.hotel.city ? ` in ${lastStay.hotel.city}` : "";
      return `Welcome back, ${firstName}! Hope you enjoyed ${lastStay.hotel.name}${city}.`;
    }
    return `Welcome, ${firstName}!`;
  }, [firstName, lastStay]);

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-4" aria-labelledby="guest-dash-title">
      <header className="rounded-2xl p-5 shadow bg-white">
        <h1 id="guest-dash-title" className="text-xl font-semibold">
          {welcomeText}
        </h1>
        <p className="text-sm text-gray-600">
          Your trips, bookings, and bills — all in one place.
        </p>
        {err && <p className="mt-2 text-sm text-amber-700">{err}</p>}
      </header>

      {/* Top row */}
      <section className="grid md:grid-cols-3 gap-4">
        <Card title="Upcoming booking" subtitle="Check-in faster with QR">
          {loading ? (
            <Skeleton lines={4} />
          ) : upcoming ? (
            <UpcomingBlock booking={upcoming} />
          ) : (
            <Empty small text="No upcoming bookings. Plan your next stay!" cta={{ to: "/hotel/sunrise", label: "Explore hotels" }} />
          )}
        </Card>

        <Card title="Recent stays" subtitle="Last 5 hotels">
          {loading ? (
            <Skeleton lines={5} />
          ) : recentStays.length ? (
            <>
              <ul className="space-y-2 text-sm">
                {recentStays.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <span>
                      {s.hotel.name}
                      {s.hotel.city ? `, ${s.hotel.city}` : ""}
                    </span>
                    <span className="opacity-70">{fmtRange(s.check_in, s.check_out)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-right">
                <Link className="btn btn-light" to="/stays">
                  View all stays
                </Link>
              </div>
            </>
          ) : (
            <Empty small text="No past stays yet." />
          )}
        </Card>

        <Card title="Spend summary" subtitle="By year">
          {loading ? (
            <Skeleton lines={4} />
          ) : spend.length ? (
            <>
              <ul className="text-sm space-y-1">
                {spend.map((s) => (
                  <li key={s.year} className="flex justify-between">
                    <span>{s.year}</span>
                    <span>₹ {Number(s.total || 0).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-right">
                <Link className="btn btn-light" to="/bills">
                  Download bills
                </Link>
              </div>
            </>
          ) : (
            <Empty small text="No spend yet." />
          )}
        </Card>
      </section>

      {/* Reviews */}
      <section className="rounded-2xl p-4 shadow bg-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600 mb-1">Your latest reviews</div>
            <div className="text-xs text-gray-500">Edit or add context anytime.</div>
          </div>
          <Link className="btn btn-light" to="/reviews/mine">
            Manage reviews
          </Link>
        </div>

        <div className="mt-3">
          {loading ? (
            <Skeleton lines={3} />
          ) : recentReviews.length ? (
            <ul className="space-y-2">
              {recentReviews.map((rv) => (
                <li key={rv.id} className="text-sm">
                  <span className="font-semibold">{rv.hotel.name}</span> · {stars(rv.rating)} · {fmtDate(rv.created_at)}
                  {rv.title ? (
                    <>
                      {" "}
                      — <span className="opacity-80">{rv.title}</span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No reviews yet." />
          )}
        </div>
      </section>
    </main>
  );
}

/* ---------- Reusable pieces ---------- */

const Card = memo(function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 shadow bg-white">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-600">{subtitle || ""}</div>
          <div className="font-semibold">{title}</div>
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
});

function UpcomingBlock({ booking }: { booking: Booking }) {
  return (
    <>
      <div className="font-semibold">
        {booking.hotel.name} {booking.hotel.city ? `• ${booking.hotel.city}` : ""}
      </div>
      <div className="text-sm text-gray-600 mt-1">
        Check-in: {fmtDate(booking.scheduled_for)}
      </div>
      <div className="mt-3 flex items-center gap-3">
        {/* Placeholder QR — replace with a real QR later */}
        <div
          className="w-24 h-24 grid place-items-center rounded bg-gray-100 text-xs"
          aria-label="Check-in QR placeholder"
        >
          QR
        </div>
        <div className="text-xs text-gray-600">
          Show this QR at the front desk to check-in faster. <br />
          Booking code: <span className="font-mono">{booking.code}</span>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Link className="btn btn-light" to={`/stay/${encodeURIComponent(booking.code)}/menu`}>
          Room menu
        </Link>
        <Link className="btn" to={`/precheck/${encodeURIComponent(booking.code)}`}>
          Pre-check
        </Link>
      </div>
    </>
  );
}

function Empty({
  text,
  cta,
  small,
}: {
  text: string;
  small?: boolean;
  cta?: { to: string; label: string };
}) {
  return (
    <div className={small ? "text-sm text-gray-600" : "p-6 text-center text-gray-600"}>
      <span>{text}</span>
      {cta && (
        <Link className="ml-2 underline" to={cta.to}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

/* ---------- Helpers ---------- */

async function safeJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
function fmtDate(s: string) {
  // locale-aware but stable
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}
function fmtRange(a: string, b: string) {
  try {
    const A = new Date(a), B = new Date(b);
    return `${A.toLocaleDateString()} – ${B.toLocaleDateString()}`;
  } catch {
    return `${a} – ${b}`;
  }
}
function stars(n: number) {
  const clamped = Math.max(0, Math.min(5, Math.round(n)));
  const full = "★★★★★".slice(0, clamped);
  const empty = "☆☆☆☆☆".slice(clamped);
  return full + empty;
}

/* ---------- Demo fallback data (only used if API fails) ---------- */
function demoStays(): Stay[] {
  return [
    { id: "s1", hotel: { name: "Sunrise Suites", city: "Nainital" }, check_in: "2025-08-10T12:00:00Z", check_out: "2025-08-12T08:00:00Z", bill_total: 7420 },
    { id: "s2", hotel: { name: "Lakeside Inn", city: "Nainital" }, check_in: "2025-06-05T12:00:00Z", check_out: "2025-06-07T08:00:00Z", bill_total: 5810 },
    { id: "s3", hotel: { name: "Pine View", city: "Almora" }, check_in: "2025-04-01T12:00:00Z", check_out: "2025-04-03T08:00:00Z", bill_total: 3999 },
  ];
}
function demoReviews(): Review[] {
  return [
    { id: "r1", hotel: { name: "Sunrise Suites" }, rating: 5, title: "Great staff!", created_at: "2025-08-12T10:00:00Z" },
    { id: "r2", hotel: { name: "Lakeside Inn" }, rating: 4, title: "Beautiful view", created_at: "2025-06-07T09:00:00Z" },
  ];
}
function demoSpend(): Spend[] {
  const y = new Date().getFullYear();
  return [
    { year: y, total: 13240 },
    { year: y - 1, total: 19880 },
    { year: y - 2, total: 0 },
  ];
}
