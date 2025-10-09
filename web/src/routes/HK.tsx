import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  status: "Requested" | "Accepted" | "InProgress" | "Done";
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline: string;
};

export default function HK() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const r = await fetch(`${API_URL}/tickets`);
      const j = await r.json();
      setItems((j.items || []) as Ticket[]);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function update(id: string, status: Ticket["status"]) {
    try {
      await fetch(`${API_URL}/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e) {
      // no-op
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000); // fast refresh
    return () => clearInterval(iv);
  }, []);

  function nextButtons(t: Ticket) {
    if (t.status === "Requested")
      return (
        <button
          onClick={() => update(t.id, "Accepted")}
          className="px-2 py-1 rounded bg-amber-600 text-white"
        >
          Accept
        </button>
      );
    if (t.status === "Accepted")
      return (
        <button
          onClick={() => update(t.id, "InProgress")}
          className="px-2 py-1 rounded bg-sky-600 text-white"
        >
          Start
        </button>
      );
    if (t.status === "InProgress")
      return (
        <button
          onClick={() => update(t.id, "Done")}
          className="px-2 py-1 rounded bg-emerald-600 text-white"
        >
          Done
        </button>
      );
    return <span className="text-emerald-700 font-medium">Done</span>;
  }

  function statusChip(s: Ticket["status"]) {
    const map: Record<Ticket["status"], string> = {
      Requested: "bg-gray-600",
      Accepted: "bg-amber-600",
      InProgress: "bg-sky-600",
      Done: "bg-emerald-600",
    };
    return (
      <span className={`px-2 py-0.5 text-white rounded ${map[s]}`}>{s}</span>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Housekeeping Queue</h1>
      {err && <div className="text-red-600 mb-2">{err}</div>}
      {loading && <div className="text-gray-500 mb-2">Loading…</div>}
      <ul className="space-y-3">
        {items.map((t) => (
          <li
            key={t.id}
            className="p-3 bg-white rounded shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">
                {t.service_key.replaceAll("_", " ")} • Room {t.room}
              </div>
              <div className="text-xs text-gray-500">#{t.id}</div>
            </div>
            <div className="flex items-center gap-3">
              {statusChip(t.status)}
              {nextButtons(t)}
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-gray-500">No open requests.</li>
        )}
      </ul>
    </main>
  );
}
