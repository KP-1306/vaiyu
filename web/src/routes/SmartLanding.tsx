// web/src/routes/SmartLanding.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";           // your auth hook (relative import)
import App from "../App";                         // <-- Public landing is App.tsx
import GuestDashboard from "./GuestDashboard";    // guest home
import Spinner from "../components/Spinner";

const OWNER_DEST = "/owner"; // change to "/owner/home" if that's your owner route

export default function SmartLanding() {
  const { loading, user, role } = useAuth(); // role: 'guest' | 'owner' | 'staff' | 'admin'

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // Not signed in -> show marketing landing (App)
  if (!user) return <App />;

  // Signed in as guest -> personalized dashboard
  if (role === "guest") return <GuestDashboard />;

  // Owners / staff / admins -> owner surface
  if (role === "owner" || role === "staff" || role === "admin") {
    return <Navigate to={OWNER_DEST} replace />;
  }

  // Fallback to public landing
  return <App />;
}
