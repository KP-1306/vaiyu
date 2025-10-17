// web/src/App.tsx
import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Spinner from "./components/Spinner";

// Lazy pages (faster initial load)
const HomeOrApp      = lazy(() => import("./routes/HomeOrApp"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const Profile        = lazy(() => import("./routes/Profile"));
const AuthCallback   = lazy(() => import("./routes/AuthCallback"));
// If you have an owner area or other pages, add more lazy imports here.

// ——— Small utility: scroll to top on route change ———
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={
        <div className="min-h-[60vh] grid place-items-center">
          <Spinner label="Loading…" />
        </div>
      }>
        <Routes>
          {/* Marketing root — automatically sends signed-in users to /guest inside HomeOrApp */}
          <Route path="/" element={<HomeOrApp />} />

          {/* Auth callback (Supabase) */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* App surfaces */}
          <Route path="/guest" element={<GuestDashboard />} />
          <Route path="/profile" element={<Profile />} />

          {/* Legacy/aliases you may still hit in links */}
          <Route path="/welcome" element={<Navigate to="/guest" replace />} />

          {/* 404 → home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
