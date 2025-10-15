// web/src/pages/AdminOps.tsx
import { useEffect, useState } from "react";

const API   = import.meta.env.VITE_API_URL as string;          // e.g. https://<ref>.supabase.co/functions/v1
const ADMIN = import.meta.env.VITE_ADMIN_TOKEN as string | undefined; // set in Netlify env

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

function withAuth(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(ADMIN ? { "x-admin": ADMIN } : {}), // lightweight guard
    },
  };
}

export default function AdminOps() {
  const [slug, setSlug] = useState("TENANT1");   // hotel slug for ops-list
  const [linkCode, setLinkCode] = useState("DEMO"); // used in /stay/<code>/requests/<id>
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/ops-list?slug=${encodeURIComponent(slug)}`, withAuth());
      const data = await r.json();

      // Prefer the new "items" array; fall back to legacy "tickets"
      let nextRows: Row[] = [];
      if (Array.isArray(data.items)) {
        nextRows = data.items as Row[];
      } else if (Array.isArray(data.tickets)) {
        nextRows = (data.tickets as TicketLegacy[]).map((t) => ({
          id: t.id,
          service_key: t.service_key,
          label: t.service_key, // legacy: no label -> use key
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
      // Try new action first
      let r = await fetch(`${API}/ops-update`, withAuth({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", id }),
      }));

      // If backend hasn’t been updated yet, retry legacy action
      if (!r.ok) {
        r = await fetch(`${API}/ops-update`, withAuth({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "closeTicket", id }),
        }));
      }

      if (!r.ok) throw new Error(await r.text());
      await refresh();
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function setOrderStatus(id: string, status: string) {
    try {
      const r = await fetch(`${API}/ops-update`, withAuth({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setOrderStatus", id, status }),
      }));
      if (!r.ok) throw new Error(await r.text());
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
          <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ padding: 4 }} />
        </label>
        <label>
          Deep-link code:{" "}
          <input value={linkCode} onChange={(e) => setLinkCode(e.target.value)} style={{ padding: 4 }} />
        </label>
        <button onClick={refresh} disabled={loading}>Refresh</button>
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
                  <button onClick={() => closeTicket(t.id)} disabled={loading}>Close</button>
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
                    <button onClick={() => setOrderStatus(o.id, "preparing")} disabled={loading}>Preparing</button>{" "}
                    <button onClick={() => setOrderStatus(o.id, "delivered")} disabled={loading}>Delivered</button>{" "}
                    <button onClick={() => setOrderStatus(o.id, "cancelled")} disabled={loading}>Cancel</button>
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
        <button onClick={refresh} disabled={loading}>Refresh</button>
      </div>
    </div>
  );
}
