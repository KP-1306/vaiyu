import React from "react";

export default function LiveProductPeek() {
  const items = [
    { tag: "Guest", poster: "/illustrations/peek_guest.png" },
    { tag: "Staff", poster: "/illustrations/peek_staff.png" }, // if cached, add ?v=2
    { tag: "Owner", poster: "/illustrations/peek_owner.png" },
  ];

  // Fallback image in case any poster is missing
  const FALLBACK = "/illustrations/peek_poster.png";

  return (
    <section id="peek" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">Live Product Peek</h2>
          <p className="mt-3 text-gray-600 max-w-3xl mx-auto">
            Three quick flows, captured from the real product.
          </p>
        </div>

        {/* Cards (no captions, equal sizes) */}
        <div className="grid gap-6 lg:grid-cols-3">
          {items.map((it) => (
            <figure
              key={it.tag}
              className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            >
              {/* Poster only (fill frame, crop bottom whitespace) */}
              <div className="relative w-full aspect-[16/10] bg-gray-50 overflow-hidden">
                <img
                  src={it.poster}
                  alt={`${it.tag} flow preview`}
                  className="absolute inset-0 h-full w-full object-cover object-top select-none"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    if (el.src.endsWith(FALLBACK)) return;
                    el.src = FALLBACK;
                  }}
                />
              </div>
            </figure>
          ))}
        </div>

        {/* CTA */}
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
