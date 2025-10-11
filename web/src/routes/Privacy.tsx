import Pill from "../components/Pill";   // ✅ correct from /routes


export default function Privacy() {
  const year = new Date().getFullYear();
  const effective = '2025-01-01';

  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Privacy Policy</h1>
        <div className="text-sm text-gray-600">Effective: {effective}</div>
      </header>

      <section className="card bg-white">
        <p className="text-gray-700">
          VAiyu (“we”, “us”) provides software that helps hotels operate smoothly and serve guests better.
          This policy explains what we collect, why, and how we protect it. If you have any questions, email
          <a className="link" href="mailto:privacy@vaiyu.app"> privacy@vaiyu.app</a>.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Information we collect</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-1 mt-2">
          <li><b>Account & contact.</b> Property details, admin name, email, phone.</li>
          <li><b>Operational data.</b> Tickets, orders, room assignments, timestamps and SLA outcomes.</li>
          <li><b>Guest inputs.</b> Optional pre-check-in details, requests, feedback.</li>
          <li><b>Device & usage.</b> Log data, approximate location, browser metadata, cookies.</li>
        </ul>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">How we use data</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-1 mt-2">
          <li>Provide and improve the VAiyu platform.</li>
          <li>Power <b>truth-anchored AI</b> features such as summaries and review drafts grounded in actual activity.</li>
          <li>Detect abuse, ensure reliability and comply with law.</li>
          <li>Send important service messages. You can opt out of non-essential emails.</li>
        </ul>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">AI & data</h2>
        <p className="text-gray-700 mt-2">
          When we generate AI summaries or drafts, we reference operational signals (e.g., tickets, orders, SLAs).
          We do not sell personal data. We may use reputable processors to provide AI functionality under strict
          data-processing agreements.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Retention</h2>
        <p className="text-gray-700 mt-2">
          We retain data for as long as needed to deliver the service and meet legal or audit requirements.
          Customers may request deletion of certain records where legally permissible.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Security</h2>
        <p className="text-gray-700 mt-2">
          We use industry practices (encryption in transit, access controls, monitoring). No method is 100% secure.
          We notify customers of material incidents in accordance with law.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Your rights</h2>
        <p className="text-gray-700 mt-2">
          Depending on your region, you may have rights to access, correct, export or delete your data. Contact
          <a className="link" href="mailto:privacy@vaiyu.app"> privacy@vaiyu.app</a>.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Third parties</h2>
        <p className="text-gray-700 mt-2">
          We rely on infrastructure, analytics and payment providers. They act as processors where applicable and
          only process data as instructed.
        </p>
      </section>

      <section className="card bg-white">
        <h2 className="font-semibold">Changes</h2>
        <p className="text-gray-700 mt-2">
          We may update this policy and will reflect the effective date above.
        </p>
      </section>

      <footer className="text-xs text-gray-500">© {year} VAiyu</footer>
    </main>
  );
}
