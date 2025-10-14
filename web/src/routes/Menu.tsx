// web/src/routes/Menu.tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getServices,
  getMenu,
  createTicket,
  createOrder,
  isDemo,
} from '../lib/api';

type Service = { key: string; label_en: string; sla_minutes: number };
type FoodItem = { item_key: string; name: string; base_price: number };

export default function Menu() {
  // booking code from route: /stay/:code/menu  (fallback to DEMO)
  const { code = 'DEMO' } = useParams();

  const [tab, setTab] = useState<'food' | 'services'>('services');
  const [services, setServices] = useState<Service[]>([]);
  const [food, setFood] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Room picker + tiny toast
  const roomKey = useMemo(() => `room:${code}`, [code]);
  const [room, setRoom] = useState<string>(() => localStorage.getItem(roomKey) || '201');
  const [toast, setToast] = useState<string>('');
  const [busy, setBusy] = useState<string>(''); // keeps the id of item being actioned

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const [svc, menu] = await Promise.all([getServices(), getMenu()]);
        if (!mounted) return;
        setServices((svc as any)?.items || []);
        setFood((menu as any)?.items || []);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || 'Failed to load menu');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(roomKey, room);
  }, [room, roomKey]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 1500);
  }

  // ---- Helpers that accept multiple API response shapes ----
  function extractTicketId(res: any): string | undefined {
    return (
      res?.ticket?.id ??
      res?.id ??
      res?.data?.id ??
      res?.ticket_id ??
      undefined
    );
  }

  async function requestService(service_key: string) {
    setBusy(`svc:${service_key}`);
    try {
      // Send both keys for compatibility (backend/demo may expect either)
      const payload: any = {
        service_key,
        service: service_key,
        room,
        booking: code,
        source: 'guest_menu',
        tenant: 'guest',
      };

      const res: any = await createTicket(payload);
      const id = extractTicketId(res);

      if (id) {
        // deep-link to tracker if you have that route
        window.location.href = `/stay/${encodeURIComponent(code!)}/requests/${id}`;
        return;
      }

      // If no ID but OK flag, just confirm
      if (res?.ok) {
        showToast('Request placed');
        return;
      }

      throw new Error('Could not create request');
    } catch (e: any) {
      alert(e?.message || 'Could not create request');
    } finally {
      setBusy('');
    }
  }

  async function addFood(item_key: string) {
    setBusy(`food:${item_key}`);
    try {
      const res: any = await createOrder({ item_key, qty: 1, booking: code, source: 'guest_menu' });
      if (res?.ok !== false) showToast('Added to order');
      else throw new Error('Could not add item');
    } catch (e: any) {
      alert(e?.message || 'Could not add item');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      {/* Heading + context */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Guest menu</h1>
          {isDemo() && (
            <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
              Demo data
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">Booking: <b>{code}</b></div>
      </div>

      {/* Tabs + Room selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('services')}
            className={`px-3 py-2 rounded ${
              tab === 'services' ? 'bg-sky-500 text-white' : 'bg-white shadow'
            }`}
          >
            Services
          </button>
          <button
            onClick={() => setTab('food')}
            className={`px-3 py-2 rounded ${
              tab === 'food' ? 'bg-sky-500 text-white' : 'bg-white shadow'
            }`}
          >
            Food
          </button>
        </div>

        <label className="text-sm text-gray-600">
          Room:{' '}
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {['201', '202', '203', '204', '205'].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Loading / error / empty states */}
      {loading && <div className="text-gray-500">Loading…</div>}
      {err && !loading && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 mb-3">
          {err}
        </div>
      )}

      {!loading && !err && tab === 'services' && (
        services.length ? (
          <ul className="space-y-3">
            {services.map((it) => (
              <li
                key={it.key}
                className="p-3 bg-white rounded shadow flex justify-between items-center"
              >
                <div>
                  <div className="font-medium">{it.label_en}</div>
                  <div className="text-xs text-gray-500">{it.sla_minutes} min SLA</div>
                </div>
                <button
                  onClick={() => requestService(it.key)}
                  disabled={busy === `svc:${it.key}`}
                  className={`px-3 py-2 rounded text-white ${
                    busy === `svc:${it.key}` ? 'bg-sky-300' : 'bg-sky-600 hover:bg-sky-700'
                  }`}
                >
                  {busy === `svc:${it.key}` ? 'Requesting…' : 'Request'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-500">No services available right now.</div>
        )
      )}

      {!loading && !err && tab === 'food' && (
        food.length ? (
          <ul className="space-y-3">
            {food.map((it) => (
              <li
                key={it.item_key}
                className="p-3 bg-white rounded shadow flex justify-between items-center"
              >
                <div>
                  <div className="font-medium">{it.name}</div>
                  <div className="text-xs text-gray-500">₹{it.base_price}</div>
                </div>
                <button
                  onClick={() => addFood(it.item_key)}
                  disabled={busy === `food:${it.item_key}`}
                  className={`px-3 py-2 rounded text-white ${
                    busy === `food:${it.item_key}` ? 'bg-sky-300' : 'bg-sky-600 hover:bg-sky-700'
                  }`}
                >
                  {busy === `food:${it.item_key}` ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-500">Food menu is unavailable at the moment.</div>
        )
      )}

      {/* Tiny toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 py-1 rounded">
          {toast}
        </div>
      )}
    </main>
  );
}
