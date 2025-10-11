import { useState } from 'react';
import Pill from "../components/Pill";   // ✅ correct from /routes
import SEO from '../components/SEO';          // if the page is in /routes


export default function Contact() {
  const [sending, setSending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [f, setF] = useState({
    name: '',
    email: '',
    company: '',
    subject: '',
    message: '',
  });

  function up<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  // Simple client-side “send”: opens an email draft to our team
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setOk(null);

    const to = 'hello@vaiyu.app';
    const subject = encodeURIComponent(f.subject || `Contact from ${f.name || 'Guest'}`);
    const body = encodeURIComponent(
      `Name: ${f.name}\nEmail: ${f.email}\nCompany/Hotel: ${f.company}\n\n${f.message}`
    );

    // Open the user's email client
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    setSending(false);
    setOk('Opening your email client… If nothing appears, write to hello@vaiyu.app.');
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            'radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            ✉️ Contact
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">Contact VAiyu</h1>
          <p className="mt-3 max-w-2xl text-white/85">
            Partner with us to bring <b>truth-anchored AI</b> to your hotel—faster service, clearer SLAs, happier guests.
          </p>
        </div>
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Content */}
      <section className="mx-auto max-w-6xl px-4 py-10 grid gap-8 lg:grid-cols-3">
        {/* Left: quick contacts */}
        <div className="space-y-4">
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Talk to sales</h2>
            <p className="mt-1 text-sm text-gray-600">Rollout, pricing, ROI.</p>
            <a className="btn btn-light mt-3" href="mailto:sales@vaiyu.app">sales@vaiyu.app</a>
          </div>
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Customer support</h2>
            <p className="mt-1 text-sm text-gray-600">We’re here 24×7 for critical issues.</p>
            <a className="btn btn-light mt-3" href="mailto:support@vaiyu.app">support@vaiyu.app</a>
          </div>
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Press & partnerships</h2>
            <p className="mt-1 text-sm text-gray-600">Media kit, interviews, ecosystem.</p>
            <a className="btn btn-light mt-3" href="/press">Press resources</a>
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

        {/* Right: form */}
        <div className="lg:col-span-2">
          <form onSubmit={submit} className="card bg-white space-y-3">
            <h2 className="text-lg font-semibold">Send us a message</h2>
            {ok && <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700">{ok}</div>}

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm">
                Your name
                <input
                  className="input w-full mt-1"
                  value={f.name}
                  onChange={(e) => up('name', e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Email
                <input
                  type="email"
                  className="input w-full mt-1"
                  value={f.email}
                  onChange={(e) => up('email', e.target.value)}
                  required
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Company / Hotel
                <input
                  className="input w-full mt-1"
                  value={f.company}
                  onChange={(e) => up('company', e.target.value)}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Subject
                <input
                  className="input w-full mt-1"
                  value={f.subject}
                  onChange={(e) => up('subject', e.target.value)}
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Message
                <textarea
                  className="input w-full mt-1"
                  rows={6}
                  value={f.message}
                  onChange={(e) => up('message', e.target.value)}
                  placeholder="Tell us a bit about your property and goals…"
                  required
                />
              </label>
            </div>

            <div className="pt-1">
              <button disabled={sending} className="btn">
                {sending ? 'Sending…' : 'Send'}
              </button>
              <div className="text-xs text-gray-500 mt-2">
                By contacting us you agree to our <a className="link" href="/privacy">Privacy Policy</a>.
              </div>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
