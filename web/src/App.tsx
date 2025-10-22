// web/src/App.tsx
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import Header from "./components/Header";

// Routes / screens (use your existing implementations)
import HomeGate from "./routes/HomeGate";               // "/" — redirects when authed; shows light marketing when signed out
import GuestDashboard from "./routes/GuestDashboard";   // "/guest"
import OwnerHome from "./routes/OwnerHome";             // "/owner", "/owner/:slug/*"
import StaffHome from "./routes/StaffHome";             // "/staff/*"

import Profile from "./routes/Profile";                 // "/profile"
import Settings from "./routes/Settings";               // "/settings"
import SignIn from "./routes/SignIn";                   // "/signin"
import AuthCallback from "./routes/AuthCallback";       // "/auth/callback"
import Logout from "./routes/Logout";                   // "/logout"
import NotFound from "./routes/NotFound";               // 404

function Layout() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Header />
      <Outlet />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Single-home gate at "/" */}
          <Route index element={<HomeGate />} />

          {/* Core app surfaces */}
          <Route path="/guest" element={<GuestDashboard />} />

          {/* Owner console (canonical + slug) */}
          <Route path="/owner" element={<OwnerHome />} />
          <Route path="/owner/:slug/*" element={<OwnerHome />} />

          {/* Staff workspace */}
          <Route path="/staff/*" element={<StaffHome />} />

          {/* Utilities / account */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/logout" element={<Logout />} />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
