import React from "react";

export default function GlassBand_OnboardingSecurityIntegrations() {
  return (
    <section id="trust" className="relative py-24">
      <div className="absolute inset-0 -z-10">
        <div className="h-full w-full bg-gradient-to-b from-gray-50 via-white to-gray-50" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-semibold text-gray-900">
            Onboarding • Security • Integrations
          </h2>
          <p className="mt-3 text-gray-600 max-w-2xl mx-auto text-lg">
            Speed to value in a day. Enterprise-secure. Connects to what you already use.
          </p>
        </div>

        <div className="rounded-3xl border border-gray-200/70 bg-white/60 backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.25)]">
          <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200/80">
            {/* A) 1-Day Onboarding */}
            <div className="p-8">
              <Header icon={<IconBolt />} title="1-Day Onboarding" />
              <ol className="mt-5 space-y-4">
                <Step n={1} title="Connect hotel" body="Create property + services" />
                <Step n={2} title="Turn on guest links" body="Pre-check-in, requests, menu" />
                <Step n={3} title="Train staff (45 min)" body="HK + Front Desk workflows" />
                <Step n={4} title="Go live" body="Monitor SLAs + AI review drafts" />
              </ol>
              <p className="mt-5 text-sm text-gray-500 italic">White-glove setup available.</p>
            </div>

            {/* B) Security & Compliance */}
            <div className="p-8">
              <Header icon={<IconShield />} title="Security & Compliance" />
              <ul className="mt-5 grid gap-3">
                <TrustTile icon={<IconCheck />} title="Supabase RLS" body="Row-level security; signed JWTs" />
                <TrustTile icon={<IconCheck />} title="Data region" body="India by default or your choice" />
                <TrustTile icon={<IconCheck />} title="Backups & audit logs" body="Daily backups + access trails" />
                <TrustTile
                  icon={<IconCheck />}
                  title="Uptime"
                  body={<><span>99.9% — </span><a href="/status" className="underline decoration-dotted hover:decoration-solid">status page</a></>}
                />
              </ul>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/80 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                Enterprise-grade
              </div>
            </div>

            {/* C) Integrations */}
            <div className="p-8">
              <Header icon={<IconNodes />} title="Integrations" />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <LogoTile label="PMS" badge="Coming soon" />
                <LogoTile label="Email" />
                <LogoTile label="SMS" />
                <LogoTile label="WhatsApp" badge="Beta" />
                <LogoTile label="UPI" />
                <LogoTile label="Cards" />
                <LogoTile label="Netlify" />
                <LogoTile label="Supabase" />
              </div>
              <p className="mt-5 text-sm text-gray-500">Clear roadmap with adapters. Owners appreciate transparency.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* subcomponents + icons (no external libs) */
function Header({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-9 w-9 grid place-items-center rounded-xl bg-gray-100 text-gray-800">{icon}</div>
      <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
    </div>
  );
}
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-600 text-white grid place-items-center text-xs font-bold">{n}</div>
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-sm text-gray-600">{body}</div>
      </div>
    </li>
  );
}
function TrustTile({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white/80 p-3">
      <div className="mt-0.5 text-emerald-600">{icon}</div>
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-sm text-gray-600">{body}</div>
      </div>
    </li>
  );
}
function LogoTile({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white/80 px-3 py-2">
      <div className="flex items-center gap-2 text-gray-800">
        <div className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="font-medium">{label}</span>
      </div>
      {badge ? (
        <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
          {badge}
        </span>
      ) : null}
    </div>
  );
}
function IconBolt() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" /></svg>); }
function IconShield() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l7 3v6c0 4.4-3.1 8-7 8s-7-3.6-7-8V6l7-3z" /><path d="M9.5 12.5l2 2 3.5-3.5" /></svg>); }
function IconNodes() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8.2 10.6 15.8 7.4M8.2 13.4 15.8 16.6" /></svg>); }
function IconCheck() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12l4 4L19 6" /></svg>); }
