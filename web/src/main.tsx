import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Global theme + styles
import { ThemeProvider } from './components/ThemeProvider';
import './theme.css';
import './index.css';

// Screens
import App from './App';
import Hotel from './routes/Hotel';
import Menu from './routes/Menu';
import RequestTracker from './routes/RequestTracker';
import Bill from './routes/Bill';
import Precheck from './routes/Precheck';
import Regcard from './routes/Regcard';
import Checkout from './routes/Checkout';
import Desk from './routes/Desk';
import HK from './routes/HK';
import Kitchen from './routes/Kitchen';
import Maint from './routes/Maint';

// Owner settings page (you created this)
import Owner from './routes/Owner'; // if you only have OwnerSettings.tsx, change to: './routes/OwnerSettings'

const router = createBrowserRouter([
  { path: '/', element: <App /> },

  // Owner configuration UI
  { path: '/owner', element: <Owner /> },

  // Guest / Ops routes
  { path: '/hotel/:slug', element: <Hotel /> },
  { path: '/stay/:code/menu', element: <Menu /> },
  { path: '/stay/:code/requests/:id', element: <RequestTracker /> },
  { path: '/stay/:code/bill', element: <Bill /> },
  { path: '/precheck/:code', element: <Precheck /> },
  { path: '/regcard/:code', element: <Regcard /> },
  { path: '/checkout/:code', element: <Checkout /> },
  { path: '/desk', element: <Desk /> },
  { path: '/hk', element: <HK /> },
  { path: '/kitchen', element: <Kitchen /> },
  { path: '/maint', element: <Maint /> },
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
