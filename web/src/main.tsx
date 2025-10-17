import React, { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
} from "react-router-dom";

// Monitoring (kept)
import { initMonitoring } from "./lib/monitoring";
initMonitoring();

// Service worker (kept)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Analytics (kept)
import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

// Theme + global styles
import { ThemeProvider } from "./components/ThemeProvider";
import "./theme.css";
import "./index.css";

// add import
import AccountControls from "./components/AccountControls";

// Global chrome helpers
import ScrollToTop from "./components/ScrollToTop";
import BackHome from "./components/BackHome";
import GlobalErrorBoundary from "./components/GlobalErrorBoundary";
import SkipToContent from "./components/SkipToContent";
import PageViewTracker from "./components/PageViewTracker";
import RouteAnnouncer from "./components/RouteAnnouncer";
import RouteErrorBoundary from "./routes/RouteErrorBoundary";
import OnlineStatusBar from "./components/OnlineStatusBar";
import TopProgressBar from "./components/TopProgressBar";
import UpdatePrompt from "./components/UpdatePrompt";
import Spinner from "./components/Spinner";

// Auth guard for protected routes
import AuthGate from "./components/AuthGate";

// Supabase client
import { supabase } from "./lib/supabase";

// (Optional) React Query – prevents “No QueryClient set” warnings
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

/* ======== Lazy routes ======== */
// Public
const SignIn         = lazy(() => import("./routes/SignIn"));
const OwnerRegister  = lazy(() => import("./routes/OwnerRegister"));
const AuthCallback   = lazy(() => import("./routes/AuthCallback")); // kept
const Logout         = lazy(() => import("./routes/Logout"));
const App            = lazy(() => import("./App"));                 // (still available for marketing sections if used elsewhere)
const AboutUs        = lazy(() => import("./routes/AboutUs"));
const AboutAI        = lazy(() => import("./routes/AboutAI"));
const Press          = lazy(() => import("./routes/Press"));
const Privacy        = lazy(() => import("./routes/Privacy"));
const Terms          = lazy(() => import("./routes/Terms"));
const Contact        = lazy(() => import("./routes/Contact"));
const Careers        = lazy(() => import("./routes/Careers"));
const Status         = lazy(() => import("./routes/Status"));
const Thanks         = lazy(() => import("./routes/Thanks"));

// Smart Landing (NEW): decides Landing vs GuestDashboard vs /owner
const SmartLanding   = lazy(() => import("./routes/SmartLanding"));

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

/* ======== Auth bootstrap gate ======== */
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      await supabase.auth.getSession().catch(() => {});
      if (!mounted) return;

      const { data: sub } = supabase.auth.onAuthStateChange((_evt) => {
        if (!mounted) return;
        setReady(true);
      });

      const t = setTimeout(() => {
        if (!mounted) return;
        setReady(true);
      }, 250);

      return () => {
        clearTimeout(t);
        sub.subscription.unsubscribe();
      };
    })();

    return () => {
      mounted = false;
    };
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

/* ======== Root layout that adds global helpers ======== */
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
      <AccountControls />   {/* ← NEW: sign-out + open app */}
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      // ⬇️ Changed: SmartLanding decides where to go at "/"
      { index: true, element: <SmartLanding /> },

      // Public
      { path: "signin", element: <SignIn /> },
      { path: "auth/callback", element: <AuthCallback /> }, // spinner-only callback
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

      // Guest / Journey (public)
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

      // Guest deep link (public)
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
      { path: "owner/register",        element: <OwnerRegister /> }, // public intake form

      // Grid (protected)
      { path: "grid/devices",   element: <AuthGate><GridDevices /></AuthGate> },
      { path: "grid/playbooks", element: <AuthGate><GridPlaybooks /></AuthGate> },
      { path: "grid/events",    element: <AuthGate><GridEvents /></AuthGate> },


      // 404 (catch-all)
      { path: "*", element: <NotFound /> },
    ],
  },
]);

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
