// web/src/routes/Demo.tsx
import { Link } from "react-router-dom";

export default function Demo() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">VAiyu Demo</h1>
      <p className="text-gray-600 mt-1">
        PWA skeleton is running. Choose a demo route:
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <Link className="card hover:shadow" to="/hotel/sunrise">Property microsite</Link>
        <Link className="card hover:shadow" to="/stay/DEMO/menu">Guest menu</Link>
        <Link className="card hover:shadow" to="/precheck/DEMO">Pre-check-in</Link>
        <Link className="card hover:shadow" to="/desk">Front Desk</Link>
        <Link className="card hover:shadow" to="/hk">Housekeeping</Link>
        <Link className="card hover:shadow" to="/kitchen">Kitchen</Link>
        <Link className="card hover:shadow" to="/owner/dashboard/sunrise">Owner dashboard</Link>
        <Link className="card hover:shadow" to="/owner/reviews">Review moderation</Link>
      </div>

      <div className="mt-6">
        <Link to="/" className="link">← Back to website</Link>
      </div>
    </main>
  );
}
