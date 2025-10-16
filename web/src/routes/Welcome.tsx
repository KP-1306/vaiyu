// web/src/routes/Welcome.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { signOutEverywhere } from "../lib/auth";
import SEO from "../components/SEO";

type Profile = { full_name?: string | null; role?: string | null };

export default function Welcome() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasProperty, setHasProperty] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let graceTimer: number | undefined;

    async function bootstrap(uid: string) {
      // who am I? (email)
      const { data: u } = await supabase.auth.getUser();
      if (mounted) setEmail(u?.user?.email ?? null);

      // profile (name/role)
      let role: string | null = null;
      const { data: p } = await supabase
        .from("user_profiles")
        .select("full_name, role")
        .eq("user_id", uid)
        .maybeSingle();

      if (mounted) {
        setProfile({ full_name: p?.full_name ?? null, role: p?.role ?? null });
        role = p?.role ?? null;
      }

      // determine if user already has a property
      if (role === "owner" || role === "manager") {
        if (mounted) setHasProperty(true);
      } else {
        const [{ data: mem }, { data: owns }] = await Promise.all([
          supabase
            .from("hotel_members")
            .select("hotel_id")
            .eq("user_id", uid)
            .limit(1),
          supabase
            .from("hotels")
            .select("id")
            .eq("owner_id", uid)
            .limit(1),
        ]);
        if (mounted) setHasProperty(Boolean(mem?.length) || Boolean(owns?.length));
      }

      if (mounted) setLoading(false);
    }

    async function checkOnce() {
      // If session already present, bootstrap immediately
      const { data: sess } = await supabase.auth.getSession();
      if (sess?.session?.user?.id) {
        await bootstrap(sess.session.user.id);
        return;
      }

      // Otherwise, wait for auth hydration after magic-link exchange
      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
        if (!mounted) return;
        if (s?.user?.id) {
          sub.subscription.unsubscribe();
          await bootstrap(s.user.id);
        }
      });

      // Safety net: after 2s, if still no session, redirect to Sign in
      graceTimer = window.setTimeout(async () => {
        if (!mounted) return;
        const { data: final } = await supabase.auth.getSession();
        if (!final?.session) {
          navigate(`/signin?redirect=${encodeURIComponent("/welcome")}`, {
            replace: true,
          });
        }
      }, 2000) as unknown as number;
    }

    checkOnce();

    return () => {
      mounted = false;
      if (graceTimer) clearTimeout(graceTimer);
    };
  }, [navigate]);

  const name = profile?.full_name || email || "there";

  async function handleSignOut() {
    await signOutEverywhere();
    navigate(`/signin?intent=signin&_=${Date.now()}`, { replace: true });
  }

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-6">
      <SEO title="Welcome" noIndex />

      {/* Header */}
      <header className="rounded-2xl border bg-white p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {name} 👋</h1>
          <p className="text-gray-600">Choose what you want to do today.</p>
        </div>

        {/* Simple account cluster */}
        <div className="flex items-center gap-3">
          {email && (
            <span className="text-sm text-gray-600 hidden sm:inline">
              {email}
            </span>
          )}
          <button className="btn btn-light" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {loading ? (
        <div className="card p-6 text-sm text-muted-foreground">Loading…</div>
      ) : hasProperty ? (
        /* ===============================================================
           Users who already have a property ⇒ show BOTH consoles
           =============================================================== */
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
              <Link to="/owner" className="btn">
                Open owner home
              </Link>
              <Link to="/owner/services" className="btn btn-light">
                Services (SLA)
              </Link>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Need to add another?{" "}
              <Link to="/owner/settings?new=1" className="underline">
                Register &amp; configure
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
              <Link to="/claim" className="btn">
                Claim my stay
              </Link>
              <Link to="/guest" className="btn btn-light">
                Open guest dashboard
              </Link>
            </div>
          </div>
        </section>
      ) : (
        /* ===============================================================
           New users (no property) ⇒ show ONLY guest console + CTA
           =============================================================== */
        <section className="grid md:grid-cols-12 gap-4">
          <div className="md:col-span-7">
            <div className="card p-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🧭</span>
                <div>
                  <div className="font-semibold">Get started as a guest</div>
                  <div className="text-sm text-gray-600">
                    Link your stay to manage requests, F&amp;B orders and
                    bills—right from your phone.
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <Link to="/claim" className="btn">
                  Claim my stay
                </Link>
                <Link to="/guest" className="btn btn-light">
                  Open guest dashboard
                </Link>
              </div>
            </div>
          </div>

          <div className="md:col-span-5">
            <div className="card p-6 h-full">
              <div className="font-semibold">Want to run a property?</div>
              <p className="text-sm text-gray-600 mt-1">
                When you register a property, you’ll unlock the owner console:
                dashboards, SLA services, staff workflows and AI moderation.
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
