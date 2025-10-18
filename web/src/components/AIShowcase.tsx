// web/src/components/AIShowcase.tsx
export default function AIShowcase() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-16 md:py-20 space-y-20">

        {/* Block 1 — Image left, content right */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <Figure
            src="/illustrations/vaiyu-intelligence-final.png"
            src2x="/illustrations/vaiyu-intelligence-final@2x.png"
            alt="VAiyu AI Intelligence connecting Guest Experience, Property Efficiency, Brand Value, and Self-Improvement"
          />
          <Copy
            eyebrow="AI that runs the hotel"
            title="The Living Brain of Hospitality"
            bullets={[
              "Elevates guest experience with real-time intelligence",
              "Guides teams with predictive SLAs and precise nudges",
              "Owner-approved outputs—brand-safe by design",
            ]}
            cta={{ label: "See it in action", href: "#use-cases" }}
          />
        </div>

        {/* Block 2 — Content left, image right */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <Copy
            eyebrow="Investor-grade architecture"
            title="VAiyu Intelligence — The AI Operating System"
            bullets={[
              "Unifies Guest, Ops, and Sustainability signals into one truth graph",
              "Predicts service risk; automates safely with audit trail",
              "Delivers measurable outcomes and ESG reporting",
            ]}
            cta={{ label: "Learn the architecture", href: "#ai" }}
          />
          <Figure
            src="/illustrations/ai-os-banner.png"
            src2x="/illustrations/ai-os-banner@2x.png"
            alt="VAiyu Intelligence — AI + Sustainability Operating System for Hospitality"
            eager={false}
          />
        </div>
      </div>
    </section>
  );
}

/* ---------- small building blocks ---------- */

function Figure({
  src,
  src2x,
  alt,
  eager = true,
}: {
  src: string;
  src2x?: string;
  alt: string;
  eager?: boolean;
}) {
  return (
    <figure className="m-0">
      <div className="rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden shadow-sm">
        {/* Maintain generous real estate without distortion */}
        <img
          src={src}
          srcSet={src2x ? `${src} 1x, ${src2x} 2x` : undefined}
          alt={alt}
          className="block w-full h-auto"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          sizes="(min-width: 1024px) 640px, 100vw"
        />
      </div>
      <figcaption className="sr-only">{alt}</figcaption>
    </figure>
  );
}

function Copy({
  eyebrow,
  title,
  bullets,
  cta,
}: {
  eyebrow: string;
  title: string;
  bullets: string[];
  cta?: { label: string; href: string };
}) {
  return (
    <div>
      <div className="text-cyan-700 text-xs font-semibold tracking-wide uppercase">{eyebrow}</div>
      <h3 className="mt-2 text-2xl md:text-3xl font-semibold leading-tight text-slate-900">{title}</h3>
      <ul className="mt-4 space-y-2 text-slate-700">
        {bullets.map((b) => (
          <li key={b} className="pl-5 relative">
            <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
            {b}
          </li>
        ))}
      </ul>
      {cta && (
        <div className="mt-5">
          <a href={cta.href} className="btn">{cta.label}</a>
        </div>
      )}
    </div>
  );
}
