// web/src/routes/AboutUs.tsx
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import SEO from "../components/SEO";
import { supabase } from "../lib/supabase";

/** Inline smart button that decides the right dashboard route without changing the page layout */
function BackToDashboardButton({ label = "Back to dashboard" }: { label?: string }) {
  const [to, setTo] = useState<string>("/");

  const compute = useMemo(
    () => async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user;
        if (!user) {
          setTo("/");
          return;
        }
        // If RLS blocks reads here, we’ll default to guest to avoid leaking owner routes
        const { data: rows, error } = await supabase.from("hotel_members").select("id").limit(1);
        if (error) {
          setTo("/guest");
          return;
        }
        setTo((rows?.length || 0) > 0 ? "/owner" : "/guest");
      } catch {
        setTo("/guest");
      }
    },
    []
  );

  useEffect(() => {
    compute();
  }, [compute]);

  return (
    <Link to={to} className="inline-flex items-center justify-center px-5 py-2.5 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors">
      {label}
    </Link>
  );
}

export default function AboutUs() {
  return (
    <main className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef]">
      <SEO
        title="About VAiyu"
        description="VAiyu is the operating system for modern hospitality—uniting guest experience, hotel operations, sustainability signals, and truth-anchored AI."
      />

      {/* Hero */}
      <section
        className="relative isolate text-[#f5f3ef]"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 20% 10%, rgba(212, 175, 55, 0.08), transparent 50%), radial-gradient(ellipse 100% 60% at 80% 20%, rgba(139, 90, 43, 0.06), transparent 45%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(30, 20, 10, 0.8), transparent 60%)",
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24 relative z-[1]">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#1a1816] border border-[#d4af37]/20 px-3 py-1 text-xs text-[#d4af37]">
            🧭 About VAiyu
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Building the operating system for modern hospitality
          </h1>
          <p className="mt-3 max-w-2xl text-[#b8b3a8]">
            We make every stay feel effortless—by uniting guest experience, hotel operations,
            sustainability signals and <b className="text-[#f5f3ef]">truth-anchored AI</b> on a single, calm platform.
          </p>

          {/* CTAs */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/about-ai" className="inline-flex items-center justify-center px-5 py-2.5 font-semibold bg-[#e9c55a] text-[#0a0a0c] rounded-xl hover:bg-[#d4af37] transition-colors">
              How our AI works
            </Link>
            <Link to="/contact" className="inline-flex items-center justify-center px-5 py-2.5 font-medium bg-[#1a1816] text-[#b8b3a8] border border-[#d4af37]/20 rounded-xl hover:bg-[#24221f] hover:text-[#f5f3ef] transition-colors">
              Contact us
            </Link>
            {/* Smart back button (guest-safe) */}
            <BackToDashboardButton label="Back to dashboard" />
          </div>
        </div>

        <svg
          viewBox="0 0 1440 140"
          className="absolute bottom-[-1px] left-0 w-full pointer-events-none"
          aria-hidden
        >
          <path fill="#0a0a0c" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Mission — authentic, with sustainability / energy signals */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-3 bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <h2 className="text-xl font-semibold text-[#f5f3ef]">Our mission</h2>
            <p className="mt-2 text-[#b8b3a8]">
              Hospitality should feel human—and calm. VAiyu gives hotels one intelligent system that
              connects guests, teams, owners and devices in real time. We predict service risk, route
              work with clear SLAs, and ground every AI output in verified activity. The result: faster
              service, fewer misses, better margins and reviews that reflect the truth of the stay.
            </p>

            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              <Bullet>Guest experience: contactless pre-check-in, live request tracking, transparent bills.</Bullet>
              <Bullet>Staff efficiency: housekeeping, kitchen and desk with real-time updates and SLA nudges.</Bullet>
              <Bullet>Owner clarity: KPIs, exceptions, and policy hints that turn insight into action.</Bullet>
              <Bullet>
                Truth-anchored AI: summaries and review drafts grounded in verified activity, with brand-safe
                approval.
              </Bullet>
              <Bullet>
                Grid-smart operations: <b className="text-[#e9c55a]">tariff-aware device shedding</b>, <b className="text-[#e9c55a]">peak-hour playbooks</b> and{" "}
                <b className="text-[#e9c55a]">carbon-aware scheduling</b> to reduce cost and impact.
              </Bullet>
            </div>
          </div>
        </div>
      </section>

      {/* What we build — improved structure (4 pillars + 2 enablers) */}
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <h2 className="text-xl font-semibold text-[#f5f3ef]">What we build</h2>
        <p className="mt-1 text-[#7a756a]">Six pieces, one calm system.</p>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          <Tile
            title="Guest Microsite"
            desc="Contactless check-in, in-stay menu, live tickets and transparent bills—no app to download."
            emoji="📱"
          />
          <Tile
            title="Ops Console"
            desc="Desk, Housekeeping and Kitchen with SSE live updates, SLA timers and one-tap actions."
            emoji="🛠️"
          />
          <Tile
            title="Owner Intelligence"
            desc="KPIs, SLA breaches and policy hints—clear paths from signal to action."
            emoji="📊"
          />
          <Tile
            title="AI Experience"
            desc="Truth-anchored summaries and review drafts grounded in verified activity, with brand-safe approval."
            emoji="🤖"
          />
          <Tile
            title="Grid & Sustainability"
            desc="Tariff-aware device shedding, peak-hour playbooks, carbon-aware schedules and energy insights."
            emoji="⚡"
          />
          <Tile
            title="Open APIs"
            desc="Clean interfaces for PMS, POS, sensors and identity—faster rollouts, lower integration cost."
            emoji="🧩"
          />
        </div>
      </section>

      {/* Our story — clearer, credible timeline */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
          <h2 className="text-xl font-semibold text-[#f5f3ef]">Our story</h2>
          <div className="mt-5 grid md:grid-cols-3 gap-4 lg:gap-6">
            <Timeline
              year="Origins"
              text="We started as operators and builders—fixing the everyday frictions of guest requests and follow-ups."
            />
            <Timeline
              year="Pilot"
              text="A simple guest microsite and live ticketing stack proved one system could calm both guests and staff."
            />
            <Timeline
              year="Truth-anchored AI"
              text="We added AI summaries and draft reviews grounded in verified tickets and orders—owner-approved, brand-safe."
            />
            <Timeline
              year="Grid-smart layer"
              text="Energy signals joined the loop—tariff-aware device shedding and peak-hour playbooks for leaner ops."
            />
            <Timeline
              year="Now"
              text="Platformizing the OS for hospitality: open APIs, faster rollouts, richer insights—without noise."
            />
          </div>
        </div>
      </section>

      {/* Leadership */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="text-xl font-semibold text-[#f5f3ef]">Leadership</h2>
        <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          <Leader
            name="A. Kamal Bisht"
            role="CEO / Product"
            blurb="Building the bridge between human hospitality and intelligent systems."
          />
          <Leader
            name="B. Kapil R Bisht"
            role="Advisor & Architect"
            blurb="Blends advisory insight and architectural discipline to keep VAiyu ahead."
          />
          <Leader
            name="C. Ajit Kumar"
            role="CTO"
            blurb="Leads the code, the cloud, and the cadence—shipping intelligence at scale."
          />
          <Leader
            name="D. Arti Bisht"
            role="Head of Operations"
            blurb="Leads people, processes and precision to make hospitality flow effortlessly."
          />
          <Leader
            name="E. Ravi Joshi"
            role="Head of Research & AI/ML"
            blurb="Bridges research and runtime—models that perform in the wild."
          />
          <Leader
            name="F. Virender Singh"
            role="Head of Marketing"
            blurb="Builds the VAiyu narrative—trust, clarity and measurable growth."
          />
        </div>
      </section>

      {/* CTA — single Contact button */}
      <section className="border-t border-[#d4af37]/20 bg-[#141210] mt-8">
        <div className="mx-auto max-w-6xl px-4 py-10 flex flex-wrap items-center justify-between gap-5">
          <div>
            <div className="text-xl font-semibold text-[#f5f3ef]">Let’s make stays effortless.</div>
            <div className="text-sm text-[#b8b3a8] mt-1">Talk to us about your property and goals.</div>
          </div>
          <div className="flex gap-2">
            <Link to="/contact" className="inline-flex items-center justify-center px-6 py-3 font-semibold text-[#0a0a0c] bg-gradient-to-r from-[#e9c55a] to-[#d4af37] rounded-xl hover:opacity-90 transition-opacity whitespace-nowrap">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ---------- small components ---------- */

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-[#b8b3a8]">
      <span className="text-[#d4af37] font-bold">•</span> <span>{children}</span>
    </div>
  );
}

function Tile({ title, desc, emoji }: { title: string; desc: string; emoji: string }) {
  return (
    <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-1 hover:border-[#d4af37]/40 hover:shadow-[0_8px_32px_rgba(212,175,55,0.15)]">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold text-[#f5f3ef] mt-2">{title}</div>
      <div className="mt-1.5 text-sm text-[#b8b3a8] leading-relaxed">{desc}</div>
    </div>
  );
}

function Timeline({ year, text }: { year: string; text: string }) {
  return (
    <div className="rounded-xl border border-[#d4af37]/20 p-5 bg-[#1a1816]/50 transition-colors hover:bg-[#1a1816]">
      <div className="text-xs font-semibold text-[#d4af37] tracking-wider uppercase">{year}</div>
      <div className="mt-2 text-sm text-[#b8b3a8] leading-relaxed">{text}</div>
    </div>
  );
}

function Leader({ name, role, blurb }: { name: string; role: string; blurb: string }) {
  return (
    <div className="bg-[#141210]/90 backdrop-blur-md border border-[#d4af37]/20 rounded-2xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#e9c55a] to-[#d4af37] text-[#0a0a0c] grid place-items-center font-bold text-lg shadow-[0_0_15px_rgba(212,175,55,0.3)] shrink-0">
          {name
            .split(" ")
            .filter((n, i) => i > 0 || n.length > 2) // skip "A.", "B.", etc ideally, but simple enough logic
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <div className="font-semibold text-[#f5f3ef]">{name}</div>
          <div className="text-xs font-medium text-[#d4af37] mt-0.5">{role}</div>
        </div>
      </div>
      <p className="mt-4 text-sm text-[#b8b3a8] leading-relaxed">{blurb}</p>
    </div>
  );
}
