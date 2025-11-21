// web/src/routes/Desk.tsx

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
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
  sla_deadline: string;
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
// Hook: detect effective hotelId (from URL or hotel_members)
//   – mirrors desk/Tickets.tsx so behaviour is consistent.
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
      // IMPORTANT: pass hotelId through – backend Edge Functions expect ?hotelId=
      const [t, o] = await Promise.all([
        listTickets(hotelId),
        listOrders(hotelId),
      ]);

      setTickets(((t as any)?.items || []) as Ticket[]);
      setOrders(((o as any)?.items || []) as Order[]);
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
        const t = (e as any)?.ticket as Ticket;
        if (!t) return;
        setTickets((prev) =>
          prev.find((x) => x.id === t.id) ? prev : [t, ...prev]
        );
      },
      ticket_updated: (e) => {
        const t = (e as any)?.ticket as Ticket;
        if (!t) return;
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

  async function setTicketStatus(id: string, status: Ticket["status"]) {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
    try {
      await updateTicket(id, { status });
    } catch {
      // revert on failure
      refresh();
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
                      }}
                    >
                      Booking: {t.booking} · SLA: {t.sla_minutes}m · Created{" "}
                      {new Date(t.created_at).toLocaleTimeString()}
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
                      onClick={() => setTicketStatus(t.id, "Accepted")}
                    >
                      Accept
                    </button>
                  )}
                  {(t.status === "Requested" || t.status === "Accepted") && (
                    <button
                      className="btn btn-light"
                      onClick={() => setTicketStatus(t.id, "InProgress")}
                    >
                      Start
                    </button>
                  )}
                  {t.status !== "Done" && (
                    <button
                      className="btn"
                      onClick={() => setTicketStatus(t.id, "Done")}
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
                      {new Date(o.created_at).toLocaleTimeString()} ·{" "}
                      {o.items?.length || 0} item(s)
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
    </div>
  );
}
