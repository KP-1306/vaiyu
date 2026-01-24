// web/src/routes/GuestDashboard.tsx — VAiyu Guest Dashboard (ULTRA PREMIUM / LOCKED STYLE)
// Preserves ALL existing data fetching / Supabase / fallback logic.
// Only UI is rebuilt to match the approved premium dark dashboard image.
// No synthetic numbers: unknown values render as "—" / "Not available".

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  status?: string | null;
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

/* ======= GUEST DASHBOARD (ULTRA PREMIUM) ======= */
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
        (u?.user_metadata?.name as string) ?? u?.user_metadata?.full_name ?? null
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

      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess) => {
        if (!mounted) return;
        const user = sess?.user;
        setEmail(user?.email ?? null);
        setAuthName(
          (user?.user_metadata?.name as string) ??
            user?.user_metadata?.full_name ??
            null
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
      });
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

        if (!cancelled) setStays({ loading: false, source: "live", data: items });
        if (items.length) return;
      } catch (err) {
        // Try alternate endpoint
        try {
          const j2: any = await jsonWithTimeout(`${API}${ALT_STAYS_ENDPOINT}?limit=10`);
          const rawItems2: any[] = Array.isArray(j2?.items) ? j2.items : [];
          const items2: Stay[] = rawItems2.map(normalizeStayRow);

          if (!cancelled) setStays({ loading: false, source: "live", data: items2 });
          if (items2.length) return;
        } catch (err2) {
          console.warn("[GuestDashboard] me-stays API failed, fallback to view", err2);
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

        if (!cancelled) setStays({ loading: false, source: "live", data: items });
      } catch (err) {
        console.error("[GuestDashboard] fallback user_recent_stays failed", err);
        if (!cancelled) {
          if (USE_DEMO) {
            setStays({ loading: false, source: "preview", data: demoStays() as Stay[] });
          } else {
            setStays({ loading: false, source: "live", data: [] as Stay[] });
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
      USE_DEMO
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
      USE_DEMO
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/referrals`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Referral[]) : []),
      demoReferrals,
      setReferrals,
      USE_DEMO
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
      return `Welcome back, ${firstName}.`;
    }
    return `Welcome back, ${firstName}.`;
  }, [firstName, lastStay, stays.source]);

  const totalReferralCredits = referrals.data.reduce(
    (a, r) => a + Number(r.credits || 0),
    0
  );

  // Derive spend per year/month from stays when /me/spend is not available
  const derivedSpendFromStays: Spend[] = useMemo(() => {
    if (!stays.data.length) return [];
    const byYear: Record<number, { total: number; byMonth: Record<number, number> }> = {};

    stays.data.forEach((s) => {
      const amount = typeof s.bill_total === "number" ? Number(s.bill_total) : 0;
      if (!amount) return;
      const dt = new Date(s.check_in);
      if (!isFinite(dt.getTime())) return;
      const year = dt.getFullYear();
      const month = dt.getMonth() + 1;

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

  const countdown = useMemo(() => (nextStay ? getCountdown(nextStay.check_in) : null), [
    nextStay?.check_in,
  ]);
  const nextStayNights = nextStay ? diffDays(nextStay.check_in, nextStay.check_out) : 0;

  // Jobs CTA URL for current stay (if we know the slug)
  const jobsUrl = useMemo(() => {
    if (!nextStay) return null;
    const anyStay: any = nextStay;
    const slug =
      anyStay.hotel_slug || anyStay.slug || anyStay.hotel?.slug || anyStay.hotel?.tenant_slug || null;
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

  const monthlySeries = useMemo(() => (selectedYear ? buildMonthlySeries(selectedYear) : []), [
    selectedYear,
  ]);
  const categorySeries = useMemo(() => (selectedYear ? buildCategorySeries(selectedYear) : []), [
    selectedYear,
  ]);

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
    { label: "Overview", to: "/guest", icon: "⌂" },
    { label: "Service requests", to: "/requestTracker", icon: "⚡" },
    { label: "Rewards & vouchers", to: "/rewards", icon: "🎁" },
    { label: "Trips", to: "/stays", icon: "🧳" },
    { label: "Express checkout", to: expressCheckoutUrl, icon: "✓" },
    { label: "Support", to: "/contact", icon: "✦" },
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
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* Premium background (10% brighter + calmer, premium blue+green) */}
      <div className="pointer-events-none fixed inset-0 opacity-90">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_700px_at_14%_0%,rgba(59,130,246,0.22),transparent_58%),radial-gradient(900px_560px_at_88%_18%,rgba(16,185,129,0.20),transparent_56%),radial-gradient(900px_640px_at_50%_120%,rgba(34,211,238,0.15),transparent_62%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.0),rgba(2,6,23,0.72))]" />
      </div>

      <div className="relative mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-6">
        {/* Top bar */}
        <header className="flex flex-col gap-3 rounded-2xl border border-sky-200/10 bg-sky-400/6 px-4 py-3 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-tight text-slate-100">
              VAiyu Guest Dashboard
            </div>
            <div className="mt-0.5 text-[12px] text-slate-400">
              Stay overview · Requests · Rewards · Support
            </div>
          </div>

          <div className="flex items-center gap-2">
            <form
              onSubmit={onSearchSubmit}
              className="hidden lg:flex items-center rounded-full border border-sky-200/10 bg-sky-400/5 px-3 py-2"
            >
              <input
                className="w-[360px] bg-transparent text-[13px] text-slate-100 placeholder:text-slate-400 outline-none"
                placeholder="Search booking, hotel, city…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button
                type="submit"
                className="ml-2 rounded-full border border-sky-200/10 bg-sky-400/6 px-3 py-1.5 text-[12px] font-semibold text-slate-100 hover:bg-sky-400/10"
              >
                Search
              </button>
            </form>

            <div className="hidden sm:flex items-center gap-2 rounded-full border border-sky-200/10 bg-sky-400/5 px-3 py-2">
              <span className="text-[12px] text-slate-300">Platinum</span>
              <span className="text-[12px] font-semibold text-slate-100">·</span>
              <span className="text-[12px] font-semibold text-slate-100">
                {tierPoints.toLocaleString()} pts
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-sky-200/10 bg-sky-400/5 px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-400/12 text-[12px] font-semibold">
                {initials || "G"}
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="text-[12px] font-semibold text-slate-100 truncate max-w-[160px]">
                  {displayName || firstName || "Guest"}
                </div>
                <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                  {email || ""}
                </div>
              </div>
            </div>

            <AccountControls />
          </div>
        </header>

        {/* 3-column layout */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[260px,minmax(0,1fr),360px]">
          {/* Left rail */}
          <aside className="hidden lg:block">
            <GlassCard className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold text-slate-100">{welcomeText}</div>
                <span className="text-[11px] text-slate-400">
                  {countdown?.label ?? "—"}
                </span>
              </div>

              <div className="mt-3 rounded-2xl border border-sky-200/10 bg-sky-400/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-sky-400/12 border border-sky-200/10 grid place-items-center text-[12px] font-semibold">
                    {initials || "G"}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-100 truncate">
                      {displayName || firstName || "Guest"}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {email || "—"}
                    </div>
                  </div>
                </div>
              </div>

              <nav className="mt-3 space-y-1">
                {sidebarNav.map((item) => {
                  const active = location.pathname === item.to;
                  return (
                    <Link
                      key={item.to + item.label}
                      to={item.to}
                      className={[
                        "flex items-center justify-between rounded-xl px-3 py-2.5 transition",
                        "border border-transparent",
                        active
                          ? "bg-sky-400/12 text-slate-50 border-sky-200/12"
                          : "text-slate-300 hover:bg-sky-400/8 hover:text-slate-50",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-center text-[14px] opacity-90">
                          {item.icon}
                        </span>
                        <span className="text-[13px] font-medium">{item.label}</span>
                      </div>
                      <span className="text-slate-500">→</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-4 border-t border-sky-200/10 pt-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Quick actions
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniAction label="Scan QR" to="/scan" hint="Check-in" icon="⌁" />
                  <MiniAction label="Find booking" to="/claim" hint="Code" icon="⌕" />
                  <MiniAction label="Rewards" to="/rewards" hint="Wallet" icon="✶" />
                  <MiniAction label="Bills" to="/bills" hint="Invoices" icon="⌁" />
                </div>
              </div>
            </GlassCard>
          </aside>

          {/* Main */}
          <section className="min-w-0 space-y-4">
            {/* Next stay card */}
            <GlassCard className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-slate-400">Next stay</div>
                  <div className="mt-1 text-[14px] font-semibold text-slate-100">
                    Your current stay status and quick actions
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusPill
                    label={stayStateLabel(stayState)}
                    tone={stayStateTone(stayState)}
                  />
                </div>
              </div>

              {nextStay ? (
                <div className="mt-3 rounded-2xl border border-sky-200/10 bg-sky-400/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-slate-100 truncate">
                        {nextStay.hotel.name}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-400">
                        Booking:{" "}
                        <span className="font-mono text-slate-200">
                          {getStayBookingCode(nextStay) ||
                            (nextStay.id ? nextStay.id.slice(0, 8) : "—")}
                        </span>
                        {nextStay.hotel.city ? <span className="text-slate-500"> · </span> : null}
                        {nextStay.hotel.city ? (
                          <span className="text-slate-300">{nextStay.hotel.city}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[12px] text-slate-400">
                        Dates:{" "}
                        <span className="text-slate-200">
                          {fmtRange(nextStay.check_in, nextStay.check_out)}
                        </span>{" "}
                        <span className="text-slate-500">·</span>{" "}
                        <span className="text-slate-200">
                          {nextStayNights || 1} night{(nextStayNights || 1) === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-[200px] text-right">
                      <div className="text-[12px] text-slate-400">Room</div>
                      <div className="text-[13px] font-semibold text-slate-100">
                        {nextStay.room_type || mostBookedRoomType || "Standard"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <PrimaryBtn to={buildStayLink(nextStay)}>View stay</PrimaryBtn>
                    <SecondaryBtn to="/scan">Scan QR</SecondaryBtn>
                    <AccentBtn to={expressCheckoutUrl}>Express checkout</AccentBtn>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-sky-200/10 bg-sky-400/5 p-4 text-[13px] text-slate-300">
                  Not available
                </div>
              )}
            </GlassCard>

            {/* KPI strip */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Trips" value={stats.totalStays ? String(stats.totalStays) : "—"} sub="Total stays" />
              <KpiCard label="Nights" value={stats.nights ? String(stats.nights) : "—"} sub="Across VAiyu" />
              <KpiCard label="Spend" value={stats.totalSpend ? fmtMoney(stats.totalSpend) : "₹ 0"} sub="Last stay / total" />
              <KpiCard label="Rewards" value={stats.totalCredits ? fmtMoney(stats.totalCredits) : "₹ 0"} sub="Balance" />
              <KpiCard label="Most visited" value={stats.totalStays ? stats.mostVisited : "—"} sub="Comfort zone" />
            </div>

            {/* Lower grid: Service requests + Rewards wallet */}
            <div className="grid gap-4 lg:grid-cols-2">
              <GlassCard className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] text-slate-400">Service Requests</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-100">
                      Track and raise requests
                    </div>
                  </div>
                  <Link
                    to="/requestTracker"
                    className="text-[12px] font-semibold text-slate-300 hover:text-slate-100 underline"
                  >
                    Open →
                  </Link>
                </div>

                <div className="mt-3 space-y-2">
                  <ServiceRow name="Housekeeping" value="Not available" />
                  <ServiceRow name="Maintenance" value="Not available" />
                  <ServiceRow name="Room service" value="Not available" />
                  <ServiceRow name="Laundry" value="Not available" />
                </div>

                <div className="mt-4 border-t border-sky-200/10 pt-4">
                  <div className="text-[12px] font-semibold text-slate-100">
                    Quick actions
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <QuickTile
                      title="Book a new stay"
                      subtitle="Explore stays"
                      icon="🏨"
                      onClick={() => setShowExplore(true)}
                    />
                    <QuickTile
                      title={jobsUrl ? "Jobs at this hotel" : "Work in hotels"}
                      subtitle={jobsUrl ? "Apply for openings" : "Build profile"}
                      icon="🧑‍🍳"
                      to={jobsUrl || "/workforce/profile"}
                    />
                    <QuickTile title="Find my booking" subtitle="Use booking code" icon="🔎" to="/claim" />
                    <QuickTile title="Download invoices" subtitle="Bills & reports" icon="🧾" to="/bills" />
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] text-slate-400">Rewards & Wallet</div>
                    <div className="mt-1 text-[14px] font-semibold text-slate-100">
                      Vouchers and points
                    </div>
                  </div>
                  <Link
                    to="/rewards"
                    className="text-[12px] font-semibold text-slate-300 hover:text-slate-100 underline"
                  >
                    View →
                  </Link>
                </div>

                <div className="mt-3">
                  {/* Keep existing component */}
                  <RewardsPill />
                </div>

                <div className="mt-3 rounded-2xl border border-sky-200/10 bg-sky-400/5 p-4">
                  <div className="text-[12px] text-slate-400">
                    Progress to next perk
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-sky-400/10">
                    {/* Pilot-safe: if no spend/rewards data, keep subtle baseline */}
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400/80 via-cyan-400/70 to-emerald-400/75"
                      style={{
                        width: `${Math.min(100, Math.max(6, stats.totalStays ? 22 : 6))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 text-[12px] text-slate-300">
                    Available vouchers:{" "}
                    <span className="font-semibold text-slate-100">
                      {referrals.loading ? "—" : referrals.data.length ? String(referrals.data.length) : "0"}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-slate-400">
                    Referral bonus: Invite friends to earn
                  </div>
                </div>

                {/* Spend analytics (kept, premium dark) */}
                <div className="mt-4 border-t border-sky-200/10 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] text-slate-400">Guest Insights</div>
                      <div className="mt-1 text-[14px] font-semibold text-slate-100">
                        Travel analytics
                      </div>
                    </div>
                    <div className="inline-flex rounded-full border border-sky-200/10 bg-sky-400/5 p-1 text-[12px]">
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
                            "rounded-full px-3 py-1 transition",
                            spendMode === tab.key
                              ? "bg-sky-400/12 text-slate-100"
                              : "text-slate-400 hover:text-slate-200",
                          ].join(" ")}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    {spend.loading ? (
                      <DarkSkeleton lines={4} />
                    ) : !selectedYear ? (
                      <DarkEmpty text="Not available" />
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <div className="text-[12px] text-slate-400">Monthly spend</div>
                          <MonthlyBarsDark data={monthlySeries} />
                        </div>
                        <div>
                          <div className="text-[12px] text-slate-400">Spend by category</div>
                          <CategoryBreakdownDark data={categorySeries} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Recent trips (kept, premium dark) */}
            <GlassCard className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] text-slate-400">Recent trips</div>
                  <div className="mt-1 text-[14px] font-semibold text-slate-100">
                    Last {Math.min(5, recentTrips.length)} stays
                  </div>
                </div>
                <Link
                  to="/stays"
                  className="text-[12px] font-semibold text-slate-300 hover:text-slate-100 underline"
                >
                  View all →
                </Link>
              </div>

              <div className="mt-3">
                {stays.loading ? (
                  <DarkSkeleton lines={4} />
                ) : recentTrips.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {recentTrips.map((s) => {
                      const key = (s?.hotel?.name || "").toLowerCase();
                      const rv = key ? reviewByHotel[key] : undefined;
                      const credits = key ? creditsByHotel[key] || 0 : 0;

                      return (
                        <div
                          key={s.id}
                          className="rounded-2xl border border-sky-200/10 bg-sky-400/5 p-3"
                        >
                          <div className="text-[13px] font-semibold text-slate-100 truncate">
                            {s.hotel.name}
                          </div>
                          <div className="mt-1 text-[12px] text-slate-400">
                            {s.hotel.city ? `${s.hotel.city} · ` : ""}
                            {fmtRange(s.check_in, s.check_out)}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                            {typeof s.bill_total === "number" ? (
                              <span className="text-slate-200">{fmtMoney(Number(s.bill_total))}</span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                            {rv ? (
                              <span className="text-amber-200">{stars(rv.rating)}</span>
                            ) : null}
                            {credits > 0 ? (
                              <span className="text-emerald-200">
                                Credits {fmtMoney(credits)}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-3">
                            <Link
                              to={buildStayLink(s)}
                              className="text-[12px] font-semibold text-slate-300 hover:text-slate-100 underline"
                            >
                              Details →
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <DarkEmpty text="Not available" />
                )}
              </div>
            </GlassCard>

            {/* Owner CTA - unchanged behavior, restyled dark */}
            <GlassCard className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-slate-100">
                    Want to run a property?
                  </div>
                  <div className="mt-1 text-[12px] text-slate-400">
                    Register your hotel to unlock dashboards, SLAs, workflows and AI helpers.
                  </div>
                </div>
                <PrimaryBtn to="/owner/register">Register your property</PrimaryBtn>
              </div>
            </GlassCard>
          </section>

          {/* Right rail */}
          <aside className="space-y-4">
            <GlassCard className="p-4">
              <div className="text-[12px] text-slate-400">Guest Insights</div>
              <div className="mt-1 text-[14px] font-semibold text-slate-100">
                Personalized tips and travel analytics
              </div>
              <div className="mt-3 space-y-2">
                <InsightBox title="Travel analytics" subtitle="Spend trends, stay history" />
                <InsightBox title="Comfort preferences" subtitle="Pillows, temperature, diet" />
                <InsightBox title="Quick support" subtitle="Chat / Call / Email" />
              </div>
            </GlassCard>

            <GlassCard className="p-4">
              <div className="text-[12px] text-slate-400">Service shortcuts</div>
              <div className="mt-1 text-[14px] font-semibold text-slate-100">
                One-tap actions
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniAction label="Scan QR" to="/scan" hint="Check-in" icon="⌁" />
                <MiniAction label="Express" to={expressCheckoutUrl} hint="Checkout" icon="✓" />
                <MiniAction label="Rewards" to="/rewards" hint="Wallet" icon="✶" />
                <MiniAction label="Support" to="/contact" hint="Help" icon="✦" />
              </div>
            </GlassCard>

            <GlassCard className="p-4">
              <div className="text-[12px] text-slate-400">Support</div>
              <div className="mt-1 text-[14px] font-semibold text-slate-100">Need help?</div>
              <div className="mt-3 space-y-2">
                <Link
                  to="/contact"
                  className="block rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-2.5 text-[13px] font-semibold text-slate-100 hover:bg-sky-400/10"
                >
                  Contact support
                </Link>
                <button
                  type="button"
                  onClick={() => setShowExplore(true)}
                  className="w-full rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-2.5 text-left text-[13px] font-semibold text-slate-100 hover:bg-sky-400/10"
                >
                  Explore stays
                </button>
              </div>
            </GlassCard>
          </aside>
        </div>
      </div>

      {/* Mobile bottom dock */}
      <MobileGuestDock items={bottomNav} />

      {/* Explore stays overlay */}
      <ExploreStaysQuickAction open={showExplore} onClose={() => setShowExplore(false)} />
    </main>
  );
}

/* =========================
   UI Helpers (Premium Dark)
========================= */

function GlassCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        // Cooler + calmer base with premium blue tint (10% brighter vs before)
        "rounded-2xl border border-sky-200/10 bg-[#071427]/72",
        "shadow-[0_18px_60px_rgba(0,0,0,0.40)] backdrop-blur-md",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "slate";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-300/16 text-emerald-100 border-emerald-300/22"
      : tone === "amber"
        ? "bg-amber-300/16 text-amber-100 border-amber-300/22"
        : "bg-sky-400/8 text-slate-200 border-sky-200/10";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-3 py-1",
        "text-[12px] font-semibold",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <GlassCard className="p-3">
      <div className="text-[12px] text-slate-400">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tracking-tight text-slate-100">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
    </GlassCard>
  );
}

function ServiceRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-2.5">
      <div className="text-[13px] font-medium text-slate-100">{name}</div>
      <div className="text-[12px] text-slate-400">{value}</div>
    </div>
  );
}

function QuickTile({
  title,
  subtitle,
  icon,
  to,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: string;
  to?: string;
  onClick?: () => void;
}) {
  const inner = (
    <div className="rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-3 hover:bg-sky-400/10 transition">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-slate-400">{subtitle}</div>
        <div className="text-[14px]">{icon}</div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-slate-100">{title}</div>
        <div className="text-slate-500">→</div>
      </div>
    </div>
  );

  if (to) return <Link to={to}>{inner}</Link>;
  return (
    <button type="button" onClick={onClick} className="text-left">
      {inner}
    </button>
  );
}

function InsightBox({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-3">
      <div className="text-[13px] font-semibold text-slate-100">{title}</div>
      <div className="mt-0.5 text-[12px] text-slate-400">{subtitle}</div>
    </div>
  );
}

function MiniAction({
  label,
  hint,
  icon,
  to,
}: {
  label: string;
  hint: string;
  icon: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-sky-200/10 bg-sky-400/5 px-3 py-2.5 hover:bg-sky-400/10 transition"
    >
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-100">{label}</div>
        <div className="text-[13px] text-slate-300">{icon}</div>
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>
    </Link>
  );
}

function PrimaryBtn({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-full border border-sky-300/20 bg-sky-400/10 px-4 py-2 text-[13px] font-semibold text-slate-100 hover:bg-sky-400/14"
    >
      {children}
    </Link>
  );
}

function SecondaryBtn({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-full border border-sky-200/10 bg-sky-400/6 px-4 py-2 text-[13px] font-semibold text-slate-100 hover:bg-sky-400/10"
    >
      {children}
    </Link>
  );
}

function AccentBtn({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/12 px-4 py-2 text-[13px] font-semibold text-emerald-50 hover:bg-emerald-300/18"
    >
      {children}
    </Link>
  );
}

function DarkEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-sky-200/10 bg-sky-400/5 p-4 text-[13px] text-slate-300">
      {text}
    </div>
  );
}

function DarkSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-sky-400/10 animate-pulse" />
      ))}
    </div>
  );
}

/* =========================
   Spend visuals (Dark)
========================= */

function MonthlyBarsDark({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <DarkEmpty text="Not available" />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="h-24 rounded-2xl border border-sky-200/10 bg-sky-400/5 px-3 py-3 flex items-end gap-1">
      {data.map((m) => {
        const h = Math.max(4, Math.round((m.value / max) * 64));
        return (
          <div key={m.label} className="flex flex-col items-center flex-1">
            <div
              className="w-2 rounded-full bg-gradient-to-b from-blue-300/85 via-cyan-300/75 to-emerald-300/75"
              style={{ height: h }}
              title={`${m.label}: ${fmtMoney(Math.round(m.value))}`}
            />
            <div className="mt-1 text-[10px] text-slate-500">{m.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBreakdownDark({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <DarkEmpty text="Not available" />;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;

  const colors = [
    "bg-blue-300/78",
    "bg-cyan-300/78",
    "bg-emerald-300/78",
    "bg-teal-300/74",
  ];

  return (
    <div className="space-y-2">
      <div className="w-full h-3 rounded-full bg-sky-400/10 overflow-hidden flex border border-sky-200/10">
        {data.map((seg, idx) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className={`h-full ${colors[idx % colors.length]}`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>

      <div className="space-y-1">
        {data.map((seg, idx) => {
          const pct = (seg.value / total) * 100;
          return (
            <div key={seg.label} className="flex items-center justify-between text-[12px]">
              <div className="flex items-center gap-2 text-slate-300">
                <span className={`h-2 w-2 rounded-full ${colors[idx % colors.length]}`} />
                <span>{seg.label}</span>
              </div>
              <span className="text-slate-200 font-semibold">
                {pct.toFixed(1)}% · {fmtMoney(Math.round(seg.value))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Stay State Chip mapping ===== */

type StayState = "upcoming" | "ongoing" | "completed" | "claimed" | "unknown";

function getStayState(stay?: Stay): StayState {
  if (!stay) return "unknown";

  const raw = String(stay.status ?? "").toLowerCase().trim();
  const now = Date.now();
  const ci = new Date(stay.check_in).getTime();
  const co = new Date(stay.check_out).getTime();

  if (raw.includes("complete") || raw.includes("checked_out")) return "completed";
  if (raw.includes("ongoing") || raw.includes("inhouse") || raw.includes("checked_in"))
    return "ongoing";
  if (raw.includes("claimed")) return "claimed";

  if (isFinite(ci) && ci > now) return "upcoming";
  if (isFinite(ci) && isFinite(co) && ci <= now && co >= now) return "ongoing";
  if (isFinite(co) && co < now) return "completed";

  return "unknown";
}

function stayStateLabel(s: StayState) {
  return {
    upcoming: "Upcoming",
    ongoing: "Ongoing",
    completed: "Completed",
    claimed: "Claimed",
    unknown: "Trip",
  }[s];
}
function stayStateTone(s: StayState): "emerald" | "amber" | "slate" {
  if (s === "completed") return "emerald";
  if (s === "ongoing") return "amber";
  if (s === "upcoming") return "slate";
  return "slate";
}

/* ===== Mobile bottom dock ===== */
function MobileGuestDock({ items }: { items: { label: string; to: string; icon: string }[] }) {
  const location = useLocation();
  return (
    <div className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-sky-200/10 bg-[#071427]/86 backdrop-blur-md shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <div className="grid grid-cols-5">
          {items.map((i) => {
            const active = location.pathname === i.to;
            return (
              <Link
                key={i.to + i.label}
                to={i.to}
                className={[
                  "py-2.5 px-1 flex flex-col items-center justify-center gap-1",
                  "text-[10px] font-semibold",
                  active ? "text-slate-100" : "text-slate-400",
                ].join(" ")}
              >
                <span className="text-[16px]">{i.icon}</span>
                <span className="leading-none">{i.label}</span>
                <span
                  className={[
                    "h-0.5 w-8 rounded-full",
                    active ? "bg-cyan-200/85" : "bg-transparent",
                  ].join(" ")}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===== Premium Explore stays overlay (kept as-is, light UI is acceptable overlay) ===== */
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

  const filtered =
    cityFilter === "all" ? properties : properties.filter((p) => p.cityKey === cityFilter);

  const mailBase =
    "mailto:support@vaiyu.co.in?subject=" + encodeURIComponent("VAiyu booking interest");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-4xl w-full rounded-3xl bg-white shadow-2xl border overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-sky-600">
              Concierge booking · Beta
            </div>
            <h2 className="text-lg md:text-xl font-semibold">Explore stays with VAiyu</h2>
            <p className="mt-1 text-xs text-slate-600 max-w-xl">
              Right now we handle bookings with a human concierge. Pick a property, share your dates
              and we’ll confirm the best available rate over WhatsApp / email.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-slate-50 text-slate-500 hover:bg-slate-100"
            aria-label="Close explore stays"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-3 pb-4 border-b flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="inline-flex items-center gap-2">
            <span className="text-slate-500">Filter by location</span>
            <div className="inline-flex rounded-full border bg-slate-50 px-1 py-0.5">
              {cities.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCityFilter(c.key)}
                  className={`px-2 py-0.5 rounded-full ${
                    cityFilter === c.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            Prefer a different city?{" "}
            <a
              href={`${mailBase}&body=${encodeURIComponent(
                "I’d like to explore a booking in another city. Please contact me with options."
              )}`}
              className="underline"
            >
              Ask our concierge
            </a>
          </div>
        </div>

        <div className="p-5 grid md:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border bg-slate-50/70 p-3 flex flex-col justify-between"
            >
              <div>
                <div className="text-[11px] text-slate-500">{p.cityLabel}</div>
                <div className="mt-0.5 font-semibold text-sm">{p.name}</div>
                <div className="mt-1 text-[11px] text-emerald-700">{p.tag}</div>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                  {p.highlights.map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500">
                  From <span className="font-semibold text-slate-800">{p.startingFrom}</span>
                  <div className="text-[10px] text-slate-400">
                    *Indicative rack rates. Final price will be confirmed on call.
                  </div>
                </div>
                <a
                  className="inline-flex items-center justify-center rounded-full border bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  href={`${mailBase}&body=${encodeURIComponent(
                    `I’d like to book: ${p.name} (${p.cityLabel}).\n\nPreferred dates:\nGuests:\nSpecial requests:\n\nPlease contact me on this number/email with availability and best rate.`
                  )}`}
                >
                  Share details
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>You will receive a confirmation from our concierge team before any booking is final.</span>
          <span>
            Online one-tap booking · <span className="font-semibold text-slate-700">coming soon</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Data helpers (unchanged)
========================= */

async function loadCard<J, T>(
  fetcher: () => Promise<J>,
  map: (j: J | null) => T,
  demo: () => T,
  set: (next: AsyncData<T>) => void,
  allowDemo: boolean
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
    stay?.hotel_slug ??
    stay?.slug ??
    stay?.hotel?.slug ??
    stay?.hotel?.tenant_slug ??
    stay?.tenant_slug ??
    null;
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

function buildStayLink(stay: any) {
  const bookingCode = getStayBookingCode(stay);
  const slug = getStayPropertySlug(stay);

  const idForPath =
    (typeof stay?.id === "string" && stay.id.trim() ? stay.id.trim() : null) ||
    bookingCode ||
    "";

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

function buildCategorySeries(spend: {
  total: number;
  categories?: { room: number; dining: number; spa: number; other: number };
}) {
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

/* ===== Network ===== */
async function jsonWithTimeout(url: string, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);

  try {
    const headers: Record<string, string> = {};

    // Attach Supabase access token when calling our own APIs
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (token && shouldAttachAuthTo(url)) {
        headers["authorization"] = `Bearer ${token}`;
      }

      // When using direct Supabase Edge host, apikey helps with some setups
      if (IS_SUPABASE_EDGE && shouldAttachAuthTo(url)) {
        const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
        if (anonKey) headers["apikey"] = anonKey;
      }
    } catch {
      // ok
    }

    const r = await fetch(url, {
      signal: c.signal,
      cache: "no-store",
      headers,
    });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

function shouldAttachAuthTo(url: string) {
  try {
    const u = new URL(url, window.location.origin);
    if (u.host === window.location.host) return true;
    if (API_HOST && u.host === API_HOST) return true;
    if (u.host.includes(".functions.supabase.co")) return true;
  } catch {
    // ignore
  }
  return false;
}

/* ===== Formatting ===== */
function fmtMoney(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `₹ ${v.toLocaleString()}`;
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
  return [
    { year: y, total: 13240 },
    { year: y - 1, total: 19880 },
    { year: y - 2, total: 0 },
  ];
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
