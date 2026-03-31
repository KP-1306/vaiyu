import React from "react";

export default function GlassBand_OnboardingSecurityIntegrations() {
  return (
    <section id="trust" className="relative py-12">
      {/* Decorative dark glow background instead of light gradient */}
      <div className="absolute inset-0 -z-10 flex justify-center items-center pointer-events-none">
        <div className="w-[80%] h-full bg-[#d4af37]/5 blur-[120px] rounded-[100%]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#f5f3ef]">
            Onboarding • Security • Integrations
          </h2>
          <p className="mt-4 text-[#b8b3a8] max-w-2xl mx-auto text-lg">
            Speed to value in a day. Enterprise-secure. Connects to what you already use.
          </p>
        </div>

        <div className="rounded-[2.5rem] border border-[#d4af37]/20 bg-[#141210]/90 backdrop-blur-xl shadow-[0_10px_40px_-20px_rgba(0,0,0,0.6)]">
          <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#d4af37]/10">
            {/* A) 1-Day Onboarding */}
            <div className="p-8 sm:p-10">
              <Header icon={<IconBolt />} title="1-Day Onboarding" />
              <ol className="mt-8 space-y-6">
                <Step n={1} title="Connect hotel" body="Create property + services" />
                <Step n={2} title="Turn on guest links" body="Pre-check-in, requests, menu" />
                <Step n={3} title="Train staff (45 min)" body="HK + Front Desk workflows" />
                <Step n={4} title="Go live" body="Monitor SLAs + AI review drafts" />
              </ol>
              <p className="mt-8 text-sm text-[#7a756a] italic">White-glove setup available.</p>
            </div>

            {/* B) Security & Compliance */}
            <div className="p-8 sm:p-10">
              <Header icon={<IconShield />} title="Security & Compliance" />
              <ul className="mt-8 grid gap-4">
                <TrustTile icon={<IconCheck />} title="Supabase RLS" body="Row-level security; signed JWTs" />
                <TrustTile icon={<IconCheck />} title="Data region" body="India by default or your choice" />
                <TrustTile icon={<IconCheck />} title="Backups & audit logs" body="Daily backups + access trails" />
                <TrustTile
                  icon={<IconCheck />}
                  title="Uptime"
                  body={<><span>99.9% — </span><a href="/status" className="underline decoration-[#d4af37]/50 hover:decoration-[#d4af37] transition-all text-[#d4af37]">status page</a></>}
                />
              </ul>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-900 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400">
                Enterprise-grade
              </div>
            </div>

            {/* C) Integrations */}
            <div className="p-8 sm:p-10">
              <Header icon={<IconNodes />} title="Integrations" />
              <div className="mt-8 grid grid-cols-2 gap-3">
                <LogoTile label="PMS" badge="Coming soon" />
                <LogoTile label="Email" />
                <LogoTile label="SMS" />
                <LogoTile label="WhatsApp" badge="Beta" />
                <LogoTile label="UPI" />
                <LogoTile label="Cards" />
                <LogoTile label="Netlify" />
                <LogoTile label="Supabase" />
              </div>
              <p className="mt-8 text-sm text-[#7a756a]">Clear roadmap with adapters. Owners appreciate transparency.</p>
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
    <div className="flex items-center gap-4">
      <div className="h-10 w-10 grid place-items-center rounded-xl bg-gradient-to-br from-[#e9c55a] to-[#d4af37] text-[#0a0a0c] shadow-[0_0_15px_rgba(212,175,55,0.2)]">{icon}</div>
      <h3 className="text-xl font-bold text-[#f5f3ef]">{title}</h3>
    </div>
  );
}
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-4">
      <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[#d4af37] text-[#0a0a0c] grid place-items-center text-xs font-bold shadow-sm">{n}</div>
      <div>
        <div className="font-semibold text-[#f5f3ef]">{title}</div>
        <div className="text-sm text-[#b8b3a8] mt-0.5">{body}</div>
      </div>
    </li>
  );
}
function TrustTile({ icon, title, body }: { icon: React.ReactNode; title: string; body: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-[#d4af37]/10 bg-[#1a1816]/50 p-4 hover:bg-[#1a1816] transition-colors">
      <div className="mt-0.5 text-[#d4af37]">{icon}</div>
      <div>
        <div className="font-semibold text-[#f5f3ef]">{title}</div>
        <div className="text-sm text-[#b8b3a8] mt-1">{body}</div>
      </div>
    </li>
  );
}
function LogoTile({ label, badge }: { label: string; badge?: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#d4af37]/10 bg-[#1a1816]/50 px-4 py-3 hover:bg-[#1a1816] transition-colors">
      <div className="flex items-center gap-2.5 text-[#f5f3ef]">
        <div className="h-2 w-2 rounded-full bg-[#e9c55a] shadow-[0_0_5px_rgba(233,197,90,0.5)]" />
        <span className="font-medium text-sm sm:text-base">{label}</span>
      </div>
      {badge ? (
        <span className="rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 px-2 py-0.5 text-[9px] sm:text-[10px] uppercase tracking-wider text-[#d4af37] self-start sm:self-auto">
          {badge}
        </span>
      ) : null}
    </div>
  );
}
function IconBolt() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" /></svg>); }
function IconShield() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 3v6c0 4.4-3.1 8-7 8s-7-3.6-7-8V6l7-3z" /><path d="M9.5 12.5l2 2 3.5-3.5" /></svg>); }
function IconNodes() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8.2 10.6 15.8 7.4M8.2 13.4 15.8 16.6" /></svg>); }
function IconCheck() { return (<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12l4 4L19 6" /></svg>); }
