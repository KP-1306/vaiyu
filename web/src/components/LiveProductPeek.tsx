import React from "react";

export default function LiveProductPeek() {
  const items = [
    {
      tag: "Guest",
      title: "Pre-check-in → Request → Live status",
      poster: "/illustrations/peek_guest.png",
    },
    {
      tag: "Staff",
      title: "HK ticket → Countdown → On-time/Late dashboard",
      poster: "/illustrations/peek_staff.png",
    },
    {
      tag: "Owner",
      title: "AI review draft → Approve → Publish",
      poster: "/illustrations/peek_owner.png",
    },
  ];

  // Fallback image in case any poster is missing
  const FALLBACK = "/illustrations/peek_poster.png";

  return (
    <section id="peek" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">Live Product Peek</h2>
          <p className="mt-3 text-gray-600 max-w-3xl mx-auto">
            Three quick flows, captured from the real product.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {items.map((it) => (
            <figure
              key={it.tag}
              className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            >
              {/* Title bar */}
              <div className="bg-gray-900 text-gray-100 px-4 py-2 text-xs">
                {it.tag} — {it.title}
              </div>

              {/* Distinct poster per flow with graceful fallback */}
              <img
                src={it.poster}
                alt={`${it.tag} flow preview`}
                className="w-full aspect-[16/10] object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement;
                  if (el.src.endsWith(FALLBACK)) return;
                  el.src = FALLBACK;
                }}
              />

              {/* Caption row */}
              <figcaption className="px-4 py-3 text-sm text-gray-700 border-t border-gray-100">
                {it.tag} flow: {it.title}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-8 text-center">
          <a
            href="/demo?property=sample"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-white font-medium hover:bg-blue-700 shadow"
          >
            Try a sample property
          </a>
        </div>
      </div>
    </section>
  );
}
