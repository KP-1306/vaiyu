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
    <Link to={to} className="btn btn-light">
      {label}
    </Link>
  );
}

export default function AboutUs() {
  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <SEO
        title="About VAiyu"
        description="VAiyu is the operating system for modern hospitality—uniting guest experience, hotel operations, sustainability signals, and truth-anchored AI."
      />

      {/* Hero */}
      <section
        className="relative isolate text-white"
        style={{
          background:
            "radial-gradient(900px 320px at -10% -40%, rgba(20,90,242,.25), transparent 60%), radial-gradient(800px 300px at 110% -30%, rgba(14,165,233,.25), transparent 60%), linear-gradient(180deg, #0b1220, #101827)",
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            🧭 About VAiyu
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Building the operating system for modern hospitality
          </h1>
          <p className="mt-3 max-w-2xl text-white/85">
            We make every stay feel effortless—by uniting guest experience, hotel operations,
            sustainability signals and <b>truth-anchored AI</b> on a single, calm platform.
          </p>

          {/* CTAs */}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/about-ai" className="btn !bg-white !text-gray-900 hover:!bg-gray-50">
              How our AI works
            </Link>
            <Link to="/contact" className="btn btn-light">
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
          <path fill="#f9fafb" d="M0,80 C240,160 480,0 720,60 C960,120 1200,40 1440,100 L1440,140 L0,140 Z" />
        </svg>
      </section>

      {/* Mission — authentic, with sustainability / energy signals */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-3 card bg-white">
            <h2 className="text-xl font-semibold">Our mission</h2>
            <p className="mt-2 text-gray-700">
              Hospitality should feel human—and calm. VAiyu gives hotels one intelligent system that
              connects guests, teams, owners and devices in real time. We predict service risk, route
              work with clear SLAs, and ground every AI output in verified activity. The result: faster
              service, fewer misses, better margins and reviews that reflect the truth of the stay.
            </p>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <Bullet>Guest experience: contactless pre-check-in, live request tracking, transparent bills.</Bullet>
              <Bullet>Staff efficiency: housekeeping, kitchen and desk with real-time updates and SLA nudges.</Bullet>
              <Bullet>Owner clarity: KPIs, exceptions, and policy hints that turn insight into action.</Bullet>
              <Bullet>
                Truth-anchored AI: summaries and review drafts grounded in verified activity, with brand-safe
                approval.
              </Bullet>
              <Bullet>
                Grid-smart operations: <b>tariff-aware device shedding</b>, <b>peak-hour playbooks</b> and{" "}
                <b>carbon-aware scheduling</b> to reduce cost and impact.
              </Bullet>
            </div>
          </div>
        </div>
      </section>

      {/* What we build — improved structure (4 pillars + 2 enablers) */}
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <h2 className="text-xl font-semibold">What we build</h2>
        <p className="mt-1 text-gray-600">Six pieces, one calm system.</p>
        <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
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
      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="card bg-white">
          <h2 className="text-xl font-semibold">Our story</h2>
          <div className="mt-4 grid md:grid-cols-3 gap-4">
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
      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="text-xl font-semibold">Leadership</h2>
        <div className="mt-3 grid md:grid-cols-3 gap-4">
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
      <section className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Let’s make stays effortless.</div>
            <div className="text-sm text-gray-600">Talk to us about your property and goals.</div>
          </div>
          <div className="flex gap-2">
            <Link to="/contact" className="btn">
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
    <div className="flex items-start gap-2 text-sm text-gray-700">
      • <span>{children}</span>
    </div>
  );
}

function Tile({ title, desc, emoji }: { title: string; desc: string; emoji: string }) {
  return (
    <div className="card bg-white">
      <div className="text-2xl">{emoji}</div>
      <div className="font-semibold mt-1">{title}</div>
      <div className="mt-1 text-sm text-gray-700">{desc}</div>
    </div>
  );
}

function Timeline({ year, text }: { year: string; text: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs font-semibold text-gray-500">{year}</div>
      <div className="mt-1 text-sm text-gray-800">{text}</div>
    </div>
  );
}

function Leader({ name, role, blurb }: { name: string; role: string; blurb: string }) {
  return (
    <div className="card bg-white">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white grid place-items-center font-semibold">
          {name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <div className="font-semibold">{name}</div>
          <div className="text-xs text-gray-600">{role}</div>
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-700">{blurb}</p>
    </div>
  );
}
