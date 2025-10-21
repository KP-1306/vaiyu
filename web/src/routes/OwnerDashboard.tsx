// web/src/routes/OwnerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

/** ========= Types ========= */
type Hotel = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
};

type StayRow = {
  id: string;
  guest_id: string;
  check_in_start: string | null;
  check_out_end: string | null;
  status: string | null;
  room: string | null;
};

type KpiRow = {
  hotel_id: string;
  as_of_date: string;
  occupied_today: number;
  orders_today: number;
  revenue_today: number;
  pickup_7d: number;
  avg_rating_30d: number | null;
  updated_at: string;
};

type LiveOrder = {
  id: string;
  created_at: string;
  status: string;
  price: number | null;
};

type StaffPerf = {
  name: string;
  orders_served: number;
  avg_rating_30d: number | null;
  avg_completion_min: number | null;
  volume_score: number | null;
  rating_score: number | null;
  speed_score: number | null;
  performance_score: number | null;
};

type HrmsSnapshot = {
  staff_total: number;
  present_today: number;
  late_today: number;
  absent_today: number;
  attendance_pct_today: number;
  absences_7d: number;
  staff_with_absence_7d: number;
};

const HAS_FUNCS = import.meta.env.VITE_HAS_FUNCS === "true";

/** ========= Page ========= */
export default function OwnerDashboard() {
  const { slug } = useParams();
  const [params] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);

  const [arrivals, setArrivals] = useState<StayRow[]>([]);
  const [inhouse, setInhouse] = useState<StayRow[]>([]);
  const [departures, setDepartures] = useState<StayRow[]>([]);
  const [totalRooms, setTotalRooms] = useState<number>(0);

  // KPI state (live via Realtime)
  const [kpi, setKpi] = useState<KpiRow | null>(null);

  // SLA + Live orders
  const [slaTargetMin, setSlaTargetMin] = useState<number | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);

  // Staff performance & HRMS snapshot (optional RPC)
  const [staffPerf, setStaffPerf] = useState<StaffPerf[] | null>(null);
  const [hrms, setHrms] = useState<HrmsSnapshot | null>(null);

  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const inviteToken = params.get("invite");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Resolve slug → hotel + hydrate lists + start KPI subscription
  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setAccessProblem("Missing property slug in the URL.");
      return;
    }

    let alive = true;
    let unsubscribe = () => {};

    (async () => {
      setLoading(true);
      setAccessProblem(null);

      // 1) Hotel (RLS-gated)
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id,name,slug,city")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (hErr || !hotelRow) {
        setHotel(null);
        setArrivals([]); setInhouse([]); setDepartures([]);
        setTotalRooms(0);
        setKpi(null);
        setAccessProblem(
          "We couldn’t open this property. You might not have access yet or the property doesn’t exist."
        );
        setLoading(false);
        return;
      }

      setHotel(hotelRow);
      const hotelId = hotelRow.id;

      // 2) Ops lists (non-blocking)
      try {
        const [{ data: arr }, { data: inh }, { data: dep }] = await Promise.all([
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .gte("check_in_start", today)
            .lt("check_in_start", nextDayISO(today))
            .order("check_in_start", { ascending: true }),
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .lte("check_in_start", new Date().toISOString())
            .gte("check_out_end", new Date().toISOString())
            .order("check_out_end", { ascending: true }),
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .gte("check_out_end", today)
            .lt("check_out_end", nextDayISO(today))
            .order("check_out_end", { ascending: true }),
        ]);

        if (!alive) return;
        setArrivals(arr || []);
        setInhouse(inh || []);
        setDepartures(dep || []);
      } catch {
        setArrivals([]); setInhouse([]); setDepartures([]);
      }

      // 3) Rooms count (non-blocking)
      try {
        const { data: rooms } = await supabase
          .from("rooms")
          .select("id")
          .eq("hotel_id", hotelId);
        if (!alive) return;
        setTotalRooms(rooms?.length || 0);
      } catch {
        setTotalRooms(0);
      }

      // 4) KPI initial load (from cache table)
      try {
        const { data: row } = await supabase
          .from("owner_dashboard_kpis")
          .select("*")
          .eq("hotel_id", hotelId)
          .maybeSingle();
        if (!alive) return;
        setKpi(row ?? null);
      } catch {
        setKpi(null);
      }

      // 5) SLA target + Live orders
      try {
        const [{ data: sla }, { data: orders }] = await Promise.all([
          supabase
            .from("sla_targets")
            .select("target_minutes")
            .eq("hotel_id", hotelId)
            .eq("key", "order_delivery_min")
            .maybeSingle(),
          supabase
            .from("orders")
            .select("id,created_at,status,price")
            .eq("hotel_id", hotelId)
            .in("status", ["open", "preparing"])
            .order("created_at", { ascending: false })
            .limit(50),
        ]);
        if (!alive) return;
        setSlaTargetMin(sla?.target_minutes ?? 20); // sensible default
        setLiveOrders(orders || []);
      } catch {
        setSlaTargetMin(20);
        setLiveOrders([]);
      }

      // 6) Realtime subscription for live KPIs
      const channel = supabase
        .channel(`kpi-stream-${hotelId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "owner_dashboard_kpis", filter: `hotel_id=eq.${hotelId}` },
          (payload) => {
            const next = (payload.new as KpiRow) ?? null;
            setKpi(next);
          }
        )
        .subscribe();
      unsubscribe = () => supabase.removeChannel(channel);

      // 7) Optional RPCs (best staff + HRMS)
      if (HAS_FUNCS) {
        try {
          const { data } = await supabase.rpc("best_staff_performance_for_slug", { p_slug: slug });
          if (alive) setStaffPerf(data ?? null);
        } catch { setStaffPerf(null); }
        try {
          const { data } = await supabase.rpc("hrms_snapshot_for_slug", { p_slug: slug });
          if (alive) setHrms((data && data[0]) ?? null);
        } catch { setHrms(null); }
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [slug, today]);

  /** ======= UI States ======= */
  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  if (accessProblem) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <BackHome />
        <AccessHelp
          slug={slug || ""}
          message={accessProblem}
          inviteToken={inviteToken || undefined}
        />
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <div className="rounded-xl border p-6 text-center">
          <div className="text-lg font-medium mb-2">No property to show</div>
          <p className="text-sm text-gray-600">
            Try opening your property dashboard from the Owner Home.
          </p>
          <div className="mt-4">
            <Link to="/owner" className="btn btn-light">Owner Home</Link>
          </div>
        </div>
      </main>
    );
  }

  /** ======= KPI Calculations ======= */
  const total = totalRooms;
  const occupied = kpi?.occupied_today ?? 0;
  const occPct = total ? Math.round((occupied / total) * 100) : 0;
  const revenueToday = kpi?.revenue_today ?? 0;
  const adr = occupied ? revenueToday / occupied : 0;
  const revpar = total ? (adr * occupied) / total : 0;
  const pickup7d = kpi?.pickup_7d ?? 0;

  /** ======= Render ======= */
  return (
    <main className="max-w-6xl mx-auto p-6">
      <BackHome />

      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{hotel.name}</h1>
          {hotel.city ? <p className="text-sm text-gray-600">{hotel.city}</p> : null}
          <p className="text-xs text-gray-500 mt-1">
            This page shows today’s performance, live orders & staff activity. Green is good —
            anything in red needs attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/owner/${hotel.slug}/ops`} className="btn btn-light">Operations</Link>
          <Link to={`/owner/${hotel.slug}/housekeeping`} className="btn btn-light">Housekeeping</Link>
          <Link to={`/owner/${hotel.slug}/settings`} className="btn btn-light">Settings</Link>
          <Link to={`/owner/access?slug=${encodeURIComponent(hotel.slug)}`} className="btn btn-light">Access</Link>
        </div>
      </header>

      {/* ======= KPI Row (live) ======= */}
      <KpiRow
        items={[
          {
            label: "Occupancy",
            value: `${occPct}%`,
            sub: `${occupied}/${total} rooms · 60–80% is healthy`
          },
          {
            label: "ADR (Average Daily Rate)",
            value: `₹${adr.toFixed(0)}`,
            sub: "Today’s average price per occupied room"
          },
          {
            label: "RevPAR (Revenue Per Available Room)",
            value: `₹${revpar.toFixed(0)}`,
            sub: "Revenue ÷ total rooms (today)"
          },
          {
            label: "Pick-up (7 days)",
            value: pickup7d,
            sub: "New nights added in the last week"
          },
        ]}
      />

      {/* ======= Pricing nudge ======= */}
      <PricingNudge
        occupancy={occPct}
        suggestion={`Consider raising tonight’s base rate by ₹${suggestedBump(occPct)} to capture late demand.`}
        ctaTo={`/owner/${hotel.slug}/settings`}
      />

      {/* ======= SLA + Live orders ======= */}
      <section className="grid gap-4 lg:grid-cols-3 mb-6">
        <SlaCard
          targetMin={slaTargetMin ?? 20}
          orders={liveOrders}
        />
        <LiveOrdersPanel
          orders={liveOrders}
          targetMin={slaTargetMin ?? 20}
          className="lg:col-span-2"
        />
      </section>

      {/* ======= Staff performance + HRMS ======= */}
      <section className="grid gap-4 lg:grid-cols-2 mb-6">
        <StaffPerformancePanel data={staffPerf} />
        <HrmsPanel data={hrms} />
      </section>

      {/* ======= Heatmap + Lists ======= */}
      <section className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2">
          <OccupancyHeatmap title="Occupancy (next 6 weeks)" />
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium mb-2">Housekeeping progress</div>
          <p className="text-sm text-gray-500">
            Link your HK statuses to show real-time room readiness.
          </p>
          <div className="mt-4 h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(occPct, 100)}%` }} />
          </div>
          <div className="text-xs text-gray-500 mt-2">{Math.min(occPct, 100)}% rooms ready</div>
        </div>
      </section>

      {/* ======= Arrivals / In-house / Departures ======= */}
      <section className="grid gap-4 md:grid-cols-3">
        <Board title="Arrivals today" items={arrivals} empty="No arrivals today." />
        <Board title="In-house" items={inhouse} empty="No guests are currently in-house." />
        <Board title="Departures today" items={departures} empty="No departures today." />
      </section>

      {/* ======= Footer contact ======= */}
      <footer className="mt-8">
        <div className="rounded-2xl border p-4 flex items-center justify-between bg-white">
          <div>
            <div className="font-medium">Need help or want to improve results?</div>
            <div className="text-sm text-gray-500">Our team can review your numbers and suggest quick wins.</div>
          </div>
          <a href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help" className="btn">Contact us</a>
        </div>
      </footer>
    </main>
  );
}

/** ========= Components ========= */

function KpiRow({
  items,
}: {
  items: { label: string; value: string | number; sub?: string; trend?: number | null }[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-gray-500">{k.label}</div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
              {k.sub ? <div className="text-xs text-gray-500 mt-0.5">{k.sub}</div> : null}
            </div>
            <MiniSparkline />
          </div>
          {typeof k.trend === "number" ? (
            <div className={`mt-2 text-xs ${k.trend >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {k.trend >= 0 ? "▲" : "▼"} {Math.abs(k.trend)}% vs. prev
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function MiniSparkline() {
  return (
    <div className="ml-4 mt-1 h-8 w-20 relative">
      <div className="absolute inset-0 opacity-20 bg-gradient-to-tr from-emerald-500 to-indigo-500 rounded" />
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-1">
        {[4, 8, 3, 9, 6, 10, 7].map((h, i) => (
          <div key={i} className="w-1.5 rounded-t bg-emerald-500" style={{ height: `${h * 6}%` }} />
        ))}
      </div>
    </div>
  );
}

function PricingNudge({
  occupancy,
  suggestion,
  ctaTo,
}: {
  occupancy: number;
  suggestion: string;
  ctaTo: string;
}) {
  const tone = occupancy >= 80 ? "Great momentum!" : occupancy >= 40 ? "Room to grow." : "Let’s boost pick-up.";
  return (
    <section className="mb-6 rounded-2xl border bg-gradient-to-r from-amber-50 to-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-amber-800 font-medium">{tone}</div>
          <div className="text-gray-800 mt-1">{suggestion}</div>
          <div className="text-xs text-gray-500 mt-1">
            Tip: Auto-pricing can do this automatically and show you the uplift.
          </div>
        </div>
        <Link to={ctaTo} className="btn">Open pricing</Link>
      </div>
    </section>
  );
}

function SlaCard({ targetMin, orders }: { targetMin: number; orders: LiveOrder[] }) {
  const total = orders.length;
  const onTime = orders.filter((o) => ageMin(o.created_at) <= targetMin).length;
  const pct = total ? Math.round((onTime / total) * 100) : 100;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium">SLA (order delivery)</div>
      <div className="text-sm text-gray-500 mb-2">Target: {targetMin} min</div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-500 mt-2">{onTime}/{total} orders on time</div>
    </div>
  );
}

function LiveOrdersPanel({ orders, targetMin, className = "" }:{ orders: LiveOrder[]; targetMin: number; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${className}`}>
      <div className="font-medium mb-2">Live orders</div>
      {orders.length === 0 ? (
        <div className="text-sm text-gray-500">No live orders right now.</div>
      ) : (
        <ul className="divide-y">
          {orders.map((o) => {
            const mins = ageMin(o.created_at);
            const breach = mins > targetMin;
            return (
              <li key={o.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm">#{o.id.slice(0,8)} · {o.status}</div>
                  <div className="text-xs text-gray-500">Age: {mins} min</div>
                </div>
                <div className={`text-xs px-2 py-1 rounded ${breach ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                  {breach ? "SLA breach" : "On time"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StaffPerformancePanel({ data }: { data: StaffPerf[] | null }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-2">Staff performance (last 30 days)</div>
      {!data || data.length === 0 ? (
        <div className="text-sm text-gray-500">
          Hook this to <code>best_staff_performance_for_slug(slug)</code> to rank your team by volume, rating and speed.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Orders</th>
                <th className="py-1 pr-3">Avg rating</th>
                <th className="py-1 pr-3">Avg mins</th>
                <th className="py-1 pr-3">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3">{r.orders_served ?? "—"}</td>
                  <td className="py-1 pr-3">{r.avg_rating_30d ?? "—"}</td>
                  <td className="py-1 pr-3">{r.avg_completion_min ?? "—"}</td>
                  <td className="py-1 pr-3 font-medium">{r.performance_score ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-2">Tip: Train under-performers on speed and guest experience.</p>
    </div>
  );
}

function HrmsPanel({ data }: { data: HrmsSnapshot | null }) {
  if (!data) {
    return (
      <div className="rounded-xl border bg-white p-4">
        <div className="font-medium mb-2">Attendance & leaves</div>
        <div className="text-sm text-gray-500">
          Connect <code>hrms_snapshot_for_slug(slug)</code> to see presence, late arrivals and 7-day absences.
        </div>
      </div>
    );
  }
  const { staff_total, present_today, late_today, absent_today, attendance_pct_today, absences_7d, staff_with_absence_7d } = data;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-2">Attendance & leaves</div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Metric label="Total staff" value={staff_total} />
        <Metric label="Present today" value={present_today} />
        <Metric label="Late today" value={late_today} />
        <Metric label="Absent today" value={absent_today} />
        <Metric label="Attendance %" value={`${attendance_pct_today}%`} />
        <Metric label="Absence days (7d)" value={absences_7d} />
      </div>
      <div className="text-xs text-gray-500 mt-2">{staff_with_absence_7d} staff had at least one absence in 7 days.</div>
    </div>
  );
}

function Metric({ label, value }:{ label:string; value:string|number }) {
  return (
    <div className="rounded-lg border p-3 bg-gray-50">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function OccupancyHeatmap({ title }: { title: string }) {
  const weeks = 6, days = 7;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-3">{title}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * days }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-md bg-gray-100"
            style={{ opacity: 0.6 + 0.4 * Math.sin((i % 7) / 7) }}
            title="Occupancy placeholder"
          />
        ))}
      </div>
      <div className="mt-3 text-xs text-gray-500">Deeper calendar with real data coming next.</div>
    </div>
  );
}

function Board({
  title,
  items,
  empty,
}: {
  title: string;
  items: StayRow[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {s.room ? `Room ${s.room}` : "Unassigned room"}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {fmt(s.check_in_start)} → {fmt(s.check_out_end)}
                  </div>
                </div>
                <div className="text-xs uppercase tracking-wide text-gray-600">
                  {s.status || "—"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccessHelp({
  slug,
  message,
  inviteToken,
}: {
  slug: string;
  message: string;
  inviteToken?: string;
}) {
  return (
    <div className="rounded-2xl border p-6 bg-amber-50">
      <div className="text-lg font-semibold mb-1">Property access needed</div>
      <p className="text-sm text-amber-900 mb-4">{message}</p>
      <div className="flex flex-wrap gap-2">
        {slug ? (
          <Link to={`/owner/access?slug=${encodeURIComponent(slug)}`} className="btn">Request Access</Link>
        ) : null}
        <Link to="/owner" className="btn btn-light">Owner Home</Link>
        <Link to="/invite/accept" className="btn btn-light">Accept Invite</Link>
        {inviteToken ? (
          <Link to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`} className="btn btn-light">Accept via Code</Link>
        ) : null}
      </div>
      <p className="text-xs text-amber-900 mt-3">
        Tip: If you received an email invite, open it on this device so we can auto-fill your invite code.
      </p>
    </div>
  );
}

/** ========= Utils ========= */
function fmt(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}
function nextDayISO(yyyy_mm_dd: string) {
  const d = new Date(yyyy_mm_dd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function suggestedBump(occ: number) {
  if (occ >= 90) return 1200;
  if (occ >= 75) return 800;
  if (occ >= 60) return 500;
  return 300;
}
function ageMin(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}
