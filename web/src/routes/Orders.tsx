import { useEffect, useState } from "react";
import { listOrders } from "../lib/api";

type Order = {
  id: string;
  item_key?: string;
  items?: { item_key: string; qty?: number; name?: string }[];
  qty?: number;
  status: "Placed" | "Preparing" | "Ready" | "Delivered";
  created_at: string;
  room?: string;
  booking?: string;
};

export default function Orders() {
  const [items, setItems] = useState<Order[]>([]);
  const booking = "DEMO"; // later: read from URL/code

  async function load() {
    const r = await listOrders();
    const all: Order[] = (r as any).items || [];

    // Show only this booking's orders
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
        {items.map((o) => {
          // support either a single item_key or items[]
          const line =
            o.items && o.items.length
              ? `${o.items[0].name || o.items[0].item_key} × ${(o.items[0] as any).qty ?? 1}${
                  o.items.length > 1 ? ` +${o.items.length - 1} more` : ""
                }`
              : `${(o.item_key || "").replaceAll("_", " ")}${o.qty ? ` × ${o.qty}` : ""}`;

        return (
          <li
            key={o.id}
            className="p-3 bg-white rounded shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">{line}</div>
              <div className="text-xs text-gray-500">
                #{o.id} • {o.status}
              </div>
            </div>
            <span className="text-sm">
              {o.status === "Delivered" ? "✅" : "⏳"}
            </span>
          </li>
        )})}

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
