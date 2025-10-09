import { useEffect, useState } from "react";
import { api, API_URL } from "../lib/api";

export default function Menu() {
  const [tab, setTab] = useState<"food" | "services">("services");
  const [services, setServices] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);

  useEffect(() => {
    api.services("TENANT1").then((r: any) => setServices(r.items || []));
    api.menu("TENANT1").then((r: any) => setMenu(r.items || []));
  }, []);

  // Create a service ticket and navigate to the tracker
  async function requestService(service_key: string) {
    try {
      const payload = {
        service_key,
        room: "201", // TODO: make selectable later
        booking: "DEMO",
        tenant: "guest",
      };

      const res = await fetch(`${API_URL}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        alert(`Could not create request (${res.status}). ${txt}`);
        return;
      }

      const data = await res.json();
      const id = data?.ticket?.id;
      if (!id) {
        alert("No ticket id returned from server.");
        return;
      }

      // go to the live tracker page
      window.location.href = `/stay/DEMO/requests/${id}`;
    } catch (e: any) {
      alert(`Network error: ${e?.message || e}`);
    }
  }

  // (unchanged) create a food order
  async function addFood(item_key: string) {
    try {
      await api.createOrder({ item_key, qty: 1, booking: "DEMO" });
      // optional: alert("Added to order");
    } catch (e: any) {
      alert(`Could not add item: ${e?.message || e}`);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("services")}
          className={`px-3 py-2 rounded ${
            tab === "services" ? "bg-sky-500 text-white" : "bg-white shadow"
          }`}
        >
          Services
        </button>
        <button
          onClick={() => setTab("food")}
          className={`px-3 py-2 rounded ${
            tab === "food" ? "bg-sky-500 text-white" : "bg-white shadow"
          }`}
        >
          Food
        </button>
      </div>

      {tab === "services" && (
        <ul className="space-y-3">
          {services.map((it: any) => (
            <li
              key={it.key}
              className="p-3 bg-white rounded shadow flex justify-between items-center"
            >
              <div>
                <div className="font-medium">{it.label_en}</div>
                <div className="text-xs text-gray-500">{it.sla_minutes} min SLA</div>
              </div>
              <button
                onClick={() => requestService(it.key)}
                className="px-3 py-2 bg-sky-600 text-white rounded"
              >
                Request
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "food" && (
        <ul className="space-y-3">
          {menu.map((it: any) => (
            <li
              key={it.item_key}
              className="p-3 bg-white rounded shadow flex justify-between items-center"
            >
              <div>
                <div className="font-medium">{it.name}</div>
                <div className="text-xs text-gray-500">₹{it.base_price}</div>
              </div>
              <button
                onClick={() => addFood(it.item_key)}
                className="px-3 py-2 bg-sky-600 text-white rounded"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
