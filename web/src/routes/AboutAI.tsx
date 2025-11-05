// web/src/routes/AboutAI.tsx

import { Link } from "react-router-dom";
import Pill from "../components/Pill";

export default function AboutAI() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          background:
            "radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)",
        }}
      >
        {/* z-index ensures buttons stay on top of any decorative layers */}
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-20 sm:py-24 text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            🤖 Truth-anchored AI for hospitality
          </div>

          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Where <span className="text-sky-300">Intelligence</span> Meets Comfort
          </h1>

          <p className="mt-3 text-white/85 max-w-2xl">
            VAiyu converts verified stay signals—service tickets, kitchen orders, timings and
            resolutions—into <b>actionable guidance</b>, <b>on-time operations</b> and{" "}
            <b>brand-safe AI summaries</b>. Every output is grounded in real activity and approved
            by the owner.
          </p>

          {/* CTAs — Contact + Back home */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/contact" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
              Contact us
            </Link>
            <Link to="/" className="btn btn-light">
              Back to home
            </Link>
          </div>
        </div>

        {/* Make sure the decorative wave never blocks clicks */}
        <svg
          viewBox="0 0 1440 140"
          className="pointer-events-none absolute bottom-[-1px] left-0 w-full"
          aria-hidden
        >
          <path
            fill="#f9fafb"
            d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z"
          />
        </svg>
      </section>

      {/* Value for Guests / Hotels */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="For Guests" emoji="🌴">
            <ul className="space-y-2 text-sm text-gray-700">
              <li>• Fast, contactless pre-check-in and a simple in-stay microsite (no app required)</li>
              <li>• Order food & amenities from your phone; live status on every request</li>
              <li>• Track housekeeping and timings in real time</li>
              <li>• Transparent bills and easy checkout</li>
              <li>• Privacy-first review draft of your stay—always editable, never auto-published</li>
            </ul>
          </Card>

          <Card title="For Hotels" emoji="🏨">
            <ul className="space-y-2 text-sm text-gray-700">
              <li>• Live service desk with SSE updates—no refresh, no polling, no noise</li>
              <li>• SLA timers and nudges that keep work on time; breach and policy hints</li>
              <li>• AI drafts grounded in tickets, orders & timing; owner approval ensures brand safety</li>
              <li>• Owner intelligence dashboard: KPIs, exceptions and quick-win guidance</li>
              <li>• Clean integrations: PMS/POS/sensors via open APIs</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-4">
        <h2 className="text-xl font-semibold">How it works</h2>
        <div className="grid md:grid-cols-3 gap-4 mt-3">
          <Step n={1} title="Capture">
            Structured signals are recorded during a stay: service tickets, kitchen orders, start/finish
            timestamps, SLA targets and outcomes—no free-form scraping.
          </Step>
          <Step n={2} title="Summarize">
            Our models assemble a <b>truth-anchored</b> draft: request counts, on-time vs late, average
            minutes, and highlights tied to verified events.
          </Step>
          <Step n={3} title="Act">
            Guests can edit or publish their review. Owners see KPIs and policy hints that convert insight
            into on-time actions and measurable outcomes.
          </Step>
        </div>
      </section>

      {/* Data sources & Privacy */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="What data we use" emoji="📊">
            <p className="text-sm text-gray-700">
              Tickets (service_key, room, timestamps, SLA), kitchen orders (items, time), check-in/out
              markers and booking meta. We only use signals we can verify.
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

      {/* CTA strip — single Contact button */}
      <section className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Ready to make operations feel effortless?</div>
            <div className="text-sm text-gray-600">Let’s talk about your property and rollout plan.</div>
          </div>
          <div className="flex gap-2">
            <Link to="/contact" className="btn">Contact us</Link>
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
