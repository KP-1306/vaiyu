import { Link } from 'react-router-dom';

export default function AboutAI() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          background:
            'radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24 text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            🤖 Truth-anchored AI for hospitality
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Where <span className="text-sky-300">Intelligence</span> Meets Comfort
          </h1>
          <p className="mt-3 text-white/85 max-w-2xl">
            VAiyu turns real stay activity—service tickets, kitchen orders, timings and outcomes—into helpful
            suggestions, faster ops, and reviews that reflect the truth of the stay.
          </p>
          <div className="mt-6 flex gap-3">
            <Link to="/owner/reviews" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
              Try AI Review Demo
            </Link>
            <Link to="/owner/dashboard" className="btn btn-light">
              View Owner Dashboard
            </Link>
          </div>
        </div>
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Value for Guests / Hotels */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="For Guests" emoji="🌴">
            <ul className="space-y-2 text-sm text-gray-700">
              <li>• Express check-in and digital room keys (planned)</li>
              <li>• Order food & amenities from your phone</li>
              <li>• Track housekeeping in real-time</li>
              <li>• Crystal-clear bills and easy checkout</li>
              <li>• AI-assisted review draft that summarizes your stay—always editable, never posted without consent</li>
            </ul>
          </Card>

          <Card title="For Hotels" emoji="🏨">
            <ul className="space-y-2 text-sm text-gray-700">
              <li>• Live service desk with SSE updates (no refresh, no polling)</li>
              <li>• Auto-draft reviews grounded in tickets, orders & SLA timing</li>
              <li>• SLA breach detection, policy hints, and quick wins</li>
              <li>• Owner dashboard with KPIs (on-time, late, avg mins, volume)</li>
              <li>• Consent-aware publishing & moderation workflow</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-4">
        <h2 className="text-xl font-semibold">How it works</h2>
        <div className="grid md:grid-cols-3 gap-4 mt-3">
          <Step n={1} title="Capture">
            We record structured activity during a stay: service requests, kitchen orders, start/finish timestamps and
            SLA targets.
          </Step>
          <Step n={2} title="Summarize">
            The AI builds a <b>truth-anchored</b> draft: number of requests, on-time vs late, average minutes, and key
            highlights.
          </Step>
          <Step n={3} title="Act">
            Guests can publish or edit their review; owners see KPIs and policy hints to fix what matters first.
          </Step>
        </div>
      </section>

      {/* Data sources & Privacy */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="What data we use" emoji="📊">
            <p className="text-sm text-gray-700">
              Tickets (service_key, room, timestamps, SLA), kitchen orders (items, time), check-in/out markers and
              booking meta. No free-form scraping; just signals we can verify.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill>Tickets</Pill>
              <Pill>Orders</Pill>
              <Pill>SLA Timings</Pill>
              <Pill>Check-in/out</Pill>
            </div>
          </Card>
          <Card title="Privacy & consent" emoji="🛡️">
            <ul className="space-y-2 text-sm text-gray-700">
              <li>• Reviews are never auto-published without consent</li>
              <li>• Owner policies control auto-drafting vs moderation</li>
              <li>• Guests can edit or decline a draft at any time</li>
              <li>• Data is scoped to the booking; no third-party resale</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* CTA strip */}
      <section className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Ready to make operations feel effortless?</div>
            <div className="text-sm text-gray-600">Run the demo or open the owner dashboard.</div>
          </div>
          <div className="flex gap-2">
            <Link to="/stay/DEMO/menu" className="btn btn-light">Open Guest Demo</Link>
            <Link to="/owner/dashboard" className="btn">Go to Dashboard</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Card({
  title,
  emoji,
  children,
}: {
  title: string;
  emoji: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card bg-white">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold text-gray-500">Step {n}</div>
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-gray-700 mt-1">{children}</div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800 border">
      {children}
    </span>
  );
}
