// web/src/pages/AdminOps.tsx
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL as string;

type Row = {
  id: string;
  service_key: string;
  label: string;
  room: string | null;
  status: "open" | "closed" | string;
  created_at: string;
  minutes_to_close: number | null;
  on_time: boolean | null;
  sla_minutes: number | null;
};
type Order = {
  id: string; item_key: string; qty: number; price: number; status: string;
  created_at: string; closed_at: string | null; room?: string | null; booking_code?: string | null;
};

export default function AdminOps() {
  const [slug, setSlug] = useState("TENANT1");
  const [linkCode, setLinkCode] = useState("DEMO");

  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [itemsCursor, setItemsCursor] = useState<string | null>(null);
  const [ordersCursor, setOrdersCursor] = useState<string | null>(null);
  const [hasMoreItems, setHasMoreItems] = useState(false);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fetchPage({ cursor, ordersCursor: oc, append = false }: { cursor?: string | null; ordersCursor?: string | null; append?: boolean }) {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        slug,
        limit: "50",
        include_orders: "1",
        orders_limit: "50",
      });
      if (cursor) qs.set("cursor", cursor);
      if (oc) qs.set("orders_cursor", oc);

      const r = await fetch(`${API}/ops-list?` + qs.toString());
      const data = await r.json();

      if (!r.ok || !data?.ok) throw new Error(data?.error || "Failed to load");

      setHasMoreItems(!!data.items_next_cursor);
      setHasMoreOrders(!!data.orders_next_cursor);
      setItemsCursor(data.items_next_cursor || null);
      setOrdersCursor(data.orders_next_cursor || null);

      if (append) {
        setRows((prev) => [...prev, ...(data.items || [])]);
        setOrders((prev) => [...prev, ...(data.orders || [])]);
      } else {
        setRows(data.items || []);
        setOrders(data.orders || []);
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // reset cursors when slug changes
    setItemsCursor(null);
    setOrdersCursor(null);
    fetchPage({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function closeTicket(id: string) {
    const r = await fetch(`${API}/ops-update`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", id }),
    });
    if (!r.ok) alert(await r.text());
    await fetchPage({ append: false }); // refresh first page
  }

  async function setOrderStatus(id: string, status: string) {
    const r = await fetch(`${API}/ops-update`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setOrderStatus", id, status }),
    });
    if (!r.ok) alert(await r.text());
    await fetchPage({ append: false });
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Ops Admin {loading ? "(loading…)" : ""} {err ? `— ${err}` : ""}</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label>
          Hotel slug:{" "}
          <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ padding: 4 }} />
        </label>
        <label>
          Deep-link code:{" "}
          <input value={linkCode} onChange={(e) => setLinkCode(e.target.value)} style={{ padding: 4 }} />
        </label>
        <button onClick={() => fetchPage({ append: false })}>Refresh</button>
      </div>

      <h3>Tickets</h3>
      <table border={1} cellPadding={6} width="100%">
        <thead>
          <tr>
            <th>When</th><th>Room</th><th>Service</th><th>SLA (min)</th>
            <th>Status</th><th>Minutes</th><th>On-time</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td>{t.room ?? "-"}</td>
              <td title={t.service_key}>{t.label ?? t.service_key}</td>
              <td style={{ textAlign: "center" }}>{t.sla_minutes ?? "-"}</td>
              <td style={{ textAlign: "center" }}>{t.status}</td>
              <td style={{ textAlign: "center" }}>{t.minutes_to_close ?? "-"}</td>
              <td style={{ textAlign: "center" }}>{t.on_time === null ? "-" : t.on_time ? "✅" : "⚠️"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {t.status !== "closed" ? (
                  <button onClick={() => closeTicket(t.id)}>Close</button>
                ) : (
                  <a href={`/stay/${encodeURIComponent(linkCode)}/requests/${t.id}`} target="_blank" rel="noreferrer">View</a>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} style={{ textAlign: "center", color: "#666" }}>No tickets</td></tr>
          )}
        </tbody>
      </table>
      {hasMoreItems && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => fetchPage({ cursor: itemsCursor, ordersCursor, append: true })}>Load more tickets</button>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Orders</h3>
      <table border={1} cellPadding={6} width="100%">
        <thead>
          <tr>
            <th>When</th><th>Item</th><th>Qty</th><th>Price</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.created_at).toLocaleString()}</td>
              <td>{o.item_key}</td>
              <td>{o.qty}</td>
              <td>{o.price}</td>
              <td>{o.status}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {o.status !== "delivered" && (
                  <>
                    <button onClick={() => setOrderStatus(o.id, "preparing")}>Preparing</button>{" "}
                    <button onClick={() => setOrderStatus(o.id, "delivered")}>Delivered</button>{" "}
                    <button onClick={() => setOrderStatus(o.id, "cancelled")}>Cancel</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "#666" }}>No orders</td></tr>
          )}
        </tbody>
      </table>
      {hasMoreOrders && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => fetchPage({ cursor: itemsCursor, ordersCursor, append: true })}>Load more orders</button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={() => fetchPage({ append: false })}>Refresh</button>
      </div>
    </div>
  );
}
