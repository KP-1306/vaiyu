// web/src/routes/AppRoutes.tsx
import { Routes, Route, Navigate } from 'react-router-dom';

// Use RELATIVE imports so CI/CD doesn't choke on "@/"
import OwnerDashboard from './OwnerDashboard';
import OwnerRooms from './OwnerRooms';
import OwnerRoomDetail from './OwnerRoomDetail';
import { OwnerADR, OwnerRevPAR } from './OwnerRevenue';
import OwnerPickup from './OwnerPickup';
import OwnerBookingsCalendar from './OwnerBookingsCalendar';
import FoodOrderTracker from './FoodOrderTracker';

// Optional: a tiny 404 component so unknown routes don’t white-screen
function NotFound() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you’re looking for doesn’t exist.</p>
    </main>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Redirect bare /owner to a safer default if needed */}
      <Route path="/owner" element={<Navigate to="/" replace />} />

      {/* Dashboard */}
      <Route path="/owner/:slug" element={<OwnerDashboard />} />

      {/* Rooms (availability + history) */}
      <Route path="/owner/:slug/rooms" element={<OwnerRooms />} />
      <Route path="/owner/:slug/rooms/:roomId" element={<OwnerRoomDetail />} />

      {/* Revenue */}
      <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
      <Route path="/owner/:slug/revenue/revpar" element={<OwnerRevPAR />} />

      {/* Bookings */}
      <Route path="/owner/:slug/bookings/pickup" element={<OwnerPickup />} />
      <Route path="/owner/:slug/bookings/calendar" element={<OwnerBookingsCalendar />} />

      {/* Food Order Tracking */}
      <Route path="/track-order/:id" element={<FoodOrderTracker />} />

      {/* Catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
