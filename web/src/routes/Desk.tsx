// web/src/routes/Desk.tsx

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  listTickets,
  updateTicket,
  listOrders,
  updateOrder,
} from "../lib/api";
import { connectEvents } from "../lib/sse";
import SEO from "../components/SEO";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

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

/* ─────────────────────────────────────────────
   Detect effective hotel (URL ?hotelId=… or first hotel_members row)
   (Same behaviour as desk/Tickets.tsx)
   ───────────────────────────────────────────── */

function useEffectiveHotelId() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlHotelId = searchParams.get("hotelId");

  const [hotelId, setHotelId] = useState<string | null>(urlHotelId);
  const [initialised, setInitialised] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If URL already has hotelId, just use it
    if (urlHotelId) {
      setHotelId(urlHotelId);
      setInitialised(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) {
          setError(userErr.message);
          setInitialised(true);
          return;
        }
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

        // Use first mapped hotel
        setHotelId(data.hotel_id);

        // Also write it into the URL so other helpers / SSE can read it
        const next = new URLSearchParams(searchParams);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHotelId]);

  return { hotelId, initialised, error };
}

export default function Desk() {
  const { hotelId, initialised: hotelReady, error: hotelDetectError } =
    useEffectiveHotelId();

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep any detection error visible in the same banner
  useEffect(() => {
    if (hotelDetectError) {
      setError(hotelDetectError);
      setLoading(false);
    }
  }, [hotelDetectError]);

  const refresh = useCallback(async () => {
    // If we don’t yet know the hotel, don’t hit the backend
    if (!hotelId) {
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      // Pass hotelId so backend doesn’t complain
      const [t, o] = await Promise.all([
        (listTickets as any)({ hotelId }),
        (listOrders as any)({ hotelId }),
      ]);
      setTickets(((t as any)?.items || []) as Ticket[]);
      setOrders(((o as any)?.items || []) as Order[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  // Initial load + SSE wiring for both tickets & orders
  useEffect(() => {
    if (!hotelReady) return; // wait until hotel detection finishes

    refresh();

    // keep existing SSE behaviour; EventSource can read hotelId from URL
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
  }, [refresh, hotelReady]);

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

  const hkEmpty = !tickets.length;
  const ordersEmpty = !orders.length;

  const ticketRows = useMemo(() => tickets, [tickets]);
  const orderRows = useMemo(() => orders, [orders]);

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

      {error && (
        <div className="card" style={{ borderColor: "#f59e0b" }}>
          ⚠️ {error}
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
                  {(t.status === "Requested" ||
                    t.status === "Accepted") && (
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
