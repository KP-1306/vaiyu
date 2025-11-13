// web/src/routes/desk/Tickets.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import Spinner from "../../components/Spinner";

type TicketStatus = "new" | "accepted" | "in_progress" | "paused" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

type TicketRow = {
  id: string;
  hotel_id: string;
  service_id: string | null;        // legacy path
  service_key: string | null;       // new path (preferred)
  status: TicketStatus;
  priority: TicketPriority;
  title: string;
  details: string | null;
  source: string;
  booking_code: string | null;
  sla_minutes_snapshot: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  mins_remaining: number | null;
  is_overdue: boolean | null;
};

type ServiceRow = {
  id: string;
  key: string;
  label: string;
  sla_minutes: number;
};

type NewTicketPayload = {
  serviceKey: string;
  title: string;
  details?: string;
  bookingCode?: string;
  priority: TicketPriority;
};

/**
 * Decide which hotel to use:
 * - If URL has ?hotelId=… → use that
 * - Else look up first hotel_members row for current user
 * - If found, set it AND push ?hotelId=… into the URL
 */
function useEffectiveHotelId() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlHotelId = searchParams.get("hotelId");
  const [hotelId, setHotelId] = useState<string | null>(urlHotelId);
  const [initialised, setInitialised] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (urlHotelId) {
      setHotelId(urlHotelId);
      setInitialised(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const userId = userRes?.user?.id;
        if (!userId) {
          setError("You are not signed in.");
          setInitialised(true);
          return;
        }

        const { data, error: hmError } = await supabase
          .from("hotel_members")
          .select("hotel_id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (hmError) {
          setError(hmError.message);
          setInitialised(true);
          return;
        }

        if (!data) {
          setError("You are not a member of any hotel yet.");
          setInitialised(true);
          return;
        }

        if (cancelled) return;

        setHotelId(data.hotel_id);

        const next = new URLSearchParams();
        next.set("hotelId", data.hotel_id);
        setSearchParams(next, { replace: true });

        setInitialised(true);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to detect hotel.");
          setInitialised(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urlHotelId, setSearchParams]);

  return { hotelId, initialised, error };
}

function SlaChip({ ticket }: { ticket: TicketRow }) {
  const mins = ticket.mins_remaining;
  if (mins == null) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
        No SLA
      </span>
    );
  }
  if (mins < 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
        Overdue {Math.abs(mins)} min
      </span>
    );
  }
  if (mins <= 5) {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
        Due now ({mins} min)
      </span>
    );
  }
  if (mins <= 30) {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
        Due in {mins} min
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
      Due in {mins} min
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
  switch (priority) {
    case "urgent":
      return <span className={`${base} bg-red-100 text-red-700`}>Urgent</span>;
    case "high":
      return <span className={`${base} bg-orange-100 text-orange-800`}>High</span>;
    case "normal":
      return <span className={`${base} bg-blue-100 text-blue-700`}>Normal</span>;
    case "low":
    default:
      return <span className={`${base} bg-gray-100 text-gray-700`}>Low</span>;
  }
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
  switch (status) {
    case "new":
      return <span className={`${base} bg-purple-100 text-purple-700`}>New</span>;
    case "accepted":
      return <span className={`${base} bg-indigo-100 text-indigo-700`}>Accepted</span>;
    case "in_progress":
      return <span className={`${base} bg-blue-100 text-blue-700`}>In progress</span>;
    case "paused":
      return <span className={`${base} bg-yellow-100 text-yellow-800`}>Paused</span>;
    case "resolved":
      return <span className={`${base} bg-emerald-100 text-emerald-700`}>Resolved</span>;
    case "closed":
    default:
      return <span className={`${base} bg-gray-100 text-gray-700`}>Closed</span>;
  }
}

export default function DeskTickets() {
  const { hotelId, initialised, error: hotelError } = useEffectiveHotelId();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TicketPriority>("all");
  const [overdueFilter, setOverdueFilter] = useState<"all" | "overdue" | "on_time">("all");

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newTicket, setNewTicket] = useState<NewTicketPayload>({
    serviceKey: "",
    title: "",
    details: "",
    bookingCode: "",
    priority: "normal",
  });

  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    data: services,
    isLoading: servicesLoading,
    error: servicesError,
  } = useQuery({
    queryKey: ["services", hotelId],
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id, key, label, sla_minutes")
        .eq("hotel_id", hotelId)
        .eq("active", true)
        .order("priority_weight", { ascending: false });
      if (error) throw error;
      return data as ServiceRow[];
    },
  });

  const {
    data: tickets,
    isLoading: ticketsLoading,
    error: ticketsError,
    refetch,
  } = useQuery({
    queryKey: ["tickets_sla_status", hotelId, statusFilter, priorityFilter, overdueFilter],
    enabled: !!hotelId,
    queryFn: async () => {
      let query: any = supabase
        .from("tickets_sla_status")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (priorityFilter !== "all") query = query.eq("priority", priorityFilter);
      if (overdueFilter === "overdue") query = query.eq("is_overdue", true);
      else if (overdueFilter === "on_time") query = query.eq("is_overdue", false);

      const { data, error } = await query;
      if (error) throw error;
      return data as TicketRow[];
    },
  });

  // Legacy map by ID (for any old tickets that still have service_id)
  const serviceById = useMemo(() => {
    const map = new Map<string, ServiceRow>();
    (services ?? []).forEach((s) => map.set(s.id, s));
    return map;
  }, [services]);

  // New map by key (preferred path, matches tickets.service_key)
  const serviceByKey = useMemo(() => {
    const map = new Map<string, ServiceRow>();
    (services ?? []).forEach((s) => {
      if (s.key) map.set(s.key, s);
    });
    return map;
  }, [services]);

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!hotelId) return;
    if (!newTicket.serviceKey || !newTicket.title.trim()) {
      setCreateError("Service and title are required.");
      return;
    }
    setCreateError(null);

    try {
      const { error } = await supabase.rpc("create_ticket", {
        p_hotel_id: hotelId,
        p_service_key: newTicket.serviceKey,
        p_title: newTicket.title.trim(),
        p_details: newTicket.details?.trim() || null,
        p_source: "desk",
        p_booking_code: newTicket.bookingCode?.trim() || null,
        p_priority: newTicket.priority,
      });
      if (error) throw error;

      setIsNewOpen(false);
      setNewTicket({
        serviceKey: "",
        title: "",
        details: "",
        bookingCode: "",
        priority: "normal",
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["tickets_sla_status"] });
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to create ticket.");
    }
  }

  async function runAction(
    ticket: TicketRow,
    action: "accept" | "start" | "pause" | "resume" | "resolve" | "close" | "bump"
  ) {
    setActionPendingId(ticket.id);
    try {
      let fn: string;
      const args: Record<string, any> = { p_ticket_id: ticket.id };

      switch (action) {
        case "accept":
          fn = "accept_ticket";
          break;
        case "start":
          fn = "start_progress";
          break;
        case "pause":
          fn = "pause_ticket";
          break;
        case "resume":
          fn = "resume_ticket";
          break;
        case "resolve":
          fn = "resolve_ticket";
          break;
        case "close":
          fn = "close_ticket";
          break;
        case "bump":
        default:
          fn = "bump_priority";
          break;
      }

      const { error } = await supabase.rpc(fn, args);
      if (error) throw error;
      await refetch();
    } catch (err: any) {
      alert(err?.message ?? "Failed to apply ticket action.");
    } finally {
      setActionPendingId(null);
    }
  }

  // ───────────────────────── UI STATES ─────────────────────────

  if (!initialised) {
    return (
      <main className="p-4 sm:p-6">
        <h1 className="text-xl font-semibold mb-4">Desk – Tickets</h1>
        <div className="mt-4">
          <Spinner label="Detecting your hotel…" />
        </div>
      </main>
    );
  }

  if (!hotelId) {
    return (
      <main className="p-4 sm:p-6">
        <h1 className="text-xl font-semibold mb-2">Desk – Tickets</h1>
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {hotelError || "Could not determine hotel. Please make sure your user is linked to a hotel."}
        </p>
      </main>
    );
  }

  const hasTickets = (tickets ?? []).length > 0;

  return (
    <main className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Desk – Tickets</h1>
          <p className="mt-1 text-sm text-gray-600">
            Live operations board for this hotel. SLA chips turn red when tickets are overdue.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setIsNewOpen(true)}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            + New ticket
          </button>
        </div>
      </div>

      {/* Filters */}
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col text-xs font-medium text-gray-600">
          Status
          <select
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="new">New</option>
            <option value="accepted">Accepted</option>
            <option value="in_progress">In progress</option>
            <option value="paused">Paused</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          Priority
          <select
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>

        <label className="flex flex-col text-xs font-medium text-gray-600">
          SLA
          <select
            className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            value={overdueFilter}
            onChange={(e) => setOverdueFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="overdue">Only overdue</option>
            <option value="on_time">Only on-time</option>
          </select>
        </label>
      </section>

      {/* Errors */}
      {servicesError && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          Failed to load services: {String((servicesError as any).message ?? servicesError)}
        </p>
      )}
      {ticketsError && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          Failed to load tickets: {String((ticketsError as any).message ?? ticketsError)}
        </p>
      )}

      {/* Tickets table */}
      <section className="mt-4">
        {(ticketsLoading || servicesLoading) && (
          <div className="mt-4">
            <Spinner label="Loading tickets…" />
          </div>
        )}

        {!ticketsLoading && !hasTickets && (
          <p className="mt-4 text-sm text-gray-500">
            No tickets yet for this hotel. Use <span className="font-medium">“+ New ticket”</span> to
            create the first one.
          </p>
        )}

        {hasTickets && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Created</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Service</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Title</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Priority</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">SLA</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(tickets ?? []).map((t) => {
                  // Prefer new service_key mapping, fall back to legacy service_id
                  const service =
                    (t.service_id && serviceById.get(t.service_id)) ||
                    (t.service_key && serviceByKey.get(t.service_key)) ||
                    undefined;

                  const created = new Date(t.created_at);
                  const createdLabel = created.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isBusy = actionPendingId === t.id;

                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {created.toLocaleDateString()}{" "}
                        <span className="text-gray-400">•</span> {createdLabel}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900">
                        {service?.label ? (
                          service.label
                        ) : (
                          <span className="text-gray-400 italic">
                            {t.service_key || "Unknown service"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900">
                        <button
                          type="button"
                          onClick={() => setSelectedTicket(t)}
                          className="max-w-xs truncate text-left text-blue-700 hover:underline"
                          title={t.title}
                        >
                          {t.title}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-3 py-2">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-3 py-2">
                        <SlaChip ticket={t} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          {t.status === "new" && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => runAction(t, "accept")}
                                className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => runAction(t, "start")}
                                className="rounded-md border border-blue-500 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                              >
                                Start
                              </button>
                            </>
                          )}
                          {t.status === "accepted" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => runAction(t, "start")}
                              className="rounded-md border border-blue-500 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            >
                              Start
                            </button>
                          )}
                          {t.status === "in_progress" && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => runAction(t, "pause")}
                                className="rounded-md border border-yellow-500 px-2 py-0.5 text-xs text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
                              >
                                Pause
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => runAction(t, "resolve")}
                                className="rounded-md border border-emerald-600 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                Resolve
                              </button>
                            </>
                          )}
                          {t.status === "paused" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => runAction(t, "resume")}
                              className="rounded-md border border-blue-500 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            >
                              Resume
                            </button>
                          )}
                          {t.status === "resolved" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => runAction(t, "close")}
                              className="rounded-md border border-gray-400 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Close
                            </button>
                          )}
                          {t.status !== "closed" && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => runAction(t, "bump")}
                              className="rounded-md border border-pink-500 px-2 py-0.5 text-xs text-pink-600 hover:bg-pink-50 disabled:opacity-50"
                            >
                              Bump priority
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* New ticket modal */}
      {isNewOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">New ticket</h2>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setIsNewOpen(false)}
              >
                ✕
              </button>
            </div>

            <form className="mt-3 space-y-3" onSubmit={handleCreateTicket}>
              <label className="block text-xs font-medium text-gray-700">
                Service
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  value={newTicket.serviceKey}
                  onChange={(e) => setNewTicket((t) => ({ ...t, serviceKey: e.target.value }))}
                >
                  <option value="">Select a service…</option>
                  {(services ?? []).map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-gray-700">
                Title
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  value={newTicket.title}
                  onChange={(e) => setNewTicket((t) => ({ ...t, title: e.target.value }))}
                  maxLength={200}
                />
              </label>

              <label className="block text-xs font-medium text-gray-700">
                Details (optional)
                <textarea
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  rows={3}
                  value={newTicket.details}
                  onChange={(e) => setNewTicket((t) => ({ ...t, details: e.target.value }))}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-gray-700">
                  Booking / Room (optional)
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={newTicket.bookingCode}
                    onChange={(e) =>
                      setNewTicket((t) => ({ ...t, bookingCode: e.target.value }))
                    }
                    placeholder="e.g. ROOM-101"
                  />
                </label>

                <label className="block text-xs font-medium text-gray-700">
                  Priority
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    value={newTicket.priority}
                    onChange={(e) =>
                      setNewTicket((t) => ({
                        ...t,
                        priority: e.target.value as TicketPriority,
                      }))
                    }
                  >
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>

              {createError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
                  {createError}
                </p>
              )}

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewOpen(false)}
                  className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Create ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Ticket details</h2>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setSelectedTicket(null)}
              >
                ✕
              </button>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <p className="font-medium">{selectedTicket.title}</p>
              <p className="text-xs text-gray-500">
                ID: {selectedTicket.id}
                <br />
                Created at: {new Date(selectedTicket.created_at).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <StatusBadge status={selectedTicket.status} />
                <PriorityBadge priority={selectedTicket.priority} />
                <SlaChip ticket={selectedTicket} />
              </div>
              {selectedTicket.details && (
                <p className="mt-2 whitespace-pre-wrap text-gray-700">
                  {selectedTicket.details}
                </p>
              )}
              {selectedTicket.booking_code && (
                <p className="mt-1 text-xs text-gray-600">
                  Booking / Room:{" "}
                  <span className="font-medium">{selectedTicket.booking_code}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Source: <span className="font-mono">{selectedTicket.source}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
