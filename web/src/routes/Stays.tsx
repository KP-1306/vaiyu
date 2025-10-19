import { Link } from "react-router-dom";

export default function Stays() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your stays</h1>
        <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
      </div>

      <p className="text-sm text-gray-600 mt-2">
        A tidy place for your trips, bills, reviews, and rewards—coming together here.
      </p>

      {/* Placeholder content so the route is alive now. 
          Later you can render real data (last 10 stays) from your API/view. */}
      <section className="mt-6 rounded-2xl border bg-white/90 shadow-sm p-5">
        <h2 className="font-medium">Recent stays</h2>
        <p className="text-sm text-gray-600 mt-1">
          We’ll show your last 10 hotels here with previews, earned credits, and reviews.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>

        <p className="text-xs text-gray-500 mt-4">
          Tip: Want this live now? Wire this page to your Supabase view for recent stays and I’ll plug it in.
        </p>
      </section>
    </main>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border p-4 bg-white">
      <div className="h-5 w-1/2 bg-gray-100 rounded" />
      <div className="mt-2 h-4 w-1/3 bg-gray-100 rounded" />
      <div className="mt-4 h-24 bg-gray-50 rounded" />
      <div className="mt-3 flex gap-2">
        <div className="h-8 w-24 bg-gray-100 rounded" />
        <div className="h-8 w-24 bg-gray-100 rounded" />
      </div>
    </div>
  );
}
