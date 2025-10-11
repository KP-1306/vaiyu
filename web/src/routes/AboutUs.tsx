import { Link } from 'react-router-dom';

export default function AboutUs() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            'radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            🧭 About VAiyu
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Building the operating system for modern hospitality
          </h1>
          <p className="mt-3 max-w-2xl text-white/85">
            We’re on a mission to make every stay feel effortless—by uniting guest experience,
            hotel operations and <b>truth-anchored AI</b> on a single platform.
          </p>
          <div className="mt-6 flex gap-3">
            <Link to="/ai" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">How our AI works</Link>
            <Link to="/owner/dashboard" className="btn btn-light">See Owner Dashboard</Link>
          </div>
        </div>
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Mission + Numbers */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card bg-white">
            <h2 className="text-xl font-semibold">Our mission</h2>
            <p className="mt-2 text-gray-700">
              Hospitality should feel human, not hectic. VAiyu gives hotels a single, elegant system that
              connects guests, teams and data—so service is faster, SLAs are clearer, and reviews reflect
              the truth of the stay. We call it <b>Where Intelligence Meets Comfort.</b>
            </p>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <Bullet>Guest-first UX: microsites, in-stay ordering, live request tracking.</Bullet>
              <Bullet>Ops that hum: housekeeping, kitchen and desk with real-time updates.</Bullet>
              <Bullet>Truth-anchored AI: summaries and review drafts grounded in real activity.</Bullet>
              <Bullet>Owner clarity: KPIs, SLA signals and policy hints that drive action.</Bullet>
            </div>
          </div>

          <div className="card bg-white">
            <h3 className="text-sm font-semibold text-gray-600">In numbers <span className="text-xs text-gray-400">(demo)</span></h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="Avg. resolution" value="⟲ 23m" />
              <Stat label="On-time rate" value="92%" />
              <Stat label="Requests handled" value="12k" />
              <Stat label="Kitchen orders" value="8k" />
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Replace with live metrics when your data pipeline is connected.
            </p>
          </div>
        </div>
      </section>

      {/* What we build */}
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <h2 className="text-xl font-semibold">What we build</h2>
        <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile title="Guest Microsite" desc="Contactless check-in, in-stay menu, live tickets & transparent bills." emoji="📱" />
          <Tile title="Ops Console" desc="Desk, HK & Kitchen with SSE live updates—no refresh, no polling." emoji="🛠️" />
          <Tile title="AI Experience" desc="Drafts reviews and summaries grounded in tickets, orders & SLAs." emoji="🤖" />
          <Tile title="Owner Intelligence" desc="KPIs, SLA breaches and policy hints—actionable, not just charts." emoji="📊" />
        </div>
      </section>

      {/* Story / Timeline */}
      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Our story</h2>
          <div className="mt-4 grid md:grid-cols-3 gap-4">
            <Timeline year="2024" text="Prototype launched to remove friction from guest messaging." />
            <Timeline year="2025" text="Truth-anchored AI pilots: reviews grounded in real stay activity." />
            <Timeline year="Now" text="Platformizing the OS for hospitality—open APIs, faster rollouts, richer insights." />
          </div>
        </div>
      </section>

      {/* Leadership */}
      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="text-xl font-semibold">Leadership</h2>
        <div className="mt-3 grid md:grid-cols-3 gap-4">
          <Leader name="A. Founder" role="CEO / Product" blurb="Obsessed with guest delight and simple systems." />
          <Leader name="B. Founder" role="CTO" blurb="Builds resilient, real-time infra for operations at scale." />
          <Leader name="C. Founder" role="Design" blurb="Crafts interfaces that feel calm—especially on busy days." />
        </div>
      </section>

      {/* Values */}
      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">What we value</h2>
          <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm text-gray-700">
            <Value>Start with the guest</Value>
            <Value>Earn trust with truth</Value>
            <Value>Design for calm</Value>
            <Value>Default to action</Value>
            <Value>Own the outcome</Value>
            <Value>Play the long game</Value>
          </div>
        </div>
      </section>

      {/* Logos / Social proof (placeholders) */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="text-sm font-semibold text-gray-600">Backed by operators & builders</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded border bg-white flex items-center justify-center text-gray-400">
              LOGO
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Let’s make stays effortless.</div>
            <div className="text-sm text-gray-600">Run the demo, then talk to us about your property.</div>
          </div>
          <div className="flex gap-2">
            <Link to="/stay/DEMO/menu" className="btn btn-light">Open Guest Demo</Link>
            <Link to="/owner" className="btn">Book a demo</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ---------- small components ---------- */

function Bullet({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2 text-sm text-gray-700">• <span>{children}</span></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function Tile({ title, desc, emoji }: { title: string; desc: string; emoji: string }) {
  return (
    <div className="card bg-white">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="mt-1 text-sm text-gray-700">{desc}</div>
    </div>
  );
}

function Timeline({ year, text }: { year: string; text: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs font-semibold text-gray-500">{year}</div>
      <div className="mt-1 text-sm text-gray-800">{text}</div>
    </div>
  );
}

function Leader({ name, role, blurb }: { name: string; role: string; blurb: string }) {
  return (
    <div className="card bg-white">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white grid place-items-center font-semibold">
          {name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
        </div>
        <div>
          <div className="font-semibold">{name}</div>
          <div className="text-xs text-gray-600">{role}</div>
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-700">{blurb}</p>
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border p-3 bg-white">
      {children}
    </div>
  );
}
