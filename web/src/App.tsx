// web/src/App.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Pill from './components/Pill';

const TOKEN_KEY = 'stay:token';
const heroBg =
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=1600&auto=format&fit=crop';

export default function App() {
  // Show "My credits" only when a guest token exists
  const [hasToken, setHasToken] = useState<boolean>(() => !!localStorage.getItem(TOKEN_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY) setHasToken(!!e.newValue);
    };
    const onVis = () => setHasToken(!!localStorage.getItem(TOKEN_KEY));
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/brand/vaiyu-logo.png"
              alt="VAiyu"
              className="h-8 w-auto hidden sm:block"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
            />
            <span
              className="sm:hidden inline-block h-8 w-8 rounded-xl"
              style={{ background: 'var(--brand, #145AF2)' }}
              aria-hidden
            />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#moonshots" className="hover:text-gray-700">Moonshots</a>
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#ai" className="hover:text-gray-700">AI</a>
            <a href="#use-cases" className="hover:text-gray-700">Use-cases</a>
            <Link to="/about" className="hover:text-gray-700">About</Link>
            <a href="#demo" className="hover:text-gray-700">Live Demo</a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/precheck/DEMO" className="btn btn-light !py-2 !px-3 text-sm">
              Pre-check-in
            </Link>
            {hasToken && (
              <Link to="/guest" className="btn btn-light !py-2 !px-3 text-sm">
                My credits
              </Link>
            )}
            <Link to="/hk" className="btn !py-2 !px-3 text-sm">Try VAiyu</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35)), url(${heroBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-24 sm:py-28 lg:py-32 text-white relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
              <span className="animate-pulse">⚡</span> New • Grid-interactive hotels (VPP)
            </div>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl leading-tight">
              Where <span className="text-sky-300">Intelligence</span> Meets Comfort
            </h1>

            <p className="mt-3 text-white/90 text-lg">
              A hospitality OS that turns real stay activity into faster service, verified reviews, and
              even lower energy costs during peak hours — without compromising comfort.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/hotel/sunrise" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
                See a sample property
              </Link>
              <Link to="/demo" className="btn btn-light">
                Watch a quick demo
              </Link>
              <a href="#moonshots" className="link text-white/90 underline-offset-4">
                Explore moonshots →
              </a>
            </div>
          </div>

          {/* Right-side value card */}
          <aside className="mt-8 lg:mt-0 lg:absolute lg:right-4 lg:top-1/2 lg:-translate-y-1/2">
            <div className="w-full lg:w-[420px] rounded-2xl bg-white/85 text-gray-900 shadow-lg backdrop-blur p-5">
              <div className="text-xs font-medium text-sky-800 bg-sky-100 inline-flex px-2 py-1 rounded-full">
                What VAiyu automates
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                <Bullet>📲 Mobile pre-check-in & guest menu</Bullet>
                <Bullet>⚡ One-tap requests with live SLA tracking</Bullet>
                <Bullet>🍽️ Room service & F&amp;B ordering</Bullet>
                <Bullet>🧽 Housekeeping / maintenance workflows</Bullet>
                <Bullet>🧠 AI drafts reviews from actual stay data</Bullet>
                <Bullet>🛡️ Owner moderation & brand safety</Bullet>
                <Bullet>🎁 Refer &amp; Earn credits (property-scoped)</Bullet>
                <Bullet>⚡ Grid-aware operations (manual → assist → auto)</Bullet>
              </ul>
            </div>
          </aside>
        </div>

        {/* KPI ribbon (guest-first copy, investor-relevant stats) */}
        <div className="bg-white/90 text-gray-900">
          <div className="mx-auto max-w-7xl px-4 py-3 grid sm:grid-cols-3 gap-3 text-sm">
            <KPI label="Avg. request time" value="−28%" hint="last 30d vs baseline" />
            <KPI label="Reviews published" value="+41%" hint="grounded, brand-safe" />
            <KPI label="Peak-hour energy" value="−1.8 kW" hint="per event (demo)" />
          </div>
        </div>

        {/* wave divider */}
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* MOONSHOTS — guest-first framing */}
      <section id="moonshots" className="mx-auto max-w-7xl px-4 py-12">
        <h2 className="text-2xl font-bold">Moonshots for Guests</h2>
        <p className="text-gray-600 mt-1">Feels magical for travelers; makes financial sense for owners.</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <Moonshot
            emoji="⏱️"
            title="Instant help, visibly faster"
            pitch="Tap once, see progress live. No calls, no chaos."
            footnote="Backed by SLAs + server-sent events (no refresh)."
            to="/stay/DEMO/menu"
            cta="Try requests"
          />
          <Moonshot
            emoji="🛡️"
            title="Reviews you can trust"
            pitch="Drafts reference what really happened in your stay."
            footnote="Truth-anchored AI; owner/guest approve before publish."
            to="/owner/reviews"
            cta="See AI drafts"
          />
          <Moonshot
            emoji="🎁"
            title="Refer & earn at this hotel"
            pitch="Share with friends; earn credits you can spend on F&B."
            footnote="Property-scoped credits via VAiyu account/phone/email."
            to="/guest"
            cta="View credits"
          />
          <Moonshot
            emoji="⚡"
            title="Grid-savvy comfort"
            pitch="Same comfort, smarter timing during peak hours."
            footnote="Manual → assist → auto; device timelines & savings."
            to="/grid/events"
            cta="See grid events"
          />
        </div>
      </section>

      {/* Why VAiyu / value props */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">The whole journey, upgraded</h2>
        <p className="text-gray-600 mt-1">Clear wins for guests, staff, owners, and your brand.</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <ValueCard
            title="For Guests"
            points={[
              'Express pre-check-in',
              'In-app requests & tracking',
              'Room service that just works',
              'Crystal-clear bills',
              'Refer friends, earn credits on your next stay',
            ]}
            emoji="🧳"
          />
          <ValueCard
            title="For Staff"
            points={[
              'Clean tickets & SLAs',
              'Live SSE updates (no refresh)',
              'Auto-routing to teams',
              'Fewer calls, more action',
            ]}
            emoji="🧑‍🔧"
          />
          <ValueCard
            title="For Owners"
            points={[
              'SLA KPIs & policy hints',
              'Bottleneck alerts',
              'Property-wide trends',
              'CSV export for ops review',
            ]}
            emoji="📈"
          />
          <ValueCard
            title="For Your Brand"
            points={[
              'Truth-anchored reviews',
              'Owner approval before publish',
              'Fewer disputes, more trust',
              'Clear impact on rankings',
            ]}
            emoji="🏆"
          />
        </div>
      </section>

      {/* AI Showcase */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
        <div className="relative overflow-hidden rounded-3xl p-1">
          <div
            className="rounded-[20px] p-6 sm:p-8"
            style={{
              background:
                'radial-gradient(1200px 400px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(1000px 400px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #ffffff, #f8fafc)',
            }}
          >
            <div className="flex flex-col lg:flex-row items-start gap-8">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 text-sky-800 px-3 py-1 text-xs">
                  New • AI that’s grounded in real ops
                </div>
                <h3 className="mt-3 text-2xl font-bold">Let AI do the busywork, not the guesswork</h3>
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
                  <Link to="/owner/reviews" className="btn">Try AI review demo</Link>
                  <Link to="/about-ai" className="btn btn-light">How it works</Link>
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

            {/* How it works (simple 3-step) */}
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
            <p className="text-gray-600">Try the most loved workflows in under a minute.</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          <DemoLink to="/precheck/DEMO" label="Express pre-check-in" />
          <DemoLink to="/stay/DEMO/menu" label="Guest menu & requests" />
          <DemoLink to="/desk" label="Front Desk (live SSE)" />
          <DemoLink to="/hk" label="Housekeeping" />
          <DemoLink to="/owner/reviews" label="AI review moderation" />
          <DemoLink to="/owner/dashboard" label="Owner KPIs & hints" />
          <DemoLink to="/guest" label="Refer & Earn + Credits" />
          <DemoLink to="/grid/devices" label="Grid: Devices" />
          <DemoLink to="/grid/events" label="Grid: Events" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-gray-600 flex flex-wrap items-center justify-between gap-3">
          <div>© {new Date().getFullYear()} VAiyu — Where Intelligence Meets Comfort.</div>
          <div className="flex items-center gap-4">
            <Link className="hover:text-gray-800" to="/about-ai">AI</Link>
            <a className="hover:text-gray-800" href="#moonshots">Moonshots</a>
            <a className="hover:text-gray-800" href="#why">Why VAiyu</a>
            <Link className="hover:text-gray-800" to="/owner">For Hotels</Link>
            <a className="hover:text-gray-800" href="#demo">Live Demo</a>
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

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
      {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function Moonshot({
  emoji, title, pitch, footnote, to, cta,
}: { emoji: string; title: string; pitch: string; footnote: string; to: string; cta: string }) {
  return (
    <div className="card flex flex-col">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <p className="text-sm text-gray-600 mt-1">{pitch}</p>
      <div className="text-[11px] text-gray-500 mt-2">{footnote}</div>
      <Link to={to} className="btn btn-light mt-3 self-start">{cta}</Link>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2"><span className="mt-0.5">•</span><span>{children}</span></li>;
}

function Proof({ children }: { children: React.ReactNode }) {
  return <li className="rounded-xl border bg-white p-3">{children}</li>;
}

function ValueCard({
  title, points, emoji,
}: { title: string; points: string[]; emoji: string }) {
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

function DemoLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 hover:shadow transition-shadow"
    >
      <span className="font-medium">{label}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}
