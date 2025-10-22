// web/src/App.tsx
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Header from "./components/Header";
import AccountBubble from "./components/AccountBubble";

// Unified home (marketing when signed out; auto-redirect when signed in)
import HomeGate from "./routes/HomeGate";

// Lazy routes (all paths are relative to /src and use "./routes/...")
const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const StaffHome = lazy(() => import("./routes/StaffHome"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const Logout = lazy(() => import("./routes/Logout"));
const Profile = lazy(() => import("./routes/Profile"));
const Settings = lazy(() => import("./routes/Settings"));
const NotFound = lazy(() => import("./routes/NotFound"));

/**
 * App
 * - "/" shows marketing if signed out, otherwise forwards to the best console
 * - "/owner" lists properties; "/owner/:slug" opens a single property console
 * - "/staff" staff workspace
 * - "/guest" guest dashboard
 * - auth helpers: "/signin", "/auth/callback", "/logout"
 * - profile/settings
 */
export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <AccountBubble />

      <Suspense fallback={<Fallback />}>
        <Routes>
          {/* Unified home gate */}
          <Route path="/" element={<HomeGate />} />

          {/* Owner */}
          <Route path="/owner" element={<OwnerHome />} />
          <Route path="/owner/:slug" element={<OwnerHome />} />

          {/* Staff */}
          <Route path="/staff" element={<StaffHome />} />

          {/* Guest */}
          <Route path="/guest" element={<GuestDashboard />} />

          {/* Auth */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/logout" element={<Logout />} />

          {/* Profile / Settings */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />

          {/* Legacy/unknown -> 404 */}
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function Fallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-gray-500">
      Loading…
    </div>
  );
}
