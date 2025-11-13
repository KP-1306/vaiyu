// web/src/routes/desk/Tickets.tsx
import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

type TicketStatus = string; // e.g. 'new' | 'accepted' | 'in_progress' | 'paused' | 'resolved' | 'closed' | 'open'
type TicketPriority = "low" | "normal" | "high" | "urgent";
type TicketSource = "guest" | "staff" | "desk" | "owner" | "api";

type TicketRow = {
  id: string;
  hotel_id: string;
  service_key: string;
  status: TicketStatus;
  priority: TicketPriority;
  title: string;
  details: string | null;
  source: TicketSource;
  booking_code: string | null;
  room: string | null;
  created_by: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  sla_minutes_snapshot: number;
  due_at: string | null;
  mins_remaining: number | null;
  is_overdue: boolean | null;
};

type ServiceRow = {
  id: string;
  hotel_id: string;
  key: string;
  label: string;
  sla_minutes: number;
  active: boolean;
  priority_weight?: number | null;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In progress" },
  { value: "paused", label: "Paused" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open (legacy)" },
];

const PRIORITY_OPTIONS: { value: TicketPriority | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const ACTION_LABELS: Record<string, string> = {
  accept: "Accept",
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  resolve: "Resolve",
  close: "Close",
  bumpPriority: "Bump priority",
  reassign: "Reassign",
};

export default function DeskTicketsRoute() {
  const [searchParams] = useSearchParams();
  const hotelId = searchParams.get("hotelId") ?? "";
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: [
      "desk-tickets",
      hotelId,
      statusFilter,
      priorityFilter,
      overdueOnly,
    ],
    enabled: !!hotelId,
    queryFn: async (): Promise<TicketRow[]> => {
      if (!hotelId) return [];
      let query = supabase
        .from("tickets_sla_status")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("due_at", { ascending: true });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }
      if (priorityFilter) {
        query = query.eq("priority", priorityFilter);
      }
      if (overdueOnly) {
        query = query.eq("is_overdue", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
  });

  const servicesQuery = useQuery({
    queryKey: ["desk-services", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<ServiceRow[]> => {
      if (!hotelId) return [];
      const { data, error } = await supabase
        .from("services")
        .select("id, hotel_id, key, label, sla_minutes, active, priority_weight")
        .eq("hotel_id", hotelId)
        .eq("active", true)
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ServiceRow[];
    },
  });

  const serviceMap = useMemo(() => {
    const m = new Map<string, ServiceRow>();
    (servicesQuery.data ?? []).forEach((s) => m.set(s.key, s));
    return m;
  }, [servicesQuery.data]);

  const refreshTickets = () =>
    queryClient.invalidateQueries({ queryKey: ["desk-tickets", hotelId] });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      serviceKey: string;
      title: string;
      details?: string;
      priority: TicketPriority;
      source: TicketSource;
      bookingCode?: string;
      room?: string;
    }) => {
      const { serviceKey, title, details, priority, source, bookingCode, room } =
        payload;
      const { data, error } = await supabase.rpc("create_ticket", {
        p_hotel_id: hotelId,
        p_service_key: serviceKey,
        p_title: title,
        p_details: details ?? null,
        p_priority: priority,
        p_source: source,
        p_booking_code: bookingCode ?? null,
        p_room: room ?? null,
      });
      if (error) throw error;
      return data as TicketRow;
    },
    onSuccess: () => {
      setCreateOpen(false);
      refreshTickets();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: {
      ticketId: string;
      action:
        | "accept"
        | "start"
        | "pause"
        | "resume"
        | "resolve"
        | "close"
        | "bumpPriority"
        | "reassign";
      assigneeId?: string;
    }) => {
      const { ticketId, action, assigneeId } = payload;
      const rpcMap: Record<string, string> = {
        accept: "accept_ticket",
        start: "start_progress",
        pause: "pause_ticket",
        resume: "resume_ticket",
        resolve: "resolve_ticket",
        close: "close_ticket",
        bumpPriority: "bump_priority",
        reassign: "reassign_ticket",
      };
      const fn = rpcMap[action];
      const args: Record<string, unknown> = { p_ticket_id: ticketId };
      if (action === "reassign") {
        args["p_new_assigned_to"] = assigneeId;
      }
      const { error } = await supabase.rpc(fn, args);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshTickets();
    },
  });

  const isLoading =
    ticketsQuery.isLoading || servicesQuery.isLoading || actionMutation.isPending;

  if (!hotelId) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Desk – Tickets</h1>
        <p className="text-sm text-slate-600">
          No <code>hotelId</code> provided. Open this page with{" "}
          <code>?hotelId=&lt;hotel-uuid&gt;</code> in the URL.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Desk – Tickets</h1>
          <p className="text-xs text-slate-500">
            Hotel: <span className="font-mono">{hotelId}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refreshTickets}
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
          >
            + New ticket
          </button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">
            Status
          </label>
          <select
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">
            Priority
          </label>
          <select
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value || "all-priority"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>

        {isLoading && (
          <span className="ml-auto text-xs text-slate-500">Loading…</span>
        )}
      </section>

      <section className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <TicketsTable
          tickets={ticketsQuery.data ?? []}
          serviceMap={serviceMap}
          onRowClick={setSelectedTicket}
          onAction={(ticketId, action) =>
            actionMutation.mutate({ ticketId, action })
          }
          isMutating={actionMutation.isPending}
        />
      </section>

      {selectedTicket && (
        <TicketDetailDrawer
          ticket={selectedTicket}
          service={serviceMap.get(selectedTicket.service_key) ?? null}
          onClose={() => setSelectedTicket(null)}
          onAction={(action, assigneeId) =>
            actionMutation.mutate({
              ticketId: selectedTicket.id,
              action,
              assigneeId,
            })
          }
          isMutating={actionMutation.isPending}
        />
      )}

      {createOpen && (
        <CreateTicketModal
          hotelId={hotelId}
          services={servicesQuery.data ?? []}
          onClose={() => setCreateOpen(false)}
          onCreate={(payload) => createMutation.mutate(payload)}
          isSubmitting={createMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------- Table + subcomponents ----------

function TicketsTable(props: {
  tickets: TicketRow[];
  serviceMap: Map<string, ServiceRow>;
  onRowClick: (ticket: TicketRow) => void;
  onAction: (
    ticketId: string,
    action:
      | "accept"
      | "start"
      | "pause"
      | "resume"
      | "resolve"
      | "close"
      | "bumpPriority",
  ) => void;
  isMutating: boolean;
}) {
  const { tickets, serviceMap, onRowClick, onAction, isMutating } = props;

  if (!tickets.length) {
    return (
      <div className="p-6 text-sm text-slate-500">
        No tickets yet. Use “New ticket” to create one.
      </div>
    );
  }

  return (
    <table className="min-w-full text-sm">
      <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Service</th>
          <th className="px-3 py-2 text-left">Title</th>
          <th className="px-3 py-2 text-left">Status</th>
          <th className="px-3 py-2 text-left">Priority</th>
          <th className="px-3 py-2 text-left">SLA</th>
          <th className="px-3 py-2 text-left">Source</th>
          <th className="px-3 py-2 text-left">Room</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tickets.map((t) => {
          const service = serviceMap.get(t.service_key);
          return (
            <tr
              key={t.id}
              className="hover:bg-slate-50 cursor-pointer"
              onClick={() => onRowClick(t)}
            >
              <td className="px-3 py-2 align-top">
                <div className="font-medium text-slate-800">
                  {service?.label ?? t.service_key}
                </div>
                {service && (
                  <div className="text-[10px] text-slate-500 uppercase">
                    SLA {service.sla_minutes} min
                  </div>
                )}
              </td>
              <td className="px-3 py-2 align-top max-w-xs">
                <div className="text-slate-900 line-clamp-2">{t.title}</div>
                {t.booking_code && (
                  <div className="text-[11px] text-slate-500">
                    Booking: {t.booking_code}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-3 py-2 align-top">
                <PriorityBadge priority={t.priority} />
              </td>
              <td className="px-3 py-2 align-top">
                <SlaChip
                  minsRemaining={t.mins_remaining ?? null}
                  isOverdue={t.is_overdue ?? false}
                  dueAt={t.due_at}
                />
              </td>
              <td className="px-3 py-2 align-top text-xs text-slate-600">
                {t.source}
              </td>
              <td className="px-3 py-2 align-top text-xs text-slate-600">
                {t.room ?? "-"}
              </td>
              <td
                className="px-3 py-2 align-top text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <TicketRowActions
                  ticket={t}
                  disabled={isMutating}
                  onAction={(action) => onAction(t.id, action)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const label = status.replace(/_/g, " ");
  let classes = "bg-slate-100 text-slate-700";
  if (status === "new" || status === "open") {
    classes = "bg-sky-100 text-sky-700";
  } else if (status === "in_progress" || status === "accepted") {
    classes = "bg-amber-100 text-amber-700";
  } else if (status === "paused") {
    classes = "bg-slate-200 text-slate-700";
  } else if (status === "resolved") {
    classes = "bg-emerald-100 text-emerald-700";
  } else if (status === "closed") {
    classes = "bg-slate-300 text-slate-800";
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${classes}`}>
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  let classes = "bg-slate-100 text-slate-700";
  if (priority === "urgent") {
    classes = "bg-red-100 text-red-700";
  } else if (priority === "high") {
    classes = "bg-orange-100 text-orange-700";
  } else if (priority === "normal") {
    classes = "bg-emerald-100 text-emerald-700";
  } else if (priority === "low") {
    classes = "bg-slate-100 text-slate-700";
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${classes}`}>
      {priority}
    </span>
  );
}

function SlaChip(props: {
  minsRemaining: number | null;
  isOverdue: boolean;
  dueAt: string | null;
}) {
  const { minsRemaining, isOverdue, dueAt } = props;

  if (!dueAt) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600">
        No SLA
      </span>
    );
  }

  const date = new Date(dueAt);
  const timeStr = isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });

  if (isOverdue) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-red-100 text-red-700">
        Overdue {timeStr && `• due ${timeStr}`}
      </span>
    );
  }

  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700">
      {minsRemaining != null
        ? `Due in ${minsRemaining} min`
        : "Due soon"}{" "}
      {timeStr && `• ${timeStr}`}
    </span>
  );
}

function TicketRowActions(props: {
  ticket: TicketRow;
  disabled: boolean;
  onAction: (
    action:
      | "accept"
      | "start"
      | "pause"
      | "resume"
      | "resolve"
      | "close"
      | "bumpPriority",
  ) => void;
}) {
  const { ticket, disabled, onAction } = props;

  const buttons: {
    action:
      | "accept"
      | "start"
      | "pause"
      | "resume"
      | "resolve"
      | "close"
      | "bumpPriority";
    show: boolean;
  }[] = [
    { action: "accept", show: ticket.status === "new" || ticket.status === "open" },
    {
      action: "start",
      show:
        ticket.status === "new" ||
        ticket.status === "accepted" ||
        ticket.status === "open" ||
        ticket.status === "paused",
    },
    { action: "pause", show: ticket.status === "in_progress" },
    { action: "resume", show: ticket.status === "paused" },
    {
      action: "resolve",
      show:
        ticket.status === "in_progress" ||
        ticket.status === "accepted" ||
        ticket.status === "paused" ||
        ticket.status === "open" ||
        ticket.status === "new",
    },
    {
      action: "close",
      show: ticket.status === "resolved" || ticket.status === "closed",
    },
    { action: "bumpPriority", show: true },
  ];

  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {buttons
        .filter((b) => b.show)
        .map((b) => (
          <button
            key={b.action}
            type="button"
            disabled={disabled}
            className="px-2 py-0.5 text-[11px] rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            onClick={() => onAction(b.action)}
          >
            {ACTION_LABELS[b.action]}
          </button>
        ))}
    </div>
  );
}

// ---------- Detail drawer & create modal ----------

function TicketDetailDrawer(props: {
  ticket: TicketRow;
  service: ServiceRow | null;
  onClose: () => void;
  onAction: (
    action:
      | "accept"
      | "start"
      | "pause"
      | "resume"
      | "resolve"
      | "close"
      | "bumpPriority"
      | "reassign",
    assigneeId?: string,
  ) => void;
  isMutating: boolean;
}) {
  const { ticket, service, onClose, onAction, isMutating } = props;
  const [reassignTo, setReassignTo] = useState<string>("");

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25">
      <div className="w-full max-w-md h-full bg-white shadow-xl flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold">Ticket details</h2>
            <p className="text-xs text-slate-500">{ticket.id}</p>
          </div>
          <button
            type="button"
            className="text-sm text-slate-500 hover:text-slate-800"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-500">Service</div>
            <div className="font-medium text-slate-900">
              {service?.label ?? ticket.service_key}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase text-slate-500">Title</div>
            <div className="font-medium text-slate-900">{ticket.title}</div>
          </div>

          {ticket.details && (
            <div>
              <div className="text-xs uppercase text-slate-500">Details</div>
              <p className="text-slate-800 whitespace-pre-line">
                {ticket.details}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <SlaChip
              minsRemaining={ticket.mins_remaining ?? null}
              isOverdue={ticket.is_overdue ?? false}
              dueAt={ticket.due_at}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <InfoField label="Source" value={ticket.source} />
            <InfoField label="Room" value={ticket.room ?? "-"} />
            <InfoField label="Booking code" value={ticket.booking_code ?? "-"} />
            <InfoField
              label="Created at"
              value={new Date(ticket.created_at).toLocaleString()}
            />
            <InfoField
              label="Updated at"
              value={new Date(ticket.updated_at).toLocaleString()}
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-600">
              Reassign ticket
            </div>
            <input
              type="text"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="Assignee user_id (UUID)"
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
            />
            <button
              type="button"
              disabled={isMutating || !reassignTo}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
              onClick={() => onAction("reassign", reassignTo)}
            >
              {ACTION_LABELS.reassign}
            </button>
          </div>
        </div>

        <footer className="border-t border-slate-200 px-4 py-3">
          <div className="flex flex-wrap justify-end gap-2">
            <TicketRowActions
              ticket={ticket}
              disabled={isMutating}
              onAction={(action) => onAction(action)}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="text-[11px] text-slate-800 break-words">{value}</div>
    </div>
  );
}

function CreateTicketModal(props: {
  hotelId: string;
  services: ServiceRow[];
  onClose: () => void;
  onCreate: (payload: {
    serviceKey: string;
    title: string;
    details?: string;
    priority: TicketPriority;
    source: TicketSource;
    bookingCode?: string;
    room?: string;
  }) => void;
  isSubmitting: boolean;
}) {
  const { services, onClose, onCreate, isSubmitting } = props;
  const [serviceKey, setServiceKey] = useState<string>(
    services[0]?.key ?? "",
  );
  const [title, setTitle] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [source, setSource] = useState<TicketSource>("desk");
  const [bookingCode, setBookingCode] = useState<string>("");
  const [room, setRoom] = useState<string>("");

  const canSubmit = serviceKey && title && !isSubmitting;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-lg font-semibold">New ticket</h2>
          <button
            type="button"
            className="text-sm text-slate-500 hover:text-slate-800"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Service
            </label>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white"
              value={serviceKey}
              onChange={(e) => setServiceKey(e.target.value)}
            >
              <option value="">Select a service</option>
              {services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} (SLA {s.sla_minutes} min)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Title
            </label>
            <input
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary (visible on desk board)"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Details
            </label>
            <textarea
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm min-h-[80px]"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Optional additional context for staff"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Priority
              </label>
              <select
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as TicketPriority)
                }
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Source
              </label>
              <select
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white"
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as TicketSource)
                }
              >
                <option value="desk">Desk</option>
                <option value="guest">Guest</option>
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
                <option value="api">API</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Booking code
              </label>
              <input
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="Optional booking reference"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Room
              </label>
              <input
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Optional room number"
              />
            </div>
          </div>
        </div>
        <footer className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            onClick={() =>
              onCreate({
                serviceKey,
                title,
                details,
                priority,
                source,
                bookingCode: bookingCode || undefined,
                room: room || undefined,
              })
            }
          >
            {isSubmitting ? "Creating…" : "Create ticket"}
          </button>
        </footer>
      </div>
    </div>
  );
}
