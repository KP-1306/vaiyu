// web/src/App.tsx
import { Link } from 'react-router-dom';

const bg =
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=1600&auto=format&fit=crop'; // beachy hero
const card1 =
  'https://images.unsplash.com/photo-1519822471289-0eef0a80a0dc?q=80&w=1200&auto=format&fit=crop';
const card2 =
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?q=80&w=1200&auto=format&fit=crop';
const card3 =
  'https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=1200&auto=format&fit=crop';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top nav */}
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span
              className="inline-block h-8 w-8 rounded-xl"
              style={{ background: 'var(--brand, #145AF2)' }}
              aria-hidden
            />
            <span className="font-semibold text-lg tracking-tight">VAiyu</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#why" className="hover:text-gray-700">Why VAiyu</a>
            <a href="#explore" className="hover:text-gray-700">Explore</a>
            <Link to="/owner" className="hover:text-gray-700">For Hotels</Link>
            <Link to="/demo" className="hover:text-gray-700">Live Demo</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/precheck/DEMO" className="btn btn-light !py-2 !px-3 text-sm">Pre-check-in</Link>
            <Link to="/hk" className="btn !py-2 !px-3 text-sm">Try VAiyu</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative isolate"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.35)), url(${bg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-24 sm:py-28 lg:py-32 text-white">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
              New • Truth-anchored reviews
            </div>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl leading-tight">
              Your stay, made<span className="text-sky-300"> effortless</span>
            </h1>
            <p className="mt-3 text-white/90 text-lg">
              Breeze through check-in, order from your phone, and track housekeeping —
              all in one delightful PWA. Perfect for weekend escapes and long holidays.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to="/hotel/sunrise" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
                Explore a property
              </Link>
              <Link to="/stay/DEMO/menu" className="btn btn-light">
                Open guest menu
              </Link>
              <Link to="/owner/dashboard" className="link text-white/90 underline-offset-4">
                See owner dashboard →
              </Link>
            </div>
          </div>
        </div>

        {/* wave divider */}
        <svg
          viewBox="0 0 1440 140"
          className="absolute bottom-[-1px] left-0 w-full"
          aria-hidden
        >
          <path
            fill="#f9fafb"
            d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z"
          />
        </svg>
      </section>

      {/* Why VAiyu */}
      <section id="why" className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-2xl font-bold">Travel should feel easy</h2>
        <p className="text-gray-600 mt-1">…and a little magical ✨</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <Feature
            title="Express check-in"
            text="Your room ready as you arrive. No long queues."
            emoji="⚡"
          />
          <Feature
            title="Room service, reimagined"
            text="Order food & amenities right from your phone."
            emoji="🍽️"
          />
          <Feature
            title="Live housekeeping"
            text="Request towels or cleaning and track progress."
            emoji="🧼"
          />
          <Feature
            title="Crystal-clear bills"
            text="See charges in real time. No surprises."
            emoji="💳"
          />
        </div>
      </section>

      {/* Explore cards */}
      <section id="explore" className="mx-auto max-w-7xl px-4 pb-16">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-xl font-semibold">Explore stays</h3>
            <p className="text-gray-600">Handpicked destinations for sunny moods</p>
          </div>
          <Link to="/hotel/sunrise" className="link">View property →</Link>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-6">
          <Card img={card1} title="Seaside Suites" subtitle="Walk-to-beach • Private balconies" />
          <Card img={card2} title="Hilltop Hideout" subtitle="Valley views • Cozy fireplaces" />
          <Card img={card3} title="City Light Lofts" subtitle="Rooftop bar • Nightlife steps away" />
        </div>
      </section>

      {/* Quick demo entry points */}
      <section className="mx-auto max-w-7xl px-4 pb-20">
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
          <div>© {new Date().getFullYear()} VAiyu</div>
          <div className="flex items-center gap-4">
            <a className="hover:text-gray-800" href="#why">Why VAiyu</a>
            <Link className="hover:text-gray-800" to="/owner">For Hotels</Link>
            <Link className="hover:text-gray-800" to="/demo">Live Demo</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, text, emoji }: { title: string; text: string; emoji: string }) {
  return (
    <div className="card group hover:shadow-lg transition-shadow">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{text}</div>
    </div>
  );
}

function Card({ img, title, subtitle }: { img: string; title: string; subtitle: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm hover:shadow-lg transition-shadow">
      <div
        className="h-44 bg-cover bg-center"
        style={{ backgroundImage: `url(${img})` }}
        aria-hidden
      />
      <div className="p-4">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-gray-600">{subtitle}</div>
        <div className="mt-3">
          <Link to="/hotel/sunrise" className="btn btn-light !py-1.5 !px-3 text-sm">
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
