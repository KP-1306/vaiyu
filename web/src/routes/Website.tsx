// web/src/routes/Website.tsx
import { Link } from "react-router-dom";
import UseCases from "../sections/UseCases";

export default function Website() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <SiteNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
                New • Guest referrals + property-scoped credits
              </div>
              <h1 className="mt-4 text-4xl md:text-5xl font-bold leading-tight">
                Run a better stay with{" "}
                <span className="text-sky-600">real-time ops</span> and
                <span className="text-sky-600"> verified reviews</span>.
              </h1>
              <p className="mt-4 text-gray-600">
                VAiyu connects housekeeping, kitchen, and front desk into a fast
                PWA. Guests get a beautiful microsite; owners get KPIs and
                auto-drafted reviews backed by real activity. Now with{" "}
                <b>Refer &amp; Earn credits</b> redeemable on F&amp;B and services.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/hotel/sunrise" className="btn">View demo microsite</Link>
                <Link to="/owner" className="btn btn-light">Owner console</Link>
                <Link to="/demo" className="btn btn-outline">All demos</Link>
                {/* NEW: direct CTA for the referral feature */}
                <Link to="/guest" className="btn btn-light">See my credits</Link>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                No login needed • Mobile-first • Works offline
              </p>
            </div>

            <div className="lg:col-span-6">
              {/* Screenshot placeholder */}
              <div className="relative rounded-2xl bg-white shadow-lg ring-1 ring-gray-200">
                <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl">
                  <img
                    src="https://images.unsplash.com/photo-1501117716987-c8e3f6c9f4b3?q=80&w=1600&auto=format&fit=crop"
                    alt="App preview"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              {/* NEW: add a 4th mini-card for referrals */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs text-gray-600">
                <div className="card">Housekeeping SLAs</div>
                <div className="card">Kitchen Orders</div>
                <div className="card">Owner KPIs</div>
                <div className="card relative">
                  <span className="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-full border bg-green-50 text-green-700">New</span>
                  Refer &amp; Earn credits
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Logos (placeholder) */}
      <section className="py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-4">
            Built with
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {["React", "Fastify", "Tailwind", "Netlify"].map((t) => (
              <div key={t} className="card text-center">{t}</div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-14 bg-white">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold">Why VAiyu</h2>
          <div className="mt-6 grid md:grid-cols-3 gap-4">
            <Feat
              title="Real-time operations"
              body="Tickets & orders stream live over SSE. No refresh. No chaos."
            />
            <Feat
              title="Truth-anchored reviews"
              body="AI drafts that reference actual requests & SLAs. Publish with consent."
            />
            <Feat
              title="Owner dashboards"
              body="One glance KPIs, late/breach hints, and per-service trends."
            />
            <Feat
              title="Offline-first PWA"
              body="Works on spotty Wi-Fi; service worker caches the shell."
            />
            <Feat
              title="Simple theming"
              body="Set brand color/mode; guest microsite matches your property."
            />
            <Feat
              title="Fast setup"
              body="Start with in-memory demo. Swap to DB later (Postgres/Supabase)."
            />
            {/* NEW: feature tile for referrals */}
            <Feat
              title="Refer & Earn credits"
              body="Guests refer via VAiyu Account ID, registered phone or email; credits are property-scoped and redeemable on F&B & services."
            />
          </div>
        </div>
      </section>

      {/* NEW: Use-cases (includes Refer & Earn card) */}
      <UseCases />

      {/* Pricing (placeholder) */}
      <section className="py-14">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold">Pricing</h2>
          <div className="mt-6 grid md:grid-cols-3 gap-4">
            <Plan
              name="Starter"
              price="Free"
              bullets={["Demo hotel", "Guest microsite", "Ops tickets & orders"]}
              cta="Launch demo"
              href="/demo"
            />
            <Plan
              name="Pro"
              price="$99/mo"
              bullets={[
                "Multiple properties",
                "Owner dashboards",
                "SSE live updates",
              ]}
              cta="Talk to us"
              href="mailto:hello@example.com"
            />
            <Plan
              name="Enterprise"
              price="Custom"
              bullets={["SSO & roles", "Custom SLAs", "White-label"]}
              cta="Contact sales"
              href="mailto:hello@example.com"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-14 bg-white">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-2xl font-semibold">FAQ</h2>
        <div className="mt-6 grid md:grid-cols-2 gap-4">
            <Faq q="Can we publish reviews without guest consent?"
                 a="No. Even in auto mode, consent is required before publishing. We only create drafts/pending items otherwise." />
            <Faq q="Does this need an app store install?"
                 a="No. It’s a PWA. Share a link; guests can add it to their home screen." />
            <Faq q="Will this work offline?"
                 a="Yes—the shell loads offline; network actions queue/retry when back online." />
            <Faq q="Can we theme it?"
                 a="Yes—set brand color & mode in Owner → Policies & Theme." />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h3 className="text-2xl font-semibold">
            Ready to try VAiyu at your property?
          </h3>
          <p className="mt-2 text-gray-600">
            Explore the demo or jump right into the Owner console.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/hotel/sunrise" className="btn">Guest demo</Link>
            <Link to="/owner" className="btn btn-light">Owner console</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ---------- local tiny components (kept here for simplicity) ---------- */

function SiteNav() {
  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-200">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link to="/" className="font-semibold text-lg">
          <span className="text-sky-600">VA</span>iyu
        </Link>
        <nav className="hidden md:flex items-center gap-5 text-sm">
          <Link to="/hotel/sunrise" className="link">Microsite</Link>
          <Link to="/desk" className="link">Front Desk</Link>
          <Link to="/owner" className="link">Owner</Link>
          <Link to="/demo" className="btn btn-outline">All demos</Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-gray-600 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <div>© {new Date().getFullYear()} VAiyu</div>
        <div className="flex gap-4">
          <a className="link" href="mailto:hello@example.com">Contact</a>
          <a className="link" href="#">Privacy</a>
          <a className="link" href="#">Terms</a>
        </div>
      </div>
    </footer>
  );
}

function Feat({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-sm text-gray-600">{body}</p>
    </div>
  );
}

function Plan({
  name, price, bullets, cta, href,
}: { name: string; price: string; bullets: string[]; cta: string; href: string }) {
  return (
    <div className="card flex flex-col">
      <div className="font-semibold">{name}</div>
      <div className="mt-1 text-3xl font-bold">{price}</div>
      <ul className="mt-3 space-y-1 text-sm text-gray-600">
        {bullets.map((b) => <li key={b}>• {b}</li>)}
      </ul>
      <a href={href} className="btn mt-4 self-start">{cta}</a>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="card">
      <div className="font-medium">{q}</div>
      <p className="mt-1 text-sm text-gray-600">{a}</p>
    </div>
  );
}
