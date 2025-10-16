// web/src/routes/SmartLanding.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";          // ← changed from "@/lib/auth"
import Landing from "./Landing";                // ← changed from "@/routes/Landing"
import GuestDashboard from "./GuestDashboard";  // ← changed from "@/routes/GuestDashboard"

const OWNER_DEST = "/owner"; // or "/owner/home" if that's your owner route

export default function SmartLanding() {
  const { loading, user, role } = useAuth();
  if (loading) return <div className="min-h-[50vh] grid place-items-center">Loading…</div>;
  if (!user) return <Landing />;
  if (role === "guest") return <GuestDashboard />;
  if (role === "owner" || role === "staff" || role === "admin") return <Navigate to={OWNER_DEST} replace />;
  return <Landing />;
}
