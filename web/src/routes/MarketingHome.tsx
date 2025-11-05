// web/src/routes/MarketingHome.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import SEO from "../components/SEO";
import HeroCarousel from "../components/HeroCarousel";
import AIShowcase from "../components/AIShowcase";
import ResultsAndSocialProof from "../components/ResultsAndSocialProof";
import GlassBand_OnboardingSecurityIntegrations from "../components/GlassBand_OnboardingSecurityIntegrations";
import LiveProductPeek from "../components/LiveProductPeek";
import FAQShort from "../components/FAQShort";

import { supabase } from "../lib/supabase";

// Hardening hooks (safe to keep)
import { useIdleSignOut } from "../hooks/useIdleSignOut";
import { useFocusAuthCheck } from "../hooks/useFocusAuthCheck";

// Role context (kept — only tailors a few CTAs elsewhere)
import { useRole } from "../context/RoleContext";

const TOKEN_KEY = "stay:token";

/** ---------- tiny inline SVGs (no external images) ---------- */
function SuitcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="5" y="7" width="14" height="12" rx="2" className="fill-sky-500" />
      <rect x="9" y="4" width="6" height="3" rx="1" className="fill-sky-600" />
      <path d="M7 7v12M17 7v12" className="stroke-sky-700" strokeWidth="1.5" />
    </svg>
  );
}
function StaffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="9" cy="8" r="3" className="fill-emerald-500" />
      <rect x="5" y="12" width="8" height="6" rx="2" className="fill-emerald-600" />
      <circle cx="17" cy="13" r="2.5" className="fill-emerald-400" />
      <path d="M17 16v4" className="stroke-emerald-700" strokeWidth="1.5" />
    </svg>
  );
}
function BarsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="5" y="12" width="3" height="7" rx="1" className="fill-fuchsia-400" />
      <rect x="10.5" y="9" width="3" height="10" rx="1" className="fill-fuchsia-500" />
      <rect x="16" y="6" width="3" height="13" rx="1" className="fill-fuchsia-600" />
    </svg>
  );
}
function TrophyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M7 6h10v3a5 5 0 1 1-10 0V6Z" className="fill-amber-400" />
      <rect x="9" y="15" width="6" height="2" className="fill-amber-500" />
      <rect x="8" y="17" width="8" height="2" rx="1" className="fill-amber-600" />
      <path d="M17 6h3v2a3 3 0 0 1-3 3V6ZM7 6H4v2a3 3 0 1 0 3 3V6Z" className="fill-amber-300" />
    </svg>
  );
}

export default function MarketingHome() {
  // Optional: keep your auth hardening
  useIdleSignOut({ maxIdleMinutes: 180 });
  useFocusAuthCheck();

  const { current } = useRole(); // { role, hotelSlug? }

  /** ---------- Auth/session basics ---------- */
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

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);
  const isAuthed = !!userEmail;

  /** ---------- Token presence (if you show credits somewhere) ---------- */
  const [hasToken, setHasToken] = useState<boolean>(() => !!localStorage.getItem(TOKEN_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY) setHasToken(!!e.newValue);
    };
    const onVis = () => setHasToken(!!localStorage.getItem(TOKEN_KEY));
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /** ---------- Owner/staff helpers (used elsewhere; kept) ---------- */
  const [ownerSlug, setOwnerSlug] = useState<string | null>(null);
  const [staffSlug, setStaffSlug] = useState<string | null>(null);
  useEffect(() => {
    setOwnerSlug(current.hotelSlug || localStorage.getItem("owner:slug"));
    setStaffSlug(current.hotelSlug || localStorage.getItem("staff:slug"));
  }, [current.hotelSlug]);

  const isOwnerSide = current.role === "owner" || current.role === "manager";
  const isStaffSide = current.role === "staff" || current.role === "manager";

  const ownerHomeHref = ownerSlug ? `/owner/${ownerSlug}` : "/owner";
  const staffHomeHref = "/staff";

  /** ---------- Hero slides (CTAs present for types, but hidden by disableCtas) ---------- */
  const slides = useMemo(
    () => [
      {
        id: "ai-hero",
        headline: "Where Intelligence Meets Comfort",
        sub: "AI turns live stay activity into faster service and delightful guest journeys.",
        cta: { label: "Learn more", href: "#why" },
        variant: "photo",
        img: "/hero/ai-hero.png",
        imgAlt: "AI hero background",
      },
      {
        id: "checkin",
        headline: "10-second Mobile Check-in",
        sub: "Scan, confirm, head to your room. No kiosk queues.",
        cta: { label: "See how it works", href: "#ai" },
        variant: "photo",
        img: "/hero/checkin.png",
        imgAlt: "Guest scanning QR at the front desk",
      },
      {
        id: "sla",
        headline: "SLA Nudges for Staff",
        sub: "On-time nudges and a clean digest keep service humming.",
        cta: isStaffSide
          ? { label: "Staff workspace", href: staffHomeHref }
          : { label: "For hotels", href: ownerHomeHref },
        variant: "photo",
        img: "/hero/sla.png",
        imgAlt: "Tablet with SLA dashboard",
      },
      {
        id: "reviews",
        headline: "Truth-Anchored Reviews",
        sub: "AI drafts grounded in verified stay data—owners approve, brand stays safe.",
        cta: { label: "Moderation overview", href: "/about-ai" },
        variant: "photo",
        img: "/hero/reviews.png",
        imgAlt: "Owner reviewing AI draft",
      },
      {
        id: "grid-smart",
        headline: "Grid-Smart Operations & Sustainability",
        sub: "Tariff-aware actions and device shedding without drama.",
        cta: { label: "Learn about grid mode", href: "/grid/devices" },
        variant: "photo",
        img: "/hero/grid.png",
        imgAlt: "Energy dashboard on wall tablet",
      },
      {
        id: "owner-console",
        headline: "AI-Driven Owner Console",
        sub: "Digest, usage, moderation and KPIs—clean, fast, reliable.",
        cta: isOwnerSide
          ? { label: "Open owner home", href: ownerHomeHref }
          : { label: "For hotels", href: ownerHomeHref },
        variant: "photo",
        img: "/hero/owner-console.png",
        imgAlt: "Owner console KPIs on monitor",
      },
    ],
    [isOwnerSide, isStaffSide, ownerHomeHref, staffHomeHref]
  );

  const site =
    typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  /** ---------- Hash-based smooth scrolling (/#ai, /#use-cases) ---------- */
  const location = useLocation();
  useEffect(() => {
    const hash = location.hash?.replace("#", "");
    if (!hash) return;

    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);

    return () => clearTimeout(t);
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* SEO */}
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

      {/* HERO / Use-cases carousel */}
      <section id="use-cases" className="mx-auto max-w-7xl px-4 py-6 scroll-mt-24">
        <HeroCarousel slides={slides} disableCtas />
      </section>

      {/* WHY (HTML/CSS — lightweight, no big images) */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">
          Clear wins for guests, staff, owners, and your brand.
        </p>

        <div className="mt-6 rounded-3xl ring-1 ring-slate-200 bg-white/70 p-6 sm:p-8 shadow-sm">
          <div className="rounded-2xl bg-gradient-to-br from-slate-50 via-white to-slate-50 p-6 sm:p-10">
            <div className="text-center mb-8">
              <h3 className="text-3xl font-bold tracking-tight">
                One OS for Guests, Staff, and Owners
              </h3>
              <p className="mt-2 text-gray-600">Wins across guests, staff, owners, and brand.</p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Guests */}
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <SuitcaseIcon className="h-8 w-8" />
                  <div>
                    <h4 className="font-semibold">For Guests</h4>
                    <div className="text-xs font-medium text-sky-700 bg-sky-50 rounded-full px-2 py-0.5 inline-block">
                      Convenience
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  <li>✓ Express mobile check-in</li>
                  <li>✓ In-app request tracking</li>
                  <li>✓ Room service made easy</li>
                  <li>✓ Refer credits among friends</li>
                </ul>
              </article>

              {/* Staff */}
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <StaffIcon className="h-8 w-8" />
                  <div>
                    <h4 className="font-semibold">For Staff</h4>
                    <div className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 inline-block">
                      Efficiency
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  <li>✓ Universal &amp; clear SLAs</li>
                  <li>✓ Live updates (no refresh)</li>
                  <li>✓ Auto-routing to teams</li>
                  <li>✓ Fewer calls, more action</li>
                </ul>
              </article>

              {/* Owners */}
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <BarsIcon className="h-8 w-8" />
                  <div>
                    <h4 className="font-semibold">For Owners</h4>
                    <div className="text-xs font-medium text-fuchsia-700 bg-fuchsia-50 rounded-full px-2 py-0.5 inline-block">
                      Insights
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  <li>✓ SLA KPIs &amp; policy hints</li>
                  <li>✓ Bottleneck alerts</li>
                  <li>✓ Property-wide trends</li>
                  <li>✓ Energy-smart hours</li>
                </ul>
              </article>

              {/* Brand */}
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <TrophyIcon className="h-8 w-8" />
                  <div>
                    <h4 className="font-semibold">For Brand</h4>
                    <div className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 inline-block">
                      Trust
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700">
                  <li>✓ Truth-based reviews</li>
                  <li>✓ Owner approval</li>
                  <li>✓ Label fewer</li>
                  <li>✓ Clear ranking impact</li>
                </ul>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* Alternating image + content */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14 scroll-mt-24">
        <AIShowcase />
      </section>

      {/* Social proof */}
      <section className="mx-auto max-w-7xl px-4 pb-4">
        <ResultsAndSocialProof />
      </section>

      {/* Onboarding / Security / Integrations */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <GlassBand_OnboardingSecurityIntegrations />
      </section>

      {/* Live Product Peek */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <LiveProductPeek />
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <FAQShort />
      </section>

      {/* Closing contact CTA */}
      <section id="contact-cta" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 sm:p-10 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-2xl font-semibold text-gray-900">
                Want a walkthrough for your property?
              </h3>
              <p className="text-gray-600 mt-1">
                We’ll brand the demo with your details and share a 7-day pilot plan.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link to="/contact" className="btn">
                Contact us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-gray-600 flex flex-wrap items-center justify-between gap-3">
          <div>© {new Date().getFullYear()} VAiyu — Where Intelligence Meets Comfort.</div>
          <div className="flex items-center gap-4">
            <Link className="hover:text-gray-800" to="/about-ai">AI</Link>
            <a className="hover:text-gray-800" href="#why">Why VAiyu</a>
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
