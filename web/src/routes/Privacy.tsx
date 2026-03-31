// web/src/routes/Privacy.tsx

import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Privacy() {
  const year = new Date().getFullYear();
  const effective = "2025-01-01";
  const site =
    typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      <SEO
        title="Privacy Policy — VAiyu"
        description="How VAiyu collects, uses, and protects data for hotels and guests."
        canonical={`${site}/privacy`}
      />

      {/* Hero with clear Back home */}
      <section
        className="relative isolate text-[#f5f3ef]"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(30, 20, 10, 0.8), transparent 60%)",
        }}
      >
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-14 sm:py-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1a1816] border border-[#d4af37]/20 px-3 py-1 text-xs text-[#d4af37]">
            🔐 Privacy
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-[#b8b3a8]">Effective: {effective}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              className="inline-flex items-center justify-center px-5 py-2.5 font-semibold bg-[#e9c55a] text-[#0a0a0c] rounded-xl hover:bg-[#d4af37] transition-colors"
              href="/legal/VAiyu-Privacy-Policy.pdf"
              target="_blank"
              rel="noreferrer"
            >
              View full policy (PDF)
            </a>
            <Link to="/" className="inline-flex items-center justify-center px-5 py-2.5 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors">
              Back to home
            </Link>
          </div>
        </div>

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

      {/* Content */}
      <section className="mx-auto max-w-3xl px-4 py-10 space-y-6 text-[#b8b3a8]">
        <p className="text-[#b8b3a8]">
          VAiyu (“we”, “us”) provides software that helps hotels operate smoothly and
          serve guests better. This policy explains what we collect, why, and how we
          protect it. Questions? Email{" "}
          <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="mailto:support@vaiyu.co.in">
            support@vaiyu.co.in
          </a>
          .
        </p>

        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-lg font-semibold text-[#f5f3ef]">Information we collect</h2>
          <ul className="list-disc pl-6 space-y-3 mt-4">
            <li>
              <b className="text-[#e9c55a]">Account & contact.</b> Property details, admin contact, and billing info.
            </li>
            <li>
              <b className="text-[#e9c55a]">Operational data.</b> Tickets, orders, room assignments, timestamps, and
              SLA outcomes.
            </li>
            <li>
              <b className="text-[#e9c55a]">Guest inputs.</b> Optional pre-check-in details, requests, and feedback.
            </li>
            <li>
              <b className="text-[#e9c55a]">Device & usage.</b> Log data, approximate location, browser metadata,
              cookies.
            </li>
          </ul>
        </div>

        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-lg font-semibold text-[#f5f3ef]">How we use data</h2>
          <ul className="list-disc pl-6 space-y-3 mt-4">
            <li>Provide and improve the VAiyu platform.</li>
            <li>
              Power <b className="text-[#e9c55a]">truth-anchored AI</b> features such as summaries and review drafts
              grounded in actual activity.
            </li>
            <li>Detect abuse, ensure reliability, and comply with law.</li>
            <li>
              Send important service messages; opt-out is available for non-essential
              emails.
            </li>
          </ul>
        </div>

        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-lg font-semibold text-[#f5f3ef]">AI & processors</h2>
          <p className="mt-3">
            We do not sell personal data. Reputable processors may be used to provide AI
            functionality under strict data-processing agreements.
          </p>
        </div>

        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-lg font-semibold text-[#f5f3ef]">Security & retention</h2>
          <p className="mt-3">
            We use industry practices (encryption in transit, access controls,
            monitoring) and retain data only as needed for service delivery and
            legal/audit requirements.
          </p>
        </div>

        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-lg font-semibold text-[#f5f3ef]">Your rights</h2>
          <p className="mt-3">
            Depending on your region, you may have rights to access, correct, export, or
            delete your data. Contact{" "}
            <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="mailto:support@vaiyu.co.in">
              support@vaiyu.co.in
            </a>
            .
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 pb-8 border-t border-[#d4af37]/10 mt-8">
          <div className="text-xs text-[#7a756a]">© {year} VAiyu</div>
          <div className="text-sm">
            <Link to="/" className="text-[#d4af37] hover:text-[#e9c55a] transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
