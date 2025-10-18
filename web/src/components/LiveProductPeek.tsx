import React from "react";

export default function LiveProductPeek() {
  const items = [
    {
      title: "Guest — Pre-check-in → Request → Live status",
      src: "/videos/guest_peek.mp4",
      poster: "/illustrations/peek_guest_poster.jpg",
    },
    {
      title: "Staff — HK ticket → Countdown → On-time/Late dashboard",
      src: "/videos/staff_peek.mp4",
      poster: "/illustrations/peek_staff_poster.jpg",
    },
    {
      title: "Owner — AI review draft → Approve → Publish",
      src: "/videos/owner_peek.mp4",
      poster: "/illustrations/peek_owner_poster.jpg",
    },
  ];

  return (
    <section id="peek" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">Live Product Peek</h2>
          <p className="mt-3 text-gray-600 max-w-3xl mx-auto">
            Three quick clips. Real flows, no fluff.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {items.map((v) => (
            <figure key={v.title} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-gray-900 text-gray-200 px-4 py-2 text-xs">{v.title}</div>
              <video
                className="w-full aspect-[16/10] object-cover"
                muted
                playsInline
                autoPlay
                loop
                preload="metadata"
                poster={v.poster}
              >
                <source src={v.src} type="video/mp4" />
              </video>
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
