import { Link } from "react-router-dom";

export default function PublicLanding() {
  return (
    <main className="max-w-5xl mx-auto p-6 md:p-8">
      {/* Hero */}
      <section className="rounded-2xl border bg-white p-6 md:p-8">
        <h1 className="text-2xl md:text-3xl font-semibold">Welcome to VAiyu</h1>
        <p className="mt-2 text-gray-700">
          Guest journeys, owner console, and grid-interactive operations.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="btn" to="/signin">Sign in</Link>
          <Link className="btn btn-light" to="/guestold">Explore guest portal</Link>
          <Link className="btn btn-light" to="/owner/register">Register your property</Link>
        </div>
      </section>

      {/* Feature tiles */}
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Instant check-in</div>
          <p className="text-sm text-gray-600 mt-1">
            Scan on arrival and skip the queue.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Bills &amp; reviews</div>
          <p className="text-sm text-gray-600 mt-1">
            Find stays, download bills, leave feedback.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium">Owner console</div>
          <p className="text-sm text-gray-600 mt-1">
            Dashboards, SLAs and automations.
          </p>
        </div>
      </section>
    </main>
  );
}
