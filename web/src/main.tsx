// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Theme + global styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

/* ======== Public / Website ======== */
import App from './App';                  // Landing page
import Demo from './routes/Demo';
import AboutUs from './routes/AboutUs';
import AboutAI from './routes/AboutAI';   // <<— HOW IT WORKS (AI) PAGE
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
import Checkout from './routes/Checkout';

/* ======== Ops ======== */
import Desk from './routes/Desk';
import HK from './routes/HK';
import Kitchen from './routes/Kitchen';
import Maint from './routes/Maint';

/* ======== Owner ======== */
import Owner from './routes/Owner';                 // Owner settings / policies
import OwnerReviews from './routes/OwnerReviews';
import OwnerDashboard from './routes/OwnerDashboard';
import OwnerGate from './components/OwnerGate';     // light front-end guard

const router = createBrowserRouter([
  // Website / landing
  { path: '/', element: <App /> },
  { path: '/demo', element: <Demo /> },

  // Marketing / info pages
  { path: '/about', element: <AboutUs /> },
  { path: '/about-ai', element: <AboutAI /> },      // <<— NEW ROUTE
  { path: '/press', element: <Press /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
  { path: '/contact', element: <Contact /> },
  { path: '/careers', element: <Careers /> },

  // Guest
  { path: '/hotel/:slug', element: <Hotel /> },
  { path: '/stay/:code/menu', element: <Menu /> },
  { path: '/stay/:code/requests/:id', element: <RequestTracker /> },
  { path: '/stay/:code/bill', element: <Bill /> },
  { path: '/precheck/:code', element: <Precheck /> },
  { path: '/regcard/:code', element: <Regcard /> },
  { path: '/checkout/:code', element: <Checkout /> },

  // Ops
  { path: '/desk', element: <Desk /> },
  { path: '/hk', element: <HK /> },
  { path: '/kitchen', element: <Kitchen /> },
  { path: '/maint', element: <Maint /> },

  // Owner (guarded)
  { path: '/owner', element: <OwnerGate><Owner /></OwnerGate> },
  { path: '/owner/reviews', element: <OwnerGate><OwnerReviews /></OwnerGate> },
  { path: '/owner/dashboard', element: <OwnerGate><OwnerDashboard /></OwnerGate> },
  { path: '/owner/dashboard/:slug', element: <OwnerGate><OwnerDashboard /></OwnerGate> },
]);

const qc = new QueryClient();

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
