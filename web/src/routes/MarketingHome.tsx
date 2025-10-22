import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/** Toggle this to true if you ever want a CTA on the hero again */
const SHOW_HERO_CTA = false;

/** Simple slide data */
const slides = [
  {
    id: "ai-hero",
    headline: "Where Intelligence Meets Comfort",
    sub: "AI turns live stay activity into faster service and delightful guest journeys.",
    img: "/hero/ai-hero.png",
    imgAlt: "AI hero background",
  },
  {
    id: "checkin",
    headline: "10-second Mobile Check-in",
    sub: "Scan, confirm, head to your room. No kiosk queues.",
    img: "/hero/checkin.png",
    imgAlt: "Guest scanning QR at the front desk",
  },
  {
    id: "sla",
    headline: "SLA Nudges for Staff",
    sub: "On-time nudges and a clean digest keep service humming.",
    img: "/hero/sla.png",
    imgAlt: "Operations hero",
  },
  {
    id: "owner",
    headline: "AI-Driven Owner Console",
    sub: "Digest, usage, moderation and KPIs — clean, fast, reliable.",
    img: "/hero/owner.png",
    imgAlt: "Owner console hero",
  },
  {
    id: "energy",
    headline: "Grid-Smart Operations & Sustainability",
    sub: "Tariff-aware actions and device shedding without drama.",
    img: "/hero/energy.png",
    imgAlt: "Energy dashboard hero",
  },
];

export default function MarketingHome() {
  // We still hydrate auth so we could show a CTA later if desired
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

  // Prepared (but not rendered when SHOW_HERO_CTA=false)
  const cta = useMemo(() => {
    if (!hydrated) return { label: "\u00A0", href: "#" };
    return email
      ? { label: "My trips", href: "/guest" }
      : { label: "Sign in", href: "/signin?intent=signin&redirect=/guest" };
  }, [email, hydrated]);

  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-6">
        <div className="relative overflow-hidden rounded-2xl">
          <img
            src={slides[0].img}
            alt={slides[0].imgAlt}
            className="block h-[520px] w-full object-cover sm:h-[560px]"
            loading="eager"
            fetchPriority="high"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 md:p-12">
            <div className="max-w-3xl text-white drop-shadow">
              <div className="mb-3 inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs backdrop-blur">
                AI-powered hospitality OS
              </div>
              <h1 className="text-3xl font-bold sm:text-5xl">{slides[0].headline}</h1>
              <p className="mt-3 max-w-2xl text-sm sm:text-base opacity-95">{slides[0].sub}</p>

              {/* CTA removed from landing by default */}
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

      {/* Rest of your page sections … */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <h2 className="text-xl font-semibold">The whole journey, upgraded</h2>
        <p className="mt-1 text-gray-600">
          Clear wins for guests, staff, owners, and your brand.
        </p>
        {/* Keep the rest of your content/tiles here */}
      </section>
    </main>
  );
}
