// web/src/routes/AboutAI.tsx

import { Link } from "react-router-dom";

export default function AboutAI() {
  return (
    <main className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      {/* Hero */}
      <section
        className="relative isolate overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), linear-gradient(180deg, #060608, #0a0a0c)",
        }}
      >
        {/* z-index ensures buttons stay on top of any decorative layers */}
        <div className="relative z-[1] mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-[#f5f3ef]">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/40 bg-black/40 px-3 py-1.5 text-xs backdrop-blur font-medium tracking-wide text-[#d4af37]">
            🤖 Truth-anchored AI for hospitality
          </div>

          <h1 className="mt-6 text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            Where <span className="text-[#d4af37] drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">Intelligence</span><br className="hidden sm:block" /> Meets Comfort
          </h1>

          <p className="mt-6 text-[#b8b3a8] max-w-2xl text-lg sm:text-xl leading-relaxed">
            VAiyu converts verified stay signals—service tickets, kitchen orders, timings and
            resolutions—into <strong className="text-[#f5f3ef] font-semibold">actionable guidance</strong>, <strong className="text-[#f5f3ef] font-semibold">on-time operations</strong> and{" "}
            <strong className="text-[#f5f3ef] font-semibold">brand-safe AI summaries</strong>. Every output is grounded in real activity and approved
            by the owner.
          </p>

          {/* CTAs — Contact + Back home */}
          <div className="mt-10 flex flex-wrap gap-4">
            <Link to="/contact" className="inline-flex items-center justify-center px-8 py-4 font-bold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] border border-[#d4af37] rounded-xl hover:opacity-90 transition-all shadow-lg hover:shadow-[0_0_24px_rgba(212,175,55,0.3)]">
              Contact us
            </Link>
            <Link to="/" className="inline-flex items-center justify-center px-8 py-4 font-semibold text-[#b8b3a8] bg-[#1a1816] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors">
              Back to home
            </Link>
          </div>
        </div>

        {/* Decorative wave mapped to dark theme bg */}
        <svg
          viewBox="0 0 1440 140"
          className="pointer-events-none absolute bottom-[-1px] left-0 w-full"
          aria-hidden
        >
          <path
            fill="#0a0a0c"
            d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z"
          />
        </svg>
      </section>

      {/* Value for Guests / Hotels */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-8">
          <Card title="For Guests" emoji="🌴">
            <ul className="space-y-4 text-sm sm:text-base text-[#b8b3a8]">
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Fast, contactless pre-check-in and a simple in-stay microsite (no app required)</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Order food & amenities from your phone; live status on every request</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Track housekeeping and timings in real time</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Transparent bills and easy checkout</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Privacy-first review draft of your stay—always editable, never auto-published</li>
            </ul>
          </Card>

          <Card title="For Hotels" emoji="🏨">
            <ul className="space-y-4 text-sm sm:text-base text-[#b8b3a8]">
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Live service desk with SSE updates—no refresh, no polling, no noise</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> SLA timers and nudges that keep work on time; breach and policy hints</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> AI drafts grounded in tickets, orders & timing; owner approval ensures brand safety</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Owner intelligence dashboard: KPIs, exceptions and quick-win guidance</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Clean integrations: PMS/POS/sensors via open APIs</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <h2 className="text-2xl font-bold text-[#f5f3ef]">How it works</h2>
        <div className="grid md:grid-cols-3 gap-6 mt-6">
          <Step n={1} title="Capture">
            Structured signals are recorded during a stay: service tickets, kitchen orders, start/finish
            timestamps, SLA targets and outcomes—no free-form scraping.
          </Step>
          <Step n={2} title="Summarize">
            Our models assemble a <strong className="text-[#f5f3ef] font-semibold">truth-anchored</strong> draft: request counts, on-time vs late, average
            minutes, and highlights tied to verified events.
          </Step>
          <Step n={3} title="Act">
            Guests can edit or publish their review. Owners see KPIs and policy hints that convert insight
            into on-time actions and measurable outcomes.
          </Step>
        </div>
      </section>

      {/* Data sources & Privacy */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-8">
          <Card title="What data we use" emoji="📊">
            <p className="text-sm sm:text-base text-[#b8b3a8] leading-relaxed">
              Tickets (service_key, room, timestamps, SLA), kitchen orders (items, time), check-in/out
              markers and booking meta. We only use signals we can verify.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Pill>Tickets</Pill>
              <Pill>Orders</Pill>
              <Pill>SLA Timings</Pill>
              <Pill>Check-in/out</Pill>
            </div>
          </Card>
          <Card title="Privacy & consent" emoji="🛡️">
            <ul className="space-y-3 text-sm sm:text-base text-[#b8b3a8]">
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Reviews are never auto-published without consent</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Owner policies control auto-drafting vs moderation</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Guests can edit or decline a draft at any time</li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5">•</span> Data is scoped to the booking; no third-party resale</li>
            </ul>
          </Card>
        </div>
      </section>

      {/* CTA strip — single Contact button */}
      <section className="border-t border-[#d4af37]/20 bg-[#060608]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="text-2xl font-bold text-[#f5f3ef]">Ready to make operations feel effortless?</div>
            <div className="mt-2 text-[#b8b3a8] text-lg">Let’s talk about your property and rollout plan.</div>
          </div>
          <div className="flex-shrink-0">
            <Link to="/contact" className="inline-flex items-center justify-center px-8 py-4 font-bold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] border border-[#d4af37] rounded-xl hover:opacity-90 shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:-translate-y-1 transition-all">
              Contact us
            </Link>
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
    <div className="rounded-[2rem] border border-[#d4af37]/20 bg-[#141210]/90 p-8 sm:p-10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md hover:-translate-y-1 hover:border-[#d4af37]/40 transition-all duration-300">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-14 w-14 grid place-items-center rounded-2xl bg-[#1a1816] text-3xl border border-[#d4af37]/10 shadow-inner">
          {emoji}
        </div>
        <h3 className="text-2xl font-bold tracking-tight text-[#f5f3ef]">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#d4af37]/15 bg-[#141210] p-6 sm:p-8 shadow-lg hover:-translate-y-1 hover:border-[#d4af37]/30 transition-all duration-300">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-8 w-8 grid place-items-center rounded-full bg-gradient-to-br from-[#e9c55a] to-[#d4af37] text-[#0a0a0c] text-sm font-bold shadow-sm">
          {n}
        </div>
        <h4 className="text-lg font-bold text-[#f5f3ef]">{title}</h4>
      </div>
      <p className="text-sm sm:text-base leading-relaxed text-[#b8b3a8]">{children}</p>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 shadow-sm">
      {children}
    </span>
  );
}
