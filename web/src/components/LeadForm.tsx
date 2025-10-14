import { useState } from "react";
import { track } from "../lib/analytics";

/**
 * Netlify Forms-ready lead form.
 * - Posts to static site (no backend required)
 * - Honeypot field for spam
 * - Redirects to /thanks on success
 */
export default function LeadForm() {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      name="lead"
      method="POST"
      action="/thanks"
      data-netlify="true"
      data-netlify-honeypot="bot-field"
      onSubmit={() => {
        setSubmitting(true);
        track("lead_submit", { place: "contact" });
      }}
      className="space-y-3"
    >
      {/* Required boilerplate for Netlify Forms */}
      <input type="hidden" name="form-name" value="lead" />
      <p className="hidden">
        <label>Don’t fill this out: <input name="bot-field" /></label>
      </p>

      <div>
        <label className="block text-sm text-gray-600">Name</label>
        <input className="input" name="name" required autoComplete="name" />
      </div>

      <div>
        <label className="block text-sm text-gray-600">Work email</label>
        <input className="input" name="email" type="email" required autoComplete="email" />
      </div>

      <div>
        <label className="block text-sm text-gray-600">Property / Company</label>
        <input className="input" name="company" required />
      </div>

      <div>
        <label className="block text-sm text-gray-600">How can we help?</label>
        <textarea className="input min-h-[96px]" name="message" />
      </div>

      <button className="btn" type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Request a demo"}
      </button>
    </form>
  );
}
