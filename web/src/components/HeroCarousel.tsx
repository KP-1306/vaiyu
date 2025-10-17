import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

type Slide = {
  id: string;
  headline: string;
  sub: string;
  cta: { label: string; href: string };
  img: string;     // public path or URL
  imgAlt: string;
};

const DEFAULT_INTERVAL = 6500;

export default function HeroCarousel({
  slides,
  interval = DEFAULT_INTERVAL,
}: { slides: Slide[]; interval?: number }) {
  const [i, setI] = useState(0);
  const prefReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const timer = useRef<number | null>(null);
  const paused = useRef(false);

  // Auto-advance (respect reduced motion)
  useEffect(() => {
    if (prefReduced || slides.length <= 1) return;
    const tick = () => setI((p) => (p + 1) % slides.length);
    timer.current = window.setInterval(() => !paused.current && tick(), interval);
    return () => timer.current && window.clearInterval(timer.current);
  }, [interval, slides.length, prefReduced]);

  function goto(n: number) {
    setI(((n % slides.length) + slides.length) % slides.length);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") goto(i - 1);
    if (e.key === "ArrowRight") goto(i + 1);
  }

  return (
    <section
      className="relative isolate h-[72vh] min-h-[520px] max-h-[820px] overflow-hidden rounded-3xl border"
      aria-roledescription="carousel"
      aria-label="Highlights"
      tabIndex={0}
      onKeyDown={onKey}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
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
              style={{
                opacity: active ? 1 : 0,
                transform: active ? "scale(1)" : "scale(1.02)",
                transition: "opacity 700ms ease, transform 1200ms ease",
              }}
            >
              {/* Background + overlay */}
              <img
                src={s.img}
                alt={s.imgAlt}
                className="h-full w-full object-cover"
                loading={idx === 0 ? "eager" : "lazy"}
                fetchpriority={idx === 0 ? "high" : undefined}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/30 to-black/10" />

              {/* Copy */}
              <div className="absolute inset-0 grid">
                <div className="self-end md:self-center px-6 md:px-10 lg:px-16 pb-10 md:pb-0">
                  <div className="max-w-3xl text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs mb-3 backdrop-blur">
                      <span aria-hidden>🤖</span> AI-powered hospitality OS
                    </div>
                    <h1 className="text-4xl md:text-6xl font-bold leading-tight">
                      {s.headline}
                    </h1>
                    <p className="mt-3 text-base md:text-lg text-white/90">
                      {s.sub}
                    </p>
                    <div className="mt-6">
                      <Link
                        to={s.cta.href}
                        className="btn btn-light text-base"
                      >
                        {s.cta.label}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Dots */}
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2">
        {slides.map((_, idx) => (
          <button
            key={idx}
            aria-label={`Go to slide ${idx + 1}`}
            aria-current={idx === i}
            onClick={() => goto(idx)}
            className={`h-2.5 rounded-full transition-all ${
              idx === i ? "w-6 bg-white" : "w-2.5 bg-white/50 hover:bg-white/80"
            }`}
          />
        ))}
      </div>

      {/* Prev/Next */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
        <button
          onClick={() => goto(i - 1)}
          className="pointer-events-auto btn btn-light !px-3 !py-2 opacity-80"
          aria-label="Previous slide"
        >
          ‹
        </button>
        <button
          onClick={() => goto(i + 1)}
          className="pointer-events-auto btn btn-light !px-3 !py-2 opacity-80"
          aria-label="Next slide"
        >
          ›
        </button>
      </div>
    </section>
  );
}
