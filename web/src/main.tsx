// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Theme + global styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

/* ======== Public / Website ======== */
import App from './App';                 // Landing page
import Demo from './routes/Demo';
import AboutUs from './routes/AboutUs';
import AboutAI from './routes/AboutAI';  // HOW IT WORKS (AI) PAGE
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
import ClaimStay from './routes/ClaimStay';
import GuestDashboard from './routes/GuestDashboard';   // ← we’ll mount this at /guest

/* ======== Ops / Owner ======== */
import OwnerDashboard from './routes/OwnerDashboard';
import OwnerSettings from './routes/OwnerSettings';
import OwnerServices from './routes/OwnerServices';
import OwnerReviews from './routes/OwnerReviews';
import HK from './routes/HK';
import Desk from './routes/Desk';
import Kitchen from './routes/Kitchen';
import Maint from './routes/Maint';
import Orders from './routes/Orders';

const queryClient = new QueryClient();

/**
 * NOTE:
 * - The only NEW thing vs your previous router is the { path: "/guest", element: <GuestDashboard /> } entry.
 * - Everything else mirrors your existing route layout so nothing breaks.
 */
const router = createBrowserRouter([
  /* ------- Public / Marketing ------- */
  { path: '/', element: <App /> },
  { path: '/demo', element: <Demo /> },
  { path: '/about', element: <AboutUs /> },
  { path: '/about-ai', element: <AboutAI /> },
  { path: '/press', element: <Press /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
  { path: '/contact', element: <Contact /> },
  { path: '/careers', element: <Careers /> },

  /* ------- Guest / Journey ------- */
  { path: '/hotel/:slug', element: <Hotel /> },

  // Menu / Requests (keep both forms if you already link to them)
  { path: '/menu', element: <Menu /> },
  { path: '/stay/:code/menu', element: <Menu /> },

  { path: '/request-tracker', element: <RequestTracker /> },
  { path: '/bill', element: <Bill /> },
  { path: '/precheck/:code', element: <Precheck /> },
  { path: '/regcard', element: <Regcard /> },
  { path: '/checkout', element: <Checkout /> },
  { path: '/checkout/:code', element: <Checkout /> },

  // Claim / attach booking
  { path: '/claim', element: <ClaimStay /> },
  { path: '/claimstay', element: <ClaimStay /> },

  // NEW: Guest dashboard (credits & stays)
  { path: '/guest', element: <GuestDashboard /> },

  /* ------- Owner / Ops ------- */
  { path: '/owner', element: <OwnerDashboard /> },
  { path: '/owner/settings', element: <OwnerSettings /> },
  { path: '/owner/services', element: <OwnerServices /> },
  { path: '/owner/reviews', element: <OwnerReviews /> },

  { path: '/hk', element: <HK /> },
  { path: '/desk', element: <Desk /> },
  { path: '/kitchen', element: <Kitchen /> },
  { path: '/maint', element: <Maint /> },
  { path: '/orders', element: <Orders /> },

  /* ------- Fallback (optional) ------- */
  // { path: '*', element: <App /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
