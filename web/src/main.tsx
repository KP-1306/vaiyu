// web/src/main.tsx
import React, { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet, useNavigate } from "react-router-dom";

import { initMonitoring } from "./lib/monitoring";
initMonitoring();

import AuthGate from "./components/AuthGate";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

import { ThemeProvider } from "./components/ThemeProvider";
import "./theme.css";
import "./index.css";

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

// Supabase client (for claiming sessions and role lookup)
import { supabase } from "./lib/supabase";

/* ======== Lazy routes ======== */
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

const Desk = lazy(() => import("./routes/Desk"));
const HK = lazy(() => import("./routes/HK"));
const Maint = lazy(() => import("./routes/Maint"));

const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const OwnerDashboard = lazy(() => import("./routes/OwnerDashboard"));
const OwnerSettings = lazy(() => import("./routes/OwnerSettings"));
const OwnerServices = lazy(() => import("./routes/OwnerServices"));
const OwnerReviews = lazy(() => import("./routes/OwnerReviews"));
const AdminOps = lazy(() => import("./pages/AdminOps"));

const GridDevices = lazy(() => import("./routes/GridDevices"));
const GridPlaybooks = lazy(() => import("./routes/GridPlaybooks"));
const GridEvents = lazy(() => import("./routes/GridEvents"));

const NotFound = lazy(() => import("./routes/NotFound"));
const RequestStatus = lazy(() => import("./pages/RequestStatus"));

/* ======== Global catcher for magic-link tokens ======== */
function AuthSessionCatcher() {
  const navigate = useNavigate();

  useEffect(() => {
    const { hash, search } = window.location;

    // Supabase sends either a hash (token) or a search ?code= (PKCE)
    const hashHasTokens =
      /access_token=|refresh_token=|type=recovery|provider_token=/.test(hash);
    const searchHasCode = /[?&]code=/.test(search);

    if (!hashHasTokens && !searchHasCode) return;

    (async () => {
      try {
        // Try both flows; one will succeed depending on link format
        await supabase.auth
          .getSessionFromUrl({ storeSession: true })
          .catch(async () => {
            const code = new URLSearchParams(window.location.search).get("code");
            if (code) await supabase.auth.exchangeCodeForSession(code);
          });

        // ---- Role-based default destination if ?redirect= is absent ----
        let defaultDest = "/";
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: prof } = await supabase
              .from("user_profiles")
              .select("role")
              .eq("user_id", user.id)
              .maybeSingle();

            const role = prof?.role;
            if (role === "owner" || role === "manager") defaultDest = "/owner";
            else if (role === "admin") defaultDest = "/admin";
            else if (role === "hk") defaultDest = "/hk";
            else if (role === "desk") defaultDest = "/desk";
            else defaultDest = "/guest";
          }
        } catch {
          // if role lookup fails, keep "/"
        }

        // Clean URL & navigate to redirect (or role-based default)
        const url = new URL(window.location.href);
        const dest = url.searchParams.get("redirect") || defaultDest;

        url.hash = "";
        url.searchParams.delete("code");
        url.searchParams.delete("redirect");
        window.history.replaceState({}, "", url.pathname + url.search);
        navigate(dest, { replace: true });
      } catch {
        // If claim fails, go home
        navigate("/", { replace: true });
      }
    })();
  }, [navigate]);

  return null;
}

/* ======== Root layout ======== */
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
      {/* Run the catcher on every page so hash/PKCE links are claimed */}
      <AuthSessionCatcher />
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
      { index: true, element: <App /> },

      // Public
      { path: "signin", element: <SignIn /> },
      { path: "auth/callback", element: <AuthCallback /> }, // still supported
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
      { path: "desk", element: <AuthGate><Desk /></AuthGate> },
      { path: "hk", element: <AuthGate><HK /></AuthGate> },
      { path: "maint", element: <AuthGate><Maint /></AuthGate> },

      // Owner / Admin (protected)
      { path: "owner", element: <AuthGate><OwnerHome /></AuthGate> },
      { path: "owner/dashboard", element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/dashboard/:slug", element: <AuthGate><OwnerDashboard /></AuthGate> },
      { path: "owner/settings", element: <AuthGate><OwnerSettings /></AuthGate> },
      { path: "owner/services", element: <AuthGate><OwnerServices /></AuthGate> },
      { path: "owner/reviews", element: <AuthGate><OwnerReviews /></AuthGate> },
      { path: "admin", element: <AuthGate><AdminOps /></AuthGate> },

      // Grid (protected)
      { path: "grid/devices", element: <AuthGate><GridDevices /></AuthGate> },
      { path: "grid/playbooks", element: <AuthGate><GridPlaybooks /></AuthGate> },
      { path: "grid/events", element: <AuthGate><GridEvents /></AuthGate> },

      // 404
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
        <Suspense
          fallback={
            <div className="min-h-[40vh] grid place-items-center">
              <Spinner label="Loading page…" />
            </div>
          }
        >
          <RouterProvider router={router} />
        </Suspense>
      </ThemeProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
