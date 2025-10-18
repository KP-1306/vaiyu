import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import SEO from "./components/SEO";
import Pill from "./components/Pill";
import HeroCarousel from "./components/HeroCarousel"; // NEW
// Supabase client
import { supabase } from "./lib/supabase";

const TOKEN_KEY = "stay:token";

export default function App() {
  // --- Guest token chip (unchanged) ---
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

  // --- Auth/session awareness for nav ---
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

  // ---------- Slides (images are placeholders; replace with your assets) ----------
  
const slides = [
  {
    id: "ai-hero",
    headline: "Where Intelligence Meets Comfort",
    sub: "AI turns live stay activity into faster service and delightful guest journeys.",
    cta: { label: isAuthed ? "Open app" : "Start with your email", href: isAuthed ? "/guest" : "/signin?intent=signup&redirect=/guest" },
    variant: "photo", // or "vector" if you prefer the SVG gradient
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
              <Link to="/signin?redirect=/welcome" className="hover:text-gray-700">
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
                <Link to="/welcome" className="btn !py-2 !px-3 text-sm">
                  Open app
                </Link>
                <button onClick={handleSignOut} className="btn btn-light !py-2 !px-3 text-sm">
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/signin?intent=signup&redirect=/welcome"
                className="btn !py-2 !px-3 text-sm"
              >
                Get started
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero — NEW carousel */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <HeroCarousel slides={slides} />
      </div>

      {/* Why VAiyu / value props */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">Clear wins for guests, staff, owners, and your brand.</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <ValueCard
            title="For Guests"
            points={[
              "Express pre-check-in",
              "In-app requests & tracking",
              "Room service that just works",
              "Crystal-clear bills",
              "Refer friends, earn credits on your next stay",
            ]}
            emoji="🧳"
          />

          <ValueCard
            title="For Staff"
            points={[
              "Clean tickets & SLAs",
              "Live SSE updates (no refresh)",
              "Auto-routing to teams",
              "Fewer calls, more action",
            ]}
            emoji="🧑‍🔧"
          />

          <ValueCard
            title="For Owners"
            points={[
              "SLA KPIs & policy hints",
              "Bottleneck alerts",
              "Property-wide trends",
              "Energy-smart peak-hour playbooks",
            ]}
            emoji="📈"
          />

          <ValueCard
            title="For Your Brand"
            points={[
              "Truth-anchored reviews",
              "Owner approval before publish",
              "Fewer disputes, more trust",
              "Clear impact on rankings",
            ]}
            emoji="🏆"
          />
        </div>
      </section>

      {/* AI Showcase */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
        <div className="relative overflow-hidden rounded-3xl p-1">
          <div
            className="rounded-[20px] p-6 sm:px-8 sm:py-8"
            style={{
              background:
                "radial-gradient(1200px 400px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(1000px 400px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #ffffff, #f8fafc)",
            }}
          >
            <div className="flex flex-col lg:flex-row items-start gap-8">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 text-sky-800 px-3 py-1 text-xs">
                  New • AI that’s grounded in real ops
                </div>
                <h3 className="mt-3 text-2xl font-bold">AI that does the work, so people can shine</h3>
                <p className="mt-2 text-gray-600">
                  VAiyu builds truth-anchored suggestions from stay activity — tickets, orders & timings — then drafts
                  reviews, nudges teams, and surfaces what to fix.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill>Truth-anchored reviews</Pill>
                  <Pill>Auto-draft at checkout</Pill>
                  <Pill>Owner moderation</Pill>
                  <Pill>Live SSE updates</Pill>
                </div>

                <div className="mt-6 flex gap-3">
                  <Link to="/about-ai" className="btn btn-light">
                    How it works
                  </Link>
                </div>
              </div>

              <ul className="grid sm:grid-cols-2 gap-3 w-full lg:max-w-md">
                <AICard
                  title="AI review drafts"
                  text="Auto-summaries with on-time vs late and avg minutes — ready to approve."
                  emoji="📝"
                />
                <AICard
                  title="Policy hints"
                  text="If SLAs slip, owners see a one-line fix to act on right away."
                  emoji="🧭"
                />
                <AICard
                  title="Ops automation"
                  text="Tickets/orders stream live via SSE; agents act without refresh."
                  emoji="🔔"
                />
                <AICard
                  title="Brand-safe"
                  text="No hallucinations: content is built from verifiable stay data."
                  emoji="🛡️"
                />
              </ul>
            </div>

            <div className="mt-8 grid md:grid-cols-3 gap-3">
              <Step n={1} title="Capture" text="Guest requests, order timestamps, and SLA outcomes flow in live." />
              <Step n={2} title="Summarize" text="AI builds a review draft and owner-side diagnostics from facts." />
              <Step n={3} title="Approve" text="Owner/guest approve before publish. No surprises, just results." />
            </div>
          </div>
        </div>
      </section>

      {/* Use-cases */}
      <section id="use-cases" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-xl font-semibold">See it in action</h3>
            <p className="text-gray-600">
              From pre-check-in to service requests and owner KPIs — built for real operations.
            </p>
          </div>
          <div>
            <Link to={isAuthed ? "/welcome" : "/signin?intent=signup&redirect=/welcome"} className="btn">
              {isAuthed ? "Open app" : "Get started"}
            </Link>
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

function AICard({ title, text, emoji }: { title: string; text: string; emoji: string }) {
  return (
    <li className="card bg-white/80 backdrop-blur">
      <div className="text-xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </li>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs text-gray-500">Step {n}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </div>
  );
}
