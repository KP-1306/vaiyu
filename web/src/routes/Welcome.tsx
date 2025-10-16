// web/src/routes/Welcome.tsx
import { Link, useNavigate } from "react-router-dom";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Back to app – prefer Link, with a safe navigate(-1) fallback */}
      <div className="mb-2">
        <button
          className="btn btn-light"
          onClick={() => {
            // go back if possible, else go home
            if (window.history.length > 1) navigate(-1);
            else navigate("/");
          }}
        >
          ← Back to app
        </button>
      </div>

      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="text-gray-600">Choose what you want to do today.</p>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Property (Owner) console */}
        <section className="card">
          <div className="font-semibold mb-1">🏨 Property console</div>
          <p className="text-sm text-gray-600">
            Manage services, dashboards, staff workflows and AI moderation.
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/owner" className="btn">Open owner home</Link>
            <Link to="/owner/services" className="btn btn-light">Services (SLA)</Link>
          </div>
          <div className="mt-2 text-sm">
            New property?{" "}
            <Link to="/owner/settings" className="text-blue-600 hover:underline">
              Register & configure
            </Link>
          </div>
        </section>

        {/* Guest console */}
        <section className="card">
          <div className="font-semibold mb-1">🧳 Guest console</div>
          <p className="text-sm text-gray-600">
            Attach a booking, request housekeeping, order F&amp;B, view bills.
          </p>
          <div className="mt-3 flex gap-2">
            <Link to="/claim" className="btn">Claim my stay</Link>
            <Link to="/guest" className="btn btn-light">Open guest dashboard</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
