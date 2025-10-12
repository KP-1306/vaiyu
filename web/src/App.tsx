import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Pill from './components/Pill';
import HeroStats from './components/HeroStats';
import { HERO_METRICS } from './lib/metrics';


const TOKEN_KEY = 'stay:token';
const heroBg =
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=1600&auto=format&fit=crop';

export default function App() {
  const [hasToken, setHasToken] = useState<boolean>(() => !!localStorage.getItem(TOKEN_KEY));
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === TOKEN_KEY) setHasToken(!!e.newValue); };
    const onVis = () => setHasToken(!!localStorage.getItem(TOKEN_KEY));
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/brand/vaiyu-logo.png" alt="VAiyu" className="h-8 w-auto hidden sm:block"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            <span className="sm:hidden inline-block h-8 w-8 rounded-xl" style={{ background: 'var(--brand, #145AF2)' }} aria-hidden />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#ai" className="hover:text-gray-700">AI</a>
            <a href="#use-cases" className="hover:text-gray-700">Use-cases</a>
            <Link to="/about" className="hover:text-gray-700">About</Link>
            <a href="#demo" className="hover:text-gray-700">Live Demo</a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/precheck/DEMO" className="btn btn-light !py-2 !px-3 text-sm">Pre-check-in</Link>
            {hasToken && <Link to="/guest" className="btn btn-light !py-2 !px-3 text-sm">My credits</Link>}
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
              <span className="animate-pulse">🤖</span> AI-powered hospitality OS
            </div>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl leading-tight">
              Where <span className="text-sky-300">Intelligence</span> Meets Comfort
            </h1>

            <p className="mt-3 text-white/90 text-lg">
              We turn real stay activity into faster service, verified reviews, and even lower
              energy costs during peak hours — without compromising comfort.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/hotel/sunrise" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">See a sample property</Link>
              <Link to="/demo" className="btn btn-light">Watch a quick demo</Link>
              <Link to="/about-ai" className="link text-white/90 underline-offset-4">Explore moonshots →</Link>
            </div>
          </div>
          
<HeroStats items={HERO_METRICS} />
          
          {/* slim metrics ribbon so the image still “reads” */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <MetricCard title="Avg. request time" value="−28%" sub="vs. baseline properties" />
            <MetricCard title="Peak-hour energy saved" value="12%" sub="pilot average, manual mode" />
          </div>
        </div>

        {/* wave divider */}
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Moments that feel magical (guest-first) */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">Moments that feel magical</h2>
        <p className="text-gray-600 mt-1">Delight for travelers; operational sense for owners.</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          <ValueCard
            title="Instant help, visibly faster"
            points={['Tap once, see progress live. No calls, no chaos.', 'Backed by SLAs + server-sent events']}
            emoji="⏱️"
          />
          <ValueCard
            title="Reviews you can trust"
            points={['Drafts reference what really happened in your stay.', 'Owner/guest approve before publish']}
            emoji="🧠"
          />
          <ValueCard
            title="Refer & earn at this hotel"
            points={['Share with friends; earn credits you can spend on F&B.', 'Credits scoped to the property']}
            emoji="🎁"
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
                <h3 className="mt-3 text-2xl font-bold">AI that runs on facts, not vibes.</h3>
                <p className="mt-2 text-gray-600">
                  VAiyu turns tickets, orders & timings into draft reviews, nudges for teams, and one-line policy fixes.
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
                <AICard title="AI review drafts" text="Auto-summaries with on-time vs late and avg minutes — ready to approve." emoji="📝" />
                <AICard title="Policy hints" text="If SLAs slip, owners see a one-line fix to act on right away." emoji="🧭" />
                <AICard title="Ops automation" text="Tickets/orders stream live via SSE; agents act without refresh." emoji="🔔" />
                <AICard title="Brand-safe" text="No hallucinations; content is built from verifiable stay data." emoji="🛡️" />
              </ul>
            </div>

            {/* How it works */}
            <div className="mt-8 grid md:grid-cols-3 gap-3">
              <Step n={1} title="Capture" text="Guest requests, order timestamps, and SLA outcomes flow in live." />
              <Step n={2} title="Summarize" text="AI builds a review draft and owner-side diagnostics from facts." />
              <Step n={3} title="Approve" text="Owner/guest approve before publish. No surprises, just results." />
            </div>
          </div>
        </div>
      </section>

      {/* Grid-interactive hotels (owner/investor band) */}
      <section className="mx-auto max-w-7xl px-4 pb-14">
        <div className="rounded-2xl border bg-white p-6">
          <div className="flex items-start justify-between gap-4 flex-col md:flex-row">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-xs">New • Moonshot</div>
              <h3 className="mt-3 text-2xl font-bold">Grid-interactive hotels (Virtual Power Plant)</h3>
              <p className="mt-2 text-gray-600">
                Same comfort, smarter timing in peak hours. Start in <b>manual</b> (advisory only),
                grow into <b>assist</b> (smart plugs/relays), then <b>auto</b> (BMS/OCPP playbooks).
              </p>
              <ul className="mt-3 text-sm text-gray-700 space-y-1 list-disc pl-5">
                <li>Typical pilots: 8–15% peak-hour kWh reduction; no guest-room impact.</li>
                <li>Event log, safety timers, one-tap Restore; CSV export for finance.</li>
                <li>Works day-one without hardware; integrates later.</li>
              </ul>
              <div className="mt-4 flex gap-2">
                <Link to="/grid/devices" className="btn">See devices</Link>
                <Link to="/grid/events" className="btn btn-light">See grid events</Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full md:w-80">
              <MetricCard title="Peak-hour kWh" value="−12%" sub="demo property • manual" />
              <MetricCard title="₹ saved / event" value="₹2.4k" sub="est., 80-key hotel" />
            </div>
          </div>
        </div>
      </section>

      {/* The whole journey, upgraded */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <h3 className="text-xl font-semibold">The whole journey, upgraded</h3>
        <p className="text-gray-600">Clear wins for guests, staff, owners, and your brand.</p>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <ValueCard title="For Guests" emoji="🧳" points={[
            'Express pre-check-in',
            'In-app requests & tracking',
            'Room service that just works',
            'Crystal-clear bills',
          ]} />
          <ValueCard title="For Staff" emoji="🧑‍🔧" points={[
            'Clean tickets & SLAs',
            'Live SSE updates (no refresh)',
            'Auto-routing to teams',
            'Fewer calls, more action',
          ]} />
          <ValueCard title="For Owners" emoji="📈" points={[
            'SLA KPIs & policy hints',
            'Bottleneck alerts',
            'Property-wide trends',
            'Energy savings during peak hours',
          ]} />
          <ValueCard title="For Your Brand" emoji="🏆" points={[
            'Truth-anchored reviews',
            'Owner approval before publish',
            'Fewer disputes, more trust',
            'Clear impact on rankings',
          ]} />
        </div>
      </section>

      {/* See it in action */}
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

function MetricCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/85 text-gray-900 shadow backdrop-blur p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub ? <div className="text-xs text-gray-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

/* ---------- tiny building blocks ---------- */
function Bullet({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2"><span className="mt-0.5">•</span><span>{children}</span></li>;
}
function Proof({ children }: { children: React.ReactNode }) {
  return <li className="rounded-xl border bg-white p-3">{children}</li>;
}
function ValueCard({ title, points, emoji }: { title: string; points: string[]; emoji: string; }) {
  return (
    <div className="card group hover:shadow-lg transition-shadow">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <ul className="text-sm text-gray-600 mt-2 space-y-1">
        {points.map((p) => (<li key={p} className="flex gap-2"><span>✓</span><span>{p}</span></li>))}
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
    <Link to={to} className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 hover:shadow transition-shadow">
      <span className="font-medium">{label}</span><span aria-hidden>→</span>
    </Link>
  );
}
