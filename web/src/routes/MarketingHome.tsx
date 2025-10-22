import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Header from "../components/Header";

/**
 * Minimal, robust marketing page:
 * - Uses Header (so avatar/account menu appears once signed in)
 * - CTAs: "My trips" when signed in, else "Sign in"
 * - Owner console shortcut shows only if user has an owner/manager membership
 */
export default function MarketingHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [isOwnerish, setIsOwnerish] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!alive) return;

      const user = data?.user ?? null;
      setEmail(user?.email ?? null);

      if (!user) {
        setIsOwnerish(false);
        return;
      }

      // lightweight owner/manager check; adapt to your schema/edge func
      const { data: mems } = await supabase
        .from("hotel_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(1);

      setIsOwnerish(!!mems?.some(m => m.role === "owner" || m.role === "manager"));
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setEmail(sess?.user?.email ?? null);
      if (!sess?.user) setIsOwnerish(false);
      else load();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <Header />

      <main className="mx-auto max-w-5xl px-4 py-14">
        <h1 className="text-3xl font-semibold">VAiyu</h1>
        <p className="mt-2 text-gray-600 max-w-2xl">
          AI-powered hospitality OS. Delightful guest journeys, faster service, and clean owner dashboards.
        </p>

        <div className="mt-6 flex gap-3">
          {email ? (
            <>
              <Link
                to="/guest"
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                My trips
              </Link>

              {isOwnerish && (
                <Link
                  to="/owner"
                  className="rounded-lg border px-4 py-2 hover:bg-gray-50"
                >
                  Owner console
                </Link>
              )}
            </>
          ) : (
            <Link
              to="/signin?intent=signin&redirect=/guest"
              className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
