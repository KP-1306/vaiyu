// web/src/components/HeroCarousel.tsx
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export type Slide = {
  id: string;
  headline: string;
  sub?: string;
  cta?: { label: string; href: string } | null; // allow null or omit
  img?: string; // optional: public path or URL
  imgAlt?: string;
  variant?: "photo" | "solid";
};

const DEFAULT_INTERVAL = 6500;

type HeroCarouselProps = {
  slides: Slide[];
  interval?: number;
  disableCtas?: boolean;
};

function CtaButton({ href, label }: { href: string; label: string }) {
  const isHash = href.startsWith("#");
  const isExternal = /^https?:\/\//i.test(href);

  // Hash links or full URLs → plain <a>, routes → <Link>
  if (isHash || isExternal) {
    return (
      <a href={href} className="btn btn-light text-base">
        {label}
      </a>
    );
  }

  return (
    <Link to={href} className="btn btn-light text-base">
      {label}
    </Link>
  );
}

export default function HeroCarousel({
  slides,
  interval = DEFAULT_INTERVAL,
  disableCtas = false,
}: HeroCarouselProps) {
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
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [interval, slides.length, prefReduced]);

  function goto(n: number) {
    if (slides.length === 0) return;
    setI(((n % slides.length) + slides.length) % slides.length);
  }

  function onKey(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowLeft") goto(i - 1);
    if (e.key === "ArrowRight") goto(i + 1);
  }

  const activeId = slides[i]?.id ?? "";

  return (
    <section
      className="relative isolate h-[72vh] min-h-[520px] max-h-[820px] overflow-hidden rounded-3xl border"
      aria-roledescription="carousel"
      aria-label="Highlights"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={onKey}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      {/* Slides */}
      <ul className="relative h-full w-full">
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
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/30 to-black/10" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
              )}

              {/* Copy */}
              <div className="absolute inset-0 grid">
                <div className="self-end pb-10 pl-6 pr-6 md:self-center md:px-10 lg:px-16 md:pb-0">
                  <div className="max-w-3xl text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs backdrop-blur">
                      <span aria-hidden>🤖</span> AI-powered hospitality OS
                    </div>
                    <h1 className="text-4xl font-bold leading-tight md:text-6xl">
                      {s.headline}
                    </h1>
                    {s.sub ? (
                      <p className="mt-3 text-base text-white/90 md:text-lg">
                        {s.sub}
                      </p>
                    ) : null}

                    {/* CTA — optional & globally hideable */}
                    {!disableCtas && s.cta?.href ? (
                      <div className="mt-6">
                        <CtaButton href={s.cta.href} label={s.cta.label} />
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
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2">
          {slides.map((s, idx) => (
            <button
              key={s.id ?? idx}
              aria-label={`Go to slide ${idx + 1}`}
              aria-current={idx === i}
              onClick={() => goto(idx)}
              className={`h-2.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-white" : "w-2.5 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      )}

      {/* Prev/Next */}
      {slides.length > 1 && (
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
      )}

      {/* SR-only active slide ref */}
      <span className="sr-only" aria-live="polite">
        {activeId}
      </span>
    </section>
  );
}
