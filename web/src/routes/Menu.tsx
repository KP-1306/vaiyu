import { useEffect, useState } from "react";
import { api, API_URL } from "../lib/api";
import { getServices, getMenu, createTicket, createOrder } from '../lib/api';


export default function Menu() {
  const [tab, setTab] = useState<"food" | "services">("services");
  const [services, setServices] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);

  // NEW: room picker + toast
  const [room, setRoom] = useState<string>(() => localStorage.getItem("room") || "201");
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    api.services("TENANT1").then((r: any) => setServices(r.items || []));
    api.menu("TENANT1").then((r: any) => setMenu(r.items || []));
  }, []);

  useEffect(() => {
    localStorage.setItem("room", room);
  }, [room]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1500);
  }

  // Create a service ticket and navigate to the tracker
  async function requestService(service_key: string) {
    try {
      const payload = {
        service_key,
        room,               // <-- uses selected room
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

  // create a food order
  async function addFood(item_key: string) {
    try {
      await api.createOrder({ item_key, qty: 1, booking: "DEMO" });
      showToast("Added to order");
    } catch (e: any) {
      alert(`Could not add item: ${e?.message || e}`);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      {/* Tabs + Room selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
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

        <label className="text-sm text-gray-600">
          Room:{" "}
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {["201", "202", "203", "204", "205"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
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

      {/* Tiny toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 py-1 rounded">
          {toast}
        </div>
      )}
    </main>
  );
}
