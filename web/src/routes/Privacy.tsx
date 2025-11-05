// web/src/routes/Privacy.tsx

import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Privacy() {
  const year = new Date().getFullYear();
  const effective = "2025-01-01";
  const site =
    typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <SEO
        title="Privacy Policy — VAiyu"
        description="How VAiyu collects, uses, and protects data for hotels and guests."
        canonical={`${site}/privacy`}
      />

      {/* Hero with clear Back home */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            "radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)",
        }}
      >
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-14 sm:py-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            🔐 Privacy
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-white/85">Effective: {effective}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              className="btn !bg-white !text-gray-900 hover:!bg-gray-50"
              href="/legal/VAiyu-Privacy-Policy.pdf"
              target="_blank"
              rel="noreferrer"
            >
              View full policy (PDF)
            </a>
            <Link to="/" className="btn btn-light">
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
            fill="#f9fafb"
            d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z"
          />
        </svg>
      </section>

      {/* Content */}
      <section className="mx-auto max-w-3xl px-4 py-10 space-y-4 text-gray-700">
        <p>
          VAiyu (“we”, “us”) provides software that helps hotels operate smoothly and
          serve guests better. This policy explains what we collect, why, and how we
          protect it. Questions? Email{" "}
          <a className="link" href="mailto:privacy@vaiyu.app">
            privacy@vaiyu.app
          </a>
          .
        </p>

        <div className="card bg-white">
          <h2 className="font-semibold">Information we collect</h2>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>
              <b>Account & contact.</b> Property details, admin contact, and billing info.
            </li>
            <li>
              <b>Operational data.</b> Tickets, orders, room assignments, timestamps, and
              SLA outcomes.
            </li>
            <li>
              <b>Guest inputs.</b> Optional pre-check-in details, requests, and feedback.
            </li>
            <li>
              <b>Device & usage.</b> Log data, approximate location, browser metadata,
              cookies.
            </li>
          </ul>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">How we use data</h2>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>Provide and improve the VAiyu platform.</li>
            <li>
              Power <b>truth-anchored AI</b> features such as summaries and review drafts
              grounded in actual activity.
            </li>
            <li>Detect abuse, ensure reliability, and comply with law.</li>
            <li>
              Send important service messages; opt-out is available for non-essential
              emails.
            </li>
          </ul>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">AI & processors</h2>
          <p className="mt-2">
            We do not sell personal data. Reputable processors may be used to provide AI
            functionality under strict data-processing agreements.
          </p>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">Security & retention</h2>
          <p className="mt-2">
            We use industry practices (encryption in transit, access controls,
            monitoring) and retain data only as needed for service delivery and
            legal/audit requirements.
          </p>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">Your rights</h2>
          <p className="mt-2">
            Depending on your region, you may have rights to access, correct, export, or
            delete your data. Contact{" "}
            <a className="link" href="mailto:privacy@vaiyu.app">
              privacy@vaiyu.app
            </a>
            .
          </p>
        </div>

        <div className="text-xs text-gray-500">© {year} VAiyu</div>
        {/* Keep footer link for redundancy */}
        <div className="mt-2 text-sm text-gray-600">
          <Link to="/" className="hover:underline">
            ← Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
