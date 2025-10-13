// web/src/main.tsx
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Theme + global styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

// Global chrome helpers
import ScrollToTop from './components/ScrollToTop';
import BackHome from './components/BackHome';

// (optional) global crash guard — see tiny file at bottom
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

/* ======== Public / Website ======== */
import App from './App';                       // Landing page
import Demo from './routes/Demo';
import AboutUs from './routes/AboutUs';
import AboutAI from './routes/AboutAI';       // HOW IT WORKS (AI) PAGE
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
import Owner from './routes/Owner';
import OwnerDashboard from './routes/OwnerDashboard';
import OwnerSettings from './routes/OwnerSettings';
import OwnerServices from './routes/OwnerServices';
import OwnerReviews from './routes/OwnerReviews';
// web/src/main.tsx (routes array — add under "Owner / Admin" or its own section)
import GridDevices from './routes/GridDevices';
import GridPlaybooks from './routes/GridPlaybooks';
import GridEvents from './routes/GridEvents';
import OwnerHome from './routes/OwnerHome'; // add import

/* ======== Root layout that adds global helpers ======== */
function RootLayout() {
  return (
    <>
      <ScrollToTop />
      <BackHome />
      <Outlet />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
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

      // Guest / Journey
      { path: 'hotel/:slug', element: <Hotel /> },
      { path: 'menu', element: <Menu /> },
      { path: 'requestTracker', element: <RequestTracker /> },
      { path: 'bill', element: <Bill /> },
      { path: 'precheck/:code', element: <Precheck /> },
      { path: 'regcard', element: <Regcard /> },
      { path: 'claim', element: <ClaimStay /> },
      { path: 'checkout', element: <Checkout /> },
      { path: 'guest', element: <GuestDashboard /> }, // My credits / refer & earn

      // Staff
      { path: 'desk', element: <Desk /> },
      { path: 'hk', element: <HK /> },
      { path: 'maint', element: <Maint /> },

      // Owner
      { path: 'owner', element: <Owner /> },
      { path: 'owner/dashboard', element: <OwnerDashboard /> },
      { path: 'owner/settings', element: <OwnerSettings /> },
      { path: 'owner/services', element: <OwnerServices /> },
      { path: 'owner/reviews', element: <OwnerReviews /> },
      { path: 'grid/devices', element: <GridDevices /> },
      { path: 'grid/playbooks', element: <GridPlaybooks /> },
      { path: 'grid/events',   element: <GridEvents /> },
      { path: 'owner', element: <OwnerHome /> },  // replace the old <Owner />

      // in web/src/main.tsx router config
      { path: 'stay/:code/menu', element: <Menu /> },               // alias for /menu
      { path: 'owner/dashboard/:slug', element: <OwnerDashboard /> } // renders same dashboard

    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // helps avoid noisy refetches on visibility changes
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    {/* remove GlobalErrorBoundary below if you don’t add the tiny file */}
    <GlobalErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </GlobalErrorBoundary>
  </StrictMode>
);
