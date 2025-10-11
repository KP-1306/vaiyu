// web/src/App.tsx
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Pill from './components/Pill';

type CardHotel = { slug: string; name: string; blurb: string; image: string };

const heroBg =
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=1600&auto=format&fit=crop';

const EXPLORE_CARDS: CardHotel[] = [
  {
    slug: 'seaside',
    name: 'Seaside Suites',
    blurb: 'Walk-to-beach • Private balconies',
    image:
      'https://images.unsplash.com/photo-1519822471289-0eef0a80a0dc?q=80&w=1600&auto=format&fit=crop',
  },
  {
    slug: 'sunrise',
    name: 'Hilltop Hideout',
    blurb: 'Valley views • Cozy fireplaces',
    image:
      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?q=80&w=1600&auto=format&fit=crop',
  },
  {
    slug: 'citylight',
    name: 'City Light Lofts',
    blurb: 'Rooftop bar • Nightlife steps away',
    image:
      'https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=1600&auto=format&fit=crop',
  },
];

export default function App() {
  // (Optional) could be used later to hydrate from API; harmless to keep now
  const [cards, setCards] = useState<CardHotel[]>(EXPLORE_CARDS);
  useEffect(() => setCards(EXPLORE_CARDS), []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/brand/vaiyu-logo.png"
              alt="VAiyu"
              className="h-8 w-auto hidden sm:block"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <span
              className="sm:hidden inline-block h-8 w-8 rounded-xl"
              style={{ background: 'var(--brand, #145AF2)' }}
              aria-hidden
            />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#why" className="hover:text-gray-700">
              Why VAiyu
            </a>
            <a href="#ai" className="hover:text-gray-700">
              AI
            </a>
            <a href="#explore" className="hover:text-gray-700">
              Explore
            </a>
            <Link to="/owner" className="hover:text-gray-700">
              For Hotels
            </Link>
            <a href="#demo" className="hover:text-gray-700">
              Live Demo
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/precheck/DEMO" className="btn btn-light !py-2 !px-3 text-sm">
              Pre-check-in
            </Link>
            <Link to="/owner" className="btn !py-2 !px-3 text-sm">
              Try VAiyu
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,.35)), url(${heroBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-24 sm:py-28 lg:py-32 text-white">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
              <span className="animate-pulse">🤖</span> AI-powered hospitality OS
            </div>

            {/* Clean headline (logo removed here) */}
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl leading-tight">
              Where <span className="text-sky-300">Intelligence</span> Meets Comfort
            </h1>

            <p className="mt-3 text-white/90 text-lg">
              We turn real stay activity into truth-anchored reviews, faster service, and delightful mobile journeys —
              perfect for holidays and long escapes.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="#explore" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
                Explore a property
              </a>
              {/* No “Open guest menu” here since no property is selected yet */}
              <Link to="/owner/reviews" className="btn btn-light">
                Try AI review demo →
              </Link>
            </div>
          </div>
        </div>

        {/* wave divider */}
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Why VAiyu */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">Travel should feel easy</h2>
        <p className="text-gray-600 mt-1">…and a little magical ✨</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <Feature title="Express check-in" text="Skip queues. Your room, ready as you arrive." emoji="⚡" />
          <Feature title="Room service, reimagined" text="Order food & amenities from your phone." emoji="🍽️" />
          <Feature title="Live housekeeping" text="Request towels, cleaning & track progress." emoji="🧼" />
          <Feature title="Crystal-clear bills" text="See charges in real time. No surprises." emoji="💳" />
        </div>
      </section>

      {/* AI Showcase */}
      <section id="ai" className="mx-auto max-w-7xl px-4 pb-14">
        <div className="relative overflow-hidden rounded-3xl p-1">
          <div
            className="rounded-[20px] p-6 sm:p-8"
            style={{
              background:
                'radial-gradient(1200px 400px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(1000px 400px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #ffffff, #f8fafc)',
            }}
          >
            <div className="flex flex-col lg:flex-row items-start gap-8">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 text-sky-800 px-3 py-1 text-xs">
                  New • AI that’s grounded in real ops
                </div>
                <h3 className="mt-3 text-2xl font-bold">Let AI do the busywork, not the guesswork</h3>
                <p className="mt-2 text-gray-600">
                  VAiyu builds truth-anchored suggestions from actual stay activity — tickets, orders & SLA timings —
                  then drafts reviews, nudges teams, and highlights what to fix.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill>Truth-anchored reviews</Pill>
                  <Pill>Auto-draft at checkout</Pill>
                  <Pill>Owner moderation</Pill>
                  <Pill>Live SSE updates</Pill>
                </div>
                <div className="mt-6 flex gap-3">
                  <Link to="/owner/reviews" className="btn">
                    Try AI review demo
                  </Link>
                  <Link to="/owner/dashboard" className="btn btn-light">
                    See KPIs
                  </Link>
                </div>
              </div>

              <ul className="grid sm:grid-cols-2 gap-3 w-full lg:max-w-md">
                <AICard
                  title="AI review drafts"
                  text="Auto-summaries with on-time vs late and avg minutes — ready to approve."
                  emoji="📝"
                />
                <AICard title="Policy hints" text="If SLAs slip, owners see a one-line fix to act on right away." emoji="🧭" />
                <AICard title="Ops automation" text="Tickets/orders stream live via SSE; agents act without refresh." emoji="🔔" />
                <AICard title="Brand-safe" text="No hallucinations — content is built from verifiable stay data." emoji="🛡️" />
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Explore */}
      <section id="explore" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-xl font-semibold">Explore stays</h3>
            <p className="text-gray-600">Handpicked destinations for sunny moods</p>
          </div>
          <Link to="/hotel/sunrise" className="link">
            View property →
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-6">
          {cards.map((c) => (
            <ImageCard key={c.slug} img={c.image} title={c.name} subtitle={c.blurb} slug={c.slug} />
          ))}
        </div>
      </section>

      {/* Quick demo entry points */}
      <section id="demo" className="mx-auto max-w-7xl px-4 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <DemoLink to="/hotel/sunrise" label="Property microsite" />
          <DemoLink to="/stay/DEMO/menu" label="Guest menu" />
          <DemoLink to="/precheck/DEMO" label="Pre-check-in" />
          <DemoLink to="/desk" label="Front Desk" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-gray-600 flex flex-wrap items-center justify-between gap-3">
          <div>© {new Date().getFullYear()} VAiyu — Where Intelligence Meets Comfort.</div>
          <nav className="flex items-center gap-4">
            <Link className="hover:text-gray-800" to="/about">
              About
            </Link>
            <Link className="hover:text-gray-800" to="/press">
              Press
            </Link>
            <Link className="hover:text-gray-800" to="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-gray-800" to="/terms">
              Terms
            </Link>
            <Link className="hover:text-gray-800" to="/contact">
              Contact
            </Link>
            <Link className="hover:text-gray-800" to="/careers">
              Careers
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Local UI helpers ---------- */

function Feature({ title, text, emoji }: { title: string; text: string; emoji: string }) {
  return (
    <div className="card group hover:shadow-lg transition-shadow">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </div>
  );
}

function AICard({ title, text, emoji }: { title: string; text: string; emoji: string }) {
  return (
    <li className="card bg-white/80 backdrop-blur">
      <div className="text-xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </li>
  );
}

function ImageCard({
  img,
  title,
  subtitle,
  slug,
}: {
  img: string;
  title: string;
  subtitle: string;
  slug: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm hover:shadow-lg transition-shadow">
      <div className="h-44 bg-cover bg-center" style={{ backgroundImage: `url(${img})` }} aria-hidden />
      <div className="p-4">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-gray-600">{subtitle}</div>
        <div className="mt-3">
          <Link to={`/hotel/${slug}`} className="btn btn-light !py-1.5 !px-3 text-sm">
            View details
          </Link>
        </div>
      </div>
    </div>
  );
}

function DemoLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 hover:shadow transition-shadow"
    >
      <span className="font-medium">{label}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}
