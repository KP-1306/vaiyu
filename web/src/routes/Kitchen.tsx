import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";

type Order = {
  id: string;
  item_key: string;
  qty: number;
  status: "Placed" | "InProgress" | "Out" | "Delivered";
  created_at: string;
};

export default function Kitchen() {
  const [items, setItems] = useState<Order[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch(`${API_URL}/orders`);
      const j = await r.json();
      setItems((j.items || []) as Order[]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    }
  }

  async function update(id: string, status: Order["status"]) {
    try {
      await fetch(`${API_URL}/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      load();
    } catch {}
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, []);

  function nextButtons(o: Order) {
    if (o.status === "Placed")
      return (
        <button
          onClick={() => update(o.id, "InProgress")}
          className="px-2 py-1 rounded bg-sky-600 text-white"
        >
          Start
        </button>
      );
    if (o.status === "InProgress")
      return (
        <button
          onClick={() => update(o.id, "Out")}
          className="px-2 py-1 rounded bg-amber-600 text-white"
        >
          Out
        </button>
      );
    if (o.status === "Out")
      return (
        <button
          onClick={() => update(o.id, "Delivered")}
          className="px-2 py-1 rounded bg-emerald-600 text-white"
        >
          Delivered
        </button>
      );
    return <span className="text-emerald-700 font-medium">Delivered</span>;
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Kitchen Orders</h1>
      {err && <div className="text-red-600 mb-2">{err}</div>}
      <ul className="space-y-3">
        {items.map((o) => (
          <li
            key={o.id}
            className="p-3 bg-white rounded shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">
                {o.item_key.replaceAll("_", " ")} × {o.qty}
              </div>
              <div className="text-xs text-gray-500">#{o.id} • {o.status}</div>
            </div>
            {nextButtons(o)}
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-gray-500">No active orders.</li>
        )}
      </ul>
    </main>
  );
}
