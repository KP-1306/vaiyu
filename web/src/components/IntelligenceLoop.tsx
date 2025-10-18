// web/src/components/IntelligenceLoop.tsx
type Theme = "light" | "dark";

export default function IntelligenceLoop({ theme = "light" }: { theme?: Theme }) {
  const isLight = theme === "light";
  const wrapBG = isLight ? "bg-white text-slate-900" : "bg-neutral-950 text-white";
  const canvasBG = isLight
    ? "bg-gradient-to-b from-white to-slate-50 ring-slate-200/70"
    : "bg-gradient-to-b from-neutral-900 to-neutral-950 ring-white/10";
  const subText = isLight ? "text-slate-600" : "text-neutral-300";
  const captionText = isLight ? "text-slate-700" : "text-neutral-200";
  const cardBG = isLight ? "bg-white ring-slate-200/80" : "bg-white/5 ring-white/10";
  const bulletTint = isLight ? "bg-emerald-500/80" : "bg-emerald-300/80";
  const headlineAccent = isLight ? "text-cyan-700" : "text-cyan-300";
  const glowShadow = isLight
    ? "shadow-[0_0_34px_-10px_rgba(15,180,155,0.30)]"
    : "shadow-[0_0_32px_-8px_rgba(16,255,200,0.35)]";

  return (
    <div className={`mx-auto max-w-6xl ${wrapBG}`}>
      {/* Headline + subhead */}
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
          How VAiyu Turns Every Hotel Into a{" "}
          <span className={headlineAccent}>Living, Learning System</span>
        </h2>
        <p className={`mt-3 ${subText} max-w-2xl mx-auto`}>
          A self-improving intelligence loop: capture truth, understand context,
          act with precision, and continuously elevate brand value.
        </p>
      </div>

      {/* Canvas */}
      <div className={`relative w-full aspect-[16/9] rounded-2xl ${canvasBG} ring overflow-hidden`}>
        {/* SVG infinity with glow */}
        <svg viewBox="0 0 1200 675" className="absolute inset-0 w-full h-full" aria-labelledby="va-loop-title" role="img">
          <title id="va-loop-title">VAiyu Intelligence Loop</title>
          <defs>
            {/* Blue→Green energy gradient (kept strong so it pops on white too) */}
            <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00A9FF" />
              <stop offset="50%" stopColor="#1FD7BD" />
              <stop offset="100%" stopColor="#61E87A" />
            </linearGradient>

            {/* Softer glow on light theme */}
            <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={isLight ? 6 : 10} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Node circle gradient */}
            <radialGradient id="nodeGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={isLight ? "#11C7F0" : "#0CE6FF"} stopOpacity="0.9" />
              <stop offset="60%" stopColor="#2EF0C8" stopOpacity="0.7" />
              <stop offset="100%" stopColor={isLight ? "#7DF89B" : "#9BF79B"} stopOpacity={isLight ? 0.35 : 0.25} />
            </radialGradient>
          </defs>

          {/* Infinity path (two mirrored loops) */}
          <g filter="url(#softGlow)">
            <path
              d="M 200 337.5 C 200 230, 320 180, 430 220 C 520 252, 600 337.5, 680 417.5 C 760 497.5, 840 555, 970 540"
              fill="none" stroke="url(#arcGrad)" strokeWidth="7" strokeLinecap="round" opacity="0.9"
            />
            <path
              d="M 1000 337.5 C 1000 445, 880 495, 770 455 C 680 423, 600 337.5, 520 257.5 C 440 177.5, 360 120, 230 135"
              fill="none" stroke="url(#arcGrad)" strokeWidth="7" strokeLinecap="round" opacity="0.9"
            />
          </g>

          {/* Four nodes */}
          {[
            { cx: 260, cy: 260, title: "Sense" },
            { cx: 940, cy: 240, title: "Understand" },
            { cx: 930, cy: 460, title: "Act" },
            { cx: 280, cy: 470, title: "Learn, Improve & Elevate" },
          ].map((n, i) => (
            <g key={i} transform={`translate(${n.cx}, ${n.cy})`}>
              <circle r="58" fill="url(#nodeGrad)" stroke="#86ffc2" strokeWidth="1.5" />
              {i === 0 && (
                <g>
                  <circle cx="0" cy="0" r="20" fill="none" stroke="#00A9FF" strokeWidth="2" />
                  <circle cx="0" cy="0" r="32" fill="none" stroke="#1FD7BD" strokeWidth="1.5" opacity="0.85" />
                  <path d="M0 -18 L0 -6" stroke="#00A9FF" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 12 L4 4" stroke="#00A9FF" strokeWidth="2" strokeLinecap="round" />
                </g>
              )}
              {i === 1 && (
                <g>
                  <path
                    d="M-18 10 C-32 0,-26 -24,-6 -26 C-2 -34, 14 -32, 18 -22 C34 -18,34 8,18 12 C14 24,-2 22,-6 16 C-18 18,-20 16,-18 10 Z"
                    fill="none" stroke="#1FD7BD" strokeWidth="2"
                  />
                </g>
              )}
              {i === 2 && (
                <g transform="translate(0,2)">
                  <circle r="14" cx="-8" cy="0" fill="none" stroke="#1FD7BD" strokeWidth="2" />
                  <path d="M-8 -14 l3 4 M-8 14 l3 -4 M-22 0 l5 0 M6 0 l5 0 M-16 -10 l3 3 M0 10 l3 3 M-16 10 l3 -3 M0 -10 l3 -3"
                    stroke="#1FD7BD" strokeWidth="2" strokeLinecap="round" />
                  <path d="M12 8 L28 0 L12 -8" fill="none" stroke="#00A9FF" strokeWidth="3" strokeLinecap="round" />
                </g>
              )}
              {i === 3 && (
                <g>
                  <path d="M-20 18 C-10 6, -6 -6, 6 -14 C14 -18, 20 -12, 14 -6" fill="none" stroke="#00A9FF" strokeWidth="2" />
                  <path d="M12 -6 L24 -6 L18 -16 Z" fill="#61E87A" />
                </g>
              )}
              <text
                textAnchor="middle" y="86"
                className="select-none"
                style={{ fontSize: 14, fontWeight: 600, letterSpacing: 0.2 }}
                fill={isLight ? "#0f172a" : "#ffffff"}
              >
                {n.title}
              </text>
            </g>
          ))}
        </svg>

        {/* Descriptions */}
        <div className="absolute inset-0 grid grid-cols-2 lg:grid-cols-4 gap-5 p-5 md:p-8">
          <Card
            title="Sense" captionClass={captionText} className={cardBG}
            points={[
              "Capture live guest requests, orders & energy signals",
              "Build a real-time operational graph (no manual tracking)",
            ]}
          />
          <Card
            title="Understand" captionClass={captionText} className={cardBG}
            points={[
              "AI correlates events, predicts delays & bottlenecks",
              "Factual, brand-safe insights (no hallucinations)",
            ]}
          />
          <Card
            title="Act" captionClass={captionText} className={cardBG}
            points={[
              "Assist staff with precise nudges—or automate safely",
              "Reduce overhead while lifting on-time performance",
            ]}
          />
          <Card
            title="Learn, Improve & Elevate" captionClass={captionText}
            className={`${cardBG} ${glowShadow}`}
            points={[
              "Benchmark every stay and SLA across the VAiyu network",
              "Continuously improve guest experience & consistency",
              "Compounding effect: higher trust, loyalty & brand value",
            ]}
          />
        </div>

        {/* Bottom tagline */}
        <div className={`absolute bottom-5 inset-x-5 text-center ${captionText}`}>
          <p className="text-sm md:text-base">
            Every signal becomes <span className="text-cyan-700">intelligence</span>. Every stay becomes{" "}
            <span className="text-emerald-700">smarter</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  points,
  className = "",
  captionClass = "",
}: {
  title: string;
  points: string[];
  className?: string;
  captionClass?: string;
}) {
  return (
    <div className={`rounded-xl p-4 md:p-5 ring ${className}`}>
      <h3 className="text-base md:text-lg font-semibold">{title}</h3>
      <ul className={`mt-2 space-y-1.5 text-[13px] md:text-sm leading-relaxed ${captionClass}`}>
        {points.map((p, i) => (
          <li key={i} className="pl-4 relative">
            <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
