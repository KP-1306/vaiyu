// web/src/components/AIOperatingSystemBanner.tsx
export default function AIOperatingSystemBanner() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-14 md:py-20">
        {/* Headline */}
        <div className="text-center max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-slate-900">
            <span className="text-slate-900">VAiyu Intelligence</span>{" "}
            <span className="text-cyan-700">— The AI Operating System for Modern Hospitality</span>
          </h2>
          <p className="mt-4 text-slate-600">
            Where artificial intelligence meets operational excellence and environmental responsibility.
          </p>
        </div>

        {/* 3-zone frame */}
        <div className="mt-10 rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          <div className="grid lg:grid-cols-3">
            {/* Left: Traditional */}
            <div className="bg-slate-50 p-6 md:p-8">
              <h3 className="text-lg font-semibold text-slate-900">Traditional Hospitality</h3>
              <p className="mt-2 text-sm text-slate-600">
                Fragmented systems, manual effort, reactive decisions — data exists but never connects.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <Bullet>Staff firefighting, not forecasting</Bullet>
                <Bullet>Guests waiting, not delighted</Bullet>
                <Bullet>Energy and resources wasted without insight</Bullet>
              </ul>
            </div>

            {/* Center: Approved investor banner IMAGE (this is the change) */}
            <div className="relative bg-white p-0">
              <figure className="m-0">
                <img
                  src="/illustrations/ai-os-banner.png"
                  srcSet="/illustrations/ai-os-banner.png 1x, /illustrations/ai-os-banner@2x.png 2x"
                  alt="VAiyu Intelligence — AI + Sustainability engine transforming hotel operations"
                  className="block w-full h-full object-contain"
                  loading="eager"
                  fetchPriority="high"
                />
                <figcaption className="sr-only">
                  Investor-grade diagram of VAiyu’s AI OS for hospitality.
                </figcaption>
              </figure>
            </div>

            {/* Right: Outcomes */}
            <div className="bg-slate-50 p-6 md:p-8">
              <h3 className="text-lg font-semibold text-slate-900">Intelligent, Sustainable Hospitality</h3>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <KPI value="+22%" label="Service Efficiency" />
                <KPI value="+18%" label="Guest Satisfaction Index" />
                <KPI value="−17%" label="Operational Cost" />
              </div>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                <Bullet>Data-verified ESG reporting and policy guidance</Bullet>
                <Bullet>Safe automations with owner control and audit trail</Bullet>
                <Bullet>Every stay trains the model. Every model grows your brand.</Bullet>
              </ul>
            </div>
          </div>

          {/* Bottom strapline */}
          <div className="px-6 md:px-8 py-4 bg-white border-t border-slate-200 text-center text-sm text-slate-600">
            Each insight improves operations. Each operation improves the planet.
          </div>
        </div>
      </div>
    </section>
  );
}

function KPI({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4 text-center">
      <div className="text-xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="pl-4 relative">
      <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
      {children}
    </li>
  );
}
