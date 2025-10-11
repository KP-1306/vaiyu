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
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Hero */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            'radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)',
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            👩‍🚀 We’re hiring
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">Build hospitality’s AI OS</h1>
          <p className="mt-3 max-w-2xl text-white/85">
            Join VAiyu to reinvent hotel operations with <b>truth-anchored AI</b>. Small team, huge ownership,
            visible impact.
          </p>
        </div>
        <svg viewBox="0 0 1440 140" className="absolute bottom-[-1px] left-0 w-full" aria-hidden>
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 grid gap-8 lg:grid-cols-3">
        {/* Why VAiyu */}
        <div className="space-y-4">
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Why VAiyu</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
              <li><b>Massive impact:</b> Every release touches real hotels and guests.</li>
              <li><b>Ownership:</b> Ship end-to-end and see it live the same week.</li>
              <li><b>Remote-first:</b> Async by default with crisp writing & demos.</li>
              <li><b>Speed with care:</b> We ship fast, measure honestly, and iterate.</li>
              <li><b>Ethical AI:</b> Grounded in actual operations—no hallucinated claims.</li>
            </ul>
          </div>
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">How we hire</h2>
            <ol className="mt-2 list-decimal pl-5 text-sm text-gray-700 space-y-1">
              <li>Intro chat (15–20m)</li>
              <li>Portfolio/code walk-through or short take-home</li>
              <li>Panel with founder + peer</li>
              <li>Reference calls & offer</li>
            </ol>
            <p className="text-xs text-gray-500 mt-2">We value practical work over puzzle interviews.</p>
          </div>
        </div>

        {/* Roles + general apply */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card bg-white">
            <h2 className="text-lg font-semibold">Open roles</h2>
            <div className="mt-3 grid gap-3">
              {roles.map((r) => (
                <RoleCard key={r.id} role={r} />
              ))}
            </div>
          </div>

          <div className="card bg-white">
            <h2 className="text-lg font-semibold">General application</h2>
            <p className="text-sm text-gray-700 mt-1">
              Don’t see the perfect role? We love great people. Send us your CV or portfolio with a few lines on what
              you’d like to build at VAiyu.
            </p>
            <a
              className="btn btn-light mt-3"
              href="mailto:talent@vaiyu.app?subject=General%20Application%20-%20VAiyu&body=Links%20to%20work%20%2F%20CV%3A%0A"
            >
              Email talent@vaiyu.app
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

type Role = { id: string; title: string; location: string; type: string; blurb: string };

function RoleCard({ role }: { role: Role }) {
  const mail = `mailto:talent@vaiyu.app?subject=Application%3A%20${encodeURIComponent(
    role.title
  )}&body=Hi%20VAiyu%20team%2C%0A%0ARole%3A%20${encodeURIComponent(
    role.title
  )}%0ALinks%20to%20work%20%2F%20CV%3A%0A%0AThanks!`;

  return (
    <div className="rounded border p-3 bg-white flex items-start justify-between gap-3">
      <div>
        <div className="font-medium">{role.title}</div>
        <div className="text-xs text-gray-500">{role.location} • {role.type}</div>
        <p className="mt-2 text-sm text-gray-700">{role.blurb}</p>
      </div>
      <div className="shrink-0">
        <a className="btn" href={mail}>Apply</a>
      </div>
    </div>
  );
}
