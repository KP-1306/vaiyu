// web/src/routes/SmartLanding.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import Landing from "@/routes/Landing";            // your public marketing page
import GuestDashboard from "@/routes/GuestDashboard"; // the signed-in guest home

export default function SmartLanding() {
  const { loading, user, role } = useAuth(); // role: 'guest' | 'owner' | 'staff' | 'admin'
  if (loading) return <div className="min-h-[50vh] grid place-items-center">Loading…</div>;
  if (!user) return <Landing />;
  if (role === "guest") return <GuestDashboard />;
  if (role === "owner" || role === "staff" || role === "admin") return <Navigate to="/welcome" replace />;
  return <Landing />;
}
