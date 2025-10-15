import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <SEO
        title="Terms of Service — VAiyu"
        description="Contractual terms governing the use of VAiyu’s products and services."
        canonical={`${window.location.origin}/terms`}
      />

      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-3 text-gray-600">
        These terms govern use of VAiyu’s products and services. For the legally binding version,
        download the signed PDFs below.
      </p>

      <ul className="mt-6 list-disc pl-6 space-y-2 text-gray-700">
        <li>Acceptable use and content-moderation rules apply.</li>
        <li>Service levels and support windows are described in the SLA.</li>
        <li>Data processing is covered by our DPA.</li>
      </ul>

      <div className="mt-8 flex flex-wrap gap-3">
        <a className="btn"        href="/legal/VAiyu-MSA.pdf" target="_blank" rel="noreferrer">MSA (PDF)</a>
        <a className="btn btn-light" href="/legal/VAiyu-DPA.pdf" target="_blank" rel="noreferrer">DPA (PDF)</a>
        <a className="btn btn-light" href="/legal/VAiyu-SLA.pdf" target="_blank" rel="noreferrer">SLA (PDF)</a>
        <a className="btn btn-light" href="/legal/VAiyu-AUP.pdf" target="_blank" rel="noreferrer">AUP (PDF)</a>
      </div>

      <div className="mt-6 text-sm text-gray-600">
        <Link to="/" className="hover:underline">← Back to home</Link>
      </div>
    </main>
  );
}
