import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking: string;
  tenant?: string;
  status: "Requested" | "Accepted" | "InProgress" | "Done";
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline: string;
};

function usePathId(): string | null {
  // /stay/DEMO/requests/:id  -> pick the last segment
  try {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function formatTime(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useCountdown(deadlineISO?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = useMemo(() => {
    if (!deadlineISO) return 0;
    const delta = new Date(deadlineISO).getTime() - now;
    return Math.max(0, delta);
  }, [deadlineISO, now]);
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const text = `${mm}:${ss.toString().padStart(2, "0")}`;
  return { remaining, text };
}

export default function RequestTracker() {
  const id = usePathId();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { text: slaText, remaining } = useCountdown(ticket?.sla_deadline);

  // Poll ticket every 3s while not Done
  useEffect(() => {
    if (!id) return;
    let stopped = false;

    async function load() {
      try {
        const res = await fetch(`${API_URL}/tickets/${id}`);
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Server ${res.status}: ${t}`);
        }
        const data: Ticket = await res.json();
        if (!stopped) {
          setTicket(data);
          setError(null);
        }
      } catch (e: any) {
        if (!stopped) setError(e?.message || "Failed to load ticket");
      }
    }

    load();
    const iv = setInterval(() => {
      if (ticket?.status === "Done") return; // let the last state stay
      load();
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) {
    return (
      <main className="max-w-xl mx-auto p-4">
        <div className="text-red-600">Invalid request ID.</div>
      </main>
    );
  }

  if (error && !ticket) {
    return (
      <main className="max-w-xl mx-auto p-4">
        <div className="text-red-600">{error}</div>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto p-4">
      {!ticket ? (
        <div className="text-gray-500">Loading request…</div>
      ) : (
        <div className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">
                Room {ticket.room} • #{ticket.id}
              </div>
              <div className="text-xl font-semibold capitalize">
                {ticket.service_key.replaceAll("_", " ")}
              </div>
            </div>
            <div className="text-right">
              <div
                className={`px-2 py-1 rounded text-white inline-block ${
                  ticket.status === "Done"
                    ? "bg-emerald-600"
                    : ticket.status === "InProgress"
                    ? "bg-sky-600"
                    : ticket.status === "Accepted"
                    ? "bg-amber-600"
                    : "bg-gray-600"
                }`}
              >
                {ticket.status}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                SLA: {Math.round(ticket.sla_minutes)} min
              </div>
              {ticket.status !== "Done" && (
                <div className="text-xs mt-1">
                  <span className={remaining === 0 ? "text-red-600" : ""}>
                    Time left: {slaText}
                  </span>
                </div>
              )}
            </div>
          </header>

          {/* Timeline */}
          <section className="bg-white rounded shadow p-3">
            <div className="font-medium mb-2">Timeline</div>
            <ul className="text-sm">
              <li>
                <span className="font-semibold w-28 inline-block">Requested</span>
                {formatTime(ticket.created_at)}
              </li>
              {ticket.accepted_at && (
                <li>
                  <span className="font-semibold w-28 inline-block">Accepted</span>
                  {formatTime(ticket.accepted_at)}
                </li>
              )}
              {ticket.started_at && (
                <li>
                  <span className="font-semibold w-28 inline-block">In Progress</span>
                  {formatTime(ticket.started_at)}
                </li>
              )}
              {ticket.done_at && (
                <li>
                  <span className="font-semibold w-28 inline-block">Done</span>
                  {formatTime(ticket.done_at)}
                </li>
              )}
            </ul>
          </section>

          <p className="text-xs text-gray-500">
            This page auto-refreshes every few seconds until the request is completed.
          </p>
        </div>
      )}
    </main>
  );
}
