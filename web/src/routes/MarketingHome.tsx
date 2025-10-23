// web/src/routes/MarketingHome.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import SEO from "../components/SEO";
import HeroCarousel from "../components/HeroCarousel";
import AIShowcase from "../components/AIShowcase";
import ResultsAndSocialProof from "../components/ResultsAndSocialProof";
import GlassBand_OnboardingSecurityIntegrations from "../components/GlassBand_OnboardingSecurityIntegrations";
import LiveProductPeek from "../components/LiveProductPeek";
import FAQShort from "../components/FAQShort";

import { supabase } from "../lib/supabase";

// Hardening hooks (safe no-ops if unused)
import { useIdleSignOut } from "../hooks/useIdleSignOut";
import { useFocusAuthCheck } from "../hooks/useFocusAuthCheck";

// Role context (used to tailor a few CTAs)
import { useRole } from "../context/RoleContext";

const TOKEN_KEY = "stay:token";

// Make a friendly name from email-like strings (e.g., "kapil.bisht" -> "Kapil Bisht")
function prettyNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const raw = email.split("@")[0] || email;
  const parts = raw.split(/[\W_]+/).filter(Boolean);
  if (!parts.length) return raw;
  const cased = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return cased.join(" ");
}

export default function MarketingHome() {
  // Optional auth hardening
  useIdleSignOut({ maxIdleMinutes: 180 });
  useFocusAuthCheck();

  const { current } = useRole(); // { role: 'guest'|'staff'|'manager'|'owner', hotelSlug?: string|null }

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
  const displayName = prettyNameFromEmail(userEmail);

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

  /** ---------- Owner/staff helpers ---------- */
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

  /** ---------- Hero slides (role-aware CTAs, imagery unchanged) ---------- */
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

      {/* HERO — friendly welcome + use-cases carousel */}
      <section id="use-cases" className="mx-auto max-w-7xl px-4 pt-4 pb-6 scroll-mt-24">
        {/* Small friendly welcome chip (only when signed in) */}
        {displayName && (
          <div className="relative z-10 -mb-4 flex justify-center">
            <div className="rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-4 py-2 text-white text-sm shadow-lg ring-1 ring-white/30">
              👋 Welcome back, <strong className="font-semibold">{displayName}</strong>!
            </div>
          </div>
        )}

        <HeroCarousel slides={slides} />
      </section>

      {/* WHY */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">
          Clear wins for guests, staff, owners, and your brand.
        </p>

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
          <figcaption className="sr-only">
            VAiyu benefits across Guests, Staff, Owners, and Brand.
          </figcaption>
        </figure>
      </section>

      {/* Alternating image + content */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
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
            <Link className="hover:text-gray-800" to="/about-ai">
              AI
            </Link>
            <a className="hover:text-gray-800" href="#why">
              Why VAiyu
            </a>
            <Link className="hover:text-gray-800" to="/about">
              About
            </Link>
            <Link className="hover:text-gray-800" to="/press">
              Press
            </Link>
            <Link className="hover:text-gray-800" to="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-gray-800" to="/terms">
              Terms
            </Link>
            <Link className="hover:text-gray-800" to="/contact">
              Contact
            </Link>
            <Link className="hover:text-gray-800" to="/careers">
              Careers
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
