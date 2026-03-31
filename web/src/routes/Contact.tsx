// web/src/routes/Contact.tsx

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SEO from "../components/SEO";

export default function Contact() {
  const navigate = useNavigate();
  // unified local state (used for both Netlify submit and mailto fallback)
  const [sending, setSending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    email: "",
    company: "",
    subject: "",
    message: "",
  });

  function up<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  // Fallback: open the user's email client with the current form values
  function sendViaEmail(e?: React.MouseEvent) {
    e?.preventDefault?.();
    const to = "support@vaiyu.co.in";
    const subject = encodeURIComponent(f.subject || `Contact from ${f.name || "Guest"}`);
    const body = encodeURIComponent(
      `Name: ${f.name}\nEmail: ${f.email}\nCompany/Hotel: ${f.company}\n\n${f.message}`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    setOk("Opening your email client… If nothing appears, write to support@vaiyu.co.in.");
  }

  return (
    <main id="main" className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      <SEO
        title="Contact"
        canonical={`${location.origin}/contact`}
        description="Request a demo or ask anything about VAiyu — AI OS for hotels."
      />

      {/* ===== Hero ===== */}
      <section
        className="relative isolate text-[#f5f3ef]"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(30, 20, 10, 0.8), transparent 60%)",
        }}
      >
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1a1816] border border-[#d4af37]/20 px-3 py-1 text-xs text-[#d4af37]">
            ✉️ Contact
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">Contact VAiyu</h1>
          <p className="mt-3 max-w-2xl text-[#b8b3a8]">
            Partner with us to bring <b className="text-[#f5f3ef]">truth-anchored AI</b> to your hotel — faster service, clearer
            SLAs, happier guests.
          </p>

          {/* CTAs */}
          <div className="mt-6 flex flex-wrap gap-3">
            <a className="inline-flex items-center justify-center px-5 py-2.5 font-semibold bg-[#e9c55a] text-[#0a0a0c] rounded-xl hover:bg-[#d4af37] transition-colors" href="#form">
              Send a message
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
          <path fill="#0a0a0c" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* ===== Content ===== */}
      <section id="form" className="mx-auto max-w-6xl px-4 py-10 grid gap-8 lg:grid-cols-3">
        {/* Left column: quick contacts */}
        <div className="space-y-4">
          <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h2 className="text-lg font-semibold text-[#f5f3ef]">Talk to sales</h2>
            <p className="mt-1 text-sm text-[#b8b3a8]">Rollout, pricing, ROI.</p>
            <a className="inline-flex items-center justify-center px-4 py-2 mt-4 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors w-full sm:w-auto" href="mailto:sales@vaiyu.co.in">
              sales@vaiyu.co.in
            </a>
          </div>

          <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h2 className="text-lg font-semibold text-[#f5f3ef]">Customer support</h2>
            <p className="mt-1 text-sm text-[#b8b3a8]">We’re here 24×7 for critical issues.</p>
            <a className="inline-flex items-center justify-center px-4 py-2 mt-4 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors w-full sm:w-auto" href="mailto:support@vaiyu.co.in">
              support@vaiyu.co.in
            </a>
          </div>

          <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h2 className="text-lg font-semibold text-[#f5f3ef]">Press & partnerships</h2>
            <p className="mt-1 text-sm text-[#b8b3a8]">Media kit, interviews, ecosystem.</p>
            <a className="inline-flex items-center justify-center px-4 py-2 mt-4 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors w-full sm:w-auto" href="/press">
              Press resources
            </a>
          </div>

          <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h2 className="text-lg font-semibold text-[#f5f3ef]">Offices</h2>
            <div className="mt-3 text-sm text-[#b8b3a8] space-y-3">
              <div>
                <div className="font-medium text-[#e9c55a]">Global (Remote-first)</div>
                <div className="text-[#7a756a] mt-0.5">Teams across IST • CET • PT</div>
              </div>
              <div className="h-px bg-[#d4af37]/10 w-full" />
              <div>
                <div className="font-medium text-[#e9c55a]">Registered HQ</div>
                <div className="text-[#7a756a] mt-0.5">Will update on launch</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Netlify Forms + fallback mailto */}
        <div className="lg:col-span-2">
          <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)] space-y-4">
            <h2 className="text-xl font-semibold text-[#f5f3ef]">Send us a message</h2>

            {ok && (
              <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
                {ok}
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <form
              name="lead"
              onSubmit={async (e) => {
                e.preventDefault();
                setSending(true);
                setError(null);

                try {
                  const body = new URLSearchParams({
                    "form-name": "lead",
                    name: f.name,
                    email: f.email,
                    company: f.company,
                    subject: f.subject,
                    message: f.message,
                  });

                  const res = await fetch("/", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: body.toString(),
                  });

                  // Support custom formresponses subject line
                  const formData = new FormData(e.currentTarget);
                  formData.set("form-name", "lead");
                  const customSubject = `New Lead from VAiyu Website - ${f.name || f.company}`;
                  body.append("subject", customSubject); // Attempt injection to Netlify variables

                  if (res.ok) {
                    navigate("/thanks");
                  } else {
                    setError("Something went wrong. Please try the 'Send via email' button instead.");
                    setSending(false);
                  }
                } catch {
                  setError("Network error. Please try the 'Send via email' button instead.");
                  setSending(false);
                }
              }}
              className="space-y-4"
            >
              {/* Hidden Netlify config */}
              <input type="hidden" name="form-name" value="lead" />
              {/* This magically sets the email subject in Netlify Notifications */}
              <input type="hidden" name="subject" value={`New Lead from VAiyu Website - ${f.name || f.company || f.email}`} />
              <p className="hidden">
                <label>
                  Don't fill this out: <input name="bot-field" />
                </label>
              </p>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="text-sm font-medium text-[#b8b3a8]">
                  Your name
                  <input
                    className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all"
                    name="name"
                    value={f.name}
                    onChange={(e) => up("name", e.target.value)}
                    required
                    autoComplete="name"
                  />
                </label>

                <label className="text-sm font-medium text-[#b8b3a8]">
                  Work email
                  <input
                    type="email"
                    className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all"
                    name="email"
                    value={f.email}
                    onChange={(e) => up("email", e.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>

                <label className="text-sm font-medium text-[#b8b3a8] sm:col-span-2">
                  Company / Hotel
                  <input
                    className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all"
                    name="company"
                    value={f.company}
                    onChange={(e) => up("company", e.target.value)}
                    required
                  />
                </label>

                <label className="text-sm font-medium text-[#b8b3a8] sm:col-span-2">
                  Subject
                  <input
                    className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all"
                    placeholder="Optional"
                     // Intentionally changing local state f.userSubject vs Netlify hidden 'subject'
                     // We map this input to "message_subject" to avoid clashing with the hidden _subject field Netlify parses
                    name="message_subject"
                    value={f.subject}
                    onChange={(e) => up("subject", e.target.value)}
                  />
                </label>

                <label className="text-sm font-medium text-[#b8b3a8] sm:col-span-2">
                  Message
                  <textarea
                    className="w-full mt-1.5 bg-[#1a1816]/80 border border-[#d4af37]/20 rounded-xl px-4 py-3 text-[#f5f3ef] placeholder:text-[#7a756a] focus:outline-none focus:border-[#d4af37]/60 focus:ring-1 focus:ring-[#d4af37]/60 transition-all resize-y"
                    name="message"
                    rows={5}
                    value={f.message}
                    onChange={(e) => up("message", e.target.value)}
                    placeholder="Tell us a bit about your property and goals…"
                    required
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  disabled={sending}
                  className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] border border-[#d4af37] rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.15)] hover:shadow-[0_0_30px_rgba(212,175,55,0.3)] hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:hover:translate-y-0 w-full sm:w-auto"
                  type="submit"
                >
                  {sending ? "Sending…" : "Request a demo"}
                </button>

                {/* Secondary: mailto fallback using current state */}
                <button
                  type="button"
                  className="inline-flex items-center justify-center px-6 py-3 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors w-full sm:w-auto"
                  onClick={sendViaEmail}
                >
                  Send via email
                </button>
              </div>

              <div className="text-xs text-[#7a756a] mt-4">
                By contacting us you agree to our{" "}
                <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="/privacy">
                  Privacy Policy
                </a>.
              </div>
            </form>

            <div className="pt-2">
              <p className="text-sm text-[#7a756a]">
                Prefer to write directly? Email{" "}
                <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="mailto:support@vaiyu.co.in">
                  support@vaiyu.co.in
                </a>.
              </p>
            </div>
          </div>

          <div className="mt-6 bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h3 className="text-base font-semibold text-[#f5f3ef]">FAQ</h3>
            <ul className="mt-3 text-sm text-[#b8b3a8] list-disc pl-5 space-y-2">
              <li>We typically respond within one business day.</li>
              <li>
                For urgent issues, please write to{" "}
                <a className="text-[#d4af37] hover:text-[#e9c55a] transition-colors underline decoration-[#d4af37]/30 hover:decoration-[#d4af37] underline-offset-4" href="mailto:support@vaiyu.co.in">
                  support@vaiyu.co.in
                </a>.
              </li>
              <li>We support pilots for single properties as well as chains.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
