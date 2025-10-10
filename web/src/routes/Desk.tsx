import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { listTickets, updateTicket, listOrders, updateOrder } from '../lib/api';


type Ticket = {
  id: string;
  service_key: string;
  room: string;
  status: "Requested" | "Accepted" | "InProgress" | "Done";
  created_at: string;
  sla_minutes: number;
};

type Order = {
  id: string;
  item_key: string;
  qty: number;
  status: "Placed" | "InProgress" | "Out" | "Delivered";
  created_at: string;
};

export default function Desk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [tR, oR] = await Promise.all([
        fetch(`${API_URL}/tickets`),
        fetch(`${API_URL}/orders`),
      ]);
      const tJ = await tR.json();
      const oJ = await oR.json();
      setTickets(tJ.items || []);
      setOrders(oJ.items || []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    }
  }

  async function updTicket(id: string, status: Ticket["status"]) {
    await fetch(`${API_URL}/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function updOrder(id: string, status: Order["status"]) {
    await fetch(`${API_URL}/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Front Desk</h1>
      {err && <div className="text-red-600 mb-3">{err}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Housekeeping */}
        <section className="bg-white rounded shadow p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Housekeeping</h2>
            <button onClick={load} className="text-sm underline">
              Refresh
            </button>
          </div>
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li
                key={t.id}
                className="p-2 border rounded flex items-center justify-between"
              >
                <div>
                  <div className="font-medium capitalize">
                    {t.service_key.replaceAll("_", " ")} • Room {t.room}
                  </div>
                  <div className="text-xs text-gray-500">
                    #{t.id} • SLA {t.sla_minutes}m • {t.status}
                  </div>
                </div>
                <div className="flex gap-2">
                  {t.status === "Requested" && (
                    <button
                      onClick={() => updTicket(t.id, "Accepted")}
                      className="px-2 py-1 rounded bg-amber-600 text-white"
                    >
                      Accept
                    </button>
                  )}
                  {t.status === "Accepted" && (
                    <button
                      onClick={() => updTicket(t.id, "InProgress")}
                      className="px-2 py-1 rounded bg-sky-600 text-white"
                    >
                      Start
                    </button>
                  )}
                  {t.status === "InProgress" && (
                    <button
                      onClick={() => updTicket(t.id, "Done")}
                      className="px-2 py-1 rounded bg-emerald-600 text-white"
                    >
                      Done
                    </button>
                  )}
                  {t.status === "Done" && (
                    <span className="text-emerald-700 font-medium">Done</span>
                  )}
                </div>
              </li>
            ))}
            {tickets.length === 0 && (
              <li className="text-gray-500">No open HK requests.</li>
            )}
          </ul>
        </section>

        {/* Kitchen */}
        <section className="bg-white rounded shadow p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Kitchen Orders</h2>
            <button onClick={load} className="text-sm underline">
              Refresh
            </button>
          </div>
          <ul className="space-y-2">
            {orders.map((o) => (
              <li
                key={o.id}
                className="p-2 border rounded flex items-center justify-between"
              >
                <div>
                  <div className="font-medium capitalize">
                    {o.item_key.replaceAll("_", " ")} × {o.qty}
                  </div>
                  <div className="text-xs text-gray-500">
                    #{o.id} • {o.status}
                  </div>
                </div>
                <div className="flex gap-2">
                  {o.status === "Placed" && (
                    <button
                      onClick={() => updOrder(o.id, "InProgress")}
                      className="px-2 py-1 rounded bg-sky-600 text-white"
                    >
                      Start
                    </button>
                  )}
                  {o.status === "InProgress" && (
                    <button
                      onClick={() => updOrder(o.id, "Out")}
                      className="px-2 py-1 rounded bg-amber-600 text-white"
                    >
                      Out
                    </button>
                  )}
                  {o.status === "Out" && (
                    <button
                      onClick={() => updOrder(o.id, "Delivered")}
                      className="px-2 py-1 rounded bg-emerald-600 text-white"
                    >
                      Delivered
                    </button>
                  )}
                  {o.status === "Delivered" && (
                    <span className="text-emerald-700 font-medium">
                      Delivered
                    </span>
                  )}
                </div>
              </li>
            ))}
            {orders.length === 0 && (
              <li className="text-gray-500">No active orders.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
