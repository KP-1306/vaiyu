import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Privacy() {
  const year = new Date().getFullYear();
  const effective = "2025-01-01";

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <SEO
        title="Privacy Policy — VAiyu"
        description="How VAiyu collects, uses, and protects data for hotels and guests."
        canonical={`${window.location.origin}/privacy`}
      />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <div className="text-sm text-gray-600">Effective: {effective}</div>
      </header>

      <section className="mt-6 space-y-4 text-gray-700">
        <p>
          VAiyu (“we”, “us”) provides software that helps hotels operate smoothly and serve guests
          better. This policy explains what we collect, why, and how we protect it. Questions?
          Email <a className="link" href="mailto:privacy@vaiyu.app">privacy@vaiyu.app</a>.
        </p>

        <div className="card bg-white">
          <h2 className="font-semibold">Information we collect</h2>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li><b>Account & contact.</b> Property details, admin contact, and billing info.</li>
            <li><b>Operational data.</b> Tickets, orders, room assignments, timestamps, and SLA outcomes.</li>
            <li><b>Guest inputs.</b> Optional pre-check-in details, requests, and feedback.</li>
            <li><b>Device & usage.</b> Log data, approximate location, browser metadata, cookies.</li>
          </ul>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">How we use data</h2>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>Provide and improve the VAiyu platform.</li>
            <li>
              Power <b>truth-anchored AI</b> features such as summaries and review drafts grounded in
              actual activity.
            </li>
            <li>Detect abuse, ensure reliability, and comply with law.</li>
            <li>Send important service messages; opt-out is available for non-essential emails.</li>
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
            We use industry practices (encryption in transit, access controls, monitoring) and
            retain data only as needed for service delivery and legal/audit requirements.
          </p>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">Your rights</h2>
          <p className="mt-2">
            Depending on your region, you may have rights to access, correct, export, or delete your
            data. Contact <a className="link" href="mailto:privacy@vaiyu.app">privacy@vaiyu.app</a>.
          </p>
        </div>

        <div className="card bg-white">
          <h2 className="font-semibold">Full policy (PDF)</h2>
          <p className="mt-2">
            For the legally binding version, download the signed PDF:
          </p>
          <a className="btn mt-3" href="/legal/VAiyu-Privacy-Policy.pdf" target="_blank" rel="noreferrer">
            View Privacy Policy (PDF)
          </a>
        </div>

        <div className="text-xs text-gray-500">© {year} VAiyu</div>
        <div className="mt-6 text-sm text-gray-600">
          <Link to="/" className="hover:underline">← Back to home</Link>
        </div>
      </section>
    </main>
  );
}
