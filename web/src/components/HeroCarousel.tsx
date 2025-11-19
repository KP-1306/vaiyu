// web/src/components/HeroCarousel.tsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export type Slide = {
  id: string;
  headline: string;
  sub?: string;
  cta?: { label: string; href: string } | null;
  img?: string;
  imgAlt?: string;
  variant?: "photo" | "solid";
};

const DEFAULT_INTERVAL = 6500;

export default function HeroCarousel({
  slides,
  interval = DEFAULT_INTERVAL,
  disableCtas = false,
}: {
  slides: Slide[];
  interval?: number;
  disableCtas?: boolean;
}) {
  const [i, setI] = useState(0);

  const prefReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const timer = useRef<number | null>(null);
  const paused = useRef(false);

  // Auto-advance (respect reduced motion)
  useEffect(() => {
    if (prefReduced || !slides || slides.length <= 1) return;

    const tick = () => setI((p) => (p + 1) % slides.length);
    timer.current = window.setInterval(() => {
      if (!paused.current) tick();
    }, interval);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [interval, slides, prefReduced]);

  function goto(n: number) {
    if (!slides || slides.length === 0) return;
    setI(((n % slides.length) + slides.length) % slides.length);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") goto(i - 1);
    if (e.key === "ArrowRight") goto(i + 1);
  }

  if (!slides || slides.length === 0) {
    return null;
  }

  const showControls = slides.length > 1;
  const activeId = slides[i]?.id ?? "";

  return (
    <section
      className="relative isolate h-[72vh] min-h-[520px] max-h-[820px] overflow-hidden rounded-3xl border bg-black"
      aria-roledescription="carousel"
      aria-label="Highlights"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={onKey}
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
      style={{ position: "relative" }}
    >
      {/* Slides */}
      <ul className="h-full w-full relative">
        {slides.map((s, idx) => {
          const active = idx === i;
          return (
            <li
              key={s.id}
              className="absolute inset-0"
              aria-hidden={!active}
              aria-label={s.headline}
              aria-current={active ? "true" : undefined}
              style={{
                opacity: active ? 1 : 0,
                transform: active ? "scale(1)" : "scale(1.02)",
                transition: "opacity 700ms ease, transform 1200ms ease",
                zIndex: active ? 5 : 0, // always below controls
              }}
            >
              {/* Background + overlay */}
              {s.img ? (
                <>
                  <img
                    src={s.img}
                    alt={s.imgAlt || ""}
                    className="h-full w-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                    fetchpriority={idx === 0 ? "high" : undefined}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/40 to-black/15" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
              )}

              {/* Copy */}
              <div className="absolute inset-0 grid">
                <div className="self-end md:self-center px-6 md:px-10 lg:px-16 pb-10 md:pb-0">
                  <div className="max-w-3xl text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/40 px-3 py-1 text-xs mb-3 backdrop-blur-sm">
                      <span aria-hidden>🤖</span> AI-powered hospitality OS
                    </div>
                    <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                      {s.headline}
                    </h1>
                    {s.sub ? (
                      <p className="mt-3 text-base md:text-lg text-white/90">
                        {s.sub}
                      </p>
                    ) : null}

                    {/* CTA — optional & globally hideable */}
                    {!disableCtas && s.cta?.href ? (
                      <div className="mt-6">
                        <Link to={s.cta.href} className="btn btn-light text-base">
                          {s.cta.label}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Dots */}
      {showControls && (
        <div
          className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-3"
          style={{ zIndex: 30 }}
        >
          {slides.map((s, idx) => {
            const active = idx === i;
            return (
              <button
                key={s.id ?? idx}
                type="button"
                aria-label={`Go to slide ${idx + 1}`}
                aria-current={active}
                onClick={() => goto(idx)}
                className="relative inline-flex items-center justify-center rounded-full border border-white/70 transition-transform"
                style={{
                  width: active ? 18 : 10,
                  height: 10,
                  backgroundColor: active ? "#ffffff" : "rgba(0,0,0,0.45)",
                  boxShadow: "0 0 4px rgba(0,0,0,0.5)",
                }}
              >
                <span className="sr-only">{s.headline}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Prev / Next arrows */}
      {showControls && (
        <div
          className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-3 sm:px-4"
          style={{ zIndex: 30, pointerEvents: "none" }}
        >
          <button
            type="button"
            onClick={() => goto(i - 1)}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/65 text-white text-lg font-semibold shadow-md hover:bg-black"
            aria-label="Previous slide"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goto(i + 1)}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/65 text-white text-lg font-semibold shadow-md hover:bg-black"
            aria-label="Next slide"
          >
            ›
          </button>
        </div>
      )}

      {/* SR-only active slide ref */}
      <span className="sr-only" aria-live="polite">
        {activeId}
      </span>
    </section>
  );
}
