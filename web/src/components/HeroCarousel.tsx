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
    if (prefReduced || slides.length <= 1) return;

    const tick = () => setI((prev) => (prev + 1) % slides.length);

    timer.current = window.setInterval(() => {
      if (!paused.current) tick();
    }, interval);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [interval, slides.length, prefReduced]);

  function goto(n: number) {
    if (!slides.length) return;
    const next = ((n % slides.length) + slides.length) % slides.length;
    setI(next);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") goto(i - 1);
    if (e.key === "ArrowRight") goto(i + 1);
  }

  const activeSlide = slides[i];
  const activeId = activeSlide?.id ?? "";

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
    >
      {/* Slides */}
      <div className="relative h-full w-full">
        {slides.map((s, idx) => {
          const active = idx === i;
          return (
            <div
              key={s.id}
              className="absolute inset-0"
              aria-hidden={!active}
              aria-label={s.headline}
              aria-current={active ? "true" : undefined}
              style={{
                opacity: active ? 1 : 0,
                transform: active ? "scale(1)" : "scale(1.02)",
                transition: "opacity 700ms ease, transform 1200ms ease",
                zIndex: active ? 10 : 0, // slides stay *below* controls
              }}
            >
              {s.img ? (
                <>
                  <img
                    src={s.img}
                    alt={s.imgAlt || ""}
                    className="h-full w-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                    fetchpriority={idx === 0 ? "high" : undefined}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/35 to-black/10" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
              )}

              {/* Copy */}
              <div className="absolute inset-0 grid">
                <div className="self-end md:self-center px-6 md:px-10 lg:px-16 pb-10 md:pb-0">
                  <div className="max-w-3xl text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/35 px-3 py-1 text-xs mb-3 backdrop-blur">
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
            </div>
          );
        })}
      </div>

      {/* Dots – forced on top */}
      {slides.length > 1 && (
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-4 z-[60] flex items-center justify-center gap-2"
          style={{
            padding: "8px 0",
          }}
        >
          <div className="rounded-full bg-black/45 px-3 py-1 flex items-center gap-2 backdrop-blur">
            {slides.map((s, idx) => (
              <button
                key={s.id ?? idx}
                type="button"
                aria-label={`Go to slide ${idx + 1}`}
                aria-current={idx === i}
                onClick={() => goto(idx)}
                className={`h-2.5 rounded-full transition-all outline-none ${
                  idx === i
                    ? "w-6 bg-white shadow"
                    : "w-2.5 bg-white/50 hover:bg-white/90"
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Prev / Next arrows – forced on top */}
      {slides.length > 1 && (
        <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-between px-3">
          <button
            type="button"
            onClick={() => goto(i - 1)}
            className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black/65 px-3 py-2 text-white text-lg font-semibold shadow-lg backdrop-blur hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Previous slide"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goto(i + 1)}
            className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black/65 px-3 py-2 text-white text-lg font-semibold shadow-lg backdrop-blur hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Next slide"
          >
            ›
          </button>
        </div>
      )}

      {/* Screen-reader announce current slide */}
      <span className="sr-only" aria-live="polite">
        {activeId}
      </span>
    </section>
  );
}
