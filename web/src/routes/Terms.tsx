import Pill from "../components/Pill";   // ✅ correct from /routes
import SEO from '../components/SEO';          // if the page is in /routes

export default function Terms() {
  const year = new Date().getFullYear();
  const effective = '2025-01-01';

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Terms of Service</h1>
        <div className="text-sm text-gray-600">Effective: {effective}</div>
      </header>

      <section className="card bg-white">
        <p className="text-gray-700">
          These Terms govern your use of the VAiyu platform and services. By using VAiyu, you agree to these Terms.
          If you are agreeing on behalf of a company, you represent that you have authority to bind that company.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Accounts & access</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-1 mt-2">
          <li>You are responsible for all activity under your account and keeping credentials secure.</li>
          <li>We may suspend or terminate access for misuse, non-payment or security risk.</li>
        </ul>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Payments</h2>
        <p className="text-gray-700 mt-2">
          Fees (if applicable) are billed as agreed. Taxes and government charges are your responsibility. Late
          payments may result in suspension.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Data & privacy</h2>
        <p className="text-gray-700 mt-2">
          Our <a className="link" href="/privacy">Privacy Policy</a> explains how we handle data. You grant us the
          rights necessary to operate the service and provide features like <b>truth-anchored AI</b>. You retain
          ownership of your content.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Acceptable use</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-1 mt-2">
          <li>No illegal activities, harassment, spam or security testing without permission.</li>
          <li>No reverse engineering or circumventing technical protections.</li>
        </ul>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">AI features</h2>
        <p className="text-gray-700 mt-2">
          AI outputs are generated from operational signals and/or third-party models and may occasionally be imperfect.
          You are responsible for reviewing outputs before acting on them.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Disclaimers & liability</h2>
        <p className="text-gray-700 mt-2">
          The service is provided “as is”. To the maximum extent permitted by law, VAiyu disclaims all warranties and
          is not liable for indirect, incidental or consequential damages. Our aggregate liability is limited to fees
          paid in the past 12 months.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Termination</h2>
        <p className="text-gray-700 mt-2">
          You may stop using the service at any time. We may terminate for cause or where legally required.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Governing law</h2>
        <p className="text-gray-700 mt-2">
          These Terms are governed by applicable local law unless otherwise agreed in writing.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Changes</h2>
        <p className="text-gray-700 mt-2">
          We may update these Terms and will post the effective date above. Continued use means acceptance.
        </p>
      </section>

      <footer className="text-xs text-gray-500">© {year} VAiyu</footer>
    </main>
  );
}
