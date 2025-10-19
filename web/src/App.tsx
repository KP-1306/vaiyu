import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import SEO from "./components/SEO";
import HeroCarousel from "./components/HeroCarousel";
import { supabase } from "./lib/supabase";

// Existing alternating image–text section
import AIShowcase from "./components/AIShowcase";

// 4) Results & Social Proof
import ResultsAndSocialProof from "./components/ResultsAndSocialProof";
// 5) Onboarding, Security & Integrations (Glass Band)
import GlassBand_OnboardingSecurityIntegrations from "./components/GlassBand_OnboardingSecurityIntegrations";
// 6) Live Product Peek (static image version)
import LiveProductPeek from "./components/LiveProductPeek";
// 7) FAQ (short)
import FAQShort from "./components/FAQShort";

const TOKEN_KEY = "stay:token";

export default function App() {
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

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem(TOKEN_KEY);
    } finally {
      window.location.assign("/");
    }
  }

  const site =
    typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

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

      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/brand/vaiyu-logo.png"
              alt="VAiyu"
              className="h-8 w-auto hidden sm:block"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
            <span
              className="sm:hidden inline-block h-8 w-8 rounded-xl"
              style={{ background: "var(--brand, #145AF2)" }}
              aria-hidden
            />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#ai" className="hover:text-gray-700">AI</a>
            <a href="#use-cases" className="hover:text-gray-700">Use-cases</a>
            <Link to="/owner" className="hover:text-gray-700">For Hotels</Link>
            <Link to="/about" className="hover:text-gray-700">About</Link>

            {!isAuthed && (
              <Link to="/signin?redirect=/guest" className="hover:text-gray-700">
                Sign in
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {hasToken && (
              <Link to="/guest" className="btn btn-light !py-2 !px-3 text-sm">
                My credits
              </Link>
            )}
            {isAuthed ? (
              <>
                <Link to="/guest" className="btn !py-2 !px-3 text-sm">Open app</Link>
                <button onClick={handleSignOut} className="btn btn-light !py-2 !px-3 text-sm">Sign out</button>
              </>
            ) : (
              <Link to="/signin?intent=signup&redirect=/guest" className="btn !py-2 !px-3 text-sm">
                Get started
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero — carousel */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <HeroCarousel slides={slides} />
      </div>

      {/* Why VAiyu / value props — responsive poster image */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">Clear wins for guests, staff, owners, and your brand.</p>

        <figure className="mt-6">
          <div className="rounded-3xl ring-1 ring-slate-200 bg-white/40 backdrop-blur-sm overflow-hidden shadow-sm">
            <picture>
              {/* High-efficiency formats (optional) */}
              <source srcSet="/illustrations/journey-upgraded.avif" type="image/avif" />
              <source srcSet="/illustrations/journey-upgraded.webp" type="image/webp" />
              {/* PNG (required; you've uploaded this) */}
              <img
                src="/illustrations/journey-upgraded.png"
                srcSet="/illustrations/journey-upgraded.png 1x, /illustrations/journey-upgraded@2x.png 2x"
                alt="The whole journey, upgraded — benefits for Guests, Staff, Owners, and Brand"
                className="block w-full h-auto"
                loading="lazy"
                decoding="async"
                sizes="(min-width: 1280px) 1120px, (min-width: 1024px) 960px, 100vw"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement;
                  // Last-resort safe fallback so layout never breaks
                  el.src = "/illustrations/vaiyu-intelligence-final.png";
                }}
              />
            </picture>
          </div>
          <figcaption className="sr-only">
            VAiyu benefits across Guests, Staff, Owners, and Brand.
          </figcaption>
        </figure>
      </section>

      {/* Alternating image + content layout */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
        <AIShowcase />
      </section>

      {/* 4) Results & Social Proof */}
      <section className="mx-auto max-w-7xl px-4 pb-4">
        <ResultsAndSocialProof />
      </section>

      {/* 5) Onboarding, Security & Integrations */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <GlassBand_OnboardingSecurityIntegrations />
      </section>

      {/* 6) Live Product Peek */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <LiveProductPeek />
      </section>

      {/* 7) FAQ */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <FAQShort />
      </section>

      {/* Contact CTA */}
      <section id="contact-cta" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 sm:p-10 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="text-2xl font-semibold text-gray-900">Want a walkthrough for your property?</h3>
              <p className="text-gray-600 mt-1">
                We’ll brand the demo with your details and share a 7-day pilot plan.
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link to="/contact" className="btn">Contact us</Link>
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

/* ---------- tiny building blocks ---------- */

function ValueCard({
  title,
  points,
  emoji,
}: {
  title: string;
  points: string[];
  emoji: string;
}) {
  return (
    <div className="card group hover:shadow-lg transition-shadow">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <ul className="text-sm text-gray-600 mt-2 space-y-1">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span>✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
