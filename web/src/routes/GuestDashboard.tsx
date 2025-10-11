import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { myStays } from '../lib/api';

const TOKEN_KEY = 'stay:token';

type Stay = {
  id: string;
  bookingCode: string;
  hotel_slug: string;
  guest?: { name?: string; phone?: string; email?: string };
  roomType?: string;
  room_no?: string;
  status: 'upcoming' | 'inhouse' | 'completed' | 'canceled';
  created_at: string;
};

export default function GuestDashboard() {
  const n = useNavigate();
  const [items, setItems] = useState<Stay[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { n('/claim'); return; }
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const r = await myStays(token);
        setItems((r as any)?.items || []);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load your stays');
      } finally {
        setLoading(false);
      }
    })();
  }, [n]);

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    n('/claim', { replace: true });
  }

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your stay</h1>
        <button className="btn btn-light" onClick={logout}>Sign out</button>
      </div>

      {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}
      {loading && <div>Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="card">
          No stays yet. <Link className="link" to="/claim">Claim with a booking code</Link>.
        </div>
      )}

      <div className="grid gap-3">
        {items.map((s) => (
          <div key={s.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-600">Hotel</div>
                <div className="font-semibold capitalize">{s.hotel_slug}</div>
                <div className="text-xs text-gray-500 mt-1">Booking: {s.bookingCode}</div>
                {s.room_no && <div className="text-xs text-gray-500">Room: {s.room_no}</div>}
              </div>
              <StatusBadge status={s.status} />
            </div>

            {/* CTAs by status */}
            <div className="mt-3 flex flex-wrap gap-2">
              {s.status === 'upcoming' && (
                <>
                  <Link to={`/precheck/${s.bookingCode}`} className="btn btn-light">Pre-check-in</Link>
                  <Link to={`/stay/${s.bookingCode}/menu`} className="btn">Pre-order / Menu</Link>
                </>
              )}
              {s.status === 'inhouse' && (
                <>
                  <Link to={`/stay/${s.bookingCode}/menu`} className="btn">Open menu</Link>
                  <Link to={`/stay/${s.bookingCode}/bill`} className="btn btn-light">View bill</Link>
                </>
              )}
              {s.status === 'completed' && (
                <Link to={`/hotel/${s.hotel_slug}`} className="btn btn-light">View property</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: Stay['status'] }) {
  const map: Record<Stay['status'], string> = {
    upcoming: 'bg-amber-100 text-amber-800',
    inhouse: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-gray-100 text-gray-700',
    canceled: 'bg-red-100 text-red-800',
  };
  const label = {
    upcoming: 'Upcoming',
    inhouse: 'In-house',
    completed: 'Completed',
    canceled: 'Canceled',
  }[status];
  return <span className={`px-2 py-0.5 rounded text-xs ${map[status]}`}>{label}</span>;
}
