import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { listOrders, createOrder, updateOrder } from '../lib/api';


type Order = {
  id: string;
  item_key: string;
  qty: number;
  status: "Placed" | "InProgress" | "Out" | "Delivered";
  created_at: string;
  room?: string;
  booking?: string;
};

export default function Orders() {
  const [items, setItems] = useState<Order[]>([]);
  const booking = "DEMO"; // later: read from URL/code

  async function load() {
    const r = await fetch(`${API_URL}/orders`);
    const j = await r.json();
    const all: Order[] = j.items || [];
    // show only this booking's orders
    setItems(all.filter((o) => (o.booking || "DEMO") === booking));
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, []);

  return (
    <main className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">My Orders</h1>
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
              <div className="text-xs text-gray-500">
                #{o.id} • {o.status}
              </div>
            </div>
            <span className="text-sm">
              {o.status === "Delivered" ? "✅" : "⏳"}
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-gray-500">You have no active orders.</li>
        )}
      </ul>

      <div className="mt-4 text-sm">
        <a href="/stay/DEMO/menu" className="underline">
          ← Back to menu
        </a>
      </div>
    </main>
  );
}
