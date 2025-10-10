import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { listOrders, updateOrder } from '../lib/api';


type Order = {
  id: string;
  item_key: string;
  qty: number;
  status: "Placed" | "InProgress" | "Out" | "Delivered";
  created_at: string;
};

export default function Kitchen() {
  const [items, setItems] = useState<Order[]>([]);
  const [status, setStatus] = useState<"all" | Order["status"]>("all");

  async function load() {
    const r = await fetch(`${API_URL}/orders`);
    const j = await r.json();
    setItems(j.items || []);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(
    () => (status === "all" ? items : items.filter((o) => o.status === status)),
    [items, status]
  );

  function badge(s: Order["status"]) {
    const map: Record<Order["status"], string> = {
      Placed: "bg-gray-100 text-gray-800",
      InProgress: "bg-sky-100 text-sky-800",
      Out: "bg-amber-100 text-amber-800",
      Delivered: "bg-emerald-100 text-emerald-800",
    };
    return <span className={`px-2 py-0.5 rounded text-xs ${map[s]}`}>{s}</span>;
  }

  async function update(id: string, next: Order["status"]) {
    await fetch(`${API_URL}/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    load();
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Kitchen</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          className="border rounded px-2 py-1 text-sm"
          title="Filter by status"
        >
          <option value="all">All</option>
          <option value="Placed">Placed</option>
          <option value="InProgress">In progress</option>
          <option value="Out">Out</option>
          <option value="Delivered">Delivered</option>
        </select>
      </div>

      <ul className="space-y-3">
        {filtered.map((o) => (
          <li
            key={o.id}
            className="p-3 bg-white rounded shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">
                {o.item_key.replaceAll("_", " ")} × {o.qty}
              </div>
              <div className="text-xs text-gray-500">#{o.id}</div>
            </div>
            <div className="flex items-center gap-2">
              {badge(o.status)}
              {o.status === "Placed" && (
                <button
                  onClick={() => update(o.id, "InProgress")}
                  className="px-2 py-1 rounded bg-sky-600 text-white text-sm"
                >
                  Start
                </button>
              )}
              {o.status === "InProgress" && (
                <button
                  onClick={() => update(o.id, "Out")}
                  className="px-2 py-1 rounded bg-amber-600 text-white text-sm"
                >
                  Out
                </button>
              )}
              {o.status === "Out" && (
                <button
                  onClick={() => update(o.id, "Delivered")}
                  className="px-2 py-1 rounded bg-emerald-600 text-white text-sm"
                >
                  Delivered
                </button>
              )}
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-gray-500">No orders in this view.</li>
        )}
      </ul>
    </main>
  );
}
