// web/src/routes/GuestDashboard.tsx
import { useEffect, useMemo, useState, memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import AccountControls from "../components/AccountControls";

/** Decide if demo preview should be allowed */
function shouldUseDemo(): boolean {
  try {
    const isLocal =
      typeof location !== "undefined" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    const qp = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    const demoQP = qp?.get("demo") === "1";
    const demoLS = typeof localStorage !== "undefined" && localStorage.getItem("demo:guest") === "1";
    // Dev convenience: allow demo locally or when explicitly requested
    return isLocal || demoQP || demoLS;
  } catch {
    return false;
  }
}
const USE_DEMO = shouldUseDemo();

/* ======= QUICK AUTH GUARD (belt-and-suspenders) ======= */
export default function GuestDashboard() {
  const nav = useNavigate();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        const redirect = encodeURIComponent("/guest");
        window.location.replace(`/signin?intent=signin&redirect=${redirect}`);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  /* ===== Types ===== */
  type Stay = {
    id: string;
    hotel: { name: string; city?: string; cover_url?: string | null };
    check_in: string;
    check_out: string;
    bill_total?: number | null;
  };

  type Review = {
    id: string;
    hotel: { name: string };
    rating: number; // 1..5
    title?: string | null;
    created_at: string;
    hotel_reply?: string | null;
  };

  type Spend = { year: number; total: number };

  type Referral = {
    id: string;
    hotel: { name: string; city?: string };
    credits: number;
    referrals_count: number;
  };

  type Source = "live" | "preview";
  type AsyncData<T> = { loading: boolean; source: Source; data: T };

  // auth/profile snapshot
  const [email, setEmail] = useState<string | null>(null);
  const [authName, setAuthName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // independent card states
  const [stays, setStays] = useState<AsyncData<Stay[]>>({ loading: true, source: "live", data: [] });
  const [reviews, setReviews] = useState<AsyncData<Review[]>>({ loading: true, source: "live", data: [] });
  const [spend, setSpend] = useState<AsyncData<Spend[]>>({ loading: true, source: "live", data: [] });
  const [referrals, setReferrals] = useState<AsyncData<Referral[]>>({ loading: true, source: "live", data: [] });

  /* ---- Auth + Profile ---- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null as any } }));
      if (!mounted) return;
      const u = data?.user;

      setEmail(u?.email ?? null);
      setAuthName((u?.user_metadata?.name as string) ?? u?.user_metadata?.full_name ?? null);

      // Pull name from profiles table if available
      if (u?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", u.id)
          .maybeSingle();
        if (prof && prof.full_name && prof.full_name.trim()) {
          setDisplayName(prof.full_name.trim());
        }
      }

      // keep welcome text fresh on auth updates
      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
        if (!mounted) return;
        const user = sess?.user;
        setEmail(user?.email ?? null);
        setAuthName((user?.user_metadata?.name as string) ?? user?.user_metadata?.full_name ?? null);

        if (user?.id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .maybeSingle();
          if (prof && prof.full_name && prof.full_name.trim()) {
            setDisplayName(prof.full_name.trim());
          }
        }
      });
      return () => sub.subscription.unsubscribe();
    })();

    return () => {
      mounted = false;
    };
  }, []);

  /* ---- Card loads (resilient) ---- */
  useEffect(() => {
    loadCard(
      () => jsonWithTimeout(`${API}/me/stays?limit=10`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Stay[]) : []),
      demoStays,
      setStays,
      USE_DEMO
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/reviews?limit=50`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Review[]) : []),
      demoReviews,
      setReviews,
      USE_DEMO
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/spend?years=5`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Spend[]) : []),
      demoSpend,
      setSpend,
      USE_DEMO
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/referrals`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Referral[]) : []),
      demoReferrals,
      setReferrals,
      USE_DEMO
    );
  }, []);

  const who = displayName || authName || email || "Guest";
  const firstName = who.split(" ")[0];

  const lastStay = stays.data[0];
  const welcomeText = useMemo(() => {
    // Only personalize with a hotel when we actually have LIVE stays
    if (stays.source === "live" && lastStay?.hotel) {
      const city = lastStay.hotel.city ? ` in ${lastStay.hotel.city}` : "";
      return `Welcome back, ${firstName}! Hope you enjoyed ${lastStay.hotel.name}${city}.`;
    }
    return `Welcome, ${firstName}!`;
  }, [firstName, lastStay, stays.source]);

  const totalReferralCredits = referrals.data.reduce((a, r) => a + Number(r.credits || 0), 0);

  // Travel Stats (derived)
  const stats = useMemo(() => {
    const nights = stays.data.reduce((n, s) => n + diffDays(s.check_in, s.check_out), 0);
    const totalSpend = spend.data.reduce((a, s) => a + Number(s.total || 0), 0);
    const countsByHotel: Record<string, number> = {};
    stays.data.forEach((s) => {
      countsByHotel[s.hotel.name] = (countsByHotel[s.hotel.name] || 0) + 1;
    });
    const mostVisited = Object.entries(countsByHotel).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    return {
      totalStays: stays.data.length,
      nights,
      totalSpend,
      totalCredits: totalReferralCredits,
      mostVisited,
    };
  }, [stays.data, spend.data, totalReferralCredits]);

  // Join helpers for My Journey
  const reviewByHotel: Record<string, Review | undefined> = useMemo(() => {
    const map: Record<string, Review> = {};
    for (const r of reviews.data) {
      const key = r.hotel.name.toLowerCase();
      if (!map[key] || new Date(r.created_at) > new Date(map[key].created_at)) map[key] = r;
    }
    return map;
  }, [reviews.data]);

  const creditsByHotel: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    referrals.data.forEach((r) => {
      const key = r.hotel.name.toLowerCase();
      m[key] = (m[key] || 0) + Number(r.credits || 0);
    });
    return m;
  }, [referrals.data]);

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-5" aria-labelledby="guest-dash-title">
      {/* Hero */}
      <section className="relative rounded-2xl p-6 bg-gradient-to-r from-sky-50 via-white to-indigo-50 border overflow-hidden">
        <Bubbles />
        <div className="flex items-start justify-between gap-4 relative">
          <div>
            <h1 id="guest-dash-title" className="text-xl md:text-2xl font-semibold">
              {welcomeText}
            </h1>
            <p className="text-sm text-gray-600 mt-1">Your trips, bookings and bills — all in one happy place 😄</p>
            <p className="text-xs text-gray-600 mt-2">
              Tip: Add a profile photo and KYC in your{" "}
              <button onClick={() => nav("/profile")} className="underline">
                profile
              </button>{" "}
              to speed up check-in.
            </p>
          </div>

          {/* Unified global account menu */}
          <div className="ml-auto">
            <AccountControls />
          </div>
        </div>

        {/* Rewards: more prominent, right under welcome */}
        <div className="mt-4">
          <RewardsPill total={totalReferralCredits} />
        </div>

        {/* Hero actions */}
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <QuickPill title="Scan & go" text="Check-in with a QR" to="/scan" />
          <QuickPill title="Find my booking" text="Enter code" to="/claim" variant="light" />
          <QuickPill title="Explore hotels" text="Discover stays" to="/hotel/sunrise" variant="light" />
        </div>
      </section>

      {/* Row 0.5: Travel Stats badges */}
      <section className="grid sm:grid-cols-5 gap-3">
        <StatBadge label="Total stays" value={String(stats.totalStays)} emoji="🧳" />
        <StatBadge label="Days at VAiyu" value={String(stats.nights)} emoji="📅" />
        <StatBadge label="Total spend" value={`₹ ${stats.totalSpend.toLocaleString()}`} emoji="💸" />
        <StatBadge label="Credits earned" value={`₹ ${stats.totalCredits.toLocaleString()}`} emoji="🎁" />
        <StatBadge label="Most visited" value={stats.mostVisited} emoji="❤️" />
      </section>

      {/* Row 1: Check-in, Recent stays, Spend */}
      <section className="grid md:grid-cols-3 gap-4">
        <Card title="Check-in" subtitle="Scan & go" icon={<CalendarIcon />}>
          <ArrivalCheckInEmpty />
        </Card>

        <Card
          title="Recent stays"
          subtitle="Last 5 hotels"
          icon={<SuitcaseIcon />}
          badge={stays.source === "preview" ? "Preview" : undefined}
        >
          {stays.loading ? (
            <Skeleton lines={5} />
          ) : stays.data.slice(0, 5).length ? (
            <>
              <ul className="space-y-2 text-sm">
                {stays.data.slice(0, 5).map((s) => (
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

        <Card
          title="Spend summary"
          subtitle="By year"
          icon={<RupeeIcon />}
          badge={spend.source === "preview" ? "Preview" : undefined}
        >
          {spend.loading ? (
            <Skeleton lines={4} />
          ) : spend.data.length ? (
            <>
              <MiniBars data={spend.data} />
              <ul className="text-sm space-y-1 mt-3">
                {spend.data.map((s) => (
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

      {/* Row 2: My Journey (10 stays) with reviews inline */}
      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-gray-500">Personal timeline</div>
            <h2 className="font-semibold">My Journey — last 10 stays</h2>
          </div>
          <Link className="btn btn-light" to="/stays">
            See all
          </Link>
        </div>

        {stays.loading ? (
          <Skeleton lines={6} />
        ) : stays.data.length ? (
          <div className="grid md:grid-cols-2 gap-3">
            {stays.data.slice(0, 10).map((s) => {
              const key = s.hotel.name.toLowerCase();
              const rv = reviewByHotel[key];
              const credits = creditsByHotel[key] || 0;
              return (
                <div key={s.id} className="rounded-xl border p-3 bg-gradient-to-b from-white to-slate-50">
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-none">
                      {s.hotel.cover_url ? (
                        <img src={s.hotel.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-gray-400 text-xs">No photo</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {s.hotel.name}
                        {s.hotel.city ? `, ${s.hotel.city}` : ""}
                      </div>
                      <div className="text-xs text-gray-500">{fmtRange(s.check_in, s.check_out)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {credits > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200">
                            Earned ₹ {credits.toLocaleString()} 🎉
                          </span>
                        )}
                        {rv ? (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-100 border border-indigo-200">
                            Your rating: {stars(rv.rating)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {rv && (
                    <div className="mt-2 text-sm text-gray-700">
                      {rv.title ? `“${rv.title}”` : ""}
                      <div className="text-xs text-gray-500 mt-1">{fmtDate(rv.created_at)}</div>
                      {rv.hotel_reply && (
                        <div className="mt-2 text-xs rounded-md border bg-white p-2">
                          <span className="opacity-70">Hotel replied:</span> {rv.hotel_reply}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 text-right">
                    <Link className="btn btn-light" to={`/stay/${s.id}`}>
                      View details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text="No stays yet — your travel story starts here!" />
        )}
      </section>

      {/* Row 3: Referrals + Latest reviews */}
      <section className="grid lg:grid-cols-3 gap-4">
        <Card
          title="Your referrals"
          subtitle="Earn credits hotel-wise"
          icon={<GiftIcon />}
          badge={referrals.source === "preview" ? "Preview" : undefined}
        >
          {referrals.loading ? (
            <Skeleton lines={5} />
          ) : referrals.data.length ? (
            <>
              <div className="rounded-lg border bg-gradient-to-r from-amber-50 to-orange-50 p-3 flex items-center justify-between">
                <div className="text-sm">Total credits</div>
                <div className="text-lg font-semibold">₹ {totalReferralCredits.toLocaleString()}</div>
              </div>
              <ul className="mt-3 divide-y text-sm">
                {referrals.data.map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {r.hotel.name}
                        {r.hotel.city ? `, ${r.hotel.city}` : ""}
                      </div>
                      <div className="text-xs text-gray-500">
                        {r.referrals_count} successful {r.referrals_count === 1 ? "referral" : "referrals"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">₹ {Number(r.credits || 0).toLocaleString()}</div>
                      <button className="text-xs underline" onClick={() => copyReferral(r.hotel.name)}>
                        Share link
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty text="No credits yet — invite a friend to a hotel you love and earn rewards!" />
          )}
        </Card>

        <div className="lg:col-span-2 rounded-2xl p-4 shadow bg-white border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Your latest reviews</div>
              <div className="text-xs text-gray-500">Spread the travel joy — add a fun title or edit anytime.</div>
            </div>
            <Link className="btn btn-light" to="/stays">
              Manage
            </Link>
          </div>

          <div className="mt-3">
            {reviews.loading ? (
              <Skeleton lines={3} />
            ) : reviews.data.length ? (
              <div className="grid md:grid-cols-2 gap-3">
                {reviews.data.slice(0, 6).map((rv) => (
                  <ReviewCard key={rv.id} review={rv} />
                ))}
              </div>
            ) : (
              <Empty text="No reviews yet. Tell the world about your stay!" />
            )}
          </div>

          {reviews.source === "preview" && (
            <div className="mt-3 text-xs text-gray-500">Showing a preview while we connect to your reviews.</div>
          )}
        </div>
      </section>

      {/* Help / Support */}
      <section className="rounded-2xl p-4 shadow bg-blue-50/60 border border-blue-100 flex items-center justify-between">
        <div className="text-sm text-blue-900">
          Need help with your bookings or profile? No worries — our team can fix it quickly.
        </div>
        <div className="flex gap-2">
          <Link to="/contact" className="btn btn-light">
            Contact support
          </Link>
          <a className="btn btn-light" href="mailto:support@vaiyu.co.in?subject=Help%20on%20Guest%20Dashboard">
            Email us
          </a>
        </div>
      </section>

      {/* Owner CTA */}
      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Want to run a property?</div>
            <div className="text-sm text-gray-600">
              Register your hotel to unlock the owner console: dashboards, SLAs, workflows and AI moderation.
            </div>
          </div>
          <Link className="btn" to="/owner/register">
            Register your property
          </Link>
        </div>
      </section>
    </main>
  );
}

/* ===== Card loader helper ===== */
async function loadCard<J, T>(
  fetcher: () => Promise<J>,
  map: (j: J | null) => T,
  demo: () => T,
  set: (next: any) => void,
  allowDemo: boolean
) {
  set({ loading: true, source: "live", data: [] as unknown as T });
  try {
    const j = await fetcher();
    set({ loading: false, source: "live", data: map(j) });
  } catch {
    // In production, prefer empty live data over misleading previews.
    if (allowDemo) {
      set({ loading: false, source: "preview", data: demo() });
    } else {
      set({ loading: false, source: "live", data: map(null as any) });
    }
  }
}

/* ===== Ad-hoc Check-in card content ===== */
function ArrivalCheckInEmpty() {
  return (
    <div className="text-sm text-gray-700">
      <div className="rounded-lg border-2 border-dashed p-4 bg-gray-50">
        <div className="font-medium">Arriving at a VAiyu hotel?</div>
        <p className="text-gray-600 mt-1">
          When you reach the property, scan the VAiyu QR at the front desk to fetch your booking and start check-in.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn" to="/scan">
            Scan property QR
          </Link>
          <Link className="btn btn-light" to="/claim">
            Enter booking code
          </Link>
          <Link className="btn btn-light" to="/hotel/sunrise">
            Explore hotels
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ===== Rewards pill ===== */
function RewardsPill({ total }: { total: number }) {
  return (
    <Link
      to="/rewards"
      className="inline-flex items-center gap-3 rounded-xl border bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-2 shadow hover:shadow-md transition"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 border border-amber-300">
        🎁
      </span>
      <span className="text-sm">
        <span className="font-semibold">Rewards & Vouchers</span>
        <span className="ml-2 text-gray-600">({`₹ ${total.toLocaleString()}`} earned)</span>
      </span>
      <span className="ml-2 text-gray-500">→</span>
    </Link>
  );
}

/* ===== Reusable UI ===== */
const Card = memo(function Card({
  title,
  subtitle,
  icon,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 shadow bg-white border">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon ? <div className="text-gray-600">{icon}</div> : null}
          <div>
            <div className="text-xs text-gray-500">{subtitle || ""}</div>
            <div className="font-semibold">{title}</div>
          </div>
        </div>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border text-gray-700">{badge}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
});

function QuickPill({
  title,
  text,
  to,
  variant = "solid",
}: {
  title: string;
  text: string;
  to: string;
  variant?: "solid" | "light";
}) {
  return (
    <Link
      to={to}
      className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
        variant === "solid" ? "bg-white shadow" : "bg-white/70"
      }`}
    >
      <div>
        <div className="text-xs text-gray-500">{text}</div>
        <div className="font-semibold">{title}</div>
      </div>
      <span className="text-gray-500">→</span>
    </Link>
  );
}

function StatBadge({ label, value, emoji }: { label: string; value: string; emoji: string }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold flex items-center gap-2">
        {value} <span>{emoji}</span>
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const vibe = review.rating >= 5 ? "🎉" : review.rating >= 4 ? "😊" : review.rating >= 3 ? "🙂" : review.rating >= 2 ? "😐" : "😞";
  return (
    <div className="rounded-xl border p-3 bg-gradient-to-b from-white to-gray-50">
      <div className="flex items-center justify-between">
        <div className="font-medium truncate mr-2">{review.hotel.name}</div>
        <div className="text-xs">
          {stars(review.rating)} <span className="ml-1">{vibe}</span>
        </div>
      </div>
      {review.title ? <div className="text-sm text-gray-700 mt-1">“{review.title}”</div> : null}
      <div className="text-xs text-gray-500 mt-2">{fmtDate(review.created_at)}</div>
    </div>
  );
}

function MiniBars({ data }: { data: Spend[] }) {
  const max = Math.max(1, ...data.map((d) => Number(d.total || 0)));
  return (
    <div className="flex items-end gap-1 h-14 mt-1">
      {data
        .slice()
        .sort((a, b) => a.year - b.year)
        .map((d) => {
          const h = Math.max(4, Math.round((Number(d.total || 0) / max) * 48));
          return (
            <div
              key={d.year}
              className="w-6 rounded bg-indigo-100 border border-indigo-200"
              style={{ height: h }}
              title={`${d.year}: ₹${Number(d.total || 0).toLocaleString()}`}
            />
          );
        })}
    </div>
  );
}

function Bubbles() {
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none">
      <div className="absolute -top-8 -left-8 w-40 h-40 rounded-full bg-sky-100 blur-2xl opacity-70" />
      <div className="absolute -bottom-10 -right-10 w-44 h-44 rounded-full bg-indigo-100 blur-2xl opacity-80" />
    </div>
  );
}

/* ===== Icons ===== */
function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function SuitcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <rect x="8" y="3" width="8" height="4" rx="1" />
    </svg>
  );
}
function RupeeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <text x="5" y="17" fontSize="14" fontFamily="system-ui">
        ₹
      </text>
      <line x1="9" y1="8" x2="18" y2="8" />
    </svg>
  );
}
function GiftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M3 12h18" />
      <path d="M12 8v12" />
      <path d="M7.5 8a2.5 2.5 0 1 1 5 0H7.5z" />
      <path d="M11.5 8a2.5 2.5 0 1 1 5 0h-5z" />
    </svg>
  );
}

/* ===== Small helpers ===== */
async function jsonWithTimeout(url: string, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  } finally {
    clearTimeout(t);
  }
}
function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}
function fmtRange(a: string, b: string) {
  try {
    const A = new Date(a),
      B = new Date(b);
    return `${A.toLocaleDateString()} – ${B.toLocaleDateString()}`;
  } catch {
    return `${a} – ${b}`;
  }
}
function stars(n: number) {
  const c = Math.max(0, Math.min(5, Math.round(n)));
  return "★★★★★".slice(0, c) + "☆☆☆☆☆".slice(c);
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

/* ===== Copy referral link ===== */
function copyReferral(hotelName: string) {
  const base = location.origin;
  const url = `${base}/refer?hotel=${encodeURIComponent(hotelName)}`;
  navigator.clipboard?.writeText(url);
  // tiny non-blocking toast
  const id = "copied-referral";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className =
      "fixed bottom-4 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-3 py-1.5 rounded-full opacity-0 transition-opacity";
    document.body.appendChild(el);
  }
  el.textContent = "Referral link copied! Share the love ✨";
  el.style.opacity = "1";
  setTimeout(() => (el!.style.opacity = "0"), 1200);
}

function diffDays(a: string, b: string) {
  try {
    const A = new Date(a).getTime();
    const B = new Date(b).getTime();
    const ONE = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.round((B - A) / ONE));
  } catch {
    return 0;
  }
}

/* ===== Demo fallbacks (only used if USE_DEMO is true) ===== */
function demoStays(): any[] {
  return [
    {
      id: "s1",
      hotel: {
        name: "Sunrise Suites",
        city: "Nainital",
        cover_url: "https://images.unsplash.com/photo-1559599101-b59c1b3bcd9b?w=640",
      },
      check_in: "2025-08-10T12:00:00Z",
      check_out: "2025-08-12T08:00:00Z",
      bill_total: 7420,
    },
    {
      id: "s2",
      hotel: {
        name: "Lakeside Inn",
        city: "Nainital",
        cover_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=640",
      },
      check_in: "2025-06-05T12:00:00Z",
      check_out: "2025-06-07T08:00:00Z",
      bill_total: 5810,
    },
    {
      id: "s3",
      hotel: {
        name: "Pine View",
        city: "Almora",
        cover_url: "https://images.unsplash.com/photo-1496412705862-e0088f16f791?w=640",
      },
      check_in: "2025-04-01T12:00:00Z",
      check_out: "2025-04-03T08:00:00Z",
      bill_total: 3999,
    },
    { id: "s4", hotel: { name: "Cedar Ridge", city: "Ranikhet", cover_url: null }, check_in: "2025-03-01T12:00:00Z", check_out: "2025-03-02T08:00:00Z" },
  ];
}
function demoReviews(): any[] {
  return [
    {
      id: "r1",
      hotel: { name: "Sunrise Suites" },
      rating: 5,
      title: "Great staff!",
      created_at: "2025-08-12T10:00:00Z",
      hotel_reply: "Thank you Kapil! We loved hosting you.",
    },
    { id: "r2", hotel: { name: "Lakeside Inn" }, rating: 4, title: "Beautiful view", created_at: "2025-06-07T09:00:00Z", hotel_reply: null },
    {
      id: "r3",
      hotel: { name: "Pine View" },
      rating: 5,
      title: "Breakfast was superb",
      created_at: "2025-04-03T09:30:00Z",
      hotel_reply: "Come back for our new menu!",
    },
  ];
}
function demoSpend(): any[] {
  const y = new Date().getFullYear();
  return [
    { year: y, total: 13240 },
    { year: y - 1, total: 19880 },
    { year: y - 2, total: 0 },
  ];
}
function demoReferrals(): any[] {
  return [
    { id: "rf1", hotel: { name: "Sunrise Suites", city: "Nainital" }, credits: 1200, referrals_count: 3 },
    { id: "rf2", hotel: { name: "Lakeside Inn", city: "Nainital" }, credits: 800, referrals_count: 2 },
  ];
}

/* ===== Simple empty state ===== */
function Empty({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className={`rounded-lg border border-dashed ${small ? "p-3 text-xs" : "p-6 text-sm"} text-gray-600 bg-gray-50`}>
      {text}
    </div>
  );
}
