// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Theme + global styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

// Public / guest screens
import App from './App';
import Demo from './routes/Demo';
import Hotel from './routes/Hotel';
import Menu from './routes/Menu';
import RequestTracker from './routes/RequestTracker';
import Bill from './routes/Bill';
import Precheck from './routes/Precheck';
import Regcard from './routes/Regcard';
import Checkout from './routes/Checkout';

// Ops screens
import Desk from './routes/Desk';
import HK from './routes/HK';
import Kitchen from './routes/Kitchen';
import Maint from './routes/Maint';

// Owner screens
import Owner from './routes/Owner';                 // if your file is OwnerSettings.tsx, change this import
import OwnerReviews from './routes/OwnerReviews';
import OwnerDashboard from './routes/OwnerDashboard';

// Light guard for owner routes
import OwnerGate from './components/OwnerGate';

const router = createBrowserRouter([
  // Website / landing
  { path: '/', element: <App /> },
  { path: '/demo', element: <Demo /> },

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
