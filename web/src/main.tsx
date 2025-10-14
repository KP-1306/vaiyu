// web/src/main.tsx
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Status from './routes/Status';
import OnlineStatusBar from './components/OnlineStatusBar';
import TopProgressBar from './components/TopProgressBar';
import Thanks from './routes/Thanks';




import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { initAnalytics, track } from "./lib/analytics";
initAnalytics();
track("page_view", { path: location.pathname });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

import UpdatePrompt from './components/UpdatePrompt';


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

/* ======== Public / Website ======== */
import App from './App';
import Demo from './routes/Demo';
import AboutUs from './routes/AboutUs';
import AboutAI from './routes/AboutAI';
import Press from './routes/Press';
import Privacy from './routes/Privacy';
import Terms from './routes/Terms';
import Contact from './routes/Contact';
import Careers from './routes/Careers';


/* ======== Guest / Journey ======== */
import Hotel from './routes/Hotel';
import Menu from './routes/Menu';
import RequestTracker from './routes/RequestTracker';
import Bill from './routes/Bill';
import Precheck from './routes/Precheck';
import Regcard from './routes/Regcard';
import ClaimStay from './routes/ClaimStay';
import Checkout from './routes/Checkout';
import GuestDashboard from './routes/GuestDashboard';

/* ======== Staff / Ops ======== */
import Desk from './routes/Desk';
import HK from './routes/HK';
import Maint from './routes/Maint';

/* ======== Owner / Admin ======== */
import OwnerHome from './routes/OwnerHome';
import OwnerDashboard from './routes/OwnerDashboard';
import OwnerSettings from './routes/OwnerSettings';
import OwnerServices from './routes/OwnerServices';
import OwnerReviews from './routes/OwnerReviews';

/* ======== Grid (VPP) ======== */
import GridDevices from './routes/GridDevices';
import GridPlaybooks from './routes/GridPlaybooks';
import GridEvents from './routes/GridEvents';

/* ======== 404 ======== */
import NotFound from './routes/NotFound';

/* ======== Root layout that adds global helpers ======== */
function RootLayout() {
  return (
    <>
      <TopProgressBar /> 
      <SkipToContent />       {/* first tabbable item for keyboard users */}
      <OnlineStatusBar />   {/* NEW */}
      <ScrollToTop />
      <BackHome />
      <PageViewTracker />     {/* fires page_view on client-side navigation */}
      <RouteAnnouncer />      {/* screen reader-friendly route change announcements */}
      <UpdatePrompt />   {/* ← INSERT HERE */}
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

      // Staff
      { path: 'desk', element: <Desk /> },
      { path: 'hk', element: <HK /> },
      { path: 'maint', element: <Maint /> },

      // Owner / Admin
      { path: 'owner', element: <OwnerHome /> },            // hub
      { path: 'owner/dashboard', element: <OwnerDashboard /> },
      { path: 'owner/dashboard/:slug', element: <OwnerDashboard /> }, // slug deep-link
      { path: 'owner/settings', element: <OwnerSettings /> },
      { path: 'owner/services', element: <OwnerServices /> },
      { path: 'owner/reviews', element: <OwnerReviews /> },

      // Grid (VPP)
      { path: 'grid/devices', element: <GridDevices /> },
      { path: 'grid/playbooks', element: <GridPlaybooks /> },
      { path: 'grid/events', element: <GridEvents /> },

      // 404 (catch-all) — keep last
      { path: '*', element: <NotFound /> },
    ],
  },
]);

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
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
