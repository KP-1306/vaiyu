import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
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

/* ======= TRAVEL COMMAND CENTER (Premium) ======= */
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
        const j: any = await jsonWithTimeout(
          `${API}${STAYS_ENDPOINT}?limit=10`,
        );
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
        console.error(
          "[GuestDashboard] fallback user_recent_stays failed",
          err,
        );
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
      return `Welcome back, ${firstName}! Hope you enjoyed ${lastStay.hotel.name}${city}.`;
    }
    return `Welcome back, ${firstName} 👋`;
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
      const amount =
        typeof s.bill_total === "number" ? Number(s.bill_total) : 0;
      if (!amount) return;
      const dt = new Date(s.check_in);
      if (!isFinite(dt.getTime())) return;
      const year = dt.getFullYear();
      const month = dt.getMonth() + 1; // 1-12

      if (!byYear[year]) {
        byYear[year] = { total: 0, byMonth: {} };
      }
      byYear[year].total += amount;
      byYear[year].byMonth[month] =
        (byYear[year].byMonth[month] || 0) + amount;
    });

    return Object.entries(byYear)
      .map(([yearStr, info]) => {
        const year = Number(yearStr);
        const monthly = Object.entries(info.byMonth)
          .map(([m, total]) => ({
            month: Number(m),
            total: Number(total),
          }))
          .sort((a, b) => a.month - b.month);
        return { year, total: info.total, monthly } as Spend;
      })
      .sort((a, b) => a.year - b.year);
  }, [stays.data]);

  // Travel Stats (derived)
  const stats = useMemo(() => {
    const nights = stays.data.reduce(
      (n, s) => n + diffDays(s.check_in, s.check_out),
      0,
    );

    const spendSeries =
      spend.data && spend.data.length ? spend.data : derivedSpendFromStays;

    const totalSpend = spendSeries.reduce(
      (a, s) => a + Number(s.total || 0),
      0,
    );

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
      Object.entries(countsByHotel).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "—";
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

  const avgSpendPerTrip =
    stats.totalStays > 0 ? stats.totalSpend / stats.totalStays : 0;
  const typicalLength =
    stats.totalStays > 0 ? stats.nights / stats.totalStays : 0;
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
      .sort(
        (a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
      );
    return upcoming[0] || stays.data[0];
  }, [stays.data]);

  const countdown = useMemo(
    () => (nextStay ? getCountdown(nextStay.check_in) : null),
    [nextStay?.check_in],
  );
  const nextStayNights = nextStay
    ? diffDays(nextStay.check_in, nextStay.check_out)
    : 0;

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
    const source =
      spend.data && spend.data.length ? spend.data : derivedSpendFromStays;
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

  const monthlySeries = useMemo(
    () => (selectedYear ? buildMonthlySeries(selectedYear) : []),
    [selectedYear],
  );
  const categorySeries = useMemo(
    () => (selectedYear ? buildCategorySeries(selectedYear) : []),
    [selectedYear],
  );

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
    { label: "Quick actions", to: "/guest", icon: "⚡" },
    { label: "Rewards & Vouchers", to: "/rewards", icon: "🎁" },
    { label: "Recent Trips", to: "/stays", icon: "🧳" },
    { label: "Travel Insights", to: "/stays", icon: "📈" },
    { label: "Express Check Out", to: expressCheckoutUrl, icon: "✅" },
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
    <main className="min-h-screen bg-slate-50">
      {/* Layout wrapper */}
      <div className="max-w-7xl mx-auto flex gap-4 px-4 py-4 pb-24 lg:pb-4">
        {/* Left sidebar (desktop only) */}
        <aside className="hidden lg:flex flex-col w-64 rounded-3xl overflow-hidden border bg-slate-950 shadow-sm">
          {/* User header */}
          <div className="px-4 py-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 border border-white/10 grid place-items-center text-xs font-semibold text-white">
                {initials || "G"}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate text-white">
                  {displayName || firstName || "Guest"}
                </div>
                {email && (
                  <div className="text-xs text-slate-300 truncate">{email}</div>
                )}
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="px-3 py-3 space-y-1">
            {sidebarNav.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to + item.label}
                  to={item.to}
                  className={[
                    "group flex items-center gap-2 rounded-xl px-3 py-2",
                    "text-[12px] transition",
                    active
                      ? "bg-white text-slate-950 font-semibold shadow-sm"
                      : "text-slate-200 hover:bg-white/10",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-sm w-5 grid place-items-center",
                      active ? "opacity-100" : "opacity-80 group-hover:opacity-100",
                    ].join(" ")}
                  >
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {active && (
                    <span className="text-[9px] uppercase tracking-wide text-slate-600">
                      Now
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Footer help */}
          <div className="mt-auto px-4 py-3 border-t border-white/10 text-xs text-slate-300">
            Need help?{" "}
            <Link to="/contact" className="underline text-white">
              Contact support
            </Link>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 space-y-5">
          {/* Top bar */}
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Travel Command Center
              </div>
              <h1 className="text-xl md:text-2xl font-semibold">
                Guest Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <form
                onSubmit={onSearchSubmit}
                className="hidden md:flex items-center bg-white border rounded-full px-3 py-1.5 shadow-sm max-w-xs"
              >
                <input
                  className="bg-transparent text-xs outline-none flex-1"
                  placeholder="Search booking, city or hotel"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button
                  type="submit"
                  className="text-[11px] font-medium text-sky-700"
                >
                  Go
                </button>
              </form>

              <div className="rounded-full bg-gradient-to-r from-amber-100 to-orange-100 px-4 py-1.5 text-xs md:text-sm font-medium text-amber-900 shadow-sm">
                Platinum · {tierPoints.toLocaleString()} pts
              </div>

              <div className="ml-1">
                <AccountControls />
              </div>
            </div>
          </header>

          {/* Hero band – Next stay + analytics + quick actions */}
          <section className="relative rounded-2xl p-5 bg-gradient-to-r from-sky-50 via-white to-indigo-50 border shadow-sm overflow-hidden">
            <Bubbles />
            <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6 relative">
              {/* Left – next stay */}
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-full bg-white/80 px-2 py-0.5 border text-sky-700">
                    Next stay
                  </span>
                  {countdown && (
                    <span className="text-slate-600">{countdown.label}</span>
                  )}
                </div>

                <h2 className="text-lg md:text-xl font-semibold">
                  {welcomeText}
                </h2>
                <p className="text-xs text-gray-600">
                  Your trips, spend and rewards in one place.
                </p>

                {nextStay ? (
                  <div className="mt-2 rounded-2xl bg-white/90 border shadow-sm p-4 space-y-2">
                    {/* Top row with status chip */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500">Hotel</div>
                        <div className="font-semibold">
                          {nextStay.hotel.name}
                          {nextStay.hotel.city ? `, ${nextStay.hotel.city}` : ""}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <StayStateChip state={stayState} />
                        <div className="text-right text-[10px] text-slate-500">
                          Booking ID
                          <div className="font-mono text-[11px]">
                            {getStayBookingCode(nextStay) ||
                              (nextStay.id ? nextStay.id.slice(0, 8) : "—")}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs mt-2">
                      <div>
                        <div className="text-slate-500">Dates</div>
                        <div className="font-medium">
                          {fmtRange(nextStay.check_in, nextStay.check_out)} ·{" "}
                          {nextStayNights || 1} night
                          {nextStayNights === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Room type</div>
                        <div className="font-medium">
                          {nextStay.room_type ||
                            mostBookedRoomType ||
                            "Standard room"}
                        </div>
                      </div>
                      {typeof nextStay.bill_total === "number" && (
                        <div>
                          <div className="text-slate-500">Estimated bill</div>
                          <div className="font-medium">
                            {fmtMoney(Number(nextStay.bill_total))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <GuestButton to={buildStayLink(nextStay)} variant="primary">
                        View stay details
                      </GuestButton>

                      <GuestButton to={expressCheckoutUrl} variant="soft">
                        Express checkout
                      </GuestButton>

                      <GuestButton to="/scan" variant="ghost">
                        Check-in guide
                      </GuestButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl bg-white/70 border border-dashed p-4 text-sm text-slate-600">
                    No upcoming stays yet. Start your next journey with VAiyu —
                    explore curated partner hotels and request a booking with one
                    tap.
                  </div>
                )}
              </div>

              {/* Right – spend analytics + quick actions + rewards pill */}
              <div className="space-y-3">
                {/* Spend & Rewards Analytics panel */}
                <section className="rounded-2xl bg-white border shadow-sm p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        Spend &amp; Rewards Analytics
                      </div>
                      <div className="font-semibold text-sm">
                        {selectedYear
                          ? `Year ${selectedYear.year}`
                          : "Your travel analytics"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="inline-flex rounded-full bg-slate-50 border px-1 py-0.5 text-[11px]">
                        {[
                          { key: "this", label: "This year" },
                          { key: "last", label: "Last year" },
                          { key: "all", label: "All time" },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() =>
                              setSpendMode(tab.key as "this" | "last" | "all")
                            }
                            className={`px-2.5 py-0.5 rounded-full ${spendMode === tab.key
                                ? "bg-white shadow-sm text-slate-900"
                                : "text-slate-500"
                              }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <Link
                        to="/rewards"
                        className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        🎁 View rewards
                      </Link>
                    </div>
                  </div>

                  {spend.loading ? (
                    <Skeleton lines={4} />
                  ) : !selectedYear ? (
                    <Empty
                      small
                      text="Complete your first stay to unlock monthly spend trends and category breakdowns."
                    />
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">
                          Monthly spend (₹)
                        </div>
                        <MonthlyBars data={monthlySeries} />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">
                          Spend by category
                        </div>
                        <CategoryBreakdown data={categorySeries} />
                      </div>
                    </div>
                  )}
                </section>

                {/* Service Request Console + quick actions */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">
                      Service Request Console
                    </div>
                  </div>

                  <div className="space-y-2">
                    <RewardsPill />

                    <div className="grid sm:grid-cols-2 gap-2">
                      <QuickPill
                        title="Book a new stay"
                        text="Explore stays"
                        variant="solid"
                        icon="🏨"
                        onClick={() => setShowExplore(true)}
                      />
                      <QuickPill
                        title={jobsUrl ? "Jobs at this hotel" : "Work in hotels"}
                        text={
                          jobsUrl ? "Apply for openings" : "Build my staff profile"
                        }
                        to={jobsUrl || "/workforce/profile"}
                        variant="light"
                        icon="🧑‍🍳"
                      />
                      <QuickPill
                        title="Scan QR to check-in"
                        text="Scan & Go"
                        to="/scan"
                        variant="light"
                        icon="📷"
                      />
                      <QuickPill
                        title="Find my booking"
                        text="Use booking code"
                        to="/claim"
                        variant="light"
                        icon="🔎"
                      />
                      <QuickPill
                        title="Rewards & vouchers"
                        text="View & redeem"
                        to="/rewards"
                        variant="light"
                        icon="🎁"
                      />
                      <QuickPill
                        title="Download invoices"
                        text="Bills & reports"
                        to="/bills"
                        variant="light"
                        icon="🧾"
                      />
                      <QuickPill
                        title="Express check-out"
                        text="Finish in seconds"
                        to={expressCheckoutUrl}
                        variant="light"
                        icon="✅"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* KPI strip */}
          <section className="grid md:grid-cols-5 gap-3">
            <StatBadge
              label="Total stays"
              value={String(stats.totalStays)}
              sublabel={
                stats.totalStays
                  ? `${stats.cityCount} cities · ${stats.countryCount} ${stats.countryCount === 1 ? "country" : "countries"
                  }`
                  : "Your first trip awaits"
              }
              emoji="🧳"
            />
            <StatBadge
              label="Nights at VAiyu"
              value={String(stats.nights)}
              sublabel={stats.nights ? "Across all your trips" : "No stays yet"}
              emoji="📅"
            />
            <StatBadge
              label="Lifetime spend"
              value={fmtMoney(stats.totalSpend)}
              sublabel={
                stats.totalStays
                  ? `Avg ${fmtMoney(Math.round(avgSpendPerTrip))} / trip`
                  : "Start earning travel history"
              }
              emoji="💸"
            />
            <StatBadge
              label="Rewards balance"
              value={fmtMoney(stats.totalCredits)}
              sublabel={`${totalReferralCredits ? "Active credits" : "Invite friends to earn"
                }`}
              emoji="🎁"
            />
            <StatBadge
              label="Most visited"
              value={stats.mostVisited}
              sublabel={stats.totalStays ? "Your comfort zone" : "—"}
              emoji="❤️"
            />
          </section>

          {/* Recent trips & travel insights */}
          <section className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
            {/* Recent trips */}
            <div className="rounded-2xl bg-white border shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-slate-500">Recent trips</div>
                  <div className="font-semibold text-sm">
                    Last {Math.min(5, recentTrips.length)} stays
                  </div>
                </div>

                <Link
                  to="/stays"
                  className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span className="text-xs">🧳</span>
                  View all trips
                </Link>
              </div>

              {stays.loading ? (
                <Skeleton lines={4} />
              ) : recentTrips.length ? (
                <div className="space-y-2 text-xs">
                  {recentTrips.map((s) => {
                    const key = (s?.hotel?.name || "").toLowerCase();
                    const rv = key ? reviewByHotel[key] : undefined;
                    const credits = key ? creditsByHotel[key] || 0 : 0;

                    return (
                      <div
                        key={s.id}
                        className="rounded-xl border bg-slate-50/60 px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {s.hotel.name}
                            {s.hotel.city ? `, ${s.hotel.city}` : ""}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {fmtRange(s.check_in, s.check_out)} ·{" "}
                            {diffDays(s.check_in, s.check_out) || 1} night
                            {diffDays(s.check_in, s.check_out) === 1 ? "" : "s"}
                          </div>

                          <div className="mt-1 flex flex-wrap gap-2 items-center">
                            {typeof s.bill_total === "number" && (
                              <span className="text-[11px] text-slate-700">
                                {fmtMoney(Number(s.bill_total))}
                              </span>
                            )}
                            {rv && (
                              <span className="text-[11px] text-amber-700">
                                {stars(rv.rating)}
                              </span>
                            )}
                            {credits > 0 && (
                              <span className="text-[11px] text-emerald-700">
                                Credits: {fmtMoney(credits)}
                              </span>
                            )}
                          </div>
                        </div>

                        <Link
                          to={buildStayLink(s)}
                          className="text-[11px] underline shrink-0"
                        >
                          Details
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty
                  small
                  text="No trips yet. Your recent journeys will appear here."
                />
              )}
            </div>

            {/* Travel insights */}
            <div className="rounded-2xl bg-white border shadow-sm p-4 space-y-3">
              <div className="text-xs text-slate-500">Travel insights</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <InsightCard
                  label="Avg spend / trip"
                  value={fmtMoney(Math.round(avgSpendPerTrip || 0))}
                  hint={
                    stats.totalStays
                      ? `${stats.totalStays} trip${stats.totalStays === 1 ? "" : "s"
                      } so far`
                      : "Will appear after your first stay"
                  }
                />
                <InsightCard
                  label="Typical length"
                  value={typicalLength ? `${typicalLength.toFixed(1)} nights` : "—"}
                  hint={
                    stats.totalStays
                      ? "Average across all stays"
                      : "Book a stay to get insights"
                  }
                />
                <InsightCard
                  label="Most booked room"
                  value={mostBookedRoomType || "—"}
                  hint="Based on your history"
                />
              </div>

              <div className="rounded-xl border bg-slate-50/70 px-3 py-3 text-[11px] text-slate-600">
                Your rewards are property-scoped. Express checkout will auto-carry
                your booking + property context when available.
              </div>
            </div>
          </section>

          {/* Journey timeline */}
          <section className="rounded-2xl p-4 shadow bg-white border">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-xs text-gray-500">Journey timeline</div>
                <h2 className="font-semibold text-sm md:text-base">
                  My journey — last 10 stays
                </h2>
              </div>
            </div>

            {stays.loading ? (
              <Skeleton lines={6} />
            ) : stays.data.length ? (
              <ol className="relative border-s border-slate-200 pl-4 space-y-4">
                {stays.data.slice(0, 10).map((s, idx) => {
                  const key = (s?.hotel?.name || "").toLowerCase();
                  const rv = key ? reviewByHotel[key] : undefined;
                  const credits = key ? creditsByHotel[key] || 0 : 0;

                  return (
                    <li key={s.id} className="relative">
                      <span className="absolute -left-2.5 mt-1 w-3 h-3 rounded-full bg-sky-500 border-2 border-white shadow" />
                      <div className="rounded-xl border bg-gradient-to-r from-white to-slate-50 p-3">
                        <div className="flex flex-wrap justify-between gap-2">
                          <div>
                            <div className="text-xs text-slate-500">
                              {fmtDate(s.check_in)}
                            </div>
                            <div className="font-medium text-sm">
                              {s.hotel.city
                                ? `${s.hotel.city} · ${s.hotel.name}`
                                : s.hotel.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {diffDays(s.check_in, s.check_out) || 1} night
                              {diffDays(s.check_in, s.check_out) === 1 ? "" : "s"} ·{" "}
                              {fmtRange(s.check_in, s.check_out)}
                            </div>
                          </div>
                          <div className="text-right text-[11px] space-y-1">
                            {typeof s.bill_total === "number" && (
                              <div className="font-medium">
                                {fmtMoney(Number(s.bill_total))}
                              </div>
                            )}
                            {rv && (
                              <div className="text-amber-700">
                                {stars(rv.rating)}
                              </div>
                            )}
                            {credits > 0 && (
                              <div className="text-emerald-700">
                                Credits: {fmtMoney(credits)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-100">
                            Journey #{stays.data.length - idx}
                          </span>
                          {rv?.title && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 border-amber-100">
                              “{rv.title}”
                            </span>
                          )}
                          {credits > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
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
              <Empty text="No stays yet — your travel story starts here!" />
            )}
          </section>

          {/* Owner CTA – unchanged */}
          <section className="rounded-2xl p-4 shadow bg-white border">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Want to run a property?</div>
                <div className="text-sm text-gray-600">
                  Register your hotel to unlock the owner console: dashboards, SLAs,
                  workflows and AI moderation.
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
      <ExploreStaysQuickAction
        open={showExplore}
        onClose={() => setShowExplore(false)}
      />
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

  const bookingCode =
    row.booking_code ?? row.code ?? row.bookingCode ?? row.id ?? null;
  const hotelName =
    row.hotel_name ?? row.hotel?.name ?? row.name ?? "Unknown hotel";
  const city = row.city ?? row.hotel_city ?? row.hotel?.city ?? undefined;
  const country =
    row.country ?? row.hotel_country ?? row.hotel?.country ?? undefined;
  const coverUrl =
    row.cover_url ??
    row.cover_image_url ??
    row.hotel_cover_url ??
    row.hotel?.cover_url ??
    null;

  const slug =
    row.hotel_slug ?? row.slug ?? row.hotel?.slug ?? row.hotel?.tenant_slug ?? null;

  const checkIn =
    row.check_in ?? row.checkIn ?? row.start_at ?? row.startAt ?? "";
  const checkOut =
    row.check_out ?? row.checkOut ?? row.end_at ?? row.endAt ?? "";

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
  const c =
    stay.booking_code ??
    stay.code ??
    stay.bookingCode ??
    stay.id ??
    null;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

function getStayHotelId(stay: any): string | null {
  const h =
    stay?.hotel_id ??
    stay?.hotelId ??
    stay?.hotel?.id ??
    null;
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

/**
 * Build stay detail link with robust booking-code carry-forward.
 */
function buildStayLink(stay: any) {
  const bookingCode = getStayBookingCode(stay);
  const slug = getStayPropertySlug(stay);

  const idForPath =
    (typeof stay?.id === "string" && stay.id.trim() ? stay.id.trim() : null) ||
    bookingCode ||
    "";

  const base = `/stay/${encodeURIComponent(idForPath)}`;

  const params = new URLSearchParams();
  // Don't add hotelId - Stay page will derive it from stay code

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
function buildMonthlySeries(spend: {
  total: number;
  monthly?: { month: number; total: number }[];
}) {
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

/* ===== Simple visualization components ===== */

function MonthlyBars({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <Empty small text="No data yet for this year." />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="h-24 flex items-end gap-1 rounded-xl bg-slate-50 border px-2 py-2">
      {data.map((m) => {
        const h = Math.max(4, Math.round((m.value / max) * 64));
        return (
          <div key={m.label} className="flex flex-col items-center flex-1">
            <div
              className="w-2 rounded-full bg-indigo-200"
              style={{ height: h }}
              title={`${m.label}: ${fmtMoney(Math.round(m.value))}`}
            />
            <div className="mt-1 text-[9px] text-slate-500">{m.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryBreakdown({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  if (!data.length)
    return (
      <Empty
        small
        text="We’ll break down your categories here after your first stay."
      />
    );
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden flex">
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className="h-full bg-slate-300"
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="space-y-1 text-[11px]">
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div key={seg.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span>{seg.label}</span>
              </div>
              <span className="font-medium">
                {pct.toFixed(1)}% · {fmtMoney(Math.round(seg.value))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Reusable UI ===== */

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
  variant?: "primary" | "soft" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-[11px] font-semibold transition border";
  const styles =
    variant === "primary"
      ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
      : variant === "soft"
        ? "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
        : "bg-transparent text-slate-700 border-transparent hover:bg-slate-100";

  if (to && !onClick) {
    return (
      <Link to={to} className={`${base} ${styles} ${className}`}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function QuickPill({
  title,
  text,
  to,
  onClick,
  variant = "solid",
  icon,
}: {
  title: string;
  text: string;
  to?: string;
  onClick?: () => void;
  variant?: "solid" | "light";
  icon?: string;
}) {
  const baseClasses = [
    "rounded-xl border px-3 py-3 flex flex-col justify-between text-xs",
    "min-h-[76px]",
    variant === "solid"
      ? "bg-white shadow-sm hover:shadow transition"
      : "bg-white/80 hover:bg-white shadow-sm transition",
  ].join(" ");

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">{text}</div>
        {icon ? <span className="text-sm">{icon}</span> : null}
      </div>
      <div className="font-semibold mt-0.5 text-slate-900 flex items-center justify-between gap-2">
        <span>{title}</span>
        <span className="text-gray-400">→</span>
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
    <button
      type="button"
      onClick={onClick}
      className={`${baseClasses} text-left w-full`}
    >
      {inner}
    </button>
  );
}

function StatBadge({
  label,
  value,
  sublabel,
  emoji,
}: {
  label: string;
  value: string;
  sublabel?: string;
  emoji: string;
}) {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-white to-slate-50 shadow-sm p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg">{emoji}</div>
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {sublabel && (
        <div className="mt-1 text-[11px] text-slate-500 leading-snug">
          {sublabel}
        </div>
      )}
    </div>
  );
}

function InsightCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-50/70 px-3 py-2 flex flex-col justify-between">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">
          {hint}
        </div>
      )}
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

/* ===== Stay State Chip (status dot + label) ===== */

type StayState = "upcoming" | "ongoing" | "completed" | "claimed" | "unknown";

function getStayState(stay?: Stay): StayState {
  if (!stay) return "unknown";

  const raw = String(stay.status ?? "").toLowerCase().trim();
  const now = Date.now();
  const ci = new Date(stay.check_in).getTime();
  const co = new Date(stay.check_out).getTime();

  if (raw.includes("complete") || raw.includes("checked_out")) return "completed";
  if (
    raw.includes("ongoing") ||
    raw.includes("inhouse") ||
    raw.includes("checked_in")
  )
    return "ongoing";
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
      dot: "bg-sky-500",
      bg: "bg-sky-50",
      text: "text-sky-700",
      border: "border-sky-200",
    },
    ongoing: {
      label: "Ongoing",
      dot: "bg-amber-500",
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
    },
    completed: {
      label: "Completed",
      dot: "bg-emerald-500",
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
    },
    claimed: {
      label: "Claimed",
      dot: "bg-indigo-500",
      bg: "bg-indigo-50",
      text: "text-indigo-800",
      border: "border-indigo-200",
    },
    unknown: {
      label: "Trip",
      dot: "bg-slate-400",
      bg: "bg-slate-50",
      text: "text-slate-700",
      border: "border-slate-200",
    },
  };

  const c = cfg[state];

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[9px] font-semibold uppercase tracking-wide",
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
function MobileGuestDock({
  items,
}: {
  items: { label: string; to: string; icon: string }[];
}) {
  const location = useLocation();
  return (
    <div className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl border bg-white shadow-lg">
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
                  active ? "text-slate-950" : "text-slate-500",
                ].join(" ")}
              >
                <span className="text-base">{i.icon}</span>
                <span className="leading-none">{i.label}</span>
                <span
                  className={[
                    "h-0.5 w-6 rounded-full",
                    active ? "bg-slate-900" : "bg-transparent",
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

/* ===== Premium Explore stays overlay ===== */
function ExploreStaysQuickAction({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
      highlights: [
        "Lake-facing rooms",
        "Breakfast included",
        "Early check-in on request",
      ],
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
    cityFilter === "all"
      ? properties
      : properties.filter((p) => p.cityKey === cityFilter);

  const mailBase =
    "mailto:support@vaiyu.co.in?subject=" +
    encodeURIComponent("VAiyu booking interest");

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
            <h2 className="text-lg md:text-xl font-semibold">
              Explore stays with VAiyu
            </h2>
            <p className="mt-1 text-xs text-slate-600 max-w-xl">
              Right now we handle bookings with a human concierge. Pick a property,
              share your dates and we’ll confirm the best available rate over
              WhatsApp / email. Instant online booking is coming soon.
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
                  className={`px-2 py-0.5 rounded-full ${cityFilter === c.key
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500"
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
                "I’d like to explore a booking in another city. Please contact me with options.",
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
                  From{" "}
                  <span className="font-semibold text-slate-800">
                    {p.startingFrom}
                  </span>
                  <div className="text-[10px] text-slate-400">
                    *Indicative rack rates. Final price will be confirmed on call.
                  </div>
                </div>
                <a
                  className="inline-flex items-center justify-center rounded-full border bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  href={`${mailBase}&body=${encodeURIComponent(
                    `I’d like to book: ${p.name} (${p.cityLabel}).\n\nPreferred dates:\nGuests:\nSpecial requests:\n\nPlease contact me on this number/email with availability and best rate.`,
                  )}`}
                >
                  Share details
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>
            You will receive a confirmation from our concierge team before any
            booking is final.
          </span>
          <span>
            Online one-tap booking ·{" "}
            <span className="font-semibold text-slate-700">coming soon</span>
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

      if (token && shouldAttachAuthTo(url)) {
        headers["authorization"] = `Bearer ${token}`;
      }

      // When using direct Supabase Edge host, apikey helps with some setups
      if (IS_SUPABASE_EDGE && shouldAttachAuthTo(url)) {
        const anonKey =
          (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as
          | string
          | undefined;
        if (anonKey) {
          headers["apikey"] = anonKey;
        }
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

    // Same-origin proxy (/api/*) should receive auth
    if (u.host === window.location.host) return true;

    // Explicit API host should receive auth
    if (API_HOST && u.host === API_HOST) return true;

    // Fallback heuristic for Supabase Functions host
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
function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-gray-100 animate-pulse" />
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
        cover_url:
          "https://images.unsplash.com/photo-1559599101-b59c1b3bcd9b?w=640",
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
        cover_url:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=640",
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
        cover_url:
          "https://images.unsplash.com/photo-1496412705862-e0088f16f791?w=640",
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

/* ===== Simple empty state ===== */
function Empty({ text, small }: { text: string; small?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-dashed ${small ? "p-3 text-xs" : "p-6 text-sm"
        } text-gray-600 bg-gray-50`}
    >
      {text}
    </div>
  );
}
