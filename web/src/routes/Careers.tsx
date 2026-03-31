import Pill from "../components/Pill";

export default function Careers() {
  const roles: Role[] = [
    {
      title: 'Founding Engineer (Full-stack)',
      location: 'Remote (IST ±3h)',
      type: 'Full-time',
      blurb:
        'Own end-to-end shipping across guest, ops and owner surfaces. TypeScript, React, Fastify, Postgres, edge.',
      id: 'founding-engineer-fullstack',
    },
    {
      title: 'Product Designer (Systems/UX)',
      location: 'Remote (Global)',
      type: 'Full-time',
      blurb:
        'Design the VAiyu system: cohesive components, swift workflows for the desk, and a delightful guest feel.',
      id: 'product-designer-systems',
    },
    {
      title: 'Go-To-Market Lead (Hospitality)',
      location: 'Hybrid / Remote',
      type: 'Full-time',
      blurb:
        'Work with early hotels, shape pricing & ROI narratives, and turn pilots into category-defining case studies.',
      id: 'gtm-lead-hospitality',
    },
  ];

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      {/* Hero */}
      <section
        className="relative isolate overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), linear-gradient(180deg, #060608, #0a0a0c)",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-[#f5f3ef]">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/40 bg-black/40 px-3 py-1.5 text-xs backdrop-blur font-medium tracking-wide text-[#d4af37]">
            👩‍🚀 We’re hiring
          </span>
          <h1 className="mt-6 text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            Build hospitality’s <span className="text-[#d4af37] drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">AI OS</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg sm:text-xl text-[#b8b3a8] leading-relaxed">
            Join VAiyu to reinvent hotel operations with <strong className="text-[#f5f3ef] font-semibold">truth-anchored AI</strong>. Small team, huge ownership,
            visible impact.
          </p>
        </div>
        
        {/* Decorative wave mapped to dark theme bg */}
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full pointer-events-none" aria-hidden>
          <path fill="#0a0a0c" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 grid gap-8 lg:grid-cols-3">
        {/* Why VAiyu */}
        <div className="space-y-6">
          <div className="rounded-[2rem] border border-[#d4af37]/20 bg-[#141210]/90 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md">
            <h2 className="text-2xl font-bold text-[#f5f3ef]">Why VAiyu</h2>
            <ul className="mt-6 space-y-4 text-sm sm:text-base text-[#b8b3a8]">
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5 font-bold">•</span> <div><span className="text-[#f5f3ef] font-semibold">Massive impact:</span> Every release touches real hotels and guests.</div></li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5 font-bold">•</span> <div><span className="text-[#f5f3ef] font-semibold">Ownership:</span> Ship end-to-end and see it live the same week.</div></li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5 font-bold">•</span> <div><span className="text-[#f5f3ef] font-semibold">Remote-first:</span> Async by default with crisp writing & demos.</div></li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5 font-bold">•</span> <div><span className="text-[#f5f3ef] font-semibold">Speed with care:</span> We ship fast, measure honestly, and iterate.</div></li>
              <li className="flex items-start gap-3"><span className="text-[#d4af37] mt-0.5 font-bold">•</span> <div><span className="text-[#f5f3ef] font-semibold">Ethical AI:</span> Grounded in actual operations—no hallucinated claims.</div></li>
            </ul>
          </div>
          <div className="rounded-[2rem] border border-[#d4af37]/10 bg-[#141210]/60 p-8 shadow-inner">
            <h2 className="text-xl font-bold text-[#f5f3ef]">How we hire</h2>
            <ol className="mt-6 space-y-3 text-sm sm:text-base text-[#b8b3a8]">
              <li className="flex items-center gap-3"><div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#1a1816] text-[#d4af37] text-xs font-bold border border-[#d4af37]/20">1</div> Intro chat (15–20m)</li>
              <li className="flex items-start gap-3"><div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#1a1816] text-[#d4af37] text-xs font-bold border border-[#d4af37]/20 shrink-0">2</div> Portfolio/code walk-through or short take-home</li>
              <li className="flex items-center gap-3"><div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#1a1816] text-[#d4af37] text-xs font-bold border border-[#d4af37]/20">3</div> Panel with founder + peer</li>
              <li className="flex items-center gap-3"><div className="w-5 h-5 flex items-center justify-center rounded-full bg-[#1a1816] text-[#d4af37] text-xs font-bold border border-[#d4af37]/20">4</div> Reference calls & offer</li>
            </ol>
            <p className="text-xs text-[#7a756a] mt-6 italic pt-4 border-t border-[#d4af37]/10">We value practical work over puzzle interviews.</p>
          </div>
        </div>

        {/* Roles + general apply */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-[2rem] border border-[#d4af37]/20 bg-[#141210]/90 p-8 sm:p-10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md">
            <h2 className="text-3xl font-bold text-[#f5f3ef]">Open roles</h2>
            <div className="mt-8 grid gap-4">
              {roles.map((r) => (
                <RoleCard key={r.id} role={r} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#d4af37]/15 bg-gradient-to-br from-[#1a1816] to-[#0a0a0c] p-8">
            <h2 className="text-2xl font-bold text-[#f5f3ef]">General application</h2>
            <p className="text-[#b8b3a8] mt-3 leading-relaxed">
              Don’t see the perfect role? We love great people. Send us your CV or portfolio with a few lines on what
              you’d like to build at VAiyu.
            </p>
            <a
              className="inline-flex items-center justify-center px-6 py-3 mt-6 font-semibold text-[#b8b3a8] bg-[#1a1816] border border-[#d4af37]/30 rounded-xl hover:bg-[#d4af37] hover:text-[#0a0a0c] transition-all hover:shadow-[0_0_15px_rgba(212,175,55,0.4)]"
              href="mailto:talent@vaiyu.co.in?subject=General%20Application%20-%20VAiyu&body=Links%20to%20work%20%2F%20CV%3A%0A"
            >
              Email talent@vaiyu.co.in
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

type Role = { id: string; title: string; location: string; type: string; blurb: string };

function RoleCard({ role }: { role: Role }) {
  const mail = `mailto:talent@vaiyu.co.in?subject=Application%3A%20${encodeURIComponent(
    role.title
  )}&body=Hi%20VAiyu%20team%2C%0A%0ARole%3A%20${encodeURIComponent(
    role.title
  )}%0ALinks%20to%20work%20%2F%20CV%3A%0A%0AThanks!`;

  return (
    <div className="rounded-2xl border border-[#d4af37]/10 bg-[#1a1816]/50 p-6 hover:bg-[#1a1816] hover:border-[#d4af37]/30 transition-all duration-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 group">
      <div>
        <div className="text-xl font-bold text-[#f5f3ef] group-hover:text-[#d4af37] transition-colors">{role.title}</div>
        <div className="text-xs font-semibold tracking-wider text-[#d4af37] uppercase mt-2">{role.location} • {role.type}</div>
        <p className="mt-3 text-[#b8b3a8] leading-relaxed">{role.blurb}</p>
      </div>
      <div className="shrink-0 w-full sm:w-auto">
        <a className="inline-flex w-full sm:w-auto items-center justify-center px-6 py-2.5 font-bold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] rounded-xl hover:opacity-90 transition-opacity shadow-[0_4px_10px_rgba(212,175,55,0.2)]" href={mail}>
          Apply
        </a>
      </div>
    </div>
  );
}
