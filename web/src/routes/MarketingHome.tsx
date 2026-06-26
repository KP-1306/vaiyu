// web/src/routes/MarketingHome.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import SEO from "../components/SEO";
import HeroCarousel, { type Slide } from "../components/HeroCarousel";
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
  const { t } = useTranslation("landing");
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
  const slides = useMemo<Slide[]>(
    () => [
      {
        id: "ai-hero",
        headline: t("hero.slides.aiHero.headline", "Where Intelligence Meets Comfort"),
        sub: t("hero.slides.aiHero.sub", "AI turns live stay activity into faster service and delightful guest journeys."),
        cta: { label: t("hero.slides.aiHero.cta", "Learn more"), href: "#why" },
        variant: "photo",
        img: "/hero/ai-hero.webp",
        imgAlt: "AI hero background",
      },
      {
        id: "checkin",
        headline: t("hero.slides.checkin.headline", "10-second Mobile Check-in"),
        sub: t("hero.slides.checkin.sub", "Scan, confirm, head to your room. No kiosk queues."),
        cta: { label: t("hero.slides.checkin.cta", "See how it works"), href: "#ai" },
        variant: "photo",
        img: "/hero/checkin.webp",
        imgAlt: "Guest scanning QR at the front desk",
      },
      {
        id: "sla",
        headline: t("hero.slides.sla.headline", "SLA Nudges for Staff"),
        sub: t("hero.slides.sla.sub", "On-time nudges and a clean digest keep service humming."),
        cta: isStaffSide
          ? { label: t("hero.slides.sla.ctaStaff", "Staff workspace"), href: staffHomeHref }
          : { label: t("hero.slides.sla.ctaHotels", "For hotels"), href: ownerHomeHref },
        variant: "photo",
        img: "/hero/sla.webp",
        imgAlt: "Tablet with SLA dashboard",
      },
      {
        id: "reviews",
        headline: t("hero.slides.reviews.headline", "Truth-Anchored Reviews"),
        sub: t("hero.slides.reviews.sub", "AI drafts grounded in verified stay data—owners approve, brand stays safe."),
        cta: { label: t("hero.slides.reviews.cta", "Moderation overview"), href: "/about-ai" },
        variant: "photo",
        img: "/hero/reviews.webp",
        imgAlt: "Owner reviewing AI draft",
      },
      {
        id: "grid-smart",
        headline: t("hero.slides.gridSmart.headline", "Grid-Smart Operations & Sustainability"),
        sub: t("hero.slides.gridSmart.sub", "Tariff-aware actions and device shedding without drama."),
        cta: { label: t("hero.slides.gridSmart.cta", "Learn about grid mode"), href: "/grid/devices" },
        variant: "photo",
        img: "/hero/grid.webp",
        imgAlt: "Energy dashboard on wall tablet",
      },
      {
        id: "owner-console",
        headline: t("hero.slides.ownerConsole.headline", "AI-Driven Owner Console"),
        sub: t("hero.slides.ownerConsole.sub", "Digest, usage, moderation and KPIs—clean, fast, reliable."),
        cta: isOwnerSide
          ? { label: t("hero.slides.ownerConsole.ctaOwner", "Open owner home"), href: ownerHomeHref }
          : { label: t("hero.slides.ownerConsole.ctaHotels", "For hotels"), href: ownerHomeHref },
        variant: "photo",
        img: "/hero/owner-console.webp",
        imgAlt: "Owner console KPIs on monitor",
      },
    ],
    [t, isOwnerSide, isStaffSide, ownerHomeHref, staffHomeHref]
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
    <div className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      {/* SEO */}
      <SEO
        title={t("seo.title", "VAiyu — AI OS for Hotels")}
        description={t("seo.desc", "Where Intelligence Meets Comfort — verified reviews, refer-and-earn growth, and grid-smart operations.")}
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
      {/* Floating cinematic dark hero with safe zones */}
      <section id="use-cases" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 scroll-mt-24">
        <HeroCarousel slides={slides} disableCtas />
      </section>

      {/* WHY (Upgraded to Dark Gold Theme) */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-16 sm:py-24">
        <h2 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">{t("why.title", "The whole journey, upgraded")}</h2>
        <p className="text-[#b8b3a8] mt-3 text-lg">
          {t("why.subtitle", "Clear wins for guests, staff, owners, and your brand.")}
        </p>

        <div className="mt-10 rounded-3xl border border-[#d4af37]/20 bg-[#141210]/90 p-6 sm:p-10 shadow-[0_4px_24px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <div className="rounded-2xl bg-[#0a0a0c] border border-[#d4af37]/10 p-8 sm:p-12 shadow-inner">
            <div className="text-center mb-12">
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#f5f3ef]">
                {t("why.osTitle", "One OS for Guests, Staff, and Owners")}
              </h3>
              <p className="mt-4 text-[#b8b3a8] text-lg">{t("why.osSubtitle", "Wins across guests, staff, owners, and brand.")}</p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Guests */}
              <article className="rounded-2xl border border-[#d4af37]/20 bg-[#141210] p-6 shadow-lg hover:-translate-y-1 hover:border-[#d4af37]/40 transition-all duration-300">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                    <SuitcaseIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#f5f3ef]">{t("why.guests.title", "For Guests")}</h4>
                    <div className="text-[11px] font-bold text-sky-400 uppercase tracking-wider mt-1">
                      {t("why.guests.tag", "Convenience")}
                    </div>
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-[#b8b3a8]">
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.guests.b1", "Express mobile check-in")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.guests.b2", "In-app request tracking")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.guests.b3", "Room service made easy")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.guests.b4", "Refer credits among friends")}</li>
                </ul>
              </article>

              {/* Staff */}
              <article className="rounded-2xl border border-[#d4af37]/20 bg-[#141210] p-6 shadow-lg hover:-translate-y-1 hover:border-[#d4af37]/40 transition-all duration-300">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <StaffIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#f5f3ef]">{t("why.staff.title", "For Staff")}</h4>
                    <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mt-1">
                      {t("why.staff.tag", "Efficiency")}
                    </div>
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-[#b8b3a8]">
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.staff.b1", "Universal & clear SLAs")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.staff.b2", "Live updates (no refresh)")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.staff.b3", "Auto-routing to teams")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.staff.b4", "Fewer calls, more action")}</li>
                </ul>
              </article>

              {/* Owners */}
              <article className="rounded-2xl border border-[#d4af37]/20 bg-[#141210] p-6 shadow-lg hover:-translate-y-1 hover:border-[#d4af37]/40 transition-all duration-300">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-fuchsia-500/10 flex items-center justify-center">
                    <BarsIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#f5f3ef]">{t("why.owners.title", "For Owners")}</h4>
                    <div className="text-[11px] font-bold text-fuchsia-400 uppercase tracking-wider mt-1">
                      {t("why.owners.tag", "Insights")}
                    </div>
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-[#b8b3a8]">
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.owners.b1", "SLA KPIs & policy hints")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.owners.b2", "Bottleneck alerts")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.owners.b3", "Property-wide trends")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.owners.b4", "Energy-smart hours")}</li>
                </ul>
              </article>

              {/* Brand */}
              <article className="rounded-2xl border border-[#d4af37]/20 bg-[#141210] p-6 shadow-lg hover:-translate-y-1 hover:border-[#d4af37]/40 transition-all duration-300">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <TrophyIcon className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#f5f3ef]">{t("why.brand.title", "For Brand")}</h4>
                    <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mt-1">
                      {t("why.brand.tag", "Trust")}
                    </div>
                  </div>
                </div>
                <ul className="mt-6 space-y-3 text-sm text-[#b8b3a8]">
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.brand.b1", "Truth-based reviews")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.brand.b2", "Owner approval")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.brand.b3", "Label fewer")}</li>
                  <li className="flex items-start gap-2"><span className="text-[#d4af37]">✓</span> {t("why.brand.b4", "Clear ranking impact")}</li>
                </ul>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* Alternating image + content */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-16 scroll-mt-24">
        <AIShowcase />
      </section>

      {/* Social proof */}
      <section className="mx-auto max-w-7xl px-4 pb-10">
        <ResultsAndSocialProof />
      </section>

      {/* Onboarding / Security / Integrations */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <GlassBand_OnboardingSecurityIntegrations />
      </section>

      {/* Live Product Peek */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <LiveProductPeek />
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-7xl px-4 pb-24">
        <FAQShort />
      </section>

      {/* Closing contact CTA */}
      <section id="contact-cta" className="mx-auto max-w-7xl px-4 pb-24">
        <div className="rounded-[2.5rem] border border-[#d4af37]/20 bg-[#141210]/90 p-10 sm:p-14 shadow-[0_4px_32px_rgba(0,0,0,0.5)] backdrop-blur-md relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-[#d4af37]/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-10 relative z-10">
            <div className="text-center md:text-left max-w-2xl">
              <h3 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">
                {t("cta.title", "Want a walkthrough for your property?")}
              </h3>
              <p className="text-[#b8b3a8] mt-4 text-xl">
                {t("cta.subtitle", "We’ll brand the demo with your details and share a 7-day pilot plan.")}
              </p>
            </div>
            <div className="flex-shrink-0">
              <Link to="/contact" className="inline-flex items-center justify-center px-8 py-4 font-bold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] border border-[#d4af37] rounded-2xl hover:opacity-90 shadow-[0_0_24px_rgba(212,175,55,0.2)] hover:shadow-[0_0_36px_rgba(212,175,55,0.4)] hover:-translate-y-1 transition-all">
                {t("cta.button", "Contact us")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#d4af37]/20 bg-[#0a0a0c]">
        <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-[#7a756a] flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="font-medium tracking-wide">{t("footer.copyright", "© {{year}} VAiyu — Where Intelligence Meets Comfort.", { year: new Date().getFullYear() })}</div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Link className="hover:text-[#d4af37] transition-colors" to="/about-ai">{t("footer.ai", "AI")}</Link>
            <a className="hover:text-[#d4af37] transition-colors" href="#why">{t("footer.whyVaiyu", "Why VAiyu")}</a>
            <Link className="hover:text-[#d4af37] transition-colors" to="/about">{t("footer.about", "About")}</Link>
            <Link className="hover:text-[#d4af37] transition-colors" to="/press">{t("footer.press", "Press")}</Link>
            <Link className="hover:text-[#d4af37] transition-colors" to="/privacy">{t("footer.privacy", "Privacy")}</Link>
            <Link className="hover:text-[#d4af37] transition-colors" to="/terms">{t("footer.terms", "Terms")}</Link>
            <Link className="hover:text-[#d4af37] transition-colors" to="/contact">{t("footer.contact", "Contact")}</Link>
            <Link className="hover:text-[#d4af37] transition-colors" to="/careers">{t("footer.careers", "Careers")}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
