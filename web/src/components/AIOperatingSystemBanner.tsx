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

        {/* 3-zone banner */}
        <div className="mt-10 rounded-2xl ring-1 ring-slate-200 overflow-hidden">
          <div className="grid lg:grid-cols-3">
            {/* Left: Traditional */}
            <div className="bg-slate-50 p-6 md:p-8">
              <h3 className="text-lg font-semibold text-slate-900">Traditional Hospitality</h3>
              <p className="mt-2 text-sm text-slate-600">
                Fragmented systems, manual effort, reactive decisions — data exists but never connects.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Staff firefighting, not forecasting
                </li>
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Guests waiting, not delighted
                </li>
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-slate-400" />
                  Energy and resources wasted without insight
                </li>
              </ul>
            </div>

            {/* Center: Engine */}
            <div className="relative bg-white p-6 md:p-8">
              <h3 className="sr-only">VAiyu Intelligence Engine</h3>
              <div className="relative rounded-xl ring-1 ring-slate-200 p-5 md:p-8 bg-gradient-to-b from-white to-slate-50">
                {/* Hotel + engine graphic */}
                <svg viewBox="0 0 600 360" className="w-full h-auto" role="img" aria-label="VAiyu Intelligence Engine">
                  <defs>
                    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
                      <stop offset="0%" stopColor="#32E0C4" stopOpacity="0.95"/>
                      <stop offset="60%" stopColor="#0EC9F7" stopOpacity="0.55"/>
                      <stop offset="100%" stopColor="#0EC9F7" stopOpacity="0.15"/>
                    </radialGradient>
                    <linearGradient id="wire" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00A9FF"/>
                      <stop offset="60%" stopColor="#1FD7BD"/>
                      <stop offset="100%" stopColor="#61E87A"/>
                    </linearGradient>
                    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="b"/>
                      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>

                  {/* Hotel silhouette */}
                  <path d="M120 210 L300 90 L480 210 L480 300 L120 300 Z" fill="#E6F7F5" stroke="#BFEDE6" />
                  {/* Wires in/out */}
                  <g stroke="url(#wire)" strokeWidth="3" fill="none" filter="url(#soft)" opacity="0.9">
                    <path d="M60 160 C120 160, 140 160, 180 180" />
                    <path d="M60 245 C140 240, 180 230, 220 220" />
                    <path d="M540 160 C480 160, 460 160, 420 180" />
                    <path d="M540 245 C460 240, 420 230, 380 220" />
                    <path d="M300 300 C300 330, 300 330, 300 340" />
                  </g>

                  {/* Engine core */}
                  <circle cx="300" cy="220" r="58" fill="url(#glow)" />
                  <text x="300" y="214" textAnchor="middle" fontSize="16" fontWeight="700" fill="#033">
                    Va<span style={{letterSpacing: '-0.02em'}}>i</span>yu
                  </text>
                  <text x="300" y="234" textAnchor="middle" fontSize="11" fill="#065f46">
                    INTELLIGENCE ENGINE
                  </text>

                  {/* Labels */}
                  <g fontSize="11" fill="#0f172a">
                    <text x="70" y="150">Guest Signals</text>
                    <text x="65" y="260">Service Requests</text>
                    <text x="485" y="150">Energy & Device Data</text>
                    <text x="480" y="260">Owner Dashboards</text>
                    <text x="280" y="355">Sustainability KPIs</text>
                  </g>

                  {/* Core capabilities */}
                  <g fontSize="11" fill="#0f172a" textAnchor="middle">
                    <text x="180" y="205">Predictive Models</text>
                    <text x="420" y="205">Autonomous Ops Engine</text>
                    <text x="300" y="265">Generative Review Intelligence</text>
                    <text x="205" y="255">Learning Graph</text>
                    <text x="395" y="255">ESG Optimizer</text>
                  </g>
                </svg>

                {/* Footer line under engine */}
                <p className="mt-3 text-xs text-slate-500 text-center">
                  Proprietary AI graph that learns from 1,000+ real-world operations signals per day.
                </p>
              </div>
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
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
                  Data-verified ESG reporting and policy guidance
                </li>
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
                  Safe automations with owner control and audit trail
                </li>
                <li className="pl-4 relative">
                  <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
                  Every stay trains the model. Every model grows your brand.
                </li>
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
