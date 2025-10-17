// web/src/main.tsx
import React, { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";

// ── Kill stale SW + caches (do NOT register a new one while debugging)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const r of regs) r.unregister().catch(() => {});
  });
  (async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {}
  })();
}
// ⚠️ IMPORTANT: do not register a SW anywhere below.

// Monitoring (kept)
import { initMonitoring } from "./lib/monitoring";
initMonitoring();

// Analytics (kept)
import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

// Theme + global styles
import { ThemeProvider } from "./components/ThemeProvider";
import "./theme.css";
import "./index.css";

// Chrome
import AccountControls from "./components/AccountControls";
import ScrollToTop from "./components/ScrollToTop";
import BackHome from "./components/BackHome";
import GlobalErrorBoundary from "./components/GlobalErrorBoundary";
import SkipToContent from "./components/SkipToContent";
import PageViewTracker from "./components/PageViewTracker";
import RouteAnnouncer from "./components/RouteAnnouncer";
import OnlineStatusBar from "./components/OnlineStatusBar";
import TopProgressBar from "./components/TopProgressBar";
import UpdatePrompt from "./components/UpdatePrompt";
import Spinner from "./components/Spinner";

// Route error UI
import { RouteErrorElement } from "./components/RouteErrorBoundary";

// Auth + client
import AuthGate from "./components/AuthGate";
import { supabase } from "./lib/supabase";

// React Query
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

/* ===== Lazy routes ===== */
const SignIn         = lazy(() => import("./routes/SignIn"));
const OwnerRegister  = lazy(() => import("./routes/OwnerRegister"));
const AuthCallback   = lazy(() => import("./routes/AuthCallback"));
const Logout         = lazy(() => import("./routes/Logout"));
// const App         = lazy(() => import("./App")); // (optional: keep around for /home if you want)
const AboutUs        = lazy(() => import("./routes/AboutUs"));
const AboutAI        = lazy(() => import("./routes/AboutAI"));
const Press          = lazy(() => import("./routes/Press"));
const Privacy        = lazy(() => import("./routes/Privacy"));
const Terms          = lazy(() => import("./routes/Terms"));
const Contact        = lazy(() => import("./routes/Contact"));
const Careers        = lazy(() => import("./routes/Careers"));
const Status         = lazy(() => import("./routes/Status"));
const Thanks         = lazy(() => import("./routes/Thanks"));
const Profile        = lazy(() => import("./routes/Profile"));
const Scan           = lazy(() => import("./routes/Scan"));

const PublicLanding  = lazy(() => import("./routes/PublicLanding")); // ← the page above

// Guest / Journey
const Hotel          = lazy(() => import("./routes/Hotel"));
const Menu           = lazy(() => import("./routes/Menu"));
const RequestTracker = lazy(() => import("./routes/RequestTracker"));
const Bill           = lazy(() => import("./routes/Bill"));
const Precheck       = lazy(() => import("./routes/Precheck"));
const Regcard        = lazy(() => import("./routes/Regcard"));
const ClaimStay      = lazy(() => import("./routes/ClaimStay"));
const Checkout       = lazy(() => import("./routes/Checkout"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const HotelReviews   = lazy(() => import("./routes/HotelReviews"));

// Staff / Ops
const Desk           = lazy(() => import("./routes/Desk"));
const HK             = lazy(() => import("./routes/HK"));
const Maint          = lazy(() => import("./routes/Maint"));

// Owner / Admin
const OwnerHome      = lazy(() => import("./routes/OwnerHome"));
const OwnerDashboard = lazy(() => import("./routes/OwnerDashboard"));
const OwnerSettings  = lazy(() => import("./routes/OwnerSettings"));
const OwnerServices  = lazy(() => import("./routes/OwnerServices"));
const OwnerReviews   = lazy(() => import("./routes/OwnerReviews"));
const AdminOps       = lazy(() => import("./pages/AdminOps"));

// Grid (VPP)
const GridDevices    = lazy(() => import("./routes/GridDevices"));
const GridPlaybooks  = lazy(() => import("./routes/GridPlaybooks"));
const GridEvents     = lazy(() => import("./routes/GridEvents"));

// 404 + deep link
const NotFound       = lazy(() => import("./routes/NotFound"));
const RequestStatus  = lazy(() => import("./pages/RequestStatus"));

/* ===== Minimal always-on OK page ===== */
function MinimalOK() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Router is working</h1>
      <p className="mt-2 text-gray-600">Try /guest or /profile next.</p>
      <p className="mt-4 space-x-4">
        <a className="text-blue-700 underline" href="/guest">Guest Dashboard</a>{" "}
        <a className="text-blue-700 underline" href="/profile">Profile</a>
      </p>
    </main>
  );
}

/* ===== Auth bootstrap gate ===== */
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      await supabase.auth.getSession().catch(() => {});
      if (!mounted) return;
      const { data: sub } = supabase.auth.onAuthStateChange(() => {
        if (!mounted) return;
        setReady(true);
      });
      const t = setTimeout(() => { if (mounted) setReady(true); }, 250);
      return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
    })();
    return () => { mounted = false; };
  }, []);
  if (!ready) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner label="Starting app…" />
      </div>
    );
  }
  return <>{children}</>;
}

/* ===== Root layout ===== */
function RootLayout() {
  return (
    <>
      <TopProgressBar />
      <SkipToContent />
      <OnlineStatusBar />
      <ScrollToTop />
      <BackHome />
      <PageViewTracker />
      <RouteAnnouncer />
      <UpdatePrompt />
      <AccountControls />
      <Outlet />
    </>
  );
}

/* ===== Router ===== */
const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorElement />,
    children: [
      // ✅ Public landing at "/"
      { index: true, element: <PublicLanding /> },

      // Safety hatch
      { path: "ok", element: <MinimalOK /> },

      // Public
      { path: "signin", element: <SignIn /> },
      { path: "auth/callback", element: <AuthCallback /> },
      { path: "logout", element: <Logout /> },
      { path: "about", element: <AboutUs /> },
      { path: "about-ai", element: <AboutAI /> },
      { path: "press", element: <Press /> },
      { path: "privacy", element: <Privacy /> },
      { path: "terms", element: <Terms /> },
      { path: "contact", element: <Contact /> },
      { path: "careers", element: <Careers /> },
      { path: "status", element: <Status /> },
      { path: "thanks", element: <Thanks /> },
      { path: "profile", element: <Profile /> },
      { path: "settings", element: <Profile /> },
      { path: "scan", element: <Scan /> },

      // Guest / Journey
      { path: "hotel/:slug", element: <Hotel /> },
      { path: "menu", element: <Menu /> },
      { path: "stay/:code/menu", element: <Menu /> },
      { path: "requestTracker", element: <RequestTracker /> },
      { path: "bill", element: <Bill /> },
      { path: "precheck/:code", element: <Precheck /> },
      { path: "regcard", element: <Regcard /> },
      { path: "claim", element: <ClaimStay /> },
      { path: "checkout", element: <Checkout /> },
      { path: "guest", element: <GuestDashboard /> },
      { path: "hotel/:slug/reviews", element: <HotelReviews /> },

      // Guest deep link
      { path: "stay/:slug/requests/:id", element: <RequestStatus /> },

      // Staff (protected)
      { path: "desk",  element: <AuthGate><Desk /></AuthGate> },
      { path: "hk",    element: <AuthGate><HK /></AuthGate> },
      { path: "maint", element: <AuthGate><Maint /></AuthGate> },

      // Owner / Admin (protected)
      { path: "owner",                 element: <AuthGate><OwnerHome /></AuthGate> },
      { path: "owner/dashboard",       element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/dashboard/:slug", element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/settings",        element: <AuthGate><OwnerSettings /></AuthGate> },
      { path: "owner/services",        element: <AuthGate><OwnerServices /></AuthGate> },
      { path: "owner/reviews",         element: <AuthGate><OwnerReviews /></AuthGate> },
      { path: "admin",                 element: <AuthGate><AdminOps /></AuthGate> },
      { path: "owner/register",        element: <OwnerRegister /> },

      // Grid (protected)
      { path: "grid/devices",   element: <AuthGate><GridDevices /></AuthGate> },
      { path: "grid/playbooks", element: <AuthGate><GridPlaybooks /></AuthGate> },
      { path: "grid/events",    element: <AuthGate><GridEvents /></AuthGate> },

      // 404
      { path: "*", element: <NotFound /> },
    ],
  },
]);

/* ===== Mount ===== */
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthBootstrap>
            <Suspense
              fallback={
                <div className="min-h-[40vh] grid place-items-center">
                  <Spinner label="Loading page…" />
                </div>
              }
            >
              <RouterProvider router={router} />
            </Suspense>
          </AuthBootstrap>
        </QueryClientProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
