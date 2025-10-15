// web/src/main.tsx
import React, { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Service worker registration (kept)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Analytics (kept)
import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

// Theme + global styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

// Global chrome helpers
import ScrollToTop from './components/ScrollToTop';
import BackHome from './components/BackHome';

// Crash guard
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

// A11y + analytics helpers
import SkipToContent from './components/SkipToContent';
import PageViewTracker from './components/PageViewTracker';
import RouteAnnouncer from './components/RouteAnnouncer';
import RouteErrorBoundary from './routes/RouteErrorBoundary';

// Network/perf helpers
import OnlineStatusBar from './components/OnlineStatusBar';
import TopProgressBar from './components/TopProgressBar';
import UpdatePrompt from './components/UpdatePrompt';
import Spinner from './components/Spinner';

/* ======== Lazy-loaded routes ======== */
// Public / Website
const SignIn        = lazy(() => import('./routes/SignIn'));
const AuthCallback  = lazy(() => import('./routes/AuthCallback'));
const Logout        = lazy(() => import('./routes/Logout'));
const App            = lazy(() => import('./App'));
const Demo           = lazy(() => import('./routes/Demo'));
const AboutUs        = lazy(() => import('./routes/AboutUs'));
const AboutAI        = lazy(() => import('./routes/AboutAI'));
const Press          = lazy(() => import('./routes/Press'));
const Privacy        = lazy(() => import('./routes/Privacy'));
const Terms          = lazy(() => import('./routes/Terms'));
const Contact        = lazy(() => import('./routes/Contact'));
const Careers        = lazy(() => import('./routes/Careers'));
const Status         = lazy(() => import('./routes/Status'));
const Thanks         = lazy(() => import('./routes/Thanks'));


// Guest / Journey
const Hotel          = lazy(() => import('./routes/Hotel'));
const Menu           = lazy(() => import('./routes/Menu'));
const RequestTracker = lazy(() => import('./routes/RequestTracker'));
const Bill           = lazy(() => import('./routes/Bill'));
const Precheck       = lazy(() => import('./routes/Precheck'));
const Regcard        = lazy(() => import('./routes/Regcard'));
const ClaimStay      = lazy(() => import('./routes/ClaimStay'));
const Checkout       = lazy(() => import('./routes/Checkout'));
const GuestDashboard = lazy(() => import('./routes/GuestDashboard'));

// Staff / Ops
const Desk           = lazy(() => import('./routes/Desk'));
const HK             = lazy(() => import('./routes/HK'));
const Maint          = lazy(() => import('./routes/Maint'));

// Owner / Admin
const OwnerHome      = lazy(() => import('./routes/OwnerHome'));
const OwnerDashboard = lazy(() => import('./routes/OwnerDashboard'));
const OwnerSettings  = lazy(() => import('./routes/OwnerSettings'));
const OwnerServices  = lazy(() => import('./routes/OwnerServices'));
const OwnerReviews   = lazy(() => import('./routes/OwnerReviews'));
const AdminOps       = lazy(() => import('./pages/AdminOps'));

// Grid (VPP)
const GridDevices    = lazy(() => import('./routes/GridDevices'));
const GridPlaybooks  = lazy(() => import('./routes/GridPlaybooks'));
const GridEvents     = lazy(() => import('./routes/GridEvents'));

// 404
const NotFound       = lazy(() => import('./routes/NotFound'));

/* >>> ADDED: guest request status page for deep links */
const RequestStatus  = lazy(() => import('./pages/RequestStatus'));

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
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <App /> },

      // Website
      { path: 'signin', element: <SignIn /> },
      { path: 'auth/callback', element: <AuthCallback /> },
      { path: 'logout', element: <Logout /> },
      { path: 'demo', element: <Demo /> },
      { path: 'about', element: <AboutUs /> },
      { path: 'about-ai', element: <AboutAI /> },
      { path: 'press', element: <Press /> },
      { path: 'privacy', element: <Privacy /> },
      { path: 'terms', element: <Terms /> },
      { path: 'contact', element: <Contact /> },
      { path: 'careers', element: <Careers /> },
      { path: 'status', element: <Status /> },
      { path: 'thanks', element: <Thanks /> },

      // Guest / Journey
      { path: 'hotel/:slug', element: <Hotel /> },
      { path: 'menu', element: <Menu /> },
      { path: 'stay/:code/menu', element: <Menu /> }, // alias for guest menu deep-link
      { path: 'requestTracker', element: <RequestTracker /> },
      { path: 'bill', element: <Bill /> },
      { path: 'precheck/:code', element: <Precheck /> },
      { path: 'regcard', element: <Regcard /> },
      { path: 'claim', element: <ClaimStay /> },
      { path: 'checkout', element: <Checkout /> },
      { path: 'guest', element: <GuestDashboard /> },

      /* >>> ADDED: deep link like /stay/DEMO/requests/<id> */
      { path: 'stay/:slug/requests/:id', element: <RequestStatus /> },

      // Staff
      { path: 'desk', element: <Desk /> },
      { path: 'hk', element: <HK /> },
      { path: 'maint', element: <Maint /> },

      // Owner / Admin
      { path: 'owner', element: <OwnerHome /> }, // hub
      { path: 'owner/dashboard', element: <OwnerDashboard /> },
      { path: 'owner/dashboard/:slug', element: <OwnerDashboard /> }, // slug deep-link
      { path: 'owner/settings', element: <OwnerSettings /> },
      { path: 'owner/services', element: <OwnerServices /> },
      { path: 'owner/reviews', element: <OwnerReviews /> },
      { path: 'admin', element: <AdminOps /> },

      // Grid (VPP)
      { path: 'grid/devices', element: <GridDevices /> },
      { path: 'grid/playbooks', element: <GridPlaybooks /> },
      { path: 'grid/events', element: <GridEvents /> },

      // 404 (catch-all) — keep last
      { path: '*', element: <NotFound /> },
    ],
  },
]);

// Protect Admin pages (example: your Admin Ops at /admin or /hk/desk etc.)
{
  path: 'admin',
  element: (
    <AuthGate>
      <Desk /> {/* or AdminOps component you use */}
    </AuthGate>
  ),
},

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Suspense
            fallback={
              <div className="min-h-[40vh] grid place-items-center">
                <Spinner label="Loading page…" />
              </div>
            }
          >
            <RouterProvider router={router} />
          </Suspense>
        </QueryClientProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
