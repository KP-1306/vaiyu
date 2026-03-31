// web/src/components/AIShowcase.tsx
export default function AIShowcase() {
  return (
    <section className="bg-transparent">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-12 md:py-20 space-y-24">

        {/* Block 1 — Image left, content right (NO CTA) */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <Figure
            src="/illustrations/vaiyu-intelligence-final.png"
            // src2x="/illustrations/vaiyu-intelligence-final@2x.png"
            alt="VAiyu AI Intelligence connecting Guest Experience, Property Efficiency, Brand Value, and Self-Improvement"
          />
          <Copy
            eyebrow="AI that runs the hotel"
            title="The Living Brain of Hospitality"
            bullets={[
              "Elevates guest experience with real-time intelligence",
              "Guides teams with predictive SLAs and precise nudges",
              "Owner-approved outputs — brand-safe by design",
            ]}
          // cta removed intentionally
          />
        </div>

        {/* Block 2 — Content left, image right (keeps CTA) */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <Copy
            title="VAiyu Intelligence — The AI Operating System"
            bullets={[
              "Unifies Guest, Ops, and Sustainability signals into one truth graph",
              "Predicts service risk; automates safely with audit trail",
              "Delivers measurable outcomes and ESG reporting",
            ]}
          //   cta={{ label: "Learn the architecture", href: "#ai" }}
          />
          <Figure
            src="/illustrations/ai-os-banner.png"
            // src2x="/illustrations/ai-os-banner@2x.png"
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
    <figure className="m-0 relative group">
      {/* Decorative subtle glow behind images in dark mode */}
      <div className="absolute -inset-4 bg-[#d4af37]/5 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div className="relative rounded-2xl ring-1 ring-[#d4af37]/20 bg-[#141210] overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.6)]">
        {/* Large & crisp, never stretched or squished */}
        <img
          src={src}
          srcSet={src2x ? `${src} 1x, ${src2x} 2x` : undefined}
          alt={alt}
          className="block w-full h-auto opacity-90 group-hover:opacity-100 transition-opacity duration-500"
          loading={eager ? "eager" : "lazy"}
          // @ts-ignore
          fetchpriority={eager ? "high" : "auto"}
          decoding="async"
          sizes="(min-width: 1280px) 720px, (min-width: 1024px) 680px, 100vw"
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
  eyebrow?: string;
  title: string;
  bullets: string[];
  cta?: { label: string; href: string };
}) {
  return (
    <div>
      {eyebrow && (
        <div className="text-[#d4af37] text-xs font-bold tracking-widest uppercase">
          {eyebrow}
        </div>
      )}
      <h3 className="mt-3 text-3xl md:text-4xl font-bold leading-tight text-[#f5f3ef]">
        {title}
      </h3>
      <ul className="mt-6 space-y-4 text-lg text-[#b8b3a8]">
        {bullets.map((b) => (
          <li key={b} className="pl-6 relative">
            {/* Gold diamond bullet */}
            <span className="absolute left-0 top-2.5 w-2 h-2 rotate-45 bg-gradient-to-br from-[#e9c55a] to-[#d4af37]" />
            {b}
          </li>
        ))}
      </ul>
      {cta && (
        <div className="mt-8">
          <a href={cta.href} className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-[#e9c55a] rounded-xl hover:bg-[#d4af37] transition-colors">
            {cta.label}
          </a>
        </div>
      )}
    </div>
  );
}
