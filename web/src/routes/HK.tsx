// web/src/routes/HK.tsx
import { useEffect, useMemo, useState } from "react";
import { IS_SUPABASE_FUNCTIONS, listTickets, updateTicket } from "../lib/api";
import { connectEvents } from "../lib/sse";
import SEO from "../components/SEO";

type TicketStatus = "Requested" | "Accepted" | "InProgress" | "Done";

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking?: string;
  status: TicketStatus;
  created_at: string;
  sla_minutes: number;
  sla_deadline?: string | null;
  is_overdue?: boolean;
  priority?: "low" | "normal" | "high" | "urgent" | string;
  mins_remaining?: number | null; // from tickets_sla_status view
};

/** Map backend status (Node or Supabase) into our UI status */
function mapBackendStatusToUi(rawStatus: unknown): TicketStatus {
  const s = String(rawStatus ?? "").toLowerCase();

  switch (s) {
    case "new":
    case "requested":
      return "Requested";
    case "accepted":
      return "Accepted";
    case "in progress":
    case "paused":
    case "blocked":
      // paused/blocked still feels like "in progress" for HK UI
      return "InProgress";
    case "resolved":
    case "closed":
    case "done":
      return "Done";
    default:
      return "Requested";
  }
}

/** Normalise arbitrary ticket row into the UI Ticket type */
function normalizeTicket(raw: any): Ticket {
  const id = String(raw.id ?? "");
  const service_key = String(
    raw.service_key ?? raw.key ?? raw.service ?? "service"
  ).trim();

  const room = String(
    raw.room ?? raw.room_number ?? raw.roomNo ?? raw.unit ?? "-"
  ).trim();

  const created_at: string =
    raw.created_at ?? raw.inserted_at ?? raw.created ?? new Date().toISOString();

  const status = mapBackendStatusToUi(raw.status);

  const sla_minutes: number =
    Number(
      raw.sla_minutes ?? raw.sla_minutes_snapshot ?? raw.sla ?? raw.sla_mins
    ) || 0;

  const sla_deadline: string | null =
    raw.sla_deadline ?? raw.due_at ?? raw.deadline ?? null;

  const booking =
    raw.booking ?? raw.booking_code ?? raw.code ?? raw.stay_code ?? undefined;

  const is_overdue =
    typeof raw.is_overdue === "boolean" ? raw.is_overdue : undefined;

  const priority = raw.priority as Ticket["priority"];

  const mins_remaining: number | null =
    typeof raw.mins_remaining === "number"
      ? raw.mins_remaining
      : typeof raw.minutes_remaining === "number"
        ? raw.minutes_remaining
        : null;

  return {
    id,
    service_key,
    room,
    booking,
    status,
    created_at,
    sla_minutes,
    sla_deadline,
    is_overdue,
    priority,
    mins_remaining,
  };
}

/** Translate a UI transition into a Supabase RPC action */
function supabaseActionForTransition(
  current: TicketStatus,
  next: TicketStatus
): string | null {
  if (current === "Requested" && next === "Accepted") return "accept";
  if (current === "Accepted" && next === "InProgress") return "start";
  if (current === "InProgress" && next === "Done") return "resolve";
  return null;
}

export default function HK() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [status, setFilter] = useState<"all" | TicketStatus>("all");

  async function load() {
    try {
      const r = await listTickets();

      const rawItems: any[] =
        (Array.isArray((r as any)?.items) && (r as any).items) ||
        (Array.isArray((r as any)?.tickets) && (r as any).tickets) ||
        (Array.isArray(r) && (r as any)) ||
        [];

      setItems(rawItems.map(normalizeTicket));
    } catch (e) {
      console.error("[HK] listTickets error", e);
      setItems([]);
    }
  }

  useEffect(() => {
    // initial fetch
    load();

    // live updates via SSE (no polling)
    const off = connectEvents({
      ticket_created: () => load(),
      ticket_updated: () => load(),
    });

    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (status === "all" ? items : items.filter((t) => t.status === status)),
    [items, status]
  );

  function badge(s: TicketStatus) {
    const map: Record<TicketStatus, string> = {
      Requested: "bg-gray-100 text-gray-800",
      Accepted: "bg-amber-100 text-amber-800",
      InProgress: "bg-sky-100 text-sky-800",
      Done: "bg-emerald-100 text-emerald-800",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${map[s]}`}>{s}</span>
    );
  }

  /** Tiny SLA chip: "5m left" / "Overdue by 3m" / "Within SLA" */
  function renderSlaStatus(t: Ticket) {
    // if we don't have any SLA data, hide chip
    if (!t.sla_minutes && !t.sla_deadline && t.mins_remaining == null) {
      return null;
    }

    // Completed tickets: show within/breached SLA based on is_overdue
    if (t.status === "Done") {
      if (t.is_overdue) {
        return (
          <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
            SLA breached
          </span>
        );
      }
      return (
        <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
          Within SLA
        </span>
      );
    }

    let text = "";

    if (
      typeof t.mins_remaining === "number" &&
      !Number.isNaN(t.mins_remaining)
    ) {
      if (t.mins_remaining > 0) {
        text = `~${t.mins_remaining}m left`;
      } else if (t.mins_remaining < 0) {
        text = `Overdue by ~${Math.abs(t.mins_remaining)}m`;
      } else {
        text = "Due now";
      }
    } else if (t.is_overdue) {
      text = "Overdue";
    }

    if (!text) return null;

    const isOverdue = text.toLowerCase().includes("overdue");

    return (
      <span
        className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${isOverdue ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"
          }`}
      >
        {text}
      </span>
    );
  }

  async function updateTicketStatus(
    id: string,
    next: TicketStatus,
    current: TicketStatus
  ) {
    // optimistic UI
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: next } : t))
    );

    try {
      let payload: any;

      if (IS_SUPABASE_FUNCTIONS) {
        const action = supabaseActionForTransition(current, next);
        if (!action) {
          // unsupported transition: reload and bail
          await load();
          return;
        }
        payload = { action };
      } else {
        // Legacy Node backend: still expects direct status patch
        payload = { status: next };
      }

      await updateTicket(id, payload);
    } catch (e) {
      console.error("[HK] updateTicketStatus error", e);
      // revert by refetching
      await load();
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <SEO title="Housekeeping" noIndex />

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Housekeeping</h1>
        <select
          value={status}
          onChange={(e) => setFilter(e.target.value as any)}
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
              <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>#{t.id}</span>
                <span>• SLA {t.sla_minutes}m</span>
                {renderSlaStatus(t)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {badge(t.status)}
              {t.status === "Requested" && (
                <button
                  onClick={() =>
                    updateTicketStatus(t.id, "Accepted", t.status)
                  }
                  className="px-2 py-1 rounded bg-amber-600 text-white text-sm"
                >
                  Accept
                </button>
              )}
              {t.status === "Accepted" && (
                <button
                  onClick={() =>
                    updateTicketStatus(t.id, "InProgress", t.status)
                  }
                  className="px-2 py-1 rounded bg-sky-600 text-white text-sm"
                >
                  Start
                </button>
              )}
              {t.status === "InProgress" && (
                <button
                  onClick={() => updateTicketStatus(t.id, "Done", t.status)}
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
