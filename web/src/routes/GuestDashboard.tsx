import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { myStays, myCredits, referralInit } from '../lib/api';

const TOKEN_KEY = 'stay:token';

type Stay = {
  code: string;
  status: 'upcoming' | 'active' | 'completed';
  hotel_slug?: string;
  hotel_name?: string;
  check_in?: string;   // ISO optional
  check_out?: string;  // ISO optional
};

type Credit = { property: string; balance: number; currency?: string; expiresAt?: string | null };

export default function GuestDashboard() {
  const n = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [err, setErr] = useState<string>('');
  const [credits, setCredits] = useState<Record<string, Credit>>({});
  const [refLinks, setRefLinks] = useState<Record<string, string>>({}); // property -> shareUrl

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      n('/claim', { replace: true });
      return;
    }

    (async () => {
      setLoading(true);
      setErr('');
      try {
        // Load stays
        const res = await myStays(token);
        const list = res.stays || [];
        setStays(list);

        // Load credits (per property)
        try {
          const c = await myCredits(token);
          const map: Record<string, Credit> = {};
          (c.items || []).forEach((it: any) => (map[it.property] = it));
          setCredits(map);
        } catch {
          // non-blocking
        }
      } catch (e: any) {
        setErr(e?.message || 'Failed to load your stays.');
        if (/unauth|forbidden|401|403/i.test(String(e))) {
          localStorage.removeItem(TOKEN_KEY);
          n('/claim', { replace: true });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [n]);

  async function onGetReferral(property?: string) {
    if (!property) return;
    try {
      const token = localStorage.getItem(TOKEN_KEY) || undefined;
      const r = await referralInit(property, token, 'guest_dashboard');
      const url = r?.shareUrl || (r?.code ? `${location.origin}/hotel/${property}?ref=${encodeURIComponent(r.code)}` : '');
      if (url) {
        setRefLinks((p) => ({ ...p, [property]: url }));
        await navigator.clipboard.writeText(url).catch(() => {});
      }
    } catch (e) {
      // silent fail into UI toast below if needed
    }
  }

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
        {stays.map((s) => {
          const property = s.hotel_slug;
          const credit = property ? credits[property] : undefined;
          const refUrl = property ? refLinks[property] : undefined;

          return (
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

              {/* Credits + Refer & earn */}
              {property && (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded border p-3 bg-gray-50">
                    <div className="text-[11px] text-gray-500">Credits (property-scoped)</div>
                    <div className="font-medium">
                      ₹{(credit?.balance ?? 0).toString()}
                      {credit?.expiresAt && (
                        <span className="text-xs text-gray-500"> · exp {formatDate(credit.expiresAt)}</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded border p-3 bg-white">
                    <div className="text-[11px] text-gray-500">Refer &amp; earn</div>
                    {!refUrl ? (
                      <button
                        className="btn btn-light mt-1"
                        onClick={() => onGetReferral(property)}
                      >
                        Get referral link
                      </button>
                    ) : (
                      <div className="text-xs mt-1">
                        <div className="break-all">{refUrl}</div>
                        <div className="mt-1 flex gap-2">
                          <button
                            className="btn btn-light"
                            onClick={() => navigator.clipboard.writeText(refUrl)}
                          >
                            Copy
                          </button>
                          <a
                            className="btn btn-light"
                            target="_blank"
                            href={`https://wa.me/?text=${encodeURIComponent(refUrl)}`}
                          >
                            Share
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
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
