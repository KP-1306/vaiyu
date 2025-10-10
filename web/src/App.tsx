// web/src/App.tsx
import { Link } from "react-router-dom";

export default function App() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg" style={{ background: "var(--brand, #145AF2)" }} />
          <span className="text-xl font-semibold">VAiyu</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#features" className="hover:underline">Features</a>
          <a href="#how" className="hover:underline">How it works</a>
          <Link to="/demo" className="text-gray-600 hover:underline">Live demo</Link>
          <Link to="/owner" className="btn btn-light">Owner portal</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-12 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <h1 className="text-4xl font-bold leading-tight">
            Hospitality OS for <span style={{ color: "var(--brand, #145AF2)" }}>modern hotels</span>
          </h1>
          <p className="mt-4 text-gray-600">
            One lightweight PWA for guests, staff, and owners. Requests, F&B orders, housekeeping,
            folios, and truth-anchored reviews—out of the box.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/hotel/sunrise" className="btn">View sample property</Link>
            <Link to="/demo" className="btn btn-light">Try live demo</Link>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            No installs. Works offline. Deploy anywhere.
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4">
          <div className="rounded-xl border p-4">
            <div className="text-sm text-gray-500">Quick links</div>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <Link className="card hover:shadow" to="/stay/DEMO/menu">Guest menu</Link>
              <Link className="card hover:shadow" to="/desk">Front desk</Link>
              <Link className="card hover:shadow" to="/hk">Housekeeping</Link>
              <Link className="card hover:shadow" to="/owner/dashboard/sunrise">Owner dashboard</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold">What you get</h2>
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          <Feature title="Guest OS">
            Menu, orders, requests, bill, pre-check-in & checkout.
          </Feature>
          <Feature title="Ops OS">
            Live queues for Desk, HK, Kitchen; SLA timers; status & audit.
          </Feature>
          <Feature title="Owner OS">
            Policies & theme, moderation, truth-anchored reviews, KPIs.
          </Feature>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="mt-4 list-decimal pl-6 text-gray-700 space-y-2">
          <li>Point your domain to this PWA (Netlify/Vercel/Render supported).</li>
          <li>Connect your PMS/PoS later; run in demo with in-memory API today.</li>
          <li>Customize brand & policies in the Owner portal.</li>
        </ol>
        <div className="mt-6">
          <Link to="/owner" className="btn">Open Owner portal</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-16 py-8 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} VAiyu — PWA for hospitality
      </footer>
    </main>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-lg font-semibold">{title}</div>
      <div className="mt-2 text-gray-600">{children}</div>
    </div>
  );
}
