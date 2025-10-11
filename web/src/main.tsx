// web/src/main.tsx
import { StrictMode } from 'react';
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
import SiteFooter from './components/SiteFooter';

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
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.15,
});


/* ======== Root layout that adds global helpers + footer ======== */
function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      <ScrollToTop />
      <BackHome />
      <div className="flex-1">
        <Outlet />
      </div>
      <SiteFooter />
    </div>
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

      // Back-compat demo routes
      { path: 'menu', element: <Menu /> },
      { path: 'bill', element: <Bill /> },
      { path: 'regcard', element: <Regcard /> },
      { path: 'requestTracker', element: <RequestTracker /> },

      // Param routes used by dashboard/links
      { path: 'stay/:code/menu', element: <Menu /> },
      { path: 'stay/:code/bill', element: <Bill /> },
      { path: 'regcard/:code', element: <Regcard /> },
      { path: 'tracker/:code', element: <RequestTracker /> },

      { path: 'precheck/:code', element: <Precheck /> },
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
    ],
  },
]);

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
