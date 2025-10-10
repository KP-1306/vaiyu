import { useEffect, useState, useCallback, useMemo } from 'react';
import { listOrders, updateOrder } from '../lib/api';
import { connectEvents } from '../lib/sse';

type Order = {
  id: string;
  status: string; // 'Placed' | 'Preparing' | 'Ready' | 'Delivered'
  created_at: string;
  items?: { item_key: string; qty?: number; name?: string }[];
  room?: string;
  booking?: string;
};

export default function Kitchen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'Placed' | 'Preparing' | 'Ready' | 'Delivered'>('all');

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await listOrders();
      setOrders(((r as any)?.items || []) as Order[]);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + live updates via SSE
  useEffect(() => {
    refresh();

    const off = connectEvents({
      order_created: (e) => {
        const o = (e as any)?.order as Order;
        if (!o) return;
        setOrders((prev) => {
          // avoid duplicates
          if (prev.find((x) => x.id === o.id)) return prev;
          return [o, ...prev];
        });
      },
      order_updated: (e) => {
        const o = (e as any)?.order as Order;
        if (!o) return;
        setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...o } : x)));
      },
    });

    return () => off();
  }, [refresh]);

  async function setStatus(id: string, status: string) {
    // optimistic UI
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      await updateOrder(id, { status });
    } catch {
      // fallback reload on error
      refresh();
    }
  }

  const view = useMemo(
    () => (filter === 'all' ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Kitchen</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            title="Filter by status"
          >
            <option value="all">All</option>
            <option value="Placed">Placed</option>
            <option value="Preparing">Preparing</option>
            <option value="Ready">Ready</option>
            <option value="Delivered">Delivered</option>
          </select>
          <button className="btn btn-light" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}
      {loading && <div>Loading…</div>}
      {!view.length && !loading && <div className="card">No orders in this view.</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {view.map((o) => (
          <div key={o.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  Order #{o.id} • Room {o.room || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {new Date(o.created_at).toLocaleTimeString()}
                </div>
              </div>
              <span className="badge">{o.status}</span>
            </div>

            {!!o.items?.length && (
              <div style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th style={{ width: 100 }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((it, idx) => (
                      <tr key={idx}>
                        <td>{it.name || it.item_key}</td>
                        <td>{(it as any).qty ?? 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {o.status === 'Placed' && (
                <button className="btn btn-light" onClick={() => setStatus(o.id, 'Preparing')}>
                  Preparing
                </button>
              )}
              {o.status === 'Preparing' && (
                <button className="btn btn-light" onClick={() => setStatus(o.id, 'Ready')}>
                  Ready
                </button>
              )}
              {o.status !== 'Delivered' && (
                <button className="btn" onClick={() => setStatus(o.id, 'Delivered')}>
                  Delivered
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
