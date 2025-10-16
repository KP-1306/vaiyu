// web/src/routes/Welcome.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import SEO from "../components/SEO";

type Profile = { full_name?: string | null; role?: string | null };

export default function Welcome() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasProperty, setHasProperty] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // who am I?
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id || null;
        setEmail(u?.user?.email ?? null);

        // profile: prefer your user_profiles table for role/name
        let role: string | null = null;
        if (uid) {
          const { data: p } = await supabase
            .from("user_profiles")
            .select("full_name, role")
            .eq("user_id", uid)
            .maybeSingle();

          setProfile({ full_name: p?.full_name ?? null, role: p?.role ?? null });
          role = p?.role ?? null;
        }

        // Decide if user has a property yet:
        // 1) Owner/Manager role ⇒ has property tools
        if (role === "owner" || role === "manager") {
          setHasProperty(true);
        } else if (uid) {
          // 2) Member of any property?
          //    Adjust table/column names if yours differ
          const { data: mem } = await supabase
            .from("hotel_members")
            .select("hotel_id")
            .eq("user_id", uid)
            .limit(1);

          // 3) Or owns any property directly?
          const { data: owns } = await supabase
            .from("hotels")
            .select("id")
            .eq("owner_id", uid)
            .limit(1);

          setHasProperty(Boolean(mem?.length) || Boolean(owns?.length));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const name = profile?.full_name || email || "there";

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-6">
      <SEO title="Welcome" noIndex />

      {/* Friendly header / hero */}
      <header className="rounded-2xl border bg-white p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {name} 👋</h1>
          <p className="text-gray-600">
            Choose what you want to do today.
          </p>
        </div>
        {/* optional small badge/brand could go here */}
      </header>

      {loading ? (
        <div className="card p-6 text-sm text-muted-foreground">Loading…</div>
      ) : hasProperty ? (
        // ===================================================================
        // Users who already have a property ⇒ show BOTH consoles
        // ===================================================================
        <section className="grid md:grid-cols-2 gap-4">
          {/* Property console */}
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏨</span>
              <div className="font-semibold">Property console</div>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Manage services, dashboards, staff workflows and AI moderation.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Link to="/owner" className="btn">Open owner home</Link>
              <Link to="/owner/services" className="btn btn-light">Services (SLA)</Link>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Need to add another?{" "}
              <Link to="/owner/settings?new=1" className="underline">
                Register & configure
              </Link>
            </div>
          </div>

          {/* Guest console */}
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="text-xl">🧳</span>
              <div className="font-semibold">Guest console</div>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Attach a booking, request housekeeping, order F&amp;B, view bills.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Link to="/claim" className="btn">Claim my stay</Link>
              <Link to="/guest" className="btn btn-light">Open guest dashboard</Link>
            </div>
          </div>
        </section>
      ) : (
        // ===================================================================
        // New users (no property yet) ⇒ show ONLY the guest console,
        // and a subtle CTA to register a property.
        // ===================================================================
        <section className="grid md:grid-cols-12 gap-4">
          <div className="md:col-span-7">
            <div className="card p-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🧭</span>
                <div>
                  <div className="font-semibold">Get started as a guest</div>
                  <div className="text-sm text-gray-600">
                    Link your stay to manage requests, F&amp;B orders and bills—right from your phone.
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <Link to="/claim" className="btn">Claim my stay</Link>
                <Link to="/guest" className="btn btn-light">Open guest dashboard</Link>
              </div>
            </div>
          </div>

          <div className="md:col-span-5">
            <div className="card p-6 h-full">
              <div className="font-semibold">Want to run a property?</div>
              <p className="text-sm text-gray-600 mt-1">
                When you register a property, you’ll unlock the owner console: dashboards, SLA services,
                staff workflows and AI moderation.
              </p>
              <div className="mt-4">
                <Link to="/owner/settings?new=1" className="btn btn-light">
                  Register your property
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
