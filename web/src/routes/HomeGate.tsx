// web/src/routes/HomeGate.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getMyMemberships, loadPersistedRole, PersistedRole } from "../lib/auth";

type Mem = { role: "viewer" | "staff" | "manager" | "owner"; hotelSlug: string | null };

export default function HomeGate() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const session = data?.session;
      const email = session?.user?.email ?? null;

      if (!email) {
        if (alive) {
          setIsAuthed(false);
          setChecking(false);
        }
        return;
      }

      setIsAuthed(true);

      // Signed in → choose landing
      const persisted: PersistedRole | null = loadPersistedRole();
      const mems: Mem[] = await getMyMemberships();

      const firstOwner = mems.find(
        (m) => (m.role === "owner" || m.role === "manager") && m.hotelSlug
      );
      const firstStaff = mems.find((m) => m.role === "staff");

      // Honor explicit last choice
      if (persisted?.role === "owner" && persisted.hotelSlug) {
        navigate(`/owner/${persisted.hotelSlug}`, { replace: true });
        return;
      }
      if (persisted?.role === "manager" && persisted.hotelSlug) {
        navigate(`/owner/${persisted.hotelSlug}`, { replace: true });
        return;
      }
      if (persisted?.role === "staff") {
        navigate(`/staff`, { replace: true });
        return;
      }

      // Otherwise best available
      if (firstOwner?.hotelSlug) {
        navigate(`/owner/${firstOwner.hotelSlug}`, { replace: true });
        return;
      }
      if (firstStaff) {
        navigate(`/staff`, { replace: true });
        return;
      }

      // No hotel membership → guest home
      navigate(`/guest`, { replace: true });
    })();

    return () => {
      alive = false;
    };
  }, [navigate]);

  // While we check auth, show a tiny skeleton
  if (checking) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-gray-500">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }

  // Not signed in → lightweight marketing on the same / route
  if (!isAuthed) {
    return (
      <main>
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Where Intelligence Meets Comfort
            </h1>
            <p className="mt-4 text-gray-600">
              AI turns live stay activity into faster service and delightful guest journeys.
            </p>
            <div className="mt-6 flex gap-3">
              <a
                className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700"
                href="/signin?intent=signup&redirect=/guest"
              >
                Get started
              </a>
              <a
                className="inline-flex items-center rounded-xl border px-4 py-2 text-gray-800 hover:bg-gray-50"
                href="/about"
              >
                Learn more
              </a>
            </div>
          </div>
        </section>

        {/* Add or remove additional marketing sections as you like */}
      </main>
    );
  }

  // In practice we never render this for authed users; we immediately navigated above.
  return null;
}
