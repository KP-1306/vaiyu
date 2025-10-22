// web/src/routes/MarketingHome.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";
import { getMyMemberships } from "../lib/auth";

type Membership = {
  hotelSlug: string | null;
  role: "viewer" | "staff" | "manager" | "owner";
};

export default function MarketingHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);

      // 1) current user
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const userEmail = data?.user?.email ?? null;

      // 2) memberships if signed-in
      const mems = userEmail ? await getMyMemberships().catch(() => []) : [];

      if (!alive) return;
      setEmail(userEmail);
      setMemberships(mems);
      setLoading(false);
    };

    load();

    // keep in sync across tabs / auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      const e = sess?.user?.email ?? null;
      setEmail(e);
      if (!e) setMemberships([]);
      else getMyMemberships().then(setMemberships).catch(() => setMemberships([]));
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes("supabase.auth.token")) {
        load();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // show owner console link when user has any owner/manager role
  const canOpenOwnerConsole = useMemo(
    () => memberships.some((m) => m.role === "owner" || m.role === "manager"),
    [memberships]
  );

  return (
    <>
      {/* Top nav with avatar / account menu */}
      <Header />

      <main className="mx-auto max-w-6xl px-4 pt-16 pb-24">
        <section className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">VAiyu</h1>
          <p className="mt-3 text-gray-600">
            AI-powered hospitality OS. Delightful guest journeys, faster service, and clean owner dashboards.
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

                {canOpenOwnerConsole && (
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
        </section>

        {/* (Optional) quick highlights below the fold */}
        <section className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="10-second Mobile Check-in" text="Scan, confirm, head to your room. No kiosk queues." />
          <FeatureCard title="Owner console" text="Digest, usage, moderation and KPIs — clean, fast, reliable." />
          <FeatureCard title="Staff workspace" text="On-time delivery SLAs, nudges, and an organized inbox." />
        </section>
      </main>
    </>
  );
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-base font-medium">{title}</div>
      <div className="mt-1 text-sm text-gray-600">{text}</div>
    </div>
  );
}
