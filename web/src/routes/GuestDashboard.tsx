// web/src/routes/GuestDashboard.tsx

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import AccountControls from "../components/AccountControls";
import RewardsPill from "../components/guest/RewardsPill";

/** Decide if demo preview should be allowed */
function shouldUseDemo(): boolean {
  try {
    const isLocal =
      typeof location !== "undefined" &&
      (location.hostname === "localhost" || location.hostname === "127.0.0.1");
    const qp =
      typeof location !== "undefined"
        ? new URLSearchParams(location.search)
        : null;
    const demoQP = qp?.get("demo") === "1";
    const demoLS =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("demo:guest") === "1";
    return isLocal || demoQP || demoLS;
  } catch {
    return false;
  }
}
const USE_DEMO = shouldUseDemo();

/**
 * Detect if API is pointing directly at Supabase Edge Functions.
 * Supports both:
 *  1) https://xyz.functions.supabase.co
 *  2) https://xyz.supabase.co/functions/v1
 */
const IS_SUPABASE_EDGE =
  typeof API === "string" &&
  (API.includes(".functions.supabase.co") || API.includes("/functions/v1"));

/** Correct stays endpoint for both backends */
const STAYS_ENDPOINT = IS_SUPABASE_EDGE ? "/me-stays" : "/me/stays";
/** Alternate stays endpoint used as a fallback probe */
const ALT_STAYS_ENDPOINT = IS_SUPABASE_EDGE ? "/me/stays" : "/me-stays";

/** Safely parse API host for auth-header scoping */
const API_HOST = (() => {
  try {
    return new URL(API).host;
  } catch {
    return null;
  }
})();

/* ===== Shared types ===== */

type Stay = {
  id: string;
  hotel_id?: string | null;
  status?: string | null; // claimed / ongoing / completed / upcoming etc.
  hotel: {
    name: string;
    city?: string;
    cover_url?: string | null;
    country?: string | null;
    slug?: string | null;
    tenant_slug?: string | null;
  };
  check_in: string;
  check_out: string;
  bill_total?: number | null;
  room_type?: string | null;
  booking_code?: string | null;
};

type Review = {
  id: string;
  hotel: { name: string };
  rating: number;
  title?: string | null;
  created_at: string;
  hotel_reply?: string | null;
};

type Spend = {
  year: number;
  total: number;
  monthly?: { month: number; total: number }[];
  categories?: { room: number; dining: number; spa: number; other: number };
};

type Referral = {
  id: string;
  hotel: { name: string; city?: string };
  credits: number;
  referrals_count: number;
};

type Source = "live" | "preview";
type AsyncData<T> = { loading: boolean; source: Source; data: T };

/* ======= GUEST DASHBOARD (Ultra Premium) ======= */
export default function GuestDashboard() {
  const nav = useNavigate();
  const location = useLocation();

  const [searchTerm, setSearchTerm] = useState("");
  const [spendMode, setSpendMode] = useState<"this" | "last" | "all">("this");
  const [showExplore, setShowExplore] = useState(false);

  // Quick auth guard
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

  // auth/profile snapshot
  const [email, setEmail] = useState<string | null>(null);
  const [authName, setAuthName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // independent card states
  const [stays, setStays] = useState<AsyncData<Stay[]>>({
    loading: true,
    source: "live",
    data: [],
  });
  const [reviews, setReviews] = useState<AsyncData<Review[]>>({
    loading: true,
    source: "live",
    data: [],
  });
  const [spend, setSpend] = useState<AsyncData<Spend[]>>({
    loading: true,
    source: "live",
    data: [],
  });
  const [referrals, setReferrals] = useState<AsyncData<Referral[]>>({
    loading: true,
    source: "live",
    data: [],
  });

  /* ---- Auth + Profile ---- */
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null as any } }));
      if (!mounted) return;
      const u = data?.user;

      setEmail(u?.email ?? null);
      setAuthName(
        (u?.user_metadata?.name as string) ??
          u?.user_metadata?.full_name ??
          null,
      );

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

      const { data: sub } = supabase.auth.onAuthStateChange(
        async (_evt, sess) => {
          if (!mounted) return;
          const user = sess?.user;
          setEmail(user?.email ?? null);
          setAuthName(
            (user?.user_metadata?.name as string) ??
              user?.user_metadata?.full_name ??
              null,
          );

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
        },
      );
      return () => sub.subscription.unsubscribe();
    })();

    return () => {
      mounted = false;
    };
  }, []);

  /* ---- Card loads (resilient) ---- */
  useEffect(() => {
    let cancelled = false;

    async function loadStaysWithFallback() {
      setStays({ loading: true, source: "live", data: [] as Stay[] });

      // 1) Try API primary endpoint
      try {
        const j: any = await jsonWithTimeout(`${API}${STAYS_ENDPOINT}?limit=10`);
        const rawItems: any[] = Array.isArray(j?.items) ? j.items : [];
        const items: Stay[] = rawItems.map(normalizeStayRow);

        if (!cancelled) {
          setStays({ loading: false, source: "live", data: items });
        }
        if (items.length) return;
      } catch (err) {
        // Try alternate endpoint (helps when backend routes differ)
        try {
          const j2: any = await jsonWithTimeout(
            `${API}${ALT_STAYS_ENDPOINT}?limit=10`,
          );
          const rawItems2: any[] = Array.isArray(j2?.items) ? j2.items : [];
          const items2: Stay[] = rawItems2.map(normalizeStayRow);

          if (!cancelled) {
            setStays({ loading: false, source: "live", data: items2 });
          }
          if (items2.length) return;
        } catch (err2) {
          console.warn(
            "[GuestDashboard] me-stays API failed, fallback to view",
            err2,
          );
        }
      }

      // 2) Fallback view
      try {
        const { data, error } = await supabase
          .from("user_recent_stays")
          .select("*")
          .order("check_in", { ascending: false })
          .limit(10);

        if (error) throw error;
        const items: Stay[] = (data ?? []).map(normalizeStayRow);

        if (!cancelled) {
          setStays({ loading: false, source: "live", data: items });
        }
      } catch (err) {
        console.error("[GuestDashboard] fallback user_recent_stays failed", err);
        if (!cancelled) {
          if (USE_DEMO) {
            setStays({
              loading: false,
              source: "preview",
              data: demoStays() as Stay[],
            });
          } else {
            setStays({
              loading: false,
              source: "live",
              data: [] as Stay[],
            });
          }
        }
      }
    }

    loadStaysWithFallback();

    loadCard(
      () => jsonWithTimeout(`${API}/me/reviews?limit=50`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Review[]) : []),
      demoReviews,
      setReviews,
      USE_DEMO,
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/spend?years=5`),
      (j: any) =>
        Array.isArray(j?.items)
          ? (j.items as any[]).map((row) => ({
              year: Number(row.year),
              total: Number(row.total ?? row.sum ?? 0),
              monthly: row.monthly ?? row.months ?? undefined,
              categories: row.categories ?? undefined,
            }))
          : [],
      demoSpend,
      setSpend,
      USE_DEMO,
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/referrals`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Referral[]) : []),
      demoReferrals,
      setReferrals,
      USE_DEMO,
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const whoRaw = displayName || authName || email || "Guest";
  const who = (typeof whoRaw === "string" ? whoRaw : "Guest").trim() || "Guest";
  const firstName = who.split(" ")[0] || "Guest";

  const lastStay = stays.data[0];
  const welcomeText = useMemo(() => {
    if (stays.source === "live" && lastStay?.hotel) {
      const city = lastStay.hotel.city ? ` in ${lastStay.hotel.city}` : "";
      return `Welcome back, ${firstName}. Hope you enjoyed ${lastStay.hotel.name}${city}.`;
    }
    return `Welcome back, ${firstName}.`;
  }, [firstName, lastStay, stays.source]);

  const totalReferralCredits = referrals.data.reduce(
    (a, r) => a + Number(r.credits || 0),
    0,
  );

  // Derive spend per year/month from stays when /me/spend is not available
  const derivedSpendFromStays: Spend[] = useMemo(() => {
    if (!stays.data.length) return [];
    const byYear: Record<
      number,
      { total: number; byMonth: Record<number, number> }
    > = {};

    stays.data.forEach((s) => {
      const amount = typeof s.bill_total === "number" ? Number(s.bill_total) : 0;
      if (!amount) return;
      const dt = new Date(s.check_in);
      if (!isFinite(dt.getTime())) return;
      const year = dt.getFullYear();
      const month = dt.getMonth() + 1; // 1-12

      if (!byYear[year]) byYear[year] = { total: 0, byMonth: {} };
      byYear[year].total += amount;
      byYear[year].byMonth[month] = (byYear[year].byMonth[month] || 0) + amount;
    });

    return Object.entries(byYear)
      .map(([yearStr, info]) => {
        const year = Number(yearStr);
        const monthly = Object.entries(info.byMonth)
          .map(([m, total]) => ({ month: Number(m), total: Number(total) }))
          .sort((a, b) => a.month - b.month);
        return { year, total: info.total, monthly } as Spend;
      })
      .sort((a, b) => a.year - b.year);
  }, [stays.data]);

  // Travel Stats (derived)
  const stats = useMemo(() => {
    const nights = stays.data.reduce((n, s) => n + diffDays(s.check_in, s.check_out), 0);

    const spendSeries = spend.data && spend.data.length ? spend.data : derivedSpendFromStays;
    const totalSpend = spendSeries.reduce((a, s) => a + Number(s.total || 0), 0);

    const countsByHotel: Record<string, number> = {};
    const cities = new Set<string>();
    const countries = new Set<string>();
    stays.data.forEach((s) => {
      const hn = s?.hotel?.name || "Unknown";
      countsByHotel[hn] = (countsByHotel[hn] || 0) + 1;
      if (s.hotel?.city) cities.add(s.hotel.city);
      if ((s.hotel as any)?.country) countries.add((s.hotel as any).country);
    });

    const mostVisited =
      Object.entries(countsByHotel).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return {
      totalStays: stays.data.length,
      nights,
      totalSpend,
      totalCredits: totalReferralCredits,
      mostVisited,
      cityCount: cities.size,
      countryCount: countries.size || (stays.data.length ? 1 : 0),
    };
  }, [stays.data, spend.data, derivedSpendFromStays, totalReferralCredits]);

  const avgSpendPerTrip = stats.totalStays > 0 ? stats.totalSpend / stats.totalStays : 0;
  const typicalLength = stats.totalStays > 0 ? stats.nights / stats.totalStays : 0;
  const mostBookedRoomType = getMostBookedRoomType(stays.data);

  const tierPoints = useMemo(() => {
    const fromSpend = stats.totalSpend / 100;
    return Math.round(fromSpend + totalReferralCredits);
  }, [stats.totalSpend, totalReferralCredits]);

  const reviewByHotel: Record<string, Review | undefined> = useMemo(() => {
    const map: Record<string, Review> = {};
    for (const r of reviews.data) {
      const key = (r?.hotel?.name || "").toLowerCase();
      if (!key) continue;
      if (!map[key] || new Date(r.created_at) > new Date(map[key].created_at)) {
        map[key] = r;
      }
    }
    return map;
  }, [reviews.data]);

  const creditsByHotel: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    referrals.data.forEach((r) => {
      const key = (r?.hotel?.name || "").toLowerCase();
      if (!key) return;
      m[key] = (m[key] || 0) + Number(r.credits || 0);
    });
    return m;
  }, [referrals.data]);

  // Next stay (upcoming or most recent)
  const nextStay: Stay | undefined = useMemo(() => {
    if (!stays.data.length) return undefined;
    const now = Date.now();
    const upcoming = stays.data
      .filter((s) => {
        const t = new Date(s.check_in).getTime();
        return isFinite(t) && t >= now;
      })
      .sort((a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime());
    return upcoming[0] || stays.data[0];
  }, [stays.data]);

  const countdown = useMemo(() => (nextStay ? getCountdown(nextStay.check_in) : null), [nextStay?.check_in]);
  const nextStayNights = nextStay ? diffDays(nextStay.check_in, nextStay.check_out) : 0;

  // Jobs CTA URL for current stay (if we know the slug)
  const jobsUrl = useMemo(() => {
    if (!nextStay) return null;
    const anyStay: any = nextStay;
    const slug =
      anyStay.hotel_slug ||
      anyStay.slug ||
      anyStay.hotel?.slug ||
      anyStay.hotel?.tenant_slug ||
      null;
    if (typeof slug === "string" && slug.trim()) {
      return `/hotel/${encodeURIComponent(slug)}/jobs`;
    }
    return null;
  }, [nextStay]);

  // Spend analytics selection
  const currentYear = new Date().getFullYear();
  const spendByYearSorted = useMemo(() => {
    const source = spend.data && spend.data.length ? spend.data : derivedSpendFromStays;
    return source.slice().sort((a, b) => a.year - b.year);
  }, [spend.data, derivedSpendFromStays]);

  const selectedYear = useMemo(() => {
    if (!spendByYearSorted.length) return null;
    if (spendMode === "this") {
      const match = spendByYearSorted.find((s) => s.year === currentYear);
      return match || spendByYearSorted[spendByYearSorted.length - 1];
    }
    if (spendMode === "last") {
      const match = spendByYearSorted.find((s) => s.year === currentYear - 1);
      return match || spendByYearSorted[spendByYearSorted.length - 1];
    }
    return spendByYearSorted[spendByYearSorted.length - 1];
  }, [spendByYearSorted, spendMode, currentYear]);

  const monthlySeries = useMemo(() => (selectedYear ? buildMonthlySeries(selectedYear) : []), [selectedYear]);
  const categorySeries = useMemo(() => (selectedYear ? buildCategorySeries(selectedYear) : []), [selectedYear]);

  const recentTrips = stays.data.slice(0, 5);

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = searchTerm.trim();
    if (!q) return;
    nav(`/stays?query=${encodeURIComponent(q)}`);
  }

  const initials = who
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const stayState = getStayState(nextStay);

  // Express checkout URL that carries booking + hotel + property slug
  const expressCheckoutUrl = useMemo(() => {
    if (!nextStay) return "/checkout";
    return buildCheckoutLink(nextStay);
  }, [nextStay]);

  // Premium sidebar nav (desktop)
  const sidebarNav = [
    { label: "Quick actions", to: "/guest" },
    { label: "Rewards & Vouchers", to: "/rewards" },
    { label: "Recent Trips", to: "/stays" },
    { label: "Travel Insights", to: "/stays" },
    { label: "Express Check-out", to: expressCheckoutUrl },
    { label: "Help & Support", to: "/contact" },
  ];

  // Mobile bottom dock (small screens)
  const bottomNav = [
    { label: "Home", to: "/guest", icon: "🏠" },
    { label: "Trips", to: "/stays", icon: "🧳" },
    { label: "Rewards", to: "/rewards", icon: "🎁" },
    { label: "Bills", to: "/bills", icon: "🧾" },
    { label: "Help", to: "/contact", icon: "💬" },
  ];

  return (
    <main className="min-h-screen text-slate-100 bg-[#050B14]">
      {/* Ultra-premium backdrop */}
      <PremiumBackdrop />

      {/* Layout wrapper */}
      <div className="relative max-w-7xl mx-auto flex gap-5 px-4 py-5 pb-24 lg:pb-6">
        {/* Left sidebar (desktop only) */}
        <aside className="hidden lg:flex flex-col w-72 rounded-3xl overflow-hidden border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_50px_rgba(0,0,0,0.35)]">
          {/* Brand + user header */}
          <div className="px-5 pt-5 pb-4 border-b border-white/10">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-300/80">
              VAiyu Guest Dashboard
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              Stay overview · Requests · Rewards · Support
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/10 border border-white/10 grid place-items-center text-[11px] font-semibold">
                {initials || "G"}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {displayName || firstName || "Guest"}
                </div>
                {email && <div className="text-xs text-slate-400 truncate">{email}</div>}
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="px-4 py-4 space-y-2">
            {sidebarNav.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to + item.label}
                  to={item.to}
                  className={[
                    "group flex items-center justify-between gap-3 rounded-2xl px-4 py-3",
                    "border transition",
                    active
                      ? "bg-white/10 border-white/15 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                      : "bg-white/[0.02] border-white/10 hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium">{item.label}</div>
                  <span
                    className={[
                      "text-slate-400 group-hover:text-slate-200 transition",
                      active ? "text-slate-200" : "",
                    ].join(" ")}
                    aria-hidden
                  >
                    →
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Footer note */}
          <div className="mt-auto px-5 py-4 border-t border-white/10 text-xs text-slate-400">
            Support is available 24×7 for partner properties.{" "}
            <Link to="/contact" className="text-slate-200 underline">
              Contact support
            </Link>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 space-y-4">
          {/* Top bar */}
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400/90">
                Travel Command Center
              </div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                Guest Dashboard
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <form
                onSubmit={onSearchSubmit}
                className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-xl px-4 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] w-[360px]"
              >
                <input
                  className="bg-transparent text-xs outline-none flex-1 placeholder:text-slate-500"
                  placeholder="Search booking, hotel, city…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button type="submit" className="text-[11px] font-semibold text-slate-200">
                  Go
                </button>
              </form>

              <div className="rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-xl px-4 py-2 text-xs font-semibold text-slate-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                Platinum · {tierPoints.toLocaleString()} pts
              </div>

              <div className="ml-1">
                <AccountControls />
              </div>
            </div>
          </header>

          {/* Hero grid (matches approved look/feel) */}
          <section className="grid lg:grid-cols-[280px_minmax(0,1fr)_340px] gap-4">
            {/* LEFT: Next stay */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_24px_70px_rgba(0,0,0,0.35)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-400">Next stay</div>
                  <div className="text-[12px] text-slate-300/90">
                    {countdown ? countdown.label : "Your current stay status and quick actions"}
                  </div>
                </div>
                <div className="hidden sm:block">
                  <StayStateChip state={stayState} />
                </div>
              </div>

              {nextStay ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold">{nextStay.hotel.name}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Booking:{" "}
                    <span className="font-mono text-slate-300">
                      {getStayBookingCode(nextStay) ||
                        (nextStay.id ? nextStay.id.slice(0, 8) : "—")}
                    </span>{" "}
                    · Room:{" "}
                    <span className="text-slate-300">
                      {nextStay.room_type || mostBookedRoomType || "Standard"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Dates:{" "}
                    <span className="text-slate-300">
                      {fmtRange(nextStay.check_in, nextStay.check_out)}
                    </span>{" "}
                    ·{" "}
                    <span className="text-slate-300">
                      {nextStayNights || 1} night{nextStayNights === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <GuestButton to={buildStayLink(nextStay)} variant="primary">
                      View stay
                    </GuestButton>
                    <GuestButton to="/scan" variant="soft">
                      Scan QR
                    </GuestButton>
                    <GuestButton to={expressCheckoutUrl} variant="emerald">
                      Express checkout
                    </GuestButton>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-[12px] text-slate-300">
                  No upcoming stays found. Explore partner properties and request a booking.
                  <div className="mt-3">
                    <GuestButton onClick={() => setShowExplore(true)} variant="soft">
                      Explore stays
                    </GuestButton>
                  </div>
                </div>
              )}

              {/* KPI strip under next stay (mini pills like approved mock) */}
              <div className="mt-4 grid grid-cols-5 gap-2">
                <MiniStat label="Trips" value={String(stats.totalStays)} />
                <MiniStat label="Nights" value={String(stats.nights)} />
                <MiniStat label="Spend" value={fmtMoney(stats.totalSpend)} />
                <MiniStat label="Rewards" value={fmtMoney(stats.totalCredits)} />
                <MiniStat label="Most visited" value={stats.mostVisited} />
              </div>
            </div>

            {/* MIDDLE: Service requests + rewards wallet (stacked like approved) */}
            <div className="space-y-4">
              {/* Top spacer / live panel placeholder (keeps approved composition) */}
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02)] p-5 min-h-[140px]">
                <div className="text-[11px] text-slate-400">Now</div>
                <div className="mt-1 text-sm font-semibold">Your journey at a glance</div>
                <div className="mt-2 text-[12px] text-slate-400">
                  {welcomeText}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Service Requests */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_22px_60px_rgba(0,0,0,0.28)] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-400">Service Requests</div>
                      <div className="text-sm font-semibold">Track and raise requests</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowExplore(true)}
                      className="text-[11px] font-semibold text-slate-200 hover:text-white"
                    >
                      Explore stays →
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    <ServiceRow label="Housekeeping" right="Open · 1" />
                    <ServiceRow label="Maintenance" right="None" />
                    <ServiceRow label="Room service" right="None" />
                    <ServiceRow label="Laundry" right="None" />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <QuickPill
                      title="Scan QR to check-in"
                      text="Scan & Go"
                      to="/scan"
                      variant="dark"
                      icon="📷"
                    />
                    <QuickPill
                      title="Find my booking"
                      text="Use booking code"
                      to="/claim"
                      variant="dark"
                      icon="🔎"
                    />
                    <QuickPill
                      title="Download invoices"
                      text="Bills & reports"
                      to="/bills"
                      variant="dark"
                      icon="🧾"
                    />
                    <QuickPill
                      title="Express check-out"
                      text="Finish in seconds"
                      to={expressCheckoutUrl}
                      variant="dark"
                      icon="✅"
                    />
                  </div>
                </div>

                {/* Rewards & Wallet */}
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_22px_60px_rgba(0,0,0,0.28)] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-400">Rewards & Wallet</div>
                      <div className="text-sm font-semibold">Vouchers and points</div>
                    </div>
                    <Link
                      to="/rewards"
                      className="text-[11px] font-semibold text-slate-200 hover:text-white"
                    >
                      View →
                    </Link>
                  </div>

                  <div className="mt-4">
                    <RewardsPill />
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] text-slate-400">Progress to next perk</div>
                    <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-200 to-emerald-200"
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(tierPoints % 100)))}%` }}
                      />
                    </div>
                    <div className="mt-3 text-[11px] text-slate-400 space-y-1">
                      <div>
                        Available vouchers:{" "}
                        <span className="text-slate-200 font-semibold">
                          {referrals.data.length ? referrals.data.length : 0}
                        </span>
                      </div>
                      <div>
                        Rewards balance:{" "}
                        <span className="text-slate-200 font-semibold">
                          {fmtMoney(stats.totalCredits)}
                        </span>
                      </div>
                      <div>
                        Referral bonus:{" "}
                        <span className="text-slate-200 font-semibold">Invite friends to earn</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <QuickPill
                      title="Rewards & vouchers"
                      text="View & redeem"
                      to="/rewards"
                      variant="dark"
                      icon="🎁"
                    />
                    <QuickPill
                      title={jobsUrl ? "Jobs at this hotel" : "Work in hotels"}
                      text={jobsUrl ? "Apply for openings" : "Build my staff profile"}
                      to={jobsUrl || "/workforce/profile"}
                      variant="dark"
                      icon="🧑‍🍳"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Guest insights panels */}
            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_22px_60px_rgba(0,0,0,0.28)] p-5">
                <div className="text-[11px] text-slate-400">Guest Insights</div>
                <div className="text-sm font-semibold">Personalized tips and travel analytics</div>

                <div className="mt-4 space-y-3">
                  <InsightPanel
                    title="Travel analytics"
                    desc="Spend trends, stay history"
                    right={
                      <Link to="/stays" className="text-[11px] font-semibold text-slate-200 hover:text-white">
                        View →
                      </Link>
                    }
                  />
                  <InsightPanel
                    title="Comfort preferences"
                    desc="Pillows, temperature, diet"
                    right={
                      <Link
                        to="/me"
                        className="text-[11px] font-semibold text-slate-200 hover:text-white"
                      >
                        Edit →
                      </Link>
                    }
                  />
                  <InsightPanel
                    title="Quick support"
                    desc="Chat / Call / Email"
                    right={
                      <Link
                        to="/contact"
                        className="text-[11px] font-semibold text-slate-200 hover:text-white"
                      >
                        Open →
                      </Link>
                    }
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02)] p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-slate-400">Spend & rewards analytics</div>
                    <div className="text-sm font-semibold">
                      {selectedYear ? `Year ${selectedYear.year}` : "Your travel analytics"}
                    </div>
                  </div>

                  <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1 text-[11px]">
                    {[
                      { key: "this", label: "This year" },
                      { key: "last", label: "Last year" },
                      { key: "all", label: "All time" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setSpendMode(tab.key as "this" | "last" | "all")}
                        className={[
                          "px-2.5 py-1 rounded-full transition",
                          spendMode === tab.key
                            ? "bg-white/10 text-slate-100"
                            : "text-slate-400 hover:text-slate-200",
                        ].join(" ")}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  {spend.loading ? (
                    <SkeletonDark lines={4} />
                  ) : !selectedYear ? (
                    <EmptyDark
                      small
                      text="Complete your first stay to unlock monthly spend trends and category breakdowns."
                    />
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="text-[11px] text-slate-400 mb-2">Monthly spend</div>
                        <MonthlyBars data={monthlySeries} dark />
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 mb-2">Spend by category</div>
                        <CategoryBreakdown data={categorySeries} dark />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Lower sections (kept functional, restyled to premium dark) */}
          <section className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
            {/* Recent trips */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_22px_60px_rgba(0,0,0,0.22)] p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[11px] text-slate-400">Recent trips</div>
                  <div className="text-sm font-semibold">
                    Last {Math.min(5, recentTrips.length)} stays
                  </div>
                </div>
                <Link
                  to="/stays"
                  className="text-[11px] font-semibold text-slate-200 hover:text-white"
                >
                  View all →
                </Link>
              </div>

              {stays.loading ? (
                <SkeletonDark lines={4} />
              ) : recentTrips.length ? (
                <div className="space-y-2 text-xs">
                  {recentTrips.map((s) => {
                    const key = (s?.hotel?.name || "").toLowerCase();
                    const rv = key ? reviewByHotel[key] : undefined;
                    const credits = key ? creditsByHotel[key] || 0 : 0;

                    return (
                      <div
                        key={s.id}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate text-slate-100">
                            {s.hotel.name}
                            {s.hotel.city ? `, ${s.hotel.city}` : ""}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {fmtRange(s.check_in, s.check_out)} ·{" "}
                            {diffDays(s.check_in, s.check_out) || 1} night
                            {diffDays(s.check_in, s.check_out) === 1 ? "" : "s"}
                          </div>

                          <div className="mt-1 flex flex-wrap gap-2 items-center">
                            {typeof s.bill_total === "number" && (
                              <span className="text-[11px] text-slate-200">
                                {fmtMoney(Number(s.bill_total))}
                              </span>
                            )}
                            {rv && (
                              <span className="text-[11px] text-amber-200/90">
                                {stars(rv.rating)}
                              </span>
                            )}
                            {credits > 0 && (
                              <span className="text-[11px] text-emerald-200/90">
                                Credits: {fmtMoney(credits)}
                              </span>
                            )}
                          </div>
                        </div>

                        <Link to={buildStayLink(s)} className="text-[11px] text-slate-200 hover:text-white">
                          Details →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyDark small text="No trips yet. Your recent journeys will appear here." />
              )}
            </div>

            {/* Travel insights */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02)] p-5 space-y-4">
              <div>
                <div className="text-[11px] text-slate-400">Travel insights</div>
                <div className="text-sm font-semibold">Patterns from your stays</div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <InsightCardDark
                  label="Avg spend / trip"
                  value={fmtMoney(Math.round(avgSpendPerTrip || 0))}
                  hint={
                    stats.totalStays
                      ? `${stats.totalStays} trip${stats.totalStays === 1 ? "" : "s"} so far`
                      : "Will appear after your first stay"
                  }
                />
                <InsightCardDark
                  label="Typical length"
                  value={typicalLength ? `${typicalLength.toFixed(1)} nights` : "—"}
                  hint={stats.totalStays ? "Average across all stays" : "Book a stay to get insights"}
                />
                <InsightCardDark
                  label="Most booked room"
                  value={mostBookedRoomType || "—"}
                  hint="Based on your history"
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[11px] text-slate-400">
                Rewards are property-scoped. Express checkout auto-carries booking and property context when available.
              </div>
            </div>
          </section>

          {/* Journey timeline */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_22px_60px_rgba(0,0,0,0.18)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <div className="text-[11px] text-slate-400">Journey timeline</div>
                <h2 className="text-sm md:text-base font-semibold">My journey — last 10 stays</h2>
              </div>
            </div>

            {stays.loading ? (
              <SkeletonDark lines={6} />
            ) : stays.data.length ? (
              <ol className="relative border-s border-white/10 pl-5 space-y-4">
                {stays.data.slice(0, 10).map((s, idx) => {
                  const key = (s?.hotel?.name || "").toLowerCase();
                  const rv = key ? reviewByHotel[key] : undefined;
                  const credits = key ? creditsByHotel[key] || 0 : 0;

                  return (
                    <li key={s.id} className="relative">
                      <span className="absolute -left-2.5 mt-1 w-3 h-3 rounded-full bg-gradient-to-r from-sky-300 to-emerald-200 border-2 border-[#050B14] shadow" />
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-wrap justify-between gap-2">
                          <div>
                            <div className="text-xs text-slate-400">{fmtDate(s.check_in)}</div>
                            <div className="font-medium text-sm text-slate-100">
                              {s.hotel.city ? `${s.hotel.city} · ${s.hotel.name}` : s.hotel.name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {diffDays(s.check_in, s.check_out) || 1} night
                              {diffDays(s.check_in, s.check_out) === 1 ? "" : "s"} ·{" "}
                              {fmtRange(s.check_in, s.check_out)}
                            </div>
                          </div>
                          <div className="text-right text-[11px] space-y-1">
                            {typeof s.bill_total === "number" && (
                              <div className="font-semibold text-slate-100">
                                {fmtMoney(Number(s.bill_total))}
                              </div>
                            )}
                            {rv && <div className="text-amber-200/90">{stars(rv.rating)}</div>}
                            {credits > 0 && (
                              <div className="text-emerald-200/90">Credits: {fmtMoney(credits)}</div>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300/90">
                          <span className="px-2 py-1 rounded-full border border-white/10 bg-white/[0.03]">
                            Journey #{stays.data.length - idx}
                          </span>
                          {rv?.title && (
                            <span className="px-2 py-1 rounded-full border border-white/10 bg-white/[0.03]">
                              “{rv.title}”
                            </span>
                          )}
                          {credits > 0 && (
                            <span className="px-2 py-1 rounded-full border border-white/10 bg-white/[0.03]">
                              Earned rewards here
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyDark text="No stays yet — your travel story starts here." />
            )}
          </section>

          {/* Owner CTA – unchanged behavior, premium styling */}
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.02)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-100">Want to run a property?</div>
                <div className="text-sm text-slate-400">
                  Register your hotel to unlock the owner console: dashboards, SLAs, workflows and AI moderation.
                </div>
              </div>
              <GuestButton to="/owner/register" variant="primary">
                Register your property
              </GuestButton>
            </div>
          </section>
        </div>
      </div>

      {/* Mobile bottom dock */}
      <MobileGuestDock items={bottomNav} />

      {/* Explore stays overlay */}
      <ExploreStaysQuickAction open={showExplore} onClose={() => setShowExplore(false)} />
    </main>
  );
}

/* ===== Card loader helper ===== */
async function loadCard<J, T>(
  fetcher: () => Promise<J>,
  map: (j: J | null) => T,
  demo: () => T,
  set: (next: AsyncData<T>) => void,
  allowDemo: boolean,
) {
  set({ loading: true, source: "live", data: [] as unknown as T });
  try {
    const j = await fetcher();
    set({ loading: false, source: "live", data: map(j) });
  } catch {
    if (allowDemo) {
      set({ loading: false, source: "preview", data: demo() });
    } else {
      set({ loading: false, source: "live", data: map(null as any) });
    }
  }
}

/* ===== Ad-hoc helpers ===== */

function normalizeStayRow(row: any): Stay {
  if (!row) {
    return {
      id: "",
      booking_code: null,
      hotel_id: null,
      status: null,
      hotel: {
        name: "Unknown hotel",
        city: undefined,
        country: undefined,
        cover_url: null,
        slug: null,
        tenant_slug: null,
      },
      check_in: "",
      check_out: "",
      bill_total: null,
      room_type: null,
    };
  }

  const bookingCode = row.booking_code ?? row.code ?? row.bookingCode ?? row.id ?? null;
  const hotelName = row.hotel_name ?? row.hotel?.name ?? row.name ?? "Unknown hotel";
  const city = row.city ?? row.hotel_city ?? row.hotel?.city ?? undefined;
  const country = row.country ?? row.hotel_country ?? row.hotel?.country ?? undefined;
  const coverUrl =
    row.cover_url ??
    row.cover_image_url ??
    row.hotel_cover_url ??
    row.hotel?.cover_url ??
    null;

  const slug = row.hotel_slug ?? row.slug ?? row.hotel?.slug ?? row.hotel?.tenant_slug ?? null;

  const checkIn = row.check_in ?? row.checkIn ?? row.start_at ?? row.startAt ?? "";
  const checkOut = row.check_out ?? row.checkOut ?? row.end_at ?? row.endAt ?? "";

  return {
    id: bookingCode || String(row.id),
    booking_code: bookingCode,
    hotel_id: row.hotel_id ?? row.hotel?.id ?? null,
    status: row.status ?? null,
    hotel: {
      name: hotelName,
      city,
      country,
      cover_url: coverUrl,
      slug,
      tenant_slug: row.hotel?.tenant_slug ?? row.tenant_slug ?? null,
    },
    check_in: checkIn,
    check_out: checkOut,
    bill_total: row.bill_total ?? row.total_bill ?? row.amount ?? null,
    room_type: row.room_type ?? row.room ?? null,
  };
}

function getStayBookingCode(stay: any): string | null {
  if (!stay) return null;
  const c = stay.booking_code ?? stay.code ?? stay.bookingCode ?? stay.id ?? null;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

function getStayHotelId(stay: any): string | null {
  const h = stay?.hotel_id ?? stay?.hotelId ?? stay?.hotel?.id ?? null;
  return h ? String(h) : null;
}

function getStayPropertySlug(stay: any): string | null {
  const s =
    stay?.hotel_slug ?? stay?.slug ?? stay?.hotel?.slug ?? stay?.hotel?.tenant_slug ?? stay?.tenant_slug ?? null;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

function getMostBookedRoomType(stays: any[]): string | null {
  const counts: Record<string, number> = {};
  stays.forEach((s) => {
    const rt = s?.room_type as string | null;
    if (!rt) return;
    const key = rt.trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function getCountdown(checkIn: string) {
  const target = new Date(checkIn).getTime();
  const now = Date.now();
  if (!isFinite(target) || target <= now) {
    return { days: 0, hours: 0, label: "Check-in today or earlier" };
  }
  const diff = target - now;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  const days = Math.floor(diff / ONE_DAY);
  const hours = Math.floor((diff % ONE_DAY) / ONE_HOUR);
  const dd = String(days).padStart(2, "0");
  const hh = String(hours).padStart(2, "0");
  return { days, hours, label: `Check-in in ${dd} days · ${hh} hrs` };
}

/**
 * Build stay detail link with robust booking-code carry-forward.
 */
function buildStayLink(stay: any) {
  const bookingCode = getStayBookingCode(stay);
  const slug = getStayPropertySlug(stay);

  const idForPath =
    (typeof stay?.id === "string" && stay.id.trim() ? stay.id.trim() : null) || bookingCode || "";

  const base = `/stay/${encodeURIComponent(idForPath)}`;

  const params = new URLSearchParams();
  if (bookingCode) {
    params.set("bookingCode", bookingCode);
    params.set("code", bookingCode);
  }
  if (slug) {
    params.set("propertySlug", slug);
    params.set("property", slug);
    params.set("hotelSlug", slug);
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Build checkout link that auto-carries booking + hotel + property slug
 */
function buildCheckoutLink(stay: any) {
  const bookingCode = getStayBookingCode(stay);
  const hotelId = getStayHotelId(stay);
  const slug = getStayPropertySlug(stay);

  const params = new URLSearchParams();
  if (hotelId) params.set("hotelId", hotelId);
  if (bookingCode) {
    params.set("bookingCode", bookingCode);
    params.set("code", bookingCode);
  }
  if (slug) {
    params.set("propertySlug", slug);
    params.set("property", slug);
    params.set("hotelSlug", slug);
    params.set("slug", slug);
  }
  params.set("from", "guest");
  return `/checkout?${params.toString()}`;
}

/** Build 12-month series even if backend only gives yearly total */
function buildMonthlySeries(spend: { total: number; monthly?: { month: number; total: number }[] }) {
  const monthNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  if (Array.isArray(spend.monthly) && spend.monthly.length) {
    return monthNames.map((label, idx) => {
      const found = spend.monthly!.find((m) => m.month === idx + 1);
      return { label, value: Number(found?.total ?? 0) };
    });
  }
  const base = Math.floor(spend.total / 12);
  const remainder = spend.total - base * 12;
  return monthNames.map((label, idx) => ({
    label,
    value: base + (idx < remainder ? 1 : 0),
  }));
}

function buildCategorySeries(spend: { total: number; categories?: { room: number; dining: number; spa: number; other: number } }) {
  if (spend.categories) {
    const c = spend.categories;
    return [
      { label: "Room", value: Number(c.room || 0) },
      { label: "Dining", value: Number(c.dining || 0) },
      { label: "Spa", value: Number(c.spa || 0) },
      { label: "Other", value: Number(c.other || 0) },
    ];
  }
  const total = spend.total || 0;
  return [
    { label: "Room", value: total * 0.65 },
    { label: "Dining", value: total * 0.2 },
    { label: "Spa", value: total * 0.1 },
    { label: "Other", value: total * 0.05 },
  ];
}

/* ===== Visualization components (dark-capable) ===== */

function MonthlyBars({
  data,
  dark,
}: {
  data: { label: string; value: number }[];
  dark?: boolean;
}) {
  if (!data.length) return dark ? <EmptyDark small text="No data yet for this year." /> : <Empty small text="No data yet for this year." />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div
      className={[
        "h-24 flex items-end gap-1 rounded-2xl border px-3 py-2",
        dark ? "border-white/10 bg-black/20" : "border-slate-200 bg-slate-50",
      ].join(" ")}
    >
      {data.map((m) => {
        const h = Math.max(4, Math.round((m.value / max) * 64));
        return (
          <div key={m.label} className="flex flex-col items-center flex-1">
            <div
              className={[
                "w-2 rounded-full",
                dark ? "bg-gradient-to-b from-slate-200/70 to-slate-500/30" : "bg-indigo-200",
              ].join(" ")}
              style={{ height: h }}
              title={`${m.label}: ${fmtMoney(Math.round(m.value))}`}
            />
            <div className={["mt-1 text-[9px]", dark ? "text-slate-400" : "text-slate-500"].join(" ")}>
              {m.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBreakdown({
  data,
  dark,
}: {
  data: { label: string; value: number }[];
  dark?: boolean;
}) {
  if (!data.length)
    return dark ? (
      <EmptyDark small text="We’ll break down your categories here after your first stay." />
    ) : (
      <Empty small text="We’ll break down your categories here after your first stay." />
    );

  const total = data.reduce((a, d) => a + d.value, 0) || 1;

  return (
    <div className="space-y-2">
      <div
        className={[
          "w-full h-3 rounded-full overflow-hidden flex border",
          dark ? "bg-white/5 border-white/10" : "bg-slate-100 border-slate-200",
        ].join(" ")}
      >
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className={dark ? "h-full bg-slate-300/25" : "h-full bg-slate-300"}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>

      <div className={["space-y-1 text-[11px]", dark ? "text-slate-300" : "text-slate-600"].join(" ")}>
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div key={seg.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={["w-2 h-2 rounded-full", dark ? "bg-slate-300/50" : "bg-slate-400"].join(" ")} />
                <span>{seg.label}</span>
              </div>
              <span className={dark ? "font-semibold text-slate-100" : "font-medium"}>
                {pct.toFixed(1)}% · {fmtMoney(Math.round(seg.value))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Premium helper UI ===== */

function PremiumBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#050B14] via-[#050B14] to-[#060A12]" />
      {/* Soft aurora arcs */}
      <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-sky-500/10 blur-3xl" />
      <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute -bottom-44 -right-44 w-[620px] h-[620px] rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute bottom-10 left-14 w-[520px] h-[520px] rounded-full bg-amber-500/10 blur-3xl" />
      {/* Subtle noise/grid overlay */}
      <div className="absolute inset-0 opacity-[0.35] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:28px_28px]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/20" />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] text-slate-400 truncate">{label}</div>
      <div className="text-[11px] font-semibold text-slate-100 truncate">{value}</div>
    </div>
  );
}

function ServiceRow({ label, right }: { label: string; right: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center justify-between">
      <div className="text-[12px] text-slate-200">{label}</div>
      <div className="text-[11px] text-slate-400">{right}</div>
    </div>
  );
}

function InsightPanel({
  title,
  desc,
  right,
}: {
  title: string;
  desc: string;
  right?: any;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-slate-100 truncate">{title}</div>
        <div className="text-[11px] text-slate-400 truncate">{desc}</div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

/** Unified Guest-only button system (does not affect other routes) */
function GuestButton({
  children,
  to,
  onClick,
  variant = "primary",
  className = "",
}: {
  children: any;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "soft" | "ghost" | "emerald";
  className?: string;
}) {
  const base = "inline-flex items-center justify-center rounded-full px-4 py-2 text-[11px] font-semibold transition border";
  const styles =
    variant === "primary"
      ? "bg-white/10 text-white border-white/10 hover:bg-white/14"
      : variant === "emerald"
      ? "bg-emerald-300/15 text-emerald-50 border-emerald-200/20 hover:bg-emerald-300/20"
      : variant === "soft"
      ? "bg-white/[0.04] text-slate-100 border-white/10 hover:bg-white/[0.08]"
      : "bg-transparent text-slate-300 border-transparent hover:bg-white/[0.06]";

  if (to && !onClick) {
    return (
      <Link to={to} className={`${base} ${styles} ${className}`}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

function QuickPill({
  title,
  text,
  to,
  onClick,
  variant = "dark",
  icon,
}: {
  title: string;
  text: string;
  to?: string;
  onClick?: () => void;
  variant?: "dark";
  icon?: string;
}) {
  const baseClasses = [
    "rounded-2xl border px-4 py-3 flex flex-col justify-between text-xs",
    "min-h-[78px] text-left w-full transition",
    variant === "dark"
      ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
  ].join(" ");

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-400">{text}</div>
        {icon ? <span className="text-sm">{icon}</span> : null}
      </div>
      <div className="font-semibold mt-0.5 text-slate-100 flex items-center justify-between gap-2">
        <span>{title}</span>
        <span className="text-slate-500">→</span>
      </div>
    </>
  );

  if (to && !onClick) {
    return (
      <Link to={to} className={baseClasses}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={baseClasses}>
      {inner}
    </button>
  );
}

function InsightCardDark({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 flex flex-col justify-between">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-slate-400 line-clamp-2">{hint}</div>}
    </div>
  );
}

/* ===== Stay State Chip (status dot + label) ===== */

type StayState = "upcoming" | "ongoing" | "completed" | "claimed" | "unknown";

function getStayState(stay?: Stay): StayState {
  if (!stay) return "unknown";

  const raw = String(stay.status ?? "").toLowerCase().trim();
  const now = Date.now();
  const ci = new Date(stay.check_in).getTime();
  const co = new Date(stay.check_out).getTime();

  if (raw.includes("complete") || raw.includes("checked_out")) return "completed";
  if (raw.includes("ongoing") || raw.includes("inhouse") || raw.includes("checked_in")) return "ongoing";
  if (raw.includes("claimed")) return "claimed";

  if (isFinite(ci) && ci > now) return "upcoming";
  if (isFinite(ci) && isFinite(co) && ci <= now && co >= now) return "ongoing";
  if (isFinite(co) && co < now) return "completed";

  return "unknown";
}

function StayStateChip({ state }: { state: StayState }) {
  const cfg: Record<
    StayState,
    { label: string; dot: string; bg: string; text: string; border: string }
  > = {
    upcoming: {
      label: "Upcoming",
      dot: "bg-sky-300",
      bg: "bg-sky-500/10",
      text: "text-sky-100",
      border: "border-sky-200/20",
    },
    ongoing: {
      label: "Ongoing",
      dot: "bg-amber-200",
      bg: "bg-amber-500/10",
      text: "text-amber-50",
      border: "border-amber-200/20",
    },
    completed: {
      label: "Completed",
      dot: "bg-emerald-200",
      bg: "bg-emerald-500/10",
      text: "text-emerald-50",
      border: "border-emerald-200/20",
    },
    claimed: {
      label: "Claimed",
      dot: "bg-indigo-200",
      bg: "bg-indigo-500/10",
      text: "text-indigo-50",
      border: "border-indigo-200/20",
    },
    unknown: {
      label: "Trip",
      dot: "bg-slate-300",
      bg: "bg-white/[0.04]",
      text: "text-slate-200",
      border: "border-white/10",
    },
  };

  const c = cfg[state];

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
        "text-[10px] font-semibold uppercase tracking-wide",
        c.bg,
        c.text,
        c.border,
      ].join(" ")}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

/* ===== Mobile bottom dock ===== */
function MobileGuestDock({ items }: { items: { label: string; to: string; icon: string }[] }) {
  const location = useLocation();
  return (
    <div className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
        <div className="grid grid-cols-5">
          {items.map((i) => {
            const active = location.pathname === i.to;
            return (
              <Link
                key={i.to + i.label}
                to={i.to}
                className={[
                  "py-2.5 px-1 flex flex-col items-center justify-center gap-1",
                  "text-[9px] font-medium",
                  active ? "text-slate-100" : "text-slate-400",
                ].join(" ")}
              >
                <span className="text-base">{i.icon}</span>
                <span className="leading-none">{i.label}</span>
                <span className={["h-0.5 w-6 rounded-full", active ? "bg-slate-100" : "bg-transparent"].join(" ")} />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===== Premium Explore stays overlay ===== */
function ExploreStaysQuickAction({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cityFilter, setCityFilter] = useState<string>("all");

  if (!open) return null;

  const properties = [
    {
      id: "demo-hotel-one-jaipur",
      name: "Demo Hotel One · Jaipur",
      cityKey: "jaipur",
      cityLabel: "Jaipur · Rajasthan",
      tag: "Flagship luxury · Partner",
      highlights: ["Pool & spa", "Airport transfers", "City tours desk"],
      startingFrom: "₹ 9,500 / night*",
    },
    {
      id: "demo-hotel-one-nainital",
      name: "Demo Hotel One · Nainital",
      cityKey: "nainital",
      cityLabel: "Nainital · Uttarakhand",
      tag: "Lake view · Boutique",
      highlights: ["Lake-facing rooms", "Breakfast included", "Early check-in on request"],
      startingFrom: "₹ 7,800 / night*",
    },
    {
      id: "demo-hotel-two-delhi",
      name: "Demo Hotel Two · Delhi",
      cityKey: "delhi",
      cityLabel: "New Delhi · NCR",
      tag: "Business + family friendly",
      highlights: ["Metro access", "Conference rooms", "24×7 room service"],
      startingFrom: "₹ 8,900 / night*",
    },
  ];

  const cities = [
    { key: "all", label: "All locations" },
    { key: "jaipur", label: "Jaipur" },
    { key: "nainital", label: "Nainital" },
    { key: "delhi", label: "Delhi NCR" },
  ];

  const filtered = cityFilter === "all" ? properties : properties.filter((p) => p.cityKey === cityFilter);

  const mailBase = "mailto:support@vaiyu.co.in?subject=" + encodeURIComponent("VAiyu booking interest");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-4xl w-full rounded-3xl bg-[#070C15] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-sky-200/80">Concierge booking · Beta</div>
            <h2 className="text-lg md:text-xl font-semibold text-slate-100">Explore stays with VAiyu</h2>
            <p className="mt-1 text-xs text-slate-400 max-w-xl">
              Right now we handle bookings with a human concierge. Pick a property, share your dates and we’ll confirm
              availability over WhatsApp / email. Instant online booking is coming soon.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
            aria-label="Close explore stays"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-3 pb-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="inline-flex items-center gap-2">
            <span className="text-slate-400">Filter by location</span>
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-1 py-0.5">
              {cities.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCityFilter(c.key)}
                  className={[
                    "px-2 py-1 rounded-full transition text-[11px]",
                    cityFilter === c.key ? "bg-white/10 text-slate-100" : "text-slate-400 hover:text-slate-200",
                  ].join(" ")}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-slate-400">
            Prefer a different city?{" "}
            <a
              href={`${mailBase}&body=${encodeURIComponent(
                "I’d like to explore a booking in another city. Please contact me with options.",
              )}`}
              className="underline text-slate-200"
            >
              Ask our concierge
            </a>
          </div>
        </div>

        <div className="p-5 grid md:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col justify-between">
              <div>
                <div className="text-[11px] text-slate-400">{p.cityLabel}</div>
                <div className="mt-0.5 font-semibold text-sm text-slate-100">{p.name}</div>
                <div className="mt-1 text-[11px] text-emerald-200/90">{p.tag}</div>
                <ul className="mt-3 space-y-1 text-[11px] text-slate-400">
                  {p.highlights.map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-400">
                  From <span className="font-semibold text-slate-100">{p.startingFrom}</span>
                  <div className="text-[10px] text-slate-500">
                    *Indicative rates. Final price confirmed on call.
                  </div>
                </div>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-slate-100 hover:bg-white/[0.08]"
                  href={`${mailBase}&body=${encodeURIComponent(
                    `I’d like to book: ${p.name} (${p.cityLabel}).\n\nPreferred dates:\nGuests:\nSpecial requests:\n\nPlease contact me with availability and best rate.`,
                  )}`}
                >
                  Share details
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-white/10 bg-white/[0.02] text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>You will receive a confirmation from our concierge team before any booking is final.</span>
          <span>
            Online one-tap booking · <span className="font-semibold text-slate-200">coming soon</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ===== Small helpers ===== */
async function jsonWithTimeout(url: string, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);

  try {
    const headers: Record<string, string> = {};

    // Attach Supabase access token when calling our own APIs
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (token && shouldAttachAuthTo(url)) headers["authorization"] = `Bearer ${token}`;

      // When using direct Supabase Edge host, apikey helps with some setups
      if (IS_SUPABASE_EDGE && shouldAttachAuthTo(url)) {
        const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
        if (anonKey) headers["apikey"] = anonKey;
      }
    } catch {
      // ok
    }

    const r = await fetch(url, { signal: c.signal, cache: "no-store", headers });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

function shouldAttachAuthTo(url: string) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.host === window.location.host) return true; // same-origin proxy
    if (API_HOST && u.host === API_HOST) return true;
    if (u.host.includes(".functions.supabase.co")) return true;
  } catch {
    // ignore
  }
  return false;
}

function fmtMoney(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `₹ ${v.toLocaleString()}`;
}
function fmtDate(s: string) {
  const d = new Date(s);
  return isFinite(d.getTime()) ? d.toLocaleString() : s;
}
function fmtRange(a: string, b: string) {
  const A = new Date(a),
    B = new Date(b);
  const left = isFinite(A.getTime()) ? A.toLocaleDateString() : a;
  const right = isFinite(B.getTime()) ? B.toLocaleDateString() : b;
  return `${left} – ${right}`;
}
function stars(n: number) {
  const c = Math.max(0, Math.min(5, Math.round(n)));
  return "★★★★★".slice(0, c) + "☆☆☆☆☆".slice(c);
}

function SkeletonDark({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-white/10 animate-pulse" />
      ))}
    </div>
  );
}

function diffDays(a: string, b: string) {
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  const ONE = 24 * 60 * 60 * 1000;
  if (!isFinite(A) || !isFinite(B)) return 0;
  return Math.max(0, Math.round((B - A) / ONE));
}

/* ===== Demo fallbacks ===== */
function demoStays(): any[] {
  return [
    {
      id: "s1",
      hotel_id: "H1",
      status: "completed",
      hotel: {
        name: "Sunrise Suites",
        city: "Nainital",
        slug: "sunrise",
        cover_url: "https://images.unsplash.com/photo-1559599101-b59c1b3bcd9b?w=640",
      },
      check_in: "2025-08-10T12:00:00Z",
      check_out: "2025-08-12T08:00:00Z",
      bill_total: 7420,
      booking_code: "SUN-TEST-01",
    },
    {
      id: "s2",
      hotel_id: "H2",
      status: "completed",
      hotel: {
        name: "Lakeside Inn",
        city: "Nainital",
        slug: "lakeside",
        cover_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=640",
      },
      check_in: "2025-06-05T12:00:00Z",
      check_out: "2025-06-07T08:00:00Z",
      bill_total: 5810,
      booking_code: "LAKE-TEST-02",
    },
    {
      id: "s3",
      hotel_id: "H3",
      status: "completed",
      hotel: {
        name: "Pine View",
        city: "Almora",
        slug: "pineview",
        cover_url: "https://images.unsplash.com/photo-1496412705862-e0088f16f791?w=640",
      },
      check_in: "2025-04-01T12:00:00Z",
      check_out: "2025-04-03T08:00:00Z",
      bill_total: 3999,
      booking_code: "PINE-TEST-03",
    },
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
      hotel_reply: "Thank you! We loved hosting you.",
    },
  ];
}
function demoSpend(): any[] {
  const y = new Date().getFullYear();
  return [{ year: y, total: 13240 }, { year: y - 1, total: 19880 }, { year: y - 2, total: 0 }];
}
function demoReferrals(): any[] {
  return [
    {
      id: "rf1",
      hotel: { name: "Sunrise Suites", city: "Nainital" },
      credits: 1200,
      referrals_count: 3,
    },
  ];
}

/* ===== Simple empty state ===== */
function Empty({ text, small }: { text: string; small?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-dashed ${small ? "p-3 text-xs" : "p-6 text-sm"} text-gray-600 bg-gray-50`}
    >
      {text}
    </div>
  );
}
function EmptyDark({ text, small }: { text: string; small?: boolean }) {
  return (
    <div
      className={[
        "rounded-2xl border border-dashed border-white/10 bg-black/20 text-slate-300",
        small ? "p-3 text-xs" : "p-6 text-sm",
      ].join(" ")}
    >
      {text}
    </div>
  );
}
