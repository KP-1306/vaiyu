// web/src/routes/Desk.tsx
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  listTickets,
  updateTicket,
  listOrders,
  updateOrder,
} from "../lib/api";
import { connectEvents } from '../lib/events';

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

type OrderStatus = "Placed" | "Preparing" | "Ready" | "Delivered";
type Order = {
  id: string;
  status: OrderStatus;
  created_at: string;
  items?: { item_key: string; qty?: number; name?: string }[];
  room?: string;
  booking?: string;
};

// --- helpers for KPIs ---
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
const isToday = (iso?: string) => !!iso && new Date(iso).getTime() >= startOfToday().getTime();
const minutesBetween = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

function computeKpis(tickets: Ticket[], orders: Order[]) {
  const nowIso = new Date().toISOString();
  const openTickets = tickets.filter((t) => t.status !== "Done");
  const openCount = openTickets.length;

  // Breach: if ticket is Done → done_at > sla_deadline, else if open → now > sla_deadline
  const breachedToday = tickets.filter((t) => {
    const breached =
      (t.status === "Done"
        ? (!!t.done_at && new Date(t.done_at) > new Date(t.sla_deadline))
        : new Date(nowIso) > new Date(t.sla_deadline));
    // count only today's activity window (created today or completed today)
    const todayRelevant = isToday(t.created_at) || isToday(t.done_at);
    return breached && todayRelevant;
  }).length;

  // Avg resolution (today) for Done tickets
  const doneToday = tickets.filter((t) => t.status === "Done" && isToday(t.done_at));
  const avgResolve =
    doneToday.length > 0
      ? Math.round(
          doneToday.reduce((sum, t) => sum + minutesBetween(t.created_at, t.done_at || t.created_at), 0) /
            doneToday.length
        )
      : 0;

  const activeOrders = orders.filter((o) => o.status !== "Delivered").length;

  return { openCount, breachedToday, avgResolve, activeOrders };
}

export default function Desk() {
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [t, o] = await Promise.all([listTickets(), listOrders()]);
      setTickets(((t as any)?.items || []) as Ticket[]);
      setOrders(((o as any)?.items || []) as Order[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // initial load
    refresh();

    // live refresh on SSE events
    const off = connectEvents({
      ticket_created: () => refresh(),
      ticket_updated: () => refresh(),
      order_created: () => refresh(),
      order_updated: () => refresh(),
    });

    return () => off();
  }, [refresh]);

  async function setTicketStatus(id: string, status: Ticket["status"]) {
    // optimistic update
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await updateTicket(id, { status });
    } catch {
      refresh();
    }
  }

  async function setOrderStatus(id: string, status: OrderStatus) {
    // optimistic update
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      await updateOrder(id, { status });
    } catch {
      refresh();
    }
  }

  const kpis = useMemo(() => computeKpis(tickets, orders), [tickets, orders]);

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
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <h1 style={{ margin: 0 }}>Front Desk</h1>
        <button className="btn btn-light" onClick={refresh}>
          Refresh
        </button>
      </div>

      {/* SLA mini-dashboard */}
      <section
        className="card"
        style={{ padding: 12, background: "white" }}
        aria-label="SLA Metrics"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0,1fr))",
            gap: 12,
          }}
        >
          <Kpi title="Open tickets" value={kpis.openCount} />
          <Kpi
            title="Breached today"
            value={kpis.breachedToday}
            tone={kpis.breachedToday > 0 ? "warn" : "ok"}
          />
          <Kpi
            title="Avg resolve (min)"
            value={kpis.avgResolve}
            hint={kpis.avgResolve ? "for tickets completed today" : "no completions today"}
          />
          <Kpi title="Active orders" value={kpis.activeOrders} />
        </div>
      </section>

      {error && (
        <div className="card" style={{ borderColor: "#f59e0b" }}>
          ⚠️ {error}
        </div>
      )}
      {loading && <div>Loading…</div>}

      <section
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
      >
        {/* Housekeeping */}
        <div className="card">
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <h3 style={{ margin: 0 }}>Housekeeping</h3>
            <button className="link" onClick={refresh}>
              Refresh
            </button>
          </div>
          {!tickets.length && (
            <div style={{ marginTop: 8, color: "var(--muted)" }}>
              No open HK requests.
            </div>
          )}
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {tickets.map((t) => (
              <div key={t.id} className="card" style={{ background: "transparent" }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {t.service_key.replace(/_/g, " ")} • Room {t.room}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      Booking: {t.booking} · SLA: {t.sla_minutes}m · Created:{" "}
                      {new Date(t.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <span className="badge">{t.status}</span>
                </div>

                <div
                  style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}
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
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <h3 style={{ margin: 0 }}>Kitchen Orders</h3>
            <button className="link" onClick={refresh}>
              Refresh
            </button>
          </div>
          {!orders.length && (
            <div style={{ marginTop: 8, color: "var(--muted)" }}>
              No active orders.
            </div>
          )}
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {orders.map((o) => (
              <div key={o.id} className="card" style={{ background: "transparent" }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      Order #{o.id} • Room {o.room || "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {new Date(o.created_at).toLocaleTimeString()} ·{" "}
                      {o.items?.length || 0} item(s)
                    </div>
                  </div>
                  <span className="badge">{o.status}</span>
                </div>

                <div
                  style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}
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

// small KPI card
function Kpi({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: number | string;
  hint?: string;
  tone?: "ok" | "warn";
}) {
  const toneStyle =
    tone === "warn"
      ? { background: "#FEF3C7", borderColor: "#F59E0B", color: "#92400E" }
      : tone === "ok"
      ? { background: "#ECFDF5", borderColor: "#10B981", color: "#065F46" }
      : {};
  return (
    <div className="card" style={{ ...toneStyle }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, opacity: 0.75 }}>{hint}</div>}
    </div>
  );
}
