// web/src/main.tsx
import React, { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import OwnerApplications from "./routes/admin/OwnerApplications";

// ────────────── Lazy routes (grouped like your file) ──────────────
const Scan = React.lazy(() => import("./routes/Scan"));
const Stays = lazy(() => import("./routes/Stays"));
const Stay = lazy(() => import("./routes/Stay"));
const Bills = React.lazy(() => import("./routes/Bill"));
const OwnerAccess = React.lazy(() => import("./routes/OwnerAccess"));
const InviteAccept = React.lazy(() => import("./routes/InviteAccept"));
const OwnerHomeRedirect = lazy(() => import("./routes/OwnerHomeRedirect"));

// Kill stale SW + caches (keep disabled while debugging)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister().catch(() => {});
  });
  (async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
  })();
}

// Monitoring / Analytics
import { initMonitoring } from "./lib/monitoring";
initMonitoring();
import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

// Theme + global styles
import { ThemeProvider } from "./components/ThemeProvider";
import "./theme.css";
import "./index.css";

// Global chrome helpers
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
import { RouteErrorElement, withBoundary } from "./components/RouteErrorBoundary";

// Auth guards
import AuthGate from "./components/AuthGate";
import AdminGate from "./components/AdminGate"; // ← NEW (fixes ReferenceError)

// Supabase client
import { supabase } from "./lib/supabase";

// React Query
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// ================= Lazy routes =================
// Public
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const Logout = lazy(() => import("./routes/Logout"));
const App = lazy(() => import("./App"));
const AboutUs = lazy(() => import("./routes/AboutUs"));
const AboutAI = lazy(() => import("./routes/AboutAI"));
const Press = lazy(() => import("./routes/Press"));
const Privacy = lazy(() => import("./routes/Privacy"));
const Terms = lazy(() => import("./routes/Terms"));
const Contact = lazy(() => import("./routes/Contact"));
const Careers = lazy(() => import("./routes/Careers"));
const Status = lazy(() => import("./routes/Status"));
const Thanks = lazy(() => import("./routes/Thanks"));
const OwnerRegister = lazy(() => import("./routes/OwnerRegister"));

// Guest / Journey
const Hotel = lazy(() => import("./routes/Hotel"));
const Menu = lazy(() => import("./routes/Menu"));
const RequestTracker = lazy(() => import("./routes/RequestTracker"));
const Bill = lazy(() => import("./routes/Bill"));
const Precheck = lazy(() => import("./routes/Precheck"));
const Regcard = lazy(() => import("./routes/Regcard"));
const ClaimStay = lazy(() => import("./routes/ClaimStay"));
const Checkout = lazy(() => import("./routes/Checkout"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const HotelReviews = lazy(() => import("./routes/HotelReviews"));

// Staff / Ops
const Desk = lazy(() => import("./routes/Desk"));
const HK = lazy(() => import("./routes/HK"));
const Maint = lazy(() => import("./routes/Maint"));
// NEW: Desk Tickets view (Ops tickets + SLA board)
const DeskTickets = lazy(() => import("./routes/desk/Tickets"));

// Owner / Admin
const Owner = lazy(() => import("./routes/Owner"));
const OwnerDashboard = lazy(() => import("./routes/OwnerDashboard"));
const OwnerSettings = lazy(() => import("./routes/OwnerSettings"));
const OwnerServices = lazy(() => import("./routes/OwnerServices"));
const OwnerReviews = lazy(() => import("./routes/OwnerReviews"));
const OwnerHousekeeping = lazy(() => import("./routes/OwnerHousekeeping"));
const AdminOps = lazy(() => import("./pages/AdminOps"));

// Grid (VPP)
const GridDevices = lazy(() => import("./routes/GridDevices"));
const GridPlaybooks = lazy(() => import("./routes/GridPlaybooks"));
const GridEvents = lazy(() => import("./routes/GridEvents"));

// Profile / Rewards / Invite
const Profile = lazy(() => import("./routes/Profile"));
const Rewards = lazy(() => import("./routes/Rewards"));
const Invite = lazy(() => import("./routes/Invite")); // ← NEW

// 404 + deep link + welcome
const NotFound = lazy(() => import("./routes/NotFound"));
const RequestStatus = lazy(() => import("./pages/RequestStatus"));
// const Welcome = lazy(() => import("./routes/Welcome"));

// ================= Auth bootstrap gate (robust) =================
function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    const sub = supabase.auth.onAuthStateChange(() => {
      if (!cancelled) setReady(true);
    });

    const t = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(t);
      try {
        sub.data.subscription.unsubscribe();
      } catch {}
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

// ================= Minimal always-on OK page =================
function MinimalOK() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Router is working</h1>
      <p className="mt-2 text-gray-600">Try /guest or /profile next.</p>
      <p className="mt-4 space-x-4">
        <a className="text-blue-700 underline" href="/guest">
          Guest Dashboard
        </a>{" "}
        <a className="text-blue-700 underline" href="/profile">
          Profile
        </a>
      </p>
    </main>
  );
}

// ================= Root layout =================
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
      <Outlet />
    </>
  );
}

// ================= Router =================
const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: withBoundary(<App />) },
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
      { path: "owner/register", element: <OwnerRegister /> },

      // Rewards + Profile + Invite
      { path: "rewards", element: <Rewards /> },
      { path: "invite", element: <AuthGate><Invite /></AuthGate> }, // protected
      { path: "profile", element: <AuthGate><Profile /></AuthGate> },

      // Guest / Journey
      { path: "scan", element: <Scan /> },
      { path: "hotel/:slug", element: <Hotel /> },
      { path: "menu", element: <Menu /> },
      { path: "stay/:code/menu", element: <Menu /> },
      { path: "requestTracker", element: <RequestTracker /> },
      { path: "bill", element: <Bill /> },
      { path: "precheck/:code", element: <Precheck /> },
      { path: "regcard", element: <Regcard /> },
      { path: "claim", element: <ClaimStay /> },
      { path: "checkout", element: <Checkout /> },
      { path: "guest", element: <AuthGate><GuestDashboard /></AuthGate> },
      { path: "hotel/:slug/reviews", element: <HotelReviews /> },
      { path: "stays", element: <Stays /> },
      { path: "stay/:id", element: <Stay /> },
      { path: "bills", element: <Bills /> },

      // Deep link
      { path: "stay/:slug/requests/:id", element: <RequestStatus /> },

      // Staff (protected)
      { path: "desk", element: <AuthGate><Desk /></AuthGate> },
      // NEW: Desk tickets board (Ops tickets + SLA)
      { path: "desk/tickets", element: <AuthGate><DeskTickets /></AuthGate> },
      { path: "hk", element: <AuthGate><HK /></AuthGate> },
      { path: "maint", element: <AuthGate><Maint /></AuthGate> },

      // Owner (protected) — canonical
      { path: "owner", element: <AuthGate><Owner /></AuthGate> },
      { path: "owner/:slug", element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/:slug/housekeeping", element: <AuthGate><OwnerHousekeeping /></AuthGate> },

      // Owner legacy aliases (still work)
      { path: "owner/dashboard", element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/dashboard/:slug", element: <AuthGate><OwnerDashboard /></AuthGate> },

      // Owner settings/services/reviews (protected)
      { path: "owner/settings", element: <AuthGate><OwnerSettings /></AuthGate> },
      { path: "owner/services", element: <AuthGate><OwnerServices /></AuthGate> },
      { path: "owner/reviews", element: <AuthGate><OwnerReviews /></AuthGate> },

      // Admin shell (protected via AuthGate)
      { path: "admin", element: <AuthGate><AdminOps /></AuthGate> },

      // Owner home alias
      { path: "owner/home", element: <AuthGate><OwnerHomeRedirect /></AuthGate> },

      // Admin-only page with AdminGate (token/role)
      { path: "admin/owner-applications", element: <AdminGate><OwnerApplications /></AdminGate> },

      // Access & Invite acceptance (protected)
      { path: "owner/:slug/settings/access", element: <AuthGate><OwnerAccess /></AuthGate> },
      { path: "owner/invite/accept/:token", element: <AuthGate><InviteAccept /></AuthGate> },
      { path: "owner/access", element: <AuthGate><OwnerAccess /></AuthGate> }, // supports ?slug=
      { path: "invite/accept", element: <AuthGate><InviteAccept /></AuthGate> }, // supports ?code=

      // Grid (protected)
      { path: "grid/devices", element: <AuthGate><GridDevices /></AuthGate> },
      { path: "grid/playbooks", element: <AuthGate><GridPlaybooks /></AuthGate> },
      { path: "grid/events", element: <AuthGate><GridEvents /></AuthGate> },

      // 404
      { path: "*", element: <NotFound /> },
    ],
  },
]);

// ================= Mount =================
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
