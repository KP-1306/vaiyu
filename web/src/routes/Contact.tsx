// web/src/routes/Contact.tsx

import { useState } from "react";
import { Link } from "react-router-dom";
import SEO from "../components/SEO";

export default function Contact() {
  // unified local state (used for both Netlify submit and mailto fallback)
  const [sending, setSending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
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
    const to = "hello@vaiyu.app";
    const subject = encodeURIComponent(f.subject || `Contact from ${f.name || "Guest"}`);
    const body = encodeURIComponent(
      `Name: ${f.name}\nEmail: ${f.email}\nCompany/Hotel: ${f.company}\n\n${f.message}`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    setOk("Opening your email client… If nothing appears, write to hello@vaiyu.app.");
  }

  return (
    <main id="main" className="min-h-screen bg-gray-50 text-gray-900">
      <SEO
        title="Contact"
        canonical={`${location.origin}/contact`}
        description="Request a demo or ask anything about VAiyu — AI OS for hotels."
      />

      {/* ===== Hero ===== */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            "radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)",
        }}
      >
        <div className="relative z-[1] mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            ✉️ Contact
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">Contact VAiyu</h1>
          <p className="mt-3 max-w-2xl text-white/85">
            Partner with us to bring <b>truth-anchored AI</b> to your hotel — faster service, clearer
            SLAs, happier guests.
          </p>

          {/* CTAs (adds Back to home here) */}
          <div className="mt-6 flex flex-wrap gap-3">
            <a className="btn !bg-white !text-gray-900 hover:!bg-gray-50" href="#form">
              Send a message
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
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* ===== Content ===== */}
      <section id="form" className="mx-auto max-w-6xl px-4 py-10 grid gap-8 lg:grid-cols-3">
        {/* Left column: quick contacts */}
        <div className="space-y-4">
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Talk to sales</h2>
            <p className="mt-1 text-sm text-gray-600">Rollout, pricing, ROI.</p>
            <a className="btn btn-light mt-3" href="mailto:sales@vaiyu.app">
              sales@vaiyu.app
            </a>
          </div>

          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Customer support</h2>
            <p className="mt-1 text-sm text-gray-600">We’re here 24×7 for critical issues.</p>
            <a className="btn btn-light mt-3" href="mailto:support@vaiyu.app">
              support@vaiyu.app
            </a>
          </div>

          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Press & partnerships</h2>
            <p className="mt-1 text-sm text-gray-600">Media kit, interviews, ecosystem.</p>
            <a className="btn btn-light mt-3" href="/press">
              Press resources
            </a>
          </div>

          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Offices</h2>
            <div className="mt-2 text-sm text-gray-700 space-y-2">
              <div>
                <div className="font-medium">Global (Remote-first)</div>
                <div className="text-gray-500">Teams across IST • CET • PT</div>
              </div>
              <div>
                <div className="font-medium">Registered HQ</div>
                <div className="text-gray-500">Will update on launch</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Netlify Forms + fallback mailto */}
        <div className="lg:col-span-2">
          <div className="card bg-white space-y-3">
            <h2 className="text-lg font-semibold">Send us a message</h2>

            {ok && (
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700">
                {ok}
              </div>
            )}

            <form
              name="lead"
              method="POST"
              action="/thanks"
              data-netlify="true"
              data-netlify-honeypot="bot-field"
              onSubmit={() => setSending(true)}
              className="space-y-3"
            >
              <input type="hidden" name="form-name" value="lead" />
              <p className="hidden">
                <label>
                  Don’t fill this out: <input name="bot-field" />
                </label>
              </p>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  Your name
                  <input
                    className="input w-full mt-1"
                    name="name"
                    value={f.name}
                    onChange={(e) => up("name", e.target.value)}
                    required
                    autoComplete="name"
                  />
                </label>

                <label className="text-sm">
                  Work email
                  <input
                    type="email"
                    className="input w-full mt-1"
                    name="email"
                    value={f.email}
                    onChange={(e) => up("email", e.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>

                <label className="text-sm sm:col-span-2">
                  Company / Hotel
                  <input
                    className="input w-full mt-1"
                    name="company"
                    value={f.company}
                    onChange={(e) => up("company", e.target.value)}
                    required
                  />
                </label>

                <label className="text-sm sm:col-span-2">
                  Subject
                  <input
                    className="input w-full mt-1"
                    name="subject"
                    value={f.subject}
                    onChange={(e) => up("subject", e.target.value)}
                  />
                </label>

                <label className="text-sm sm:col-span-2">
                  Message
                  <textarea
                    className="input w-full mt-1"
                    name="message"
                    rows={6}
                    value={f.message}
                    onChange={(e) => up("message", e.target.value)}
                    placeholder="Tell us a bit about your property and goals…"
                    required
                  />
                </label>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button disabled={sending} className="btn" type="submit">
                  {sending ? "Sending…" : "Request a demo"}
                </button>

                {/* Secondary: mailto fallback using current state */}
                <button type="button" className="btn btn-light" onClick={sendViaEmail}>
                  Send via email
                </button>
              </div>

              <div className="text-xs text-gray-500 mt-2">
                By contacting us you agree to our <a className="link" href="/privacy">Privacy Policy</a>.
              </div>
            </form>

            <p className="text-xs text-gray-500">
              Prefer to write directly? Email{" "}
              <a className="link" href="mailto:hello@vaiyu.app">hello@vaiyu.app</a>.
            </p>
          </div>

          <div className="mt-4 card bg-white">
            <h3 className="text-base font-semibold">FAQ</h3>
            <ul className="mt-2 text-sm text-gray-700 list-disc pl-5 space-y-1">
              <li>We typically respond within one business day.</li>
              <li>
                For urgent issues, please write to{" "}
                <a className="link" href="mailto:support@vaiyu.app">support@vaiyu.app</a>.
              </li>
              <li>We support pilots for single properties as well as chains.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
