import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/** Show a hero CTA button? (kept false to avoid duplicating “My trips”) */
const SHOW_HERO_CTA = false;

/** --- Content: tweak copy/images here --- */
const HERO = {
  badge: "AI-powered hospitality OS",
  headline: "Where Intelligence Meets Comfort",
  sub: "AI turns live stay activity into faster service and delightful guest journeys.",
  img: "/hero/ai-hero.png",
  imgAlt: "AI hero background",
};

const FEATURE_CARDS = [
  {
    id: "checkin",
    title: "10-second Mobile Check-in",
    sub: "Scan, confirm, head to your room. No kiosk queues.",
    href: "/guest",
    image: "/hero/checkin.png",
  },
  {
    id: "owner",
    title: "Owner console",
    sub: "Digest, usage, moderation and KPIs — clean, fast, reliable.",
    href: "/owner",
    image: "/hero/owner.png",
  },
  {
    id: "staff",
    title: "Staff workspace",
    sub: "On-time delivery SLAs, nudges, and an organized inbox.",
    href: "/staff",
    image: "/hero/sla.png",
  },
];

const HOW_STEPS = [
  {
    title: "Capture live events",
    text: "Check-ins, requests, room status, payments and more stream in real-time.",
  },
  {
    title: "AI triage & nudges",
    text: "Smart routing, deadlines, and reminders keep operations humming.",
  },
  {
    title: "Delightful dashboards",
    text: "Owners see the signal — digest, trends, KPIs — without the noise.",
  },
];

const LOGOS = [
  { src: "/logos/hotel-01.svg", alt: "Hotel A" },
  { src: "/logos/hotel-02.svg", alt: "Hotel B" },
  { src: "/logos/hotel-03.svg", alt: "Hotel C" },
  { src: "/logos/hotel-04.svg", alt: "Hotel D" },
  { src: "/logos/hotel-05.svg", alt: "Hotel E" },
];

/** --- Auth hydrate (for optional hero CTA) --- */
export default function MarketingHome() {
  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!alive) return;
      setEmail(data?.user?.email ?? null);
      setHydrated(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setEmail(sess?.user?.email ?? null);
      setHydrated(true);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const cta = useMemo(() => {
    if (!hydrated) return { label: "\u00A0", href: "#" };
    return email
      ? { label: "My trips", href: "/guest" }
      : { label: "Sign in", href: "/signin?intent=signin&redirect=/guest" };
  }, [email, hydrated]);

  return (
    <main>

      {/* HERO */}
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-6">
        <div className="relative overflow-hidden rounded-2xl">
          <img
            src={HERO.img}
            alt={HERO.imgAlt}
            className="block h-[520px] w-full object-cover sm:h-[560px]"
            loading="eager"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 md:p-12">
            <div className="max-w-3xl text-white drop-shadow">
              <div className="mb-3 inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs backdrop-blur">
                {HERO.badge}
              </div>
              <h1 className="text-3xl font-bold sm:text-5xl">{HERO.headline}</h1>
              <p className="mt-3 max-w-2xl text-sm sm:text-base opacity-95">{HERO.sub}</p>

              {SHOW_HERO_CTA && (
                <div className="mt-6">
                  <a
                    href={cta.href}
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    {cta.label}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* WHY STRIP */}
      <section className="mx-auto max-w-7xl px-4 pb-10">
        <h2 className="text-xl font-semibold">The whole journey, upgraded</h2>
        <p className="mt-1 text-gray-600">
          Clear wins for guests, staff, owners, and your brand.
        </p>
      </section>

      {/* 3 FEATURE CARDS */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_CARDS.map((c) => (
            <a
              key={c.id}
              href={c.href}
              className="group overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md"
            >
              <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
                <img
                  src={c.image}
                  alt={c.title}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </div>
              <div className="p-4">
                <h3 className="font-medium">{c.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{c.sub}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <div className="rounded-2xl border bg-gradient-to-br from-slate-50 to-white p-6 md:p-8">
          <h2 className="text-xl font-semibold">How VAiyu works</h2>
          <p className="mt-1 text-gray-600">
            A clean pipeline from live events to outcomes — for guests, staff and owners.
          </p>

          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {HOW_STEPS.map((s, idx) => (
              <li key={s.title} className="rounded-xl border bg-white p-4">
                <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {idx + 1}
                </div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* LOGOS BAND */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <div className="rounded-2xl border bg-white px-4 py-6">
          <p className="text-center text-sm text-gray-500">Trusted by modern hotels</p>
          <div className="mt-4 grid grid-cols-2 items-center gap-6 sm:grid-cols-3 md:grid-cols-5">
            {LOGOS.map((l, i) => (
              <div key={i} className="flex items-center justify-center">
                <img
                  src={l.src}
                  alt={l.alt}
                  className="h-8 opacity-70 grayscale"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CLOSING CTA (no My trips duplication) */}
      <section className="mx-auto max-w-7xl px-4 pb-24">
        <div className="rounded-2xl border bg-gradient-to-r from-indigo-50 to-blue-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold">Ready to see it live?</h2>
          <p className="mt-1 text-gray-700">
            Explore the guest journey, owner console, and staff workspace.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="/why"
              className="inline-flex items-center rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-white/80"
            >
              Why VAiyu
            </a>
            <a
              href="/use-cases"
              className="inline-flex items-center rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-white/80"
            >
              Use-cases
            </a>
            <a
              href="/ai"
              className="inline-flex items-center rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-white/80"
            >
              AI
            </a>
          </div>
        </div>
      </section>

    </main>
  );
}
