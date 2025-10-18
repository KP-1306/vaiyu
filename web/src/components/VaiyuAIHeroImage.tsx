// web/src/components/VaiyuAIHeroImage.tsx
export default function VaiyuAIHeroImage() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-10">
        <figure className="m-0 rounded-2xl ring-1 ring-slate-200 overflow-hidden bg-white">
          {/* Use <picture> so we can swap in future (e.g., dark variant) */}
          <picture>
            {/* Example: if you add a dark-mode image later, uncomment:
            <source
              srcSet="/illustrations/vaiyu-intelligence-final-dark.png 1x,
                      /illustrations/vaiyu-intelligence-final-dark@2x.png 2x"
              media="(prefers-color-scheme: dark)"
            /> */}
            <img
              src="/illustrations/vaiyu-intelligence-final.png"
              srcSet="/illustrations/vaiyu-intelligence-final.png 1x, /illustrations/vaiyu-intelligence-final@2x.png 2x"
              alt="Vaiyu AI Intelligence at the core: Guest Experience, Property Efficiency, Brand Value, and Self-Improvement connected by a smart operating system"
              className="block w-full h-auto"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              sizes="(min-width: 80rem) 1120px, (min-width: 64rem) 960px, 100vw"
            />
          </picture>
          <figcaption className="sr-only">
            VAiyu Intelligence — AI operating system connecting guest experience, operations, brand value and self-improving insights.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
