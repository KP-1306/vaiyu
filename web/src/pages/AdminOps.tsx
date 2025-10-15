import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL as string;

type TicketLegacy = {
  id: string;
  service_key: string;
  room: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
  minutes_to_close: number | null;
  on_time: boolean | null;
};

// New shape from ops-list "items"
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
  id: string;
  item_key: string;
  qty: number;
  price: number;
  status: string;
  created_at: string;
  closed_at: string | null;
};

export default function AdminOps() {
  const [slug, setSlug] = useState("TENANT1"); // hotel slug for ops-list
  const [linkCode, setLinkCode] = useState("DEMO"); // code used in /stay/<code>/requests/<id>
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/ops-list?slug=${encodeURIComponent(slug)}`);
      const data = await r.json();

      // Prefer the new "items" array; fall back to legacy "tickets"
      let nextRows: Row[] = [];
      if (Array.isArray(data.items)) {
        nextRows = data.items as Row[];
      } else if (Array.isArray(data.tickets)) {
        nextRows = (data.tickets as TicketLegacy[]).map((t) => ({
          id: t.id,
          service_key: t.service_key,
          label: t.service_key, // no label in legacy, use key
          room: t.room,
          status: t.status as Row["status"],
          created_at: t.created_at,
          minutes_to_close: t.minutes_to_close,
          on_time: t.on_time,
          sla_minutes: null,
        }));
      }
      setRows(nextRows);
      setOrders(data.orders ?? []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function closeTicket(id: string) {
    try {
      // First try the new action name
      let r = await fetch(`${API}/ops-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", id }),
      });

      // If backend hasn't been updated yet, retry with the legacy action
      if (!r.ok) {
        r = await fetch(`${API}/ops-update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "closeTicket", id }),
        });
      }
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || "Failed to close ticket");
      }
      await refresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function setOrderStatus(id: string, status: string) {
    try {
      const r = await fetch(`${API}/ops-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setOrderStatus", id, status }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || "Failed to set order status");
      }
      await refresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>
        Ops Admin {loading ? "(loading…)" : ""} {error ? `— ${error}` : ""}
      </h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
        <label>
          Hotel slug:{" "}
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={{ padding: 4 }}
          />
        </label>
        <label>
          Deep-link code:{" "}
          <input
            value={linkCode}
            onChange={(e) => setLinkCode(e.target.value)}
            style={{ padding: 4 }}
          />
        </label>
        <button onClick={refresh}>Refresh</button>
      </div>

      <h3>Tickets</h3>
      <table border={1} cellPadding={6} width="100%">
        <thead>
          <tr>
            <th>When</th>
            <th>Room</th>
            <th>Service</th>
            <th>SLA (min)</th>
            <th>Status</th>
            <th>Minutes</th>
            <th>On-time</th>
            <th>Action</th>
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
              <td style={{ textAlign: "center" }}>
                {t.on_time === null ? "-" : t.on_time ? "✅" : "⚠️"}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {t.status !== "closed" ? (
                  <button onClick={() => closeTicket(t.id)}>Close</button>
                ) : (
                  <a
                    href={`/stay/${encodeURIComponent(linkCode)}/requests/${t.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", color: "#666" }}>
                No tickets
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Orders</h3>
      <table border={1} cellPadding={6} width="100%">
        <thead>
          <tr>
            <th>When</th>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Status</th>
            <th>Action</th>
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
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#666" }}>
                No orders
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 16 }}>
        <button onClick={refresh}>Refresh</button>
      </div>
    </div>
  );
}
