// web/src/routes/MarketingHome.tsx
import Header from "../components/Header";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { getMyMemberships } from "../lib/auth";

type Membership = { hotelSlug: string | null; role: "viewer"|"staff"|"manager"|"owner" };

export default function MarketingHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const e = data?.user?.email ?? null;
      setEmail(e);
      setMemberships(e ? await getMyMemberships().catch(() => []) : []);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      const e = sess?.user?.email ?? null;
      setEmail(e);
      if (!e) setMemberships([]); else getMyMemberships().then(setMemberships);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const canOpenOwner = useMemo(
    () => memberships.some(m => m.role === "owner" || m.role === "manager"),
    [memberships]
  );

  return (
    <>
      <Header />
      {/* Hero */}
      <section className="relative overflow-hidden bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                AI-powered hospitality OS
              </h1>
              <p className="mt-3 text-gray-600">
                Delightful guest journeys, faster service, and clean owner dashboards.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                {email ? (
                  <>
                    <Link
                      to="/guest"
                      className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                    >
                      My trips
                    </Link>
                    {canOpenOwner && (
                      <Link
                        to="/owner"
                        className="inline-flex items-center rounded-lg border px-4 py-2 text-gray-900 hover:bg-gray-50"
                      >
                        Owner console
                      </Link>
                    )}
                  </>
                ) : (
                  <Link
                    to="/signin?intent=signin&redirect=/guest"
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>

            {/* Simple visual */}
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <img
                src="/hero/hotel-lobby.jpg"
                alt="Hotel lobby"
                className="h-64 w-full rounded-xl object-cover"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="10-second Mobile Check-in" text="Scan, confirm, head to your room. No kiosk queues." />
        <Card title="Owner console" text="Digest, usage, moderation and KPIs — clean, fast, reliable." />
        <Card title="Staff workspace" text="On-time delivery SLAs, nudges, and an organized inbox." />
      </section>
    </>
  );
}

function Card({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-base font-medium">{title}</div>
      <div className="mt-1 text-sm text-gray-600">{text}</div>
    </div>
  );
}
