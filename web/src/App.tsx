import { useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";

import SEO from "./components/SEO";
import HeroCarousel from "./components/HeroCarousel";
import { supabase } from "./lib/supabase";

import AIShowcase from "./components/AIShowcase";
import ResultsAndSocialProof from "./components/ResultsAndSocialProof";
import GlassBand_OnboardingSecurityIntegrations from "./components/GlassBand_OnboardingSecurityIntegrations";
import LiveProductPeek from "./components/LiveProductPeek";
import FAQShort from "./components/FAQShort";

/* ===== Owner pages that are already proven working ===== */
import OwnerDashboard from "./routes/OwnerDashboard";
import OwnerRooms from "./routes/OwnerRooms";
import OwnerRoomDetail from "./routes/OwnerRoomDetail";
import { OwnerADR, OwnerRevPAR } from "./routes/OwnerRevenue";
import OwnerPickup from "./routes/OwnerPickup";

/* ===== HRMS: load lazily + defer rendering until route matches ===== */
import React from "react";

/** Retry lazy chunk loads to dodge transient CDN/cache hiccups. */
function lazyRetry<T>(factory: () => Promise<T>, retries = 3, interval = 800): Promise<T> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      factory().then(resolve).catch((err) => {
        if (n <= 0) reject(err);
        else setTimeout(() => attempt(n - 1), interval);
      });
    };
    attempt(retries);
  });
}

/** IMPORTANT: OwnerHRMS **must** be the module’s **default export**. */
const OwnerHRMS = React.lazy(() =>
  lazyRetry(() => import("./routes/OwnerHRMS"))
);

/** Render HRMS only when the route matches (prevents app-wide crash). */
function HRMSRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading HRMS…</div>}>
      <OwnerHRMS />
    </Suspense>
  );
}

const TOKEN_KEY = "stay:token";

/* ----------------------------------------------------------------------------
   App: Router shell
---------------------------------------------------------------------------- */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Marketing / landing */}
        <Route path="/" element={<HomeLanding />} />

        {/* Owner area */}
        <Route path="/owner/:slug" element={<OwnerDashboard />} />
        <Route path="/owner/:slug/rooms" element={<OwnerRooms />} />
        <Route path="/owner/:slug/rooms/:roomId" element={<OwnerRoomDetail />} />

        {/* Revenue (working) */}
        <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
        <Route path="/owner/:slug/revenue/revpar" element={<OwnerRevPAR />} />

        {/* Bookings (working) */}
        <Route path="/owner/:slug/bookings/pickup" element={<OwnerPickup />} />

        {/* HRMS: deferred + lazy */}
        <Route path="/owner/:slug/hrms/*" element={<HRMSRoute />} />

        {/* Convenience redirects / 404 */}
        <Route path="/owner" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

/* ----------------------------------------------------------------------------
   NotFound (tiny 404)
---------------------------------------------------------------------------- */
function NotFound() {
  return (
    <main className="min-h-[60vh] grid place-items-center">
      <div className="rounded-xl border p-6 text-center">
        <div className="text-lg font-medium mb-2">Page not found</div>
        <p className="text-sm text-gray-600">The page you’re looking for doesn’t exist.</p>
        <div className="mt-4"><Link to="/" className="btn btn-light">Go home</Link></div>
      </div>
    </main>
  );
}

/* ----------------------------------------------------------------------------
   HomeLanding (unchanged, trimmed only where necessary)
---------------------------------------------------------------------------- */
function HomeLanding() {
  const [hasToken, setHasToken] = useState<boolean>(() => !!localStorage.getItem(TOKEN_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === TOKEN_KEY) setHasToken(!!e.newValue); };
    const onVis = () => setHasToken(!!localStorage.getItem(TOKEN_KEY));
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setUserEmail(data.session?.user?.email ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => { mounted = false; sub?.subscription?.unsubscribe(); };
  }, []);
  const isAuthed = !!userEmail;

  const [hasHotel, setHasHotel] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { setHasHotel(false); return; }

      const { error, count } = await supabase
        .from("hotel_members")
        .select("hotel_id", { head: true, count: "exact" })
        .eq("user_id", userId);

      if (!alive) return;
      setHasHotel(!error && !!count && count > 0);
    })();
    return () => { alive = false; };
  }, []);

  const [ownerSlug, setOwnerSlug] = useState<string | null>(null);
  useEffect(() => { setOwnerSlug(localStorage.getItem("owner:slug")); }, []);

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem(TOKEN_KEY);
    } finally {
      window.location.assign("/");
    }
  }

  const site = typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  const slides = [
    {
      id: "ai-hero",
      headline: "Where Intelligence Meets Comfort",
      sub: "AI turns live stay activity into faster service and delightful guest journeys.",
      cta: { label: isAuthed ? "Open app" : "Start with your email", href: isAuthed ? "/guest" : "/signin?intent=signup&redirect=/guest" },
      variant: "photo",
      img: "/hero/ai-hero.png",
      imgAlt: "AI hero background"
    },
    {
      id: "checkin",
      headline: "10-second Mobile Check-in",
      sub: "Scan, confirm, head to your room. No kiosk queues.",
      cta: { label: "Try the guest demo", href: "/guest" },
      variant: "photo",
      img: "/hero/checkin.png",
      imgAlt: "Guest scanning QR at the front desk"
    },
    {
      id: "sla",
      headline: "SLA Nudges for Staff",
      sub: "On-time nudges and a clean digest keep service humming.",
      cta: { label: "See the owner console", href: "/owner" },
      variant: "photo",
      img: "/hero/sla.png",
      imgAlt: "Tablet with SLA dashboard"
    },
    {
      id: "reviews",
      headline: "Truth-Anchored Reviews",
      sub: "AI drafts grounded in verified stay data—owners approve, brand stays safe.",
      cta: { label: "How moderation works", href: "/about-ai" },
      variant: "photo",
      img: "/hero/reviews.png",
      imgAlt: "Owner reviewing AI draft"
    },
    {
      id: "grid-smart",
      headline: "Grid-Smart Operations & Sustainability",
      sub: "Tariff-aware actions and device shedding without drama.",
      cta: { label: "Learn about grid mode", href: "/grid/devices" },
      variant: "photo",
      img: "/hero/grid.png",
      imgAlt: "Energy dashboard on wall tablet"
    },
    {
      id: "owner-console",
      headline: "AI-Driven Owner Console",
      sub: "Digest, usage, moderation and KPIs—clean, fast, reliable.",
      cta: { label: "Open owner home", href: "/owner" },
      variant: "photo",
      img: "/hero/owner-console.png",
      imgAlt: "Owner console KPIs on monitor"
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SEO
        title="VAiyu — AI OS for Hotels"
        description="Where Intelligence Meets Comfort — verified reviews, refer-and-earn growth, and grid-smart operations."
        canonical={`${site}/`}
        ogImage="/og/home.png"
        twitter={{ site: "@vaiyu", card: "summary_large_image" }}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "VAiyu",
          url: site,
          logo: `${site}/icons/favicon-light-512.png`,
          sameAs: [site],
        }}
      />

      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/brand/vaiyu-logo.png"
              alt="VAiyu"
              className="h-8 w-auto hidden sm:block"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
            <span className="sm:hidden inline-block h-8 w-8 rounded-xl" style={{ background: "var(--brand, #145AF2)" }} aria-hidden />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#ai" className="hover:text-gray-700">AI</a>
            <a href="#use-cases" className="hover:text-gray-700">Use-cases</a>
            <Link to="/owner" className="hover:text-gray-700">For Hotels</Link>
            <Link to="/about" className="hover:text-gray-700">About</Link>
            {!isAuthed && <Link to="/signin?redirect=/guest" className="hover:text-gray-700">Sign in</Link>}
          </nav>

          <div className="flex items-center gap-2">
            {hasToken && <Link to="/guest" className="btn btn-light !py-2 !px-3 text-sm">My credits</Link>}
            {isAuthed && <Link to="/owner" className="btn btn-light !py-2 !px-3 text-sm">Owner console</Link>}
            {isAuthed ? (
              <>
                <Link to="/guest" className="btn !py-2 !px-3 text-sm">Open app</Link>
                <button onClick={handleSignOut} className="btn btn-light !py-2 !px-3 text-sm">Sign out</button>
              </>
            ) : (
              <Link to="/signin?intent=signup&redirect=/guest" className="btn !py-2 !px-3 text-sm">Get started</Link>
            )}
          </div>
        </div>
      </header>

      <section id="use-cases" className="mx-auto max-w-7xl px-4 py-6 scroll-mt-24">
        <HeroCarousel slides={slides} />
      </section>

      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">Clear wins for guests, staff, owners, and your brand.</p>
        <figure className="mt-6">
          <div className="rounded-3xl ring-1 ring-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="w-full aspect-[16/9]">
              <img
                src="/illustrations/journey-upgraded.png?v=5"
                alt="The whole journey, upgraded — benefits for Guests, Staff, Owners, and Brand"
                className="block w-full h-full object-cover object-center"
                loading="eager"
                decoding="async"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement;
                  el.src = "/illustrations/vaiyu-intelligence-final.png";
                }}
              />
            </div>
          </div>
          <figcaption className="sr-only">VAiyu benefits across Guests, Staff, Owners, and Brand.</figcaption>
        </figure>
      </section>

      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
        <AIShowcase />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-4">
        <ResultsAndSocialProof />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16">
        <GlassBand_OnboardingSecurityIntegrations />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16">
        <LiveProductPeek />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20">
        <FAQShort />
      </section>

      {/* Quick Owner links */}
      {isAuthed && hasHotel && ownerSlug && (
        <>
          <section className="mx-auto max-w-7xl px-4 pb-6">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Quick owner KPIs</h3>
                  <p className="text-gray-600 text-sm mt-0.5">
                    Jump to today’s metrics for <span className="font-medium">{ownerSlug}</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link to={`/owner/${ownerSlug}/revenue/adr`} className="btn">ADR</Link>
                  <Link to={`/owner/${ownerSlug}/revenue/revpar`} className="btn btn-light">RevPAR</Link>
                  <Link to={`/owner/${ownerSlug}/bookings/pickup`} className="btn btn-light">Pick-up (7 days)</Link>
                </div>
              </div>
            </div>
          </section>

          <section className="mx-auto max-w-7xl px-4 pb-10">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Team & HRMS</h3>
                  <p className="text-gray-600 text-sm mt-0.5">
                    One-tap access for <span className="font-medium">{ownerSlug}</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link to={`/owner/${ownerSlug}/hrms/attendance`} className="btn">Attendance</Link>
                  <Link to={`/owner/${ownerSlug}/hrms/leaves`} className="btn btn-light">Leaves</Link>
                  <Link to={`/owner/${ownerSlug}/hrms/staff`} className="btn btn-light">Staff</Link>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <section id="contact-cta" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 sm:p-10 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-2xl font-semibold text-gray-900">Want a walkthrough for your property?</h3>
              <p className="text-gray-600 mt-1">We’ll brand the demo with your details and share a 7-day pilot plan.</p>
            </div>
            <div className="flex-shrink-0">
              <Link to="/contact" className="btn">Contact us</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-gray-600 flex flex-wrap items-center justify-between gap-3">
          <div>© {new Date().getFullYear()} VAiyu — Where Intelligence Meets Comfort.</div>
          <div className="flex items-center gap-4">
            <Link className="hover:text-gray-800" to="/about-ai">AI</Link>
            <a className="hover:text-gray-800" href="#why">Why VAiyu</a>
            <Link className="hover:text-gray-800" to="/owner">For Hotels</Link>
            <Link className="hover:text-gray-800" to="/about">About</Link>
            <Link className="hover:text-gray-800" to="/press">Press</Link>
            <Link className="hover:text-gray-800" to="/privacy">Privacy</Link>
            <Link className="hover:text-gray-800" to="/terms">Terms</Link>
            <Link className="hover:text-gray-800" to="/contact">Contact</Link>
            <Link className="hover:text-gray-800" to="/careers">Careers</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
