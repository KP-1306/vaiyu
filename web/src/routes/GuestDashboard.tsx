// web/src/routes/GuestDashboard.tsx
import { useEffect, useMemo, useState, memo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";
import AccountControls from "../components/AccountControls";
import RewardsPill from "../components/guest/RewardsPill"; // quick rewards CTA

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

/* ======= TRAVEL COMMAND CENTER ======= */
export default function GuestDashboard() {
  const nav = useNavigate();
  const location = useLocation();

  const [searchTerm, setSearchTerm] = useState("");
  const [spendMode, setSpendMode] = useState<"this" | "last" | "all">("this");
  const [showExplore, setShowExplore] = useState(false); // ⬅️ new: Explore stays overlay

  // Quick auth guard
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        const redirect = encodeURIComponent("/guest");
        window.location.replace(
          `/signin?intent=signin&redirect=${redirect}`,
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  /* ===== Types ===== */
  type Stay = {
    id: string;
    hotel: {
      name: string;
      city?: string;
      cover_url?: string | null;
      country?: string | null;
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
    rating: number; // 1..5
    title?: string | null;
    created_at: string;
    hotel_reply?: string | null;
  };

  type Spend = {
    year: number;
    total: number;
    // Optional richer analytics if backend provides it later
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
    loadCard(
      () => jsonWithTimeout(`${API}/me/stays?limit=10`),
      (j: any) => (Array.isArray(j?.items) ? (j.items as Stay[]) : []),
      demoStays,
      setStays,
      USE_DEMO,
    );

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
  }, []);

  const who = displayName || authName || email || "Guest";
  const firstName = who.split(" ")[0];

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

  // Travel Stats (derived)
  const stats = useMemo(() => {
    const nights = stays.data.reduce(
      (n, s) => n + diffDays(s.check_in, s.check_out),
      0,
    );
    const totalSpend = spend.data.reduce(
      (a, s) => a + Number(s.total || 0),
      0,
    );
    const countsByHotel: Record<string, number> = {};
    const cities = new Set<string>();
    const countries = new Set<string>();
    stays.data.forEach((s) => {
      countsByHotel[s.hotel.name] = (countsByHotel[s.hotel.name] || 0) + 1;
      if (s.hotel.city) cities.add(s.hotel.city);
      if ((s.hotel as any).country) countries.add((s.hotel as any).country);
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
      countryCount: countries.size || (stays.data.length ? 1 : 0), // default 1 country if you prefer
    };
  }, [stays.data, spend.data, totalReferralCredits]);

  const avgSpendPerTrip =
    stats.totalStays > 0 ? stats.totalSpend / stats.totalStays : 0;
  const typicalLength =
    stats.totalStays > 0 ? stats.nights / stats.totalStays : 0;
  const mostBookedRoomType = getMostBookedRoomType(stays.data);

  const tierPoints = useMemo(() => {
    // Simple derivation: 10 pts per ₹100 spend + credits
    const fromSpend = stats.totalSpend / 100;
    return Math.round(fromSpend + totalReferralCredits);
  }, [stats.totalSpend, totalReferralCredits]);

  // Join helpers for referrals + reviews
  const reviewByHotel: Record<string, Review | undefined> = useMemo(() => {
    const map: Record<string, Review> = {};
    for (const r of reviews.data) {
      const key = r.hotel.name.toLowerCase();
      if (
        !map[key] ||
        new Date(r.created_at) > new Date(map[key].created_at)
      )
        map[key] = r;
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
        (a, b) =>
          new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
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

  // Spend analytics selection
  const currentYear = new Date().getFullYear();
  const spendByYearSorted = useMemo(
    () => spend.data.slice().sort((a, b) => a.year - b.year),
    [spend.data],
  );

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
    // "all" – show latest year as representative
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

  function onSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = searchTerm.trim();
    if (!q) return;
    nav(`/stays?query=${encodeURIComponent(q)}`);
  }

  const sidebarNav = [
    { label: "Dashboard", to: "/guest" },
    { label: "Trips", to: "/stays" },
    { label: "Rewards", to: "/rewards" },
    { label: "Reports & bills", to: "/bills" },
    { label: "Settings", to: "/profile" },
    { label: "Help", to: "/contact" },
  ];

  const initials = (displayName || authName || email || "G")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto flex gap-4 px-4 py-4">
        {/* Left sidebar – matches owner / finance feel */}
        <aside className="hidden lg:flex flex-col w-64 bg-white border rounded-3xl shadow-sm">
          <div className="px-4 py-5 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-700 grid place-items-center text-sm font-semibold">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {displayName || firstName || "Guest"}
                </div>
                {email && (
                  <div className="text-xs text-slate-500 truncate">{email}</div>
                )}
              </div>
            </div>
          </div>
          <nav className="flex-1 px-2 py-3 space-y-1 text-sm">
            {sidebarNav.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                    active
                      ? "bg-sky-50 text-sky-900 border border-sky-200 font-medium"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{item.label}</span>
                  {active && (
                    <span className="text-[10px] uppercase tracking-wide text-sky-600">
                      Now
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="px-4 py-3 border-t text-xs text-slate-500">
            Need help?{" "}
            <Link to="/contact" className="underline">
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

          {/* Hero band – Next stay + quick actions */}
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
                    <span className="text-slate-600">
                      {countdown.label}
                    </span>
                  )}
                </div>
                <h2 className="text-lg md:text-xl font-semibold">
                  {welcomeText}
                </h2>
                <p className="text-xs text-gray-600">
                  Your trips, spend and rewards in one place.
                </p>

                {nextStay ? (
                  <div className="mt-2 rounded-2xl bg-white/85 border shadow-sm p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500">Hotel</div>
                        <div className="font-semibold">
                          {nextStay.hotel.name}
                          {nextStay.hotel.city ? `, ${nextStay.hotel.city}` : ""}
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        Booking ID
                        <div className="font-mono text-[11px]">
                          {nextStay.booking_code || nextStay.id.slice(0, 8)}
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
                          {nextStay.room_type || mostBookedRoomType || "Standard room"}
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
                      <Link className="btn" to={`/stay/${nextStay.id}`}>
                        View stay details
                      </Link>
                      <Link
                        className="btn btn-light"
                        to="/scan"
                      >
                        Check-in guide
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl bg-white/70 border border-dashed p-4 text-sm text-slate-600">
                    No upcoming stays yet. Start your next journey with VAiyu —
                    explore curated partner hotels and request a booking with one tap.
                  </div>
                )}
              </div>

              {/* Right – quick actions + rewards pill */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">
                    Quick actions
                  </div>
                </div>
                <div className="space-y-2">
                  <RewardsPill />
                  <div className="grid sm:grid-cols-2 gap-2">
                    <QuickPill
                      title="Book a new stay"
                      text="Explore stays"
                      variant="solid"
                      onClick={() => setShowExplore(true)}
                    />
                    <QuickPill
                      title="Scan QR to check-in"
                      text="Scan & Go"
                      to="/scan"
                      variant="light"
                    />
                    <QuickPill
                      title="Find my booking"
                      text="Use booking code"
                      to="/claim"
                      variant="light"
                    />
                    <QuickPill
                      title="Rewards & vouchers"
                      text="View & redeem"
                      to="/rewards"
                      variant="light"
                    />
                    <QuickPill
                      title="Download invoices"
                      text="Bills & reports"
                      to="/bills"
                      variant="light"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* KPI strip – premium look */}
          <section className="grid md:grid-cols-5 gap-3">
            <StatBadge
              label="Total stays"
              value={String(stats.totalStays)}
              sublabel={
                stats.totalStays
                  ? `${stats.cityCount} cities · ${stats.countryCount} ${
                      stats.countryCount === 1 ? "country" : "countries"
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
              sublabel={`${totalReferralCredits ? "Active credits" : "Invite friends to earn"}`}
              emoji="🎁"
            />
            <StatBadge
              label="Most visited"
              value={stats.mostVisited}
              sublabel={stats.totalStays ? "Your comfort zone" : "—"}
              emoji="❤️"
            />
          </section>

          {/* Analytics + Recent trips / insights */}
          <section className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
            {/* Spend & rewards analytics */}
            <div className="rounded-2xl bg-white border shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <div className="text-xs text-slate-500">
                    Spend & Rewards Analytics
                  </div>
                  <div className="font-semibold text-sm">
                    {selectedYear
                      ? `Year ${selectedYear.year}`
                      : "Waiting for your first stay"}
                  </div>
                </div>
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
                      className={`px-2.5 py-0.5 rounded-full ${
                        spendMode === tab.key
                          ? "bg-white shadow-sm text-slate-900"
                          : "text-slate-500"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {spend.loading ? (
                <Skeleton lines={5} />
              ) : !selectedYear ? (
                <Empty small text="Once you complete a stay, we’ll start showing detailed spend and rewards analytics here." />
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Monthly spend – simple column chart */}
                  <div>
                    <div className="text-xs text-slate-500 mb-1">
                      Monthly spend (₹)
                    </div>
                    <MonthlyBars data={monthlySeries} />
                  </div>

                  {/* Category breakdown – stacked bars */}
                  <div>
                    <div className="text-xs text-slate-500 mb-1">
                      Spend by category
                    </div>
                    <CategoryBreakdown data={categorySeries} />
                  </div>
                </div>
              )}
            </div>

            {/* Recent trips & travel insights */}
            <div className="rounded-2xl bg-white border shadow-sm p-4 space-y-4">
              {/* Recent trips */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs text-slate-500">
                      Recent trips
                    </div>
                    <div className="font-semibold text-sm">
                      Last {Math.min(5, recentTrips.length)} stays
                    </div>
                  </div>
                  <Link className="btn btn-light" to="/stays">
                    View all
                  </Link>
                </div>
                {stays.loading ? (
                  <Skeleton lines={4} />
                ) : recentTrips.length ? (
                  <div className="space-y-2 text-xs">
                    {recentTrips.map((s) => {
                      const key = s.hotel.name.toLowerCase();
                      const rv = reviewByHotel[key];
                      const credits = creditsByHotel[key] || 0;
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
                              {diffDays(s.check_in, s.check_out) === 1
                                ? ""
                                : "s"}
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
                            to={`/stay/${s.id}`}
                            className="text-[11px] underline shrink-0"
                          >
                            Details
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty small text="No trips yet. Your recent journeys will appear here." />
                )}
              </div>

              {/* Travel insights */}
              <div>
                <div className="text-xs text-slate-500 mb-2">
                  Travel insights
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <InsightCard
                    label="Avg spend / trip"
                    value={fmtMoney(Math.round(avgSpendPerTrip || 0))}
                    hint={
                      stats.totalStays
                        ? `${stats.totalStays} trip${
                            stats.totalStays === 1 ? "" : "s"
                          } so far`
                        : "Will appear after your first stay"
                    }
                  />
                  <InsightCard
                    label="Typical length"
                    value={
                      typicalLength
                        ? `${typicalLength.toFixed(1)} nights`
                        : "—"
                    }
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
              </div>
            </div>
          </section>

          {/* Journey timeline + export */}
          <section className="rounded-2xl p-4 shadow bg-white border">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-xs text-gray-500">
                  Journey timeline
                </div>
                <h2 className="font-semibold text-sm md:text-base">
                  My journey — last 10 stays
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-light"
                  onClick={() => window.print()}
                >
                  Export as PDF
                </button>
                <Link className="btn btn-light" to="/bills">
                  Open annual report
                </Link>
              </div>
            </div>

            {stays.loading ? (
              <Skeleton lines={6} />
            ) : stays.data.length ? (
              <ol className="relative border-s border-slate-200 pl-4 space-y-4">
                {stays.data.slice(0, 10).map((s, idx) => {
                  const key = s.hotel.name.toLowerCase();
                  const rv = reviewByHotel[key];
                  const credits = creditsByHotel[key] || 0;
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
                              {diffDays(s.check_in, s.check_out) === 1
                                ? ""
                                : "s"}{" "}
                              · {fmtRange(s.check_in, s.check_out)}
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
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100">
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
                  Register your hotel to unlock the owner console: dashboards,
                  SLAs, workflows and AI moderation.
                </div>
              </div>
              <Link className="btn" to="/owner/register">
                Register your property
              </Link>
            </div>
          </section>
        </div>
      </div>

      {/* Premium Explore stays overlay for “Book a new stay” */}
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
  set: (next: any) => void,
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

function getMostBookedRoomType(stays: any[]): string | null {
  const counts: Record<string, number> = {};
  stays.forEach((s) => {
    const rt = s.room_type as string | null;
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
  // Fallback: simple even split across 12 months
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
  // Fallback heuristic split
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
  if (!data.length) return <Empty small text="We’ll break down your categories here after your first stay." />;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden flex">
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className="h-full"
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="space-y-1 text-[11px]">
        {data.map((seg) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className="flex items-center justify-between"
            >
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
      <div className="mb-2 flex items-center justify_between">
        <div className="flex items-center gap-2">
          {icon ? <div className="text-gray-600">{icon}</div> : null}
          <div>
            <div className="text-xs text-gray-500">{subtitle || ""}</div>
            <div className="font-semibold">{title}</div>
          </div>
        </div>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border text-gray-700">
            {badge}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
});

function QuickPill({
  title,
  text,
  to,
  onClick,
  variant = "solid",
}: {
  title: string;
  text: string;
  to?: string;
  onClick?: () => void;
  variant?: "solid" | "light";
}) {
  const baseClasses = `rounded-xl border px-3 py-3 flex flex-col justify-between text-xs ${
    variant === "solid" ? "bg-white shadow-sm" : "bg-white/80"
  }`;

  if (to && !onClick) {
    return (
      <Link to={to} className={baseClasses}>
        <div className="text-[11px] text-gray-500">{text}</div>
        <div className="font-semibold mt-0.5 text-slate-900 flex items-center justify-between gap-2">
          <span>{title}</span>
          <span className="text-gray-500">→</span>
        </div>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClasses} text-left w-full`}
    >
      <div className="text-[11px] text-gray-500">{text}</div>
      <div className="font-semibold mt-0.5 text-slate-900 flex items-center justify-between gap-2">
        <span>{title}</span>
        <span className="text-gray-500">→</span>
      </div>
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
    <div className="rounded-xl border bg-white shadow-sm p-3 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg">{emoji}</div>
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
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

function ReviewCard({ review }: { review: Review }) {
  const vibe =
    review.rating >= 5
      ? "🎉"
      : review.rating >= 4
      ? "😊"
      : review.rating >= 3
      ? "🙂"
      : review.rating >= 2
      ? "😐"
      : "😞";
  return (
    <div className="rounded-xl border p-3 bg-gradient-to-b from-white to-gray-50">
      <div className="flex items-center justify-between">
        <div className="font-medium truncate mr-2">{review.hotel.name}</div>
        <div className="text-xs">
          {stars(review.rating)} <span className="ml-1">{vibe}</span>
        </div>
      </div>
      {review.title ? (
        <div className="text-sm text-gray-700 mt-1">“{review.title}”</div>
      ) : null}
      <div className="text-xs text-gray-500 mt-2">
        {fmtDate(review.created_at)}
      </div>
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
              Right now we handle bookings with a human concierge. Pick a
              property, share your dates and we’ll confirm the best available
              rate over WhatsApp / email. Instant online booking is coming soon.
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
                    cityFilter === c.key
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
                <div className="mt-0.5 font-semibold text-sm">
                  {p.name}
                </div>
                <div className="mt-1 text-[11px] text-emerald-700">
                  {p.tag}
                </div>
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
                  className="btn btn-light text-[11px] whitespace-nowrap"
                  href={`${mailBase}&body=${encodeURIComponent(
                    `I’d like to book: ${p.name} (${p.cityLabel}).\n\nPreferred dates:\nGuests:\nSpecial requests:\n\nPlease contact me on this number/email with availability and best rate.`,
                  )}`}
                >
                  Share details to book
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t bg-slate-50 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>
            You will receive a confirmation from our concierge team before any booking is final.
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

/* ===== Icons (kept for compatibility if needed) ===== */
function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      {...props}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function SuitcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      {...props}
    >
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <rect x="8" y="3" width="8" height="4" rx="1" />
    </svg>
  );
}
function RupeeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      {...props}
    >
      <text x="5" y="17" fontSize="14" fontFamily="system-ui">
        ₹
      </text>
      <line x1="9" y1="8" x2="18" y2="8" />
    </svg>
  );
}
function GiftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      {...props}
    >
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

/* ===== Copy referral link (unchanged) ===== */
function copyReferral(hotelName: string) {
  const base = location.origin;
  const url = `${base}/refer?hotel=${encodeURIComponent(hotelName)}`;
  navigator.clipboard?.writeText(url);
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
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  const ONE = 24 * 60 * 60 * 1000;
  if (!isFinite(A) || !isFinite(B)) return 0;
  return Math.max(0, Math.round((B - A) / ONE));
}

/* ===== Demo fallbacks (used only if USE_DEMO is true) ===== */
function demoStays(): any[] {
  return [
    {
      id: "s1",
      hotel: {
        name: "Sunrise Suites",
        city: "Nainital",
        cover_url:
          "https://images.unsplash.com/photo-1559599101-b59c1b3bcd9b?w=640",
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
        cover_url:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=640",
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
        cover_url:
          "https://images.unsplash.com/photo-1496412705862-e0088f16f791?w=640",
      },
      check_in: "2025-04-01T12:00:00Z",
      check_out: "2025-04-03T08:00:00Z",
      bill_total: 3999,
    },
    {
      id: "s4",
      hotel: {
        name: "Cedar Ridge",
        city: "Ranikhet",
        cover_url: null,
      },
      check_in: "2025-03-01T12:00:00Z",
      check_out: "2025-03-02T08:00:00Z",
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
      hotel_reply: "Thank you Kapil! We loved hosting you.",
    },
    {
      id: "r2",
      hotel: { name: "Lakeside Inn" },
      rating: 4,
      title: "Beautiful view",
      created_at: "2025-06-07T09:00:00Z",
      hotel_reply: null,
    },
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
    {
      id: "rf1",
      hotel: { name: "Sunrise Suites", city: "Nainital" },
      credits: 1200,
      referrals_count: 3,
    },
    {
      id: "rf2",
      hotel: { name: "Lakeside Inn", city: "Nainital" },
      credits: 800,
      referrals_count: 2,
    },
  ];
}

/* ===== Simple empty state ===== */
function Empty({ text, small }: { text: string; small?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-dashed ${
        small ? "p-3 text-xs" : "p-6 text-sm"
      } text-gray-600 bg-gray-50`}
    >
      {text}
    </div>
  );
}
