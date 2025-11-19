// web/src/components/HeroCarousel.tsx
import type React from "react";
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

type HeroCarouselProps = {
  slides: Slide[];
  interval?: number;
  disableCtas?: boolean;
};

function CtaButton({ href, label }: { href: string; label: string }) {
  const isHash = href.startsWith("#");
  const isExternal = /^https?:\/\//i.test(href);

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

  if (!slides || slides.length === 0) return null;

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
              className="absolute inset-0 z-10"
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
        <div className="absolute bottom-4 left-0 right-0 z-30 flex items-center justify-center gap-2">
          {slides.map((s, idx) => {
            const active = idx === i;
            return (
              <button
                key={s.id ?? idx}
                aria-label={`Go to slide ${idx + 1}`}
                aria-current={active}
                onClick={() => goto(idx)}
                className="rounded-full transition-all"
                style={{
                  width: active ? 24 : 10,
                  height: 10,
                  borderRadius: 9999,
                  backgroundColor: `rgba(255,255,255,${active ? 1 : 0.5})`,
                  border: active ? "1px solid rgba(0,0,0,0.4)" : "none",
                }}
              >
                {/* Text bullet so it's visible even if CSS fails */}
                <span
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0,0,0,0)",
                    whiteSpace: "nowrap",
                    border: 0,
                  }}
                >
                  {idx + 1}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Prev/Next */}
      {slides.length > 1 && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-between px-2">
          <button
            onClick={() => goto(i - 1)}
            className="pointer-events-auto flex items-center justify-center text-white"
            style={{
              width: 36,
              height: 36,
              borderRadius: 9999,
              backgroundColor: "rgba(0,0,0,0.45)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
            aria-label="Previous slide"
          >
            ‹
          </button>
          <button
            onClick={() => goto(i + 1)}
            className="pointer-events-auto flex items-center justify-center text-white"
            style={{
              width: 36,
              height: 36,
              borderRadius: 9999,
              backgroundColor: "rgba(0,0,0,0.45)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
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
