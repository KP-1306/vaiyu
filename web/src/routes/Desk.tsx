// web/src/routes/Desk.tsx

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  IS_SUPABASE_FUNCTIONS,
  listTickets,
  updateTicket,
  listOrders,
  updateOrder,
} from "../lib/api";
import { connectEvents } from "../lib/sse";
import SEO from "../components/SEO";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus = "Requested" | "Accepted" | "InProgress" | "Done";

type TicketPriority = "low" | "normal" | "high" | "urgent" | string;

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  booking?: string;
  status: TicketStatus;
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline?: string | null;
  is_overdue?: boolean;
  priority?: TicketPriority;
  mins_remaining?: number | null;
};

type Order = {
  id: string;
  status: string; // 'Placed' | 'Preparing' | 'Ready' | 'Delivered'
  created_at: string;
  items?: any[];
  room?: string;
  booking?: string;
};

// ---------------------------------------------------------------------------
// Helpers: status mapping + ticket normalisation
// ---------------------------------------------------------------------------

/** Map backend status (Node or Supabase) into our UI status */
function mapBackendStatusToUi(rawStatus: unknown): TicketStatus {
  const s = String(rawStatus ?? "").toLowerCase();

  switch (s) {
    case "new":
    case "requested":
      return "Requested";
    case "accepted":
      return "Accepted";
    case "in_progress":
    case "in-progress":
    case "in progress":
    case "paused":
      // paused still feels like "in progress" for Desk UI
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
  const id = String(raw?.id ?? "");
  const service_key = String(
    raw?.service_key ?? raw?.key ?? raw?.service ?? "service"
  ).trim();

  const room = String(
    raw?.room ?? raw?.room_number ?? raw?.roomNo ?? raw?.unit ?? "-"
  ).trim();

  const created_at: string =
    raw?.created_at ?? raw?.inserted_at ?? raw?.created ?? new Date().toISOString();

  const status = mapBackendStatusToUi(raw?.status);

  const sla_minutes: number =
    Number(
      raw?.sla_minutes ??
        raw?.sla_minutes_snapshot ??
        raw?.sla ??
        raw?.sla_mins
    ) || 0;

  const sla_deadline: string | null =
    raw?.sla_deadline ?? raw?.due_at ?? raw?.deadline ?? null;

  const booking =
    raw?.booking ?? raw?.booking_code ?? raw?.code ?? raw?.stay_code ?? undefined;

  const is_overdue =
    typeof raw?.is_overdue === "boolean" ? raw.is_overdue : undefined;

  const priority = raw?.priority as TicketPriority;

  const mins_remaining: number | null =
    typeof raw?.mins_remaining === "number"
      ? raw.mins_remaining
      : typeof raw?.minutes_remaining === "number"
      ? raw.minutes_remaining
      : null;

  const accepted_at: string | undefined =
    raw?.accepted_at ?? raw?.acceptedAt ?? raw?.acknowledged_at ?? undefined;

  const started_at: string | undefined =
    raw?.started_at ?? raw?.in_progress_at ?? undefined;

  const done_at: string | undefined =
    raw?.done_at ?? raw?.resolved_at ?? raw?.closed_at ?? undefined;

  return {
    id,
    service_key,
    room,
    booking,
    status,
    created_at,
    accepted_at,
    started_at,
    done_at,
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
  // new(Requested) -> accepted
  if (current === "Requested" && next === "Accepted") return "accept";

  // new/accepted -> in_progress
  if (current === "Requested" && next === "InProgress") return "start";
  if (current === "Accepted" && next === "InProgress") return "start";

  // in_progress -> resolved (Done)
  if (current === "InProgress" && next === "Done") return "resolve";

  return null;
}

/** Tiny SLA chip: "5m left" / "Overdue by 3m" / "Within SLA" */
function renderSlaStatus(t: Ticket) {
  // no SLA data → hide
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

  if (typeof t.mins_remaining === "number" && !Number.isNaN(t.mins_remaining)) {
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
      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${
        isOverdue ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"
      }`}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hook: detect effective hotelId (from URL or hotel_members)
// ---------------------------------------------------------------------------

function useEffectiveHotelId() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlHotelId = searchParams.get("hotelId");

  const [hotelId, setHotelId] = useState<string | null>(urlHotelId);
  const [initialised, setInitialised] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If hotelId is already in the URL, trust it and don’t hit Supabase.
    if (urlHotelId) {
      setHotelId(urlHotelId);
      setInitialised(true);
      setError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setError(null);

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) {
          if (!cancelled) {
            setError(userErr.message);
            setInitialised(true);
          }
          return;
        }

        const userId = userRes?.user?.id;
        if (!userId) {
          if (!cancelled) {
            setError("You are not signed in.");
            setInitialised(true);
          }
          return;
        }

        const { data, error: hmError } = await supabase
          .from("hotel_members")
          .select("hotel_id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (hmError) {
          if (!cancelled) {
            setError(hmError.message);
            setInitialised(true);
          }
          return;
        }

        if (!data) {
          if (!cancelled) {
            setError("You are not a member of any hotel yet.");
            setInitialised(true);
          }
          return;
        }

        if (cancelled) return;

        // We have an effective hotel_id → set it + push into URL so refresh is stable.
        setHotelId(data.hotel_id);

        const next = new URLSearchParams(searchParams);
        next.set("hotelId", data.hotel_id);
        setSearchParams(next, { replace: true });

        setInitialised(true);
        setError(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHotelId]);

  return { hotelId, initialised, error };
}

// ---------------------------------------------------------------------------
// Front Desk component
// ---------------------------------------------------------------------------

export default function Desk() {
  const { hotelId, initialised, error: hotelIdError } = useEffectiveHotelId();

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Simple tab between Ops (HK + Kitchen) and Chat workspace
  const [activeTab, setActiveTab] = useState<"ops" | "chat">("ops");

  const hkEmpty = !tickets.length;
  const ordersEmpty = !orders.length;

  const ticketRows = useMemo(() => tickets, [tickets]);
  const orderRows = useMemo(() => orders, [orders]);

  // Combined error: either local API error or hotel-detection error
  const combinedError = error ?? hotelIdError ?? null;

  const refresh = useCallback(async () => {
    // Don’t call APIs until we know our hotelId logic has run.
    if (!initialised) return;

    if (!hotelId) {
      // If hotelId is still missing after initialisation, just surface the hook error.
      if (!hotelIdError) {
        setError("Hotel id is required to load desk operations.");
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // IMPORTANT: pass hotelId through – backend Edge Functions expect ?hotelId= / ?hotel_id=
      const [t, o] = await Promise.all([
        listTickets(hotelId),
        listOrders(hotelId),
      ]);

      const rawTickets: any[] =
        (Array.isArray((t as any)?.items) && (t as any).items) ||
        (Array.isArray((t as any)?.tickets) && (t as any).tickets) ||
        (Array.isArray(t as any) && (t as any)) ||
        [];

      setTickets(rawTickets.map(normalizeTicket));

      const rawOrders: any[] =
        (Array.isArray((o as any)?.items) && (o as any).items) ||
        (Array.isArray((o as any)?.orders) && (o as any).orders) ||
        (Array.isArray(o as any) && (o as any)) ||
        [];

      setOrders(rawOrders as Order[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [hotelId, initialised, hotelIdError]);

  // Initial load + SSE wiring for both tickets & orders
  useEffect(() => {
    refresh();

    const off = connectEvents({
      // tickets
      ticket_created: (e) => {
        const raw = (e as any)?.ticket ?? e;
        if (!raw) return;
        const t = normalizeTicket(raw);
        setTickets((prev) =>
          prev.find((x) => x.id === t.id) ? prev : [t, ...prev]
        );
      },
      ticket_updated: (e) => {
        const raw = (e as any)?.ticket ?? e;
        if (!raw) return;
        const t = normalizeTicket(raw);
        setTickets((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, ...t } : x))
        );
      },

      // orders
      order_created: (e) => {
        const o = (e as any)?.order as Order;
        if (!o) return;
        setOrders((prev) =>
          prev.find((x) => x.id === o.id) ? prev : [o, ...prev]
        );
      },
      order_updated: (e) => {
        const o = (e as any)?.order as Order;
        if (!o) return;
        setOrders((prev) =>
          prev.map((x) => (x.id === o.id ? { ...x, ...o } : x))
        );
      },
    });

    return () => off();
  }, [refresh]);

  async function setTicketStatus(
    id: string,
    nextStatus: TicketStatus,
    currentStatus: TicketStatus
  ) {
    // optimistic UI
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: nextStatus } : t))
    );

    try {
      let payload: any;

      if (IS_SUPABASE_FUNCTIONS) {
        const action = supabaseActionForTransition(currentStatus, nextStatus);
        if (!action) {
          // illegal transition under Supabase rules – reload and bail
          await refresh();
          return;
        }
        payload = { action };
      } else {
        // Legacy Node backend: still expects direct status patch
        payload = { status: nextStatus };
      }

      await updateTicket(id, payload);
    } catch {
      // revert on failure
      await refresh();
    }
  }

  async function setOrderStatus(id: string, status: string) {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o))
    );
    try {
      await updateOrder(id, { status });
    } catch {
      // revert on failure
      refresh();
    }
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 24,
        display: "grid",
        gap: 16,
      }}
    >
      <SEO title="Front Desk" />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0 }}>Front Desk</h1>
        <button className="btn btn-light" onClick={refresh}>
          Refresh
        </button>
      </div>

      {combinedError && (
        <div className="card" style={{ borderColor: "#f59e0b" }}>
          ⚠️ {combinedError}
        </div>
      )}
      {loading && <div>Loading…</div>}

      {/* Tabs: Operations vs Chat */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        <button
          type="button"
          className={activeTab === "ops" ? "btn" : "btn btn-light"}
          onClick={() => setActiveTab("ops")}
        >
          Operations (HK &amp; Kitchen)
        </button>
        <button
          type="button"
          className={activeTab === "chat" ? "btn" : "btn btn-light"}
          onClick={() => setActiveTab("chat")}
        >
          Chat workspace
        </button>
      </div>

      {activeTab === "ops" && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          {/* Housekeeping */}
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>Housekeeping</h3>
              <button className="link" onClick={refresh}>
                Refresh
              </button>
            </div>
            {hkEmpty && (
              <div style={{ marginTop: 8, color: "var(--muted)" }}>
                No open HK requests.
              </div>
            )}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {ticketRows.map((t) => (
                <div
                  key={t.id}
                  className="card"
                  style={{ background: "transparent" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {t.service_key.replace(/_/g, " ")} • Room {t.room}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        <span>Booking: {t.booking ?? "—"}</span>
                        <span>· SLA: {t.sla_minutes}m</span>
                        <span>
                          · Created{" "}
                          {new Date(t.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {renderSlaStatus(t)}
                      </div>
                    </div>
                    <span className="badge">{t.status}</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {t.status === "Requested" && (
                      <button
                        className="btn btn-light"
                        onClick={() =>
                          setTicketStatus(t.id, "Accepted", t.status)
                        }
                      >
                        Accept
                      </button>
                    )}
                    {(t.status === "Requested" ||
                      t.status === "Accepted") && (
                      <button
                        className="btn btn-light"
                        onClick={() =>
                          setTicketStatus(t.id, "InProgress", t.status)
                        }
                      >
                        Start
                      </button>
                    )}
                    {(IS_SUPABASE_FUNCTIONS
                      ? t.status === "InProgress"
                      : t.status !== "Done") && (
                      <button
                        className="btn"
                        onClick={() =>
                          setTicketStatus(t.id, "Done", t.status)
                        }
                      >
                        Mark Done
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Kitchen Orders */}
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>Kitchen Orders</h3>
              <button className="link" onClick={refresh}>
                Refresh
              </button>
            </div>
            {ordersEmpty && (
              <div style={{ marginTop: 8, color: "var(--muted)" }}>
                No active orders.
              </div>
            )}
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {orderRows.map((o) => (
                <div
                  key={o.id}
                  className="card"
                  style={{ background: "transparent" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        Order #{o.id} • Room {o.room || "—"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                        }}
                      >
                        {new Date(o.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {o.items?.length || 0} item(s)
                      </div>
                    </div>
                    <span className="badge">{o.status}</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {o.status === "Placed" && (
                      <button
                        className="btn btn-light"
                        onClick={() => setOrderStatus(o.id, "Preparing")}
                      >
                        Preparing
                      </button>
                    )}
                    {o.status === "Preparing" && (
                      <button
                        className="btn btn-light"
                        onClick={() => setOrderStatus(o.id, "Ready")}
                      >
                        Ready
                      </button>
                    )}
                    {o.status !== "Delivered" && (
                      <button
                        className="btn"
                        onClick={() => setOrderStatus(o.id, "Delivered")}
                      >
                        Delivered
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === "chat" && (
        <section className="card" style={{ marginTop: 8 }}>
          <h3 style={{ marginTop: 0 }}>Chat workspace</h3>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            This is the dedicated space for two-way guest chats (WhatsApp /
            in-app). Once chat APIs and the shared <code>ChatPanel</code> are
            wired, they will render here. For now, housekeeping requests and
            orders continue to appear under the Operations tab.
          </p>
        </section>
      )}
    </div>
  );
}
