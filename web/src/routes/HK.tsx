import { useEffect, useMemo, useState } from "react";
import { listTickets, updateTicket } from "../lib/api";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  status: "Requested" | "Accepted" | "InProgress" | "Done";
  created_at: string;
  sla_minutes: number;
};

export default function HK() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<"all" | Ticket["status"]>("all");

  async function load() {
    const r = await listTickets();
    setItems((r.items || []) as Ticket[]);
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(
    () => (status === "all" ? items : items.filter((t) => t.status === status)),
    [items, status]
  );

  function badge(s: Ticket["status"]) {
    const map: Record<Ticket["status"], string> = {
      Requested: "bg-gray-100 text-gray-800",
      Accepted: "bg-amber-100 text-amber-800",
      InProgress: "bg-sky-100 text-sky-800",
      Done: "bg-emerald-100 text-emerald-800",
    };
    return <span className={`px-2 py-0.5 rounded text-xs ${map[s]}`}>{s}</span>;
  }

  async function setStatus(id: string, next: Ticket["status"]) {
    await updateTicket(id, { status: next });
    load();
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Housekeeping</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
          className="border rounded px-2 py-1 text-sm"
          title="Filter by status"
        >
          <option value="all">All</option>
          <option value="Requested">Requested</option>
          <option value="Accepted">Accepted</option>
          <option value="InProgress">In progress</option>
          <option value="Done">Done</option>
        </select>
      </div>

      <ul className="space-y-3">
        {filtered.map((t) => (
          <li
            key={t.id}
            className="p-3 bg-white rounded shadow flex items-center justify-between"
          >
            <div>
              <div className="font-medium capitalize">
                {t.service_key.replaceAll("_", " ")} • Room {t.room}
              </div>
              <div className="text-xs text-gray-500">
                #{t.id} • SLA {t.sla_minutes}m
              </div>
            </div>
            <div className="flex items-center gap-2">
              {badge(t.status)}
              {t.status === "Requested" && (
                <button
                  onClick={() => setStatus(t.id, "Accepted")}
                  className="px-2 py-1 rounded bg-amber-600 text-white text-sm"
                >
                  Accept
                </button>
              )}
              {t.status === "Accepted" && (
                <button
                  onClick={() => setStatus(t.id, "InProgress")}
                  className="px-2 py-1 rounded bg-sky-600 text-white text-sm"
                >
                  Start
                </button>
              )}
              {t.status === "InProgress" && (
                <button
                  onClick={() => setStatus(t.id, "Done")}
                  className="px-2 py-1 rounded bg-emerald-600 text-white text-sm"
                >
                  Done
                </button>
              )}
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-gray-500">No tickets in this view.</li>
        )}
      </ul>
    </main>
  );
}
