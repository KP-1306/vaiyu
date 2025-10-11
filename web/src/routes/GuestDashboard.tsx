// web/src/routes/GuestDashboard.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { myStays } from '../lib/api';

const TOKEN_KEY = 'stay:token';

type Stay = {
  code: string;
  status: 'upcoming' | 'active' | 'completed';
  hotel_slug?: string;
  hotel_name?: string;
  check_in?: string;   // ISO optional
  check_out?: string;  // ISO optional
};

export default function GuestDashboard() {
  const n = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      // no session: go to claim flow
      n('/claim', { replace: true });
      return;
    }

    (async () => {
      setLoading(true);
      setErr('');
      try {
        const res = await myStays(token);
        setStays(res.stays || []);
      } catch (e: any) {
        setErr(e?.message || 'Failed to load your stays.');
        // If unauthorized, clear token and take them to claim
        if (/unauth|forbidden|401|403/i.test(String(e))) {
          localStorage.removeItem(TOKEN_KEY);
          n('/claim', { replace: true });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [n]);

  if (loading) return <div className="p-4">Loading…</div>;

  return (
    <main className="max-w-3xl mx-auto p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your stays</h1>
        <div className="flex gap-2">
          <Link to="/claim" className="btn btn-light">Claim another booking</Link>
          <button
            className="btn btn-outline"
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              n('/claim', { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-800">
          {err}
        </div>
      )}

      {!stays.length && !err && (
        <div className="card">
          <div className="font-medium">No stays yet</div>
          <div className="text-sm text-gray-600 mt-1">
            If you booked on another platform, you can link it here.
          </div>
          <div className="mt-3">
            <Link to="/claim" className="btn">Claim a booking</Link>
          </div>
        </div>
      )}

      <ul className="grid gap-3">
        {stays.map((s) => (
          <li key={s.code} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-gray-500">{s.hotel_name || s.hotel_slug || '—'}</div>
                <div className="font-semibold mt-0.5">Booking {s.code}</div>
                <div className="text-xs text-gray-500 mt-1 capitalize">{s.status}</div>
                {(s.check_in || s.check_out) && (
                  <div className="text-xs text-gray-500 mt-1">
                    {s.check_in ? `Check-in: ${formatDate(s.check_in)}` : ''}
                    {s.check_in && s.check_out ? ' · ' : ''}
                    {s.check_out ? `Check-out: ${formatDate(s.check_out)}` : ''}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Contextual CTAs */}
                {s.status !== 'completed' && (
                  <Link to={`/stay/${encodeURIComponent(s.code)}/menu`} className="btn">
                    Open guest menu
                  </Link>
                )}
                {s.status === 'upcoming' && (
                  <Link to={`/precheck/${encodeURIComponent(s.code)}`} className="btn btn-light">
                    Pre-check-in
                  </Link>
                )}
                {s.status !== 'upcoming' && (
                  <Link to={`/stay/${encodeURIComponent(s.code)}/bill`} className="btn btn-light">
                    View bill
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function formatDate(iso?: string) {
  try {
    return iso ? new Date(iso).toLocaleDateString() : '';
  } catch {
    return iso || '';
  }
}
