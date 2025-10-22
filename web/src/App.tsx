import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import SEO from "./components/SEO";
import HeroCarousel from "./components/HeroCarousel";
import { supabase } from "./lib/supabase";

import AIShowcase from "./components/AIShowcase";
import ResultsAndSocialProof from "./components/ResultsAndSocialProof";
import GlassBand_OnboardingSecurityIntegrations from "./components/GlassBand_OnboardingSecurityIntegrations";
import LiveProductPeek from "./components/LiveProductPeek";
import FAQShort from "./components/FAQShort";

// Auth hardening hooks
import { useIdleSignOut } from "./hooks/useIdleSignOut";
import { useFocusAuthCheck } from "./hooks/useFocusAuthCheck";

// Role context
import { useRole } from "./context/RoleContext";

const TOKEN_KEY = "stay:token";

export default function App() {
  // 🔒 enable auth hardening
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
  const isAuthed = !!userEmail;

  /** ---------- Token presence (for “My credits” button) ---------- */
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

  /** ---------- Membership presence (owner/manager quick links) ---------- */
  const [hasHotel, setHasHotel] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) {
        if (alive) setHasHotel(false);
        return;
      }

      const { error, count } = await supabase
        .from("hotel_members")
        .select("hotel_id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("active", true);

      if (!alive) return;
      setHasHotel(!error && !!count && count > 0);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** ---------- Helpful slugs for routing ---------- */
  const [ownerSlug, setOwnerSlug] = useState<string | null>(null);
  const [staffSlug, setStaffSlug] = useState<string | null>(null);
  useEffect(() => {
    // Prefer RoleContext slug; otherwise look at last selection in localStorage
    setOwnerSlug(current.hotelSlug || localStorage.getItem("owner:slug"));
    setStaffSlug(current.hotelSlug || localStorage.getItem("staff:slug"));
  }, [current.hotelSlug]);

  const isOwnerSide = current.role === "owner" || current.role === "manager";
  const isStaffSide = current.role === "staff" || current.role === "manager";

  /** ---------- Hero slides (role-aware CTAs) ---------- */
  const heroCtaForOwner = ownerSlug ? `/owner/${ownerSlug}` : "/owner";
  const heroCtaForStaff = "/staff";

  const slides = useMemo(
    () => [
      {
        id: "ai-hero",
        headline: "Where Intelligence Meets Comfort",
        sub: "AI turns live stay activity into faster service and delightful guest journeys.",
        cta: {
          label: isAuthed ? "My trips" : "Start with your email",
          href: isAuthed ? "/guest" : "/signin?intent=signup&redirect=/guest",
        },
        variant: "photo",
        img: "/hero/ai-hero.png",
        imgAlt: "AI hero background",
      },
      {
        id: "checkin",
        headline: "10-second Mobile Check-in",
        sub: "Scan, confirm, head to your room. No kiosk queues.",
        cta: { label: "Try the guest demo", href: "/guest" },
        variant: "photo",
        img: "/hero/checkin.png",
        imgAlt: "Guest scanning QR at the front desk",
      },
      {
        id: "sla",
        headline: "SLA Nudges for Staff",
        sub: "On-time nudges and a clean digest keep service humming.",
        cta: {
          label: isStaffSide ? "Open staff workspace" : "See the owner console",
          href: isStaffSide ? heroCtaForStaff : heroCtaForOwner,
        },
        variant: "photo",
        img: "/hero/sla.png",
        imgAlt: "Tablet with SLA dashboard",
      },
      {
        id: "reviews",
        headline: "Truth-Anchored Reviews",
        sub: "AI drafts grounded in verified stay data—owners approve, brand stays safe.",
        cta: { label: "How moderation works", href: "/about-ai" },
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
        cta: {
          label: isStaffSide ? "Open staff workspace" : "Open owner home",
          href: isStaffSide ? heroCtaForStaff : heroCtaForOwner,
        },
        variant: "photo",
        img: "/hero/owner-console.png",
        imgAlt: "Owner console KPIs on monitor",
      },
    ],
    [isAuthed, isStaffSide, heroCtaForOwner, heroCtaForStaff]
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
            <a href="#why" className="hover:text-gray-700">
              Why VAiyu
            </a>
            <a href="#ai" className="hover:text-gray-700">
              AI
            </a>
            <a href="#use-cases" className="hover:text-gray-700">
              Use-cases
            </a>
            {isOwnerSide && (
              <Link to={heroCtaForOwner} className="hover:text-gray-700">
                For Hotels
              </Link>
            )}
            {isStaffSide && (
              <Link to={heroCtaForStaff} className="hover:text-gray-700">
                Staff
              </Link>
            )}
            <Link to="/about" className="hover:text-gray-700">
              About
            </Link>
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
            {isOwnerSide && (
              <Link to={heroCtaForOwner} className="btn btn-light !py-2 !px-3 text-sm">
                Owner console
              </Link>
            )}
            {isStaffSide && (
              <Link to={heroCtaForStaff} className="btn btn-light !py-2 !px-3 text-sm">
                Staff workspace
              </Link>
            )}
            {isAuthed ? (
              <>
                <Link to="/guest" className="btn !py-2 !px-3 text-sm">
                  My trips
                </Link>
                {/* Always route through /logout for reliable sign-out */}
                <Link to="/logout" className="btn btn-light !py-2 !px-3 text-sm">
                  Sign out
                </Link>
              </>
            ) : (
              <Link
                to="/signin?intent=signup&redirect=/guest"
                className="btn !py-2 !px-3 text-sm"
              >
                Get started
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Use-cases — hero carousel */}
      <section id="use-cases" className="mx-auto max-w-7xl px-4 py-6 scroll-mt-24">
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

      {/* Quick Owner KPIs — only for owner/manager & when we know the slug */}
      {isAuthed && isOwnerSide && hasHotel && ownerSlug && (
        <section className="mx-auto max-w-7xl px-4 pb-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Quick owner KPIs</h3>
                <p className="text-gray-600 text-sm mt-0.5">
                  Jump straight to today’s metrics for{" "}
                  <span className="font-medium">{ownerSlug}</span>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/owner/${ownerSlug}/revenue/adr`} className="btn">
                  ADR
                </Link>
                <Link to={`/owner/${ownerSlug}/revenue/revpar`} className="btn btn-light">
                  RevPAR
                </Link>
                <Link to={`/owner/${ownerSlug}/bookings/pickup`} className="btn btn-light">
                  Pick-up (7 days)
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* HRMS Quick Links — owners/managers only */}
      {isAuthed && isOwnerSide && hasHotel && ownerSlug && (
        <section className="mx-auto max-w-7xl px-4 pb-10">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Team & HRMS</h3>
                <p className="text-gray-600 text-sm mt-0.5">
                  One-tap access to your team pages for{" "}
                  <span className="font-medium">{ownerSlug}</span>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/owner/${ownerSlug}/hrms/attendance`} className="btn">
                  Attendance
                </Link>
                <Link to={`/owner/${ownerSlug}/hrms/leaves`} className="btn btn-light">
                  Leaves
                </Link>
                <Link to={`/owner/${ownerSlug}/hrms/staff`} className="btn btn-light">
                  Staff
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Staff Quick Links — staff/managers */}
      {isAuthed && isStaffSide && (
        <section className="mx-auto max-w-7xl px-4 pb-10">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Staff shortcuts</h3>
                <p className="text-gray-600 text-sm mt-0.5">
                  Your core work areas{" "}
                  {staffSlug ? (
                    <>
                      for <span className="font-medium">{staffSlug}</span>
                    </>
                  ) : null}
                  .
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link to="/desk" className="btn">
                  Front Desk
                </Link>
                <Link to="/hk" className="btn btn-light">
                  Housekeeping
                </Link>
                <Link to="/maint" className="btn btn-light">
                  Maintenance
                </Link>
                <Link to="/staff/attendance" className="btn btn-light">
                  My Attendance
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Contact CTA */}
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
            {isOwnerSide && (
              <Link className="hover:text-gray-800" to={heroCtaForOwner}>
                For Hotels
              </Link>
            )}
            {isStaffSide && (
              <Link className="hover:text-gray-800" to={heroCtaForStaff}>
                Staff
              </Link>
            )}
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

/* ---------- tiny building blocks (kept for parity) ---------- */
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
