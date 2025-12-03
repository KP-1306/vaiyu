// web/src/routes/RequestTracker.tsx

import { useEffect, useMemo, useState } from "react";
import { getTicket } from "../lib/api";

type TicketStatus = "Requested" | "Accepted" | "InProgress" | "Done";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking: string;
  status: TicketStatus;
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline?: string; // ISO
};

function usePathTicketId(): string | null {
  const path =
    typeof window !== "undefined" ? window.location.pathname : "";
  const parts = path.split("/").filter(Boolean);
  const id = parts[parts.length - 1] || null;

  if (typeof window !== "undefined") {
    console.log("[VAiyu_FE] RequestTracker.usePathTicketId", {
      path,
      parts,
      id,
    });
  }

  return id;
}

function fmtTime(ts?: string) {
  if (!ts) return "--:--";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "--:--";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
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

const steps: { key: TicketStatus; label: string; icon: string }[] = [
  { key: "Requested", label: "Requested", icon: "📨" },
  { key: "Accepted", label: "Accepted", icon: "✅" },
  { key: "InProgress", label: "In progress", icon: "🧹" },
  { key: "Done", label: "Done", icon: "🎉" },
];

// ---- Normalizers so we can support old + new backends ----

function normalizeStatus(rawStatus: any): TicketStatus {
  if (!rawStatus) return "Requested";
  const s = String(rawStatus);

  // If backend already returns display statuses, just use them
  if (
    s === "Requested" ||
    s === "Accepted" ||
    s === "InProgress" ||
    s === "Done"
  ) {
    return s as TicketStatus;
  }

  // Map DB statuses (new / accepted / in_progress / paused / resolved / closed)
  const lower = s.toLowerCase();
  if (lower === "new") return "Requested";
  if (lower === "accepted") return "Accepted";
  if (lower === "in_progress" || lower === "paused") return "InProgress";
  if (lower === "resolved" || lower === "closed") return "Done";

  return "Requested";
}

function normalizeTicket(rawInput: any): Ticket {
  const raw = rawInput ?? {};

  const id = String(raw.id ?? "");
  const service_key =
    String(
      raw.service_key ?? raw.serviceKey ?? raw.key ?? raw.service ?? "service"
    ) || "service";

  const room = String(
    raw.room ?? raw.room_number ?? raw.roomNo ?? raw.room_no ?? "--"
  );

  const booking = String(
    raw.booking ??
      raw.booking_code ??
      raw.bookingCode ??
      raw.stay_code ??
      raw.stayCode ??
      "DEMO"
  );

  const status = normalizeStatus(raw.status);

  const created_at =
    raw.created_at ??
    raw.requested_at ??
    raw.inserted_at ??
    raw.createdAt ??
    new Date().toISOString();

  const accepted_at =
    raw.accepted_at ?? raw.acceptedAt ?? raw.acknowledged_at ?? undefined;

  const started_at =
    raw.started_at ?? raw.in_progress_at ?? raw.startedAt ?? undefined;

  const done_at =
    raw.done_at ??
    raw.resolved_at ??
    raw.closed_at ??
    raw.completed_at ??
    raw.doneAt ??
    undefined;

  const sla_minutes =
    Number(
      raw.sla_minutes ??
        raw.sla_minutes_snapshot ??
        raw.sla ??
        raw.sla_mins ??
        20
    ) || 20;

  const sla_deadline: string | undefined =
    raw.sla_deadline ??
    raw.slaDeadline ??
    raw.due_at ??
    raw.dueAt ??
    undefined;

  return {
    id,
    service_key,
    room,
    booking,
    status,
    created_at: String(created_at),
    accepted_at: accepted_at ? String(accepted_at) : undefined,
    started_at: started_at ? String(started_at) : undefined,
    done_at: done_at ? String(done_at) : undefined,
    sla_minutes,
    sla_deadline: sla_deadline ? String(sla_deadline) : undefined,
  };
}

export default function RequestTracker() {
  const id = usePathTicketId();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { ms: remainingMs, text: remainingText } = useCountdown(
    ticket?.sla_deadline
  );

  // Render-level debug
  console.log("[VAiyu_FE] RequestTracker.render", {
    id,
    hasTicket: !!ticket,
    err,
    loading,
  });

  async function load() {
    if (!id) {
      console.warn("[VAiyu_FE] RequestTracker.load: missing id");
      return;
    }
    try {
      console.log("[VAiyu_FE] RequestTracker.load.start", { id });
      setLoading(true);
      const raw = await getTicket(id);
      console.log("[VAiyu_FE] RequestTracker.load.raw", raw);

      const rawTicket = (raw as any)?.ticket ?? raw;
      if (!rawTicket) {
        console.warn("[VAiyu_FE] RequestTracker.load: no ticket field", raw);
        throw new Error("Ticket not found");
      }

      const normalized = normalizeTicket(rawTicket);
      console.log("[VAiyu_FE] RequestTracker.load.normalized", normalized);

      setTicket(normalized);
      setErr(null);
    } catch (e: any) {
      console.error("[VAiyu_FE] RequestTracker.load error", e);
      setErr(e?.message || "Failed to load request");
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }

  // Simplified polling: always call load() on interval,
  // avoid closing over a stale `ticket` value.
  useEffect(() => {
    load();
    const iv = setInterval(() => {
      // Light polling so guest can see live status updates
      load();
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const progressIndex = useMemo(() => {
    if (!ticket) return 0;
    const map: Record<TicketStatus, number> = {
      Requested: 0,
      Accepted: 1,
      InProgress: 2,
      Done: 3,
    };
    return map[ticket.status] ?? 0;
  }, [ticket]);

  const pct = (progressIndex / (steps.length - 1)) * 100;

  const bookingCodeForBack = ticket?.booking || "DEMO";

  return (
    <main className="max-w-xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-gray-500">
            Request tracker • #{id ?? "--"}
          </div>
          <h1 className="text-xl font-semibold">
            {ticket
              ? `${ticket.service_key.replaceAll("_", " ")} — Room ${
                  ticket.room
                }`
              : "Loading…"}
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
              <div className="text-base font-medium">
                {ticket.sla_minutes} minutes
              </div>
            </div>
            {ticket.status !== "Done" ? (
              <div
                className={`text-right ${
                  remainingMs === 0 ? "text-red-600" : ""
                }`}
              >
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

        {loading && !ticket && (
          <div className="text-gray-500">Loading…</div>
        )}
        {err && !ticket && <div className="text-red-600">{err}</div>}

        {ticket && (
          <ul className="text-sm">
            <li className="flex gap-2 items-center">
              <span>📨</span>
              <span className="w-28 text-gray-600">Requested</span>
              <span className="font-medium">
                {fmtTime(ticket.created_at)}
              </span>
            </li>
            {ticket.accepted_at && (
              <li className="flex gap-2 items-center">
                <span>✅</span>
                <span className="w-28 text-gray-600">Accepted</span>
                <span className="font-medium">
                  {fmtTime(ticket.accepted_at)}
                </span>
              </li>
            )}
            {ticket.started_at && (
              <li className="flex gap-2 items-center">
                <span>🧹</span>
                <span className="w-28 text-gray-600">In progress</span>
                <span className="font-medium">
                  {fmtTime(ticket.started_at)}
                </span>
              </li>
            )}
            {ticket.done_at && (
              <li className="flex gap-2 items-center">
                <span>🎉</span>
                <span className="w-28 text-gray-600">Done</span>
                <span className="font-medium">
                  {fmtTime(ticket.done_at)}
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Back links */}
      <div className="mt-4 flex items-center gap-3 text-sm">
        <a
          href={`/stay/${encodeURIComponent(bookingCodeForBack)}/menu`}
          className="underline"
        >
          ← Back to menu
        </a>
        <a href="/hk" className="underline">
          Open Housekeeping
        </a>
      </div>
    </main>
  );
}
