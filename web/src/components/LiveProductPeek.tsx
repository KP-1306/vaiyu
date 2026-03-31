import React from "react";

export default function LiveProductPeek() {
  const items = [
    { tag: "Guest", poster: "/illustrations/peek_guest.png", y: 0 },
    { tag: "Staff", poster: "/illustrations/peek_staff.png", y: -10 },
    { tag: "Owner", poster: "/illustrations/peek_owner.png", y: 0 },
  ] as const;

  const FALLBACK = "/illustrations/peek_poster.png";

  return (
    <section id="peek" className="py-12 bg-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">Live Product Peek</h2>
          <p className="mt-4 text-[#b8b3a8] max-w-3xl mx-auto text-lg">
            Three quick flows, captured from the real product.
          </p>
        </div>

        {/* Cards (no captions, equal sizes, no cropping) */}
        <div className="grid gap-8 lg:grid-cols-3">
          {items.map((it) => (
            <figure
              key={it.tag}
              className="rounded-3xl border border-[#d4af37]/20 bg-[#141210]/90 shadow-[0_4px_24px_rgba(0,0,0,0.6)] backdrop-blur-md overflow-hidden hover:-translate-y-2 hover:border-[#d4af37]/40 transition-all duration-300 group"
            >
              <div className="border-b border-[#d4af37]/10 bg-[#1a1816] px-4 py-3 flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wider uppercase text-[#d4af37]">
                  {it.tag}
                </div>
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/20 border border-amber-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
                </div>
              </div>
              <div className="w-full h-[360px] bg-[#060608] grid place-items-center relative overflow-hidden">
                {/* Subtle glow behind the device */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#d4af37]/5 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <img
                  src={it.poster}
                  alt={`${it.tag} flow preview`}
                  className="h-full w-auto object-contain select-none opacity-90 group-hover:opacity-100 transition-opacity duration-300 relative z-10"
                  style={{ transform: `translateY(${it.y}px)` }}
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
      </div>
    </section>
  );
}
