import { useEffect, useState } from "react";
const API = import.meta.env.VITE_API_URL as string;

type Ticket = {
  id: string; service_key: string; room: string | null; status: string;
  created_at: string; closed_at: string | null; minutes_to_close: number | null; on_time: boolean | null;
};
type Order = {
  id: string; item_key: string; qty: number; price: number; status: string;
  created_at: string; closed_at: string | null;
};

export default function AdminOps() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await fetch(`${API}/ops-list?slug=TENANT1`);
    const data = await r.json();
    setTickets(data.tickets ?? []);
    setOrders(data.orders ?? []);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function closeTicket(id: string) {
    const r = await fetch(`${API}/ops-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "closeTicket", id }),
    });
    if (!r.ok) alert(await r.text());
    else await refresh();
  }

  async function setOrderStatus(id: string, status: string) {
    const r = await fetch(`${API}/ops-update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setOrderStatus", id, status }),
    });
    if (!r.ok) alert(await r.text());
    else await refresh();
  }

  return (
    <div style={{padding:16}}>
      <h2>Ops Admin {loading ? "(loading…)" : ""}</h2>

      <h3>Tickets</h3>
      <table border={1} cellPadding={6}>
        <thead>
          <tr><th>When</th><th>Room</th><th>Service</th><th>Status</th><th>Minutes</th><th>On-time</th><th>Action</th></tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.id}>
              <td>{new Date(t.created_at).toLocaleString()}</td>
              <td>{t.room ?? "-"}</td>
              <td>{t.service_key}</td>
              <td>{t.status}</td>
              <td>{t.minutes_to_close ?? "-"}</td>
              <td>{t.on_time === null ? "-" : t.on_time ? "✅" : "⚠️"}</td>
              <td>
                {t.status !== "closed" && (
                  <button onClick={() => closeTicket(t.id)}>Close</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{marginTop:24}}>Orders</h3>
      <table border={1} cellPadding={6}>
        <thead>
          <tr><th>When</th><th>Item</th><th>Qty</th><th>Price</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id}>
              <td>{new Date(o.created_at).toLocaleString()}</td>
              <td>{o.item_key}</td>
              <td>{o.qty}</td>
              <td>{o.price}</td>
              <td>{o.status}</td>
              <td>
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
        </tbody>
      </table>

      <div style={{marginTop:16}}>
        <button onClick={refresh}>Refresh</button>
      </div>
    </div>
  );
}
