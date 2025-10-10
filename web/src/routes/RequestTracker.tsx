import { useEffect, useMemo, useState } from "react";
import { getTicket } from "../lib/api";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking: string;
  status: "Requested" | "Accepted" | "InProgress" | "Done";
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline: string; // ISO
};

function usePathTicketId(): string | null {
  const parts = (typeof window !== "undefined" ? window.location.pathname : "")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || null;
}

function fmtTime(ts?: string) {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useCountdown(deadlineISO?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = useMemo(() => {
    if (!deadlineISO) return 0;
    const delta = new Date(deadlineISO).getTime() - now;
    return Math.max(0, delta);
  }, [deadlineISO, now]);
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return { ms, text: `${mm}:${String(ss).padStart(2, "0")}` };
}

const steps = [
  { key: "Requested", label: "Requested", icon: "📨" },
  { key: "Accepted", label: "Accepted", icon: "✅" },
  { key: "InProgress", label: "In progress", icon: "🧹" },
  { key: "Done", label: "Done", icon: "🎉" },
] as const;

export default function RequestTracker() {
  const id = usePathTicketId();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { ms: remainingMs, text: remainingText } = useCountdown(ticket?.sla_deadline);

  async function load() {
    if (!id) return;
    try {
      setLoading(true);
      const j = (await getTicket(id)) as Ticket;
      setTicket(j);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load request");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(() => {
      if (ticket?.status === "Done") return;
      load();
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const progressIndex = useMemo(() => {
    if (!ticket) return 0;
    const map: Record<Ticket["status"], number> = {
      Requested: 0,
      Accepted: 1,
      InProgress: 2,
      Done: 3,
    };
    return map[ticket.status] ?? 0;
  }, [ticket]);

  const pct = (progressIndex / (steps.length - 1)) * 100;

  return (
    <main className="max-w-xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-gray-500">Request tracker • #{id ?? "--"}</div>
          <h1 className="text-xl font-semibold">
            {ticket ? `${ticket.service_key.replaceAll("_", " ")} — Room ${ticket.room}` : "Loading…"}
          </h1>
        </div>

        {/* Status chip */}
        {ticket && (
          <span
            className={`px-2 py-1 rounded text-white text-sm ${
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
          </span>
        )}
      </div>

      {/* SLA card */}
      {ticket && (
        <section className="bg-white rounded shadow p-3 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">SLA</div>
              <div className="text-base font-medium">{ticket.sla_minutes} minutes</div>
            </div>
            {ticket.status !== "Done" ? (
              <div className={`text-right ${remainingMs === 0 ? "text-red-600" : ""}`}>
                <div className="text-sm text-gray-500">Time left</div>
                <div className="text-xl font-semibold">{remainingText}</div>
              </div>
            ) : (
              <div className="text-right text-emerald-600">
                <div className="text-sm text-gray-500">Completed</div>
                <div className="text-xl font-semibold">🎉</div>
              </div>
            )}
          </div>

          {/* progress bar */}
          <div className="mt-3">
            <div className="h-2 w-full bg-gray-200 rounded">
              <div
                className={`h-2 rounded ${
                  ticket.status === "Done" ? "bg-emerald-500" : "bg-sky-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs mt-2 text-gray-600">
              {steps.map((s, i) => (
                <div key={s.key} className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 flex items-center justify-center rounded-full border ${
                      i <= progressIndex
                        ? "bg-sky-600 text-white border-sky-600"
                        : "bg-white border-gray-300"
                    }`}
                    title={s.label}
                  >
                    <span className="text-sm">{s.icon}</span>
                  </div>
                  <div className="mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Timeline */}
      <section className="bg-white rounded shadow p-3">
        <div className="font-semibold mb-2">Timeline</div>

        {loading && !ticket && <div className="text-gray-500">Loading…</div>}
        {err && !ticket && <div className="text-red-600">{err}</div>}

        {ticket && (
          <ul className="text-sm">
            <li className="flex gap-2 items-center">
              <span>📨</span>
              <span className="w-28 text-gray-600">Requested</span>
              <span className="font-medium">{fmtTime(ticket.created_at)}</span>
            </li>
            {ticket.accepted_at && (
              <li className="flex gap-2 items-center">
                <span>✅</span>
                <span className="w-28 text-gray-600">Accepted</span>
                <span className="font-medium">{fmtTime(ticket.accepted_at)}</span>
              </li>
            )}
            {ticket.started_at && (
              <li className="flex gap-2 items-center">
                <span>🧹</span>
                <span className="w-28 text-gray-600">In progress</span>
                <span className="font-medium">{fmtTime(ticket.started_at)}</span>
              </li>
            )}
            {ticket.done_at && (
              <li className="flex gap-2 items-center">
                <span>🎉</span>
                <span className="w-28 text-gray-600">Done</span>
                <span className="font-medium">{fmtTime(ticket.done_at)}</span>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Back links */}
      <div className="mt-4 flex items-center gap-3 text-sm">
        <a href="/stay/DEMO/menu" className="underline">
          ← Back to menu
        </a>
        <a href="/hk" className="underline">
          Open Housekeeping
        </a>
      </div>
    </main>
  );
}
