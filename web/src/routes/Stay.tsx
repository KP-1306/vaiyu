import { Link, useParams } from "react-router-dom";

export default function Stay() {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stay details</h1>
        <Link to="/stays" className="btn btn-light">All stays</Link>
      </div>

      <p className="text-sm text-gray-600 mt-2">
        You opened stay <span className="font-mono">{id}</span>.
      </p>

      <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-5">
        <p className="text-sm text-gray-700">
          We’ll show booking info, hotel reply, review, and any credits earned for this stay.
        </p>

        <div className="mt-4 flex gap-2">
          <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
          <Link to="/stays" className="btn btn-light">See all stays</Link>
        </div>
      </section>
    </main>
  );
}
