import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ✅ add global theme + styles
import { ThemeProvider } from './components/ThemeProvider'
import './theme.css'

// keep your existing styles & screens
import './index.css'
import App from './App'
import Hotel from './routes/Hotel'
import Menu from './routes/Menu'
import RequestTracker from './routes/RequestTracker'
import Bill from './routes/Bill'
import Precheck from './routes/Precheck'
import Regcard from './routes/Regcard'
import Checkout from './routes/Checkout'
import Desk from './routes/Desk'
import HK from './routes/HK'
import Kitchen from './routes/Kitchen'
import Maint from './routes/Maint'

const router = createBrowserRouter([
  { path: '/', element: <App/> },
  { path: '/hotel/:slug', element: <Hotel/> },           // unchanged
  { path: '/stay/:code/menu', element: <Menu/> },
  { path: '/stay/:code/requests/:id', element: <RequestTracker/> },
  { path: '/stay/:code/bill', element: <Bill/> },
  { path: '/precheck/:code', element: <Precheck/> },
  { path: '/regcard/:code', element: <Regcard/> },
  { path: '/checkout/:code', element: <Checkout/> },
  { path: '/desk', element: <Desk/> },
  { path: '/hk', element: <HK/> },
  { path: '/kitchen', element: <Kitchen/> },
  { path: '/maint', element: <Maint/> },
])

const qc = new QueryClient()

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
