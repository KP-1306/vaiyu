import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../lib/analytics";

/**
 * Netlify Forms-ready lead form.
 * - Posts via fetch() (no full-page redirect)
 * - Uses exact premium dark theme matching the Contact page
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
      className="space-y-4 bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      {/* Required boilerplate for Netlify Forms */}
      <input type="hidden" name="form-name" value="lead" />
      <p className="hidden">
        <label>Don't fill this out: <input name="bot-field" /></label>
      </p>

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[#b8b3a8]">Name</label>
        <input 
          className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all" 
          name="name" 
          required 
          autoComplete="name" 
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#b8b3a8]">Work email</label>
        <input 
          className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all" 
          name="email" 
          type="email" 
          required 
          autoComplete="email" 
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#b8b3a8]">Property / Company</label>
        <input 
          className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all" 
          name="company" 
          required 
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#b8b3a8]">How can we help?</label>
        <textarea 
          className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all resize-y" 
          name="message" 
          rows={4}
        />
      </div>

      <button 
        className="mt-2 inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] border border-[#d4af37] rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.15)] hover:shadow-[0_0_30px_rgba(212,175,55,0.3)] hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:hover:translate-y-0 w-full" 
        type="submit" 
        disabled={submitting}
      >
        {submitting ? "Sending…" : "Request a demo"}
      </button>
    </form>
  );
}
