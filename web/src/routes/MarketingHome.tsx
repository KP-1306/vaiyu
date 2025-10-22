import { Link } from "react-router-dom";
import Header from "../components/Header";

export default function MarketingHome() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">VAiyu</h1>
        <p className="mt-2 text-gray-600">
          AI-powered hospitality OS. Delightful guest journeys, faster service, and
          clean owner dashboards.
        </p>

        <div className="mt-6 flex gap-3">
          <Link
            to="/guest"
            className="rounded-lg bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700"
          >
            Go to my trips
          </Link>
          <Link
            to="/owner"
            className="rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
          >
            Owner console
          </Link>
        </div>
      </main>
    </>
  );
}
