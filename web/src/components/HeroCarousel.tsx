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

  // Auto-advance (unchanged behaviour)
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
    const len = slides.length;
    const next = ((n % len) + len) % len;
    setI(next);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") goto(i - 1);
    if (e.key === "ArrowRight") goto(i + 1);
  }

  const activeId = slides[i]?.id ?? "";

  if (!slides.length) return null;

  return (
    <section
      className="relative isolate h-[72vh] min-h-[520px] max-h-[820px] w-full overflow-hidden rounded-[2rem] border border-[#d4af37]/20 bg-[#141210] shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
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
                zIndex: active ? 10 : 0,
              }}
            >
              {/* Background */}
              {s.img ? (
                <>
                  <img
                    src={s.img}
                    alt={s.imgAlt || ""}
                    className="h-full w-full object-cover"
                    loading={idx === 0 ? "eager" : "lazy"}
                    // @ts-ignore
                    fetchpriority={idx === 0 ? "high" : undefined}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c]/90 via-[#0a0a0c]/40 to-black/20" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#141210] via-[#0a0a0c] to-[#141210]" />
              )}

              {/* Copy */}
              <div className="absolute inset-0 grid">
                <div className="self-end md:self-center px-6 md:px-12 lg:px-20 pb-16 md:pb-0 w-full max-w-5xl mx-auto">
                  <div className="max-w-3xl text-[#f5f3ef] drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/40 bg-black/40 px-3 py-1 text-xs mb-3 md:mb-4 backdrop-blur text-[#d4af37] font-medium tracking-wide">
                      <span aria-hidden>🤖</span> AI-powered hospitality OS
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                      {s.headline}
                    </h1>
                    {s.sub ? (
                      <p className="mt-3 md:mt-4 text-base md:text-lg lg:text-xl text-[#b8b3a8] max-w-2xl">
                        {s.sub}
                      </p>
                    ) : null}

                    {!disableCtas && s.cta?.href ? (
                      <div className="mt-6 md:mt-8">
                        <Link to={s.cta.href} className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] rounded-xl hover:opacity-90 transition-opacity">
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

      {/* DOTS */}
      {slides.length > 1 && (
        <div
          className="absolute inset-x-0 bottom-6 flex items-center justify-center"
          style={{ zIndex: 80 }}
        >
          <div
            className="flex items-center gap-4 sm:gap-6"
            style={{
              padding: "6px 12px",
              borderRadius: 9999,
              backgroundColor: "rgba(10, 10, 12, 0.6)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
              backdropFilter: "blur(12px)",
            }}
          >
            {slides.map((s, idx) => (
              <button
                key={s.id ?? idx}
                type="button"
                aria-label={`Go to slide ${idx + 1}`}
                aria-current={idx === i}
                onClick={() => goto(idx)}
                style={{
                  width: idx === i ? 24 : 8,
                  height: 8,
                  borderRadius: 9999,
                  border: "none",
                  backgroundColor:
                    idx === i ? "#d4af37" : "rgba(212, 175, 55, 0.4)",
                  cursor: "pointer",
                  padding: 0,
                  transition: "all 300ms ease",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ARROWS */}
      {slides.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => goto(i - 1)}
            aria-label="Previous slide"
            className="hidden sm:block"
            style={{
              position: "absolute",
              top: "50%",
              left: 16,
              transform: "translateY(-50%)",
              zIndex: 85,
              backgroundColor: "rgba(10, 10, 12, 0.5)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
              backdropFilter: "blur(8px)",
              color: "#d4af37",
              borderRadius: 9999,
              padding: "10px 14px",
              fontSize: 20,
              fontWeight: 400,
              cursor: "pointer",
              transition: "all 200ms ease",
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'rgba(10, 10, 12, 0.8)'; e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.5)'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(10, 10, 12, 0.5)'; e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.2)'; }}
          >
            ‹
          </button>

          <button
            type="button"
            onClick={() => goto(i + 1)}
            aria-label="Next slide"
            className="hidden sm:block"
            style={{
              position: "absolute",
              top: "50%",
              right: 16,
              transform: "translateY(-50%)",
              zIndex: 85,
              backgroundColor: "rgba(10, 10, 12, 0.5)",
              border: "1px solid rgba(212, 175, 55, 0.2)",
              backdropFilter: "blur(8px)",
              color: "#d4af37",
              borderRadius: 9999,
              padding: "10px 14px",
              fontSize: 20,
              fontWeight: 400,
              cursor: "pointer",
              transition: "all 200ms ease",
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'rgba(10, 10, 12, 0.8)'; e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.5)'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(10, 10, 12, 0.5)'; e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.2)'; }}
          >
            ›
          </button>
        </>
      )}

      {/* Screen-reader helper */}
      <span className="sr-only" aria-live="polite">
        {activeId}
      </span>
    </section>
  );
}
