import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../lib/analytics";

/**
 * Netlify Forms-ready lead form.
 * - Posts via fetch() (no full-page redirect)
 * - Honeypot field for spam
 * - Navigates to /thanks on success via React Router
 */
export default function LeadForm() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      name="lead"
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        track("lead_submit", { place: "contact" });

        const formData = new FormData(e.currentTarget);
        formData.set("form-name", "lead");

        try {
          const res = await fetch("/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(formData as any).toString(),
          });

          if (res.ok) {
            navigate("/thanks");
          } else {
            setError("Something went wrong. Please try again.");
            setSubmitting(false);
          }
        } catch {
          setError("Network error. Please try again.");
          setSubmitting(false);
        }
      }}
      className="space-y-3"
    >
      {/* Required boilerplate for Netlify Forms */}
      <input type="hidden" name="form-name" value="lead" />
      <p className="hidden">
        <label>Don't fill this out: <input name="bot-field" /></label>
      </p>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

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
