// web/src/routes/Welcome.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate"; // optional (we won't wrap the whole page)

type Profile = {
  id: string;
  role?: "owner" | "manager" | "staff" | "guest" | null;
  hotel_id?: string | null;
  hotel_slug?: string | null;
  full_name?: string | null;
};

export default function Welcome() {
  const [params] = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // if we somehow hit this page without a session, send to SignIn keeping redirect
        const r = params.get("redirect") || "/welcome";
        navigate(`/signin?redirect=${encodeURIComponent(r)}`, { replace: true });
        return;
      }
      // try to read a lightweight profile; fall back to just the user
      try {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("id, role, hotel_id, hotel_slug, full_name")
          .eq("user_id", sess.session.user.id)
          .maybeSingle();
        if (!error && data) {
          setProfile({
            id: data.id,
            role: data.role as any,
            hotel_id: data.hotel_id,
            hotel_slug: data.hotel_slug ?? undefined,
            full_name: data.full_name,
          });
        } else {
          setProfile({ id: sess.session.user.id, role: "guest" });
        }
      } catch {
        setProfile({ id: sess.session.user.id, role: "guest" });
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, params]);

  const hotelSlug = useMemo(
    () => profile?.hotel_slug || "sunrise",
    [profile?.hotel_slug]
  );

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}</h1>
        <p className="text-gray-600">
          Choose what you want to do today.
        </p>
      </header>

      {loading ? (
        <div className="card">Loading…</div>
      ) : (
        <section className="grid md:grid-cols-2 gap-4">
          {/* Owner/Manager card */}
          <div className="card">
            <div className="text-xl">🏨 Property console</div>
            <div className="text-gray-600 mt-1">
              Manage services, dashboards, staff workflows and AI moderation.
            </div>
            <div className="mt-3 flex gap-2">
              <Link to={`/owner?slug=${encodeURIComponent(hotelSlug)}`} className="btn">Open owner home</Link>
              <Link to={`/owner/services?slug=${encodeURIComponent(hotelSlug)}`} className="btn btn-light">Services (SLA)</Link>
            </div>
            <div className="mt-3 text-sm text-gray-500">
              New property?{" "}
              <Link to={`/owner/settings?slug=${encodeURIComponent(hotelSlug)}`} className="link">
                Register & configure
              </Link>
            </div>
          </div>

          {/* Guest / personal card */}
          <div className="card">
            <div className="text-xl">🧳 Guest console</div>
            <div className="text-gray-600 mt-1">
              Attach a booking, order F&amp;B, request housekeeping, view bills.
            </div>
            <div className="mt-3 flex gap-2">
              <Link to="/claim" className="btn">Claim my stay</Link>
              <Link to="/guest" className="btn btn-light">Open guest dashboard</Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
