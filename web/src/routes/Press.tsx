import { Link } from 'react-router-dom';
import Pill from "../components/Pill";   // ✅ correct from /routes


export default function Press() {
  const year = new Date().getFullYear();

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
            🗞️ Press Kit
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">VAiyu Press & Media</h1>
          <p className="mt-3 max-w-2xl text-white/85">
            Logos, product shots, boilerplate and media contacts. Everything you need to cover VAiyu.
          </p>
          <div className="mt-6 flex gap-3">
            <a href="/brand/VAiyu-PressKit.zip" className="btn !bg-white !text-gray-900" download>
              Download full press kit
            </a>
            <Link to="/about" className="btn btn-light">About VAiyu</Link>
          </div>
        </div>
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 space-y-8">
        {/* Logos */}
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Logos</h2>
          <p className="mt-1 text-sm text-gray-600">
            Use the colored logo on dark backgrounds and the mono logo on light backgrounds. Do not alter colors,
            stretch, or add shadows.
          </p>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <Asset
              title="Full-color logo (PNG)"
              src="/brand/logo-color.png"
              alt="VAiyu full-color logo"
              href="/brand/logo-color.png"
            />
            <Asset
              title="Mono logo (SVG)"
              src="/brand/logo-mono.svg"
              alt="VAiyu mono logo"
              href="/brand/logo-mono.svg"
            />
          </div>
          <div className="mt-4">
            <a className="btn btn-light" href="/brand/VAiyu-Logos.zip" download>
              Download all logos (.zip)
            </a>
          </div>
        </div>

        {/* Product shots */}
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Product shots</h2>
          <p className="mt-1 text-sm text-gray-600">
            Screens of the guest microsite, live request tracking, and the owner dashboard.
          </p>
          <div className="mt-4 grid sm:grid-cols-3 gap-4">
            <Shot title="Guest Microsite" src="/brand/shot-guest.png" />
            <Shot title="Front Desk / HK" src="/brand/shot-ops.png" />
            <Shot title="Owner Dashboard" src="/brand/shot-owner.png" />
          </div>
          <div className="mt-4">
            <a className="btn btn-light" href="/brand/VAiyu-ProductShots.zip" download>
              Download all shots (.zip)
            </a>
          </div>
        </div>

        {/* Boilerplate */}
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Company boilerplate</h2>
          <p className="mt-2 text-gray-700">
            <b>VAiyu</b> is the operating system for modern hospitality. We connect guest experience, hotel
            operations and <b>truth-anchored AI</b> on one platform—so service is faster, SLAs are clearer and reviews
            reflect the reality of every stay. From contactless check-in to live housekeeping requests and an owner
            dashboard with policy hints, VAiyu helps hotels deliver five-star service at scale.
          </p>
        </div>

        {/* Contact */}
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Media contact</h2>
          <div className="mt-2 text-gray-700">
            Press & partnerships: <a className="link" href="mailto:press@vaiyu.app">press@vaiyu.app</a>
            <div className="text-sm text-gray-500 mt-1">© {year} VAiyu</div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Asset({ title, src, alt, href }: { title: string; src: string; alt: string; href: string }) {
  return (
    <div className="rounded border p-3 flex items-center gap-3">
      <img src={src} alt={alt} className="h-12 w-12 object-contain" />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <a href={href} download className="text-sm link">Download</a>
      </div>
    </div>
  );
}

function Shot({ title, src }: { title: string; src: string }) {
  return (
    <figure className="rounded border bg-white overflow-hidden">
      <img src={src} alt={title} className="w-full h-40 object-cover" />
      <figcaption className="px-3 py-2 text-sm text-gray-700">{title}</figcaption>
    </figure>
  );
}
