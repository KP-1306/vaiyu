// web/src/App.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import SEO from "./components/SEO";
import Pill from "./components/Pill";
// NEW: Supabase client
import { supabase } from "./lib/supabase";

const TOKEN_KEY = "stay:token";

const heroBg =
  "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=1600&auto=format&fit=crop";

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

  // --- NEW: Auth/session awareness for nav ---
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
      // Clear app auth + guest token
      await supabase.auth.signOut();
      localStorage.removeItem(TOKEN_KEY);
    } finally {
      // Hard redirect to avoid stale UI anywhere
      window.location.assign("/");
    }
  }

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
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#ai" className="hover:text-gray-700">AI</a>
            <a href="#use-cases" className="hover:text-gray-700">Use-cases</a>
            <Link to="/owner" className="hover:text-gray-700">For Hotels</Link>
            <Link to="/about" className="hover:text-gray-700">About</Link>

            {/* When NOT signed-in: show Sign in */}
            {!isAuthed && (
              <Link to="/signin?redirect=/welcome" className="hover:text-gray-700">
                Sign in
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {/* Only show when guest is logged in (has stay token) */}
            {hasToken && (
              <Link to="/guest" className="btn btn-light !py-2 !px-3 text-sm">
                My credits
              </Link>
            )}

            {/* Primary CTA changes with auth state */}
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

      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35)), url(${heroBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div id="main" className="mx-auto max-w-7xl px-4 py-24 sm:py-28 lg:py-32 text-white relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
              <span className="animate-pulse">🤖</span> AI-powered hospitality OS
            </div>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl leading-tight">
              Where <span className="text-sky-300">Intelligence</span> Meets Comfort
            </h1>

            <p className="mt-3 text-white/90 text-lg">
              We turn real stay activity into faster service, verified reviews, and delightful mobile journeys — while
              helping properties run smarter during peak hours.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthed ? "/welcome" : "/signin?intent=signup&redirect=/welcome"}
                className="btn btn-light"
              >
                {isAuthed ? "Open app" : "Start with your email"}
              </Link>
            </div>
          </div>

          {/* Right-side bullets */}
          <aside className="mt-8 lg:mt-0 lg:absolute lg:right-4 lg:top-1/2 lg:-translate-y-1/2">
            <div className="w-full lg:w-[420px] rounded-2xl bg-white/85 text-gray-900 shadow-lg backdrop-blur p-5">
              <div className="text-xs font-medium text-sky-800 bg-sky-100 inline-flex px-2 py-1 rounded-full">
                What VAiyu enables
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                <Bullet>📲 Mobile pre-check-in &amp; guest menu</Bullet>
                <Bullet>⚡ One-tap requests with live SLA tracking</Bullet>
                <Bullet>🍽️ Room service &amp; F&amp;B ordering</Bullet>
                <Bullet>🧽 Housekeeping / maintenance workflows</Bullet>
                <Bullet>🧠 AI review drafts grounded in real stay data</Bullet>
                <Bullet>🛡️ Owner moderation &amp; brand safety</Bullet>
                <Bullet>🎁 Refer &amp; Earn credits (property-scoped)</Bullet>
                <Bullet>🌐 Grid-aware operations (manual → assist → auto)</Bullet>
              </ul>
            </div>
          </aside>
        </div>

        {/* wave divider */}
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

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

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5">•</span>
      <span>{children}</span>
    </li>
  );
}

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
