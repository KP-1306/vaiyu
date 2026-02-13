// web/src/routes/BookingsCalendar.tsx
// Read-only scaffold for a future bookings calendar view.

import { Link } from "react-router-dom";


export default function BookingsCalendar() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-2">
        <Link to="/owner" className="hover:text-amber-600 transition">Dashboard</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700">Calendar</span>
      </div>

      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bookings calendar</h1>
          <p className="text-sm text-gray-600">
            Reserved space for a visual arrivals / in-house / departures calendar for this property.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/stays" className="btn btn-light">
            Open stays list
          </Link>
          <Link to="/desk" className="btn btn-light">
            Open ops board
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-4">
        <p className="text-sm text-gray-600">
          In this version, the calendar is intentionally read-only and not yet wired to live data.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          You can continue using the <span className="font-medium">Stays</span> view and{" "}
          <span className="font-medium">Ops board</span> for day-to-day planning. Once your bookings
          calendar is ready, this page can show a grid of dates and rooms with simple colour codes.
        </p>
      </section>
    </main>
  );
}
