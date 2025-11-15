// web/src/routes/OwnerDashboard.tsx — final, friendly, linked (hardened for :slug)
// Notes:
// • Keeps your full UI intact.
// • Normalizes the route param so ":slug" or blank won't be used.
// • If slug is invalid, shows AccessHelp (no endless spinner) and passes no bogus slug.
// • "Request Access" will include the REAL slug only when valid.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";
import { useTicketsRealtime } from "../hooks/useTicketsRealtime";

/** ========= Types ========= */
type Hotel = { id: string; name: string; slug: string; city: string | null };

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

type LiveOrder = { id: string; created_at: string; status: string; price: number | null };

type StaffPerf = {
  name: string;
  orders_served: number;
  avg_rating_30d: number | null;
  avg_completion_min: number | null;
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

/** ========= Tone helpers ========= */
function toneClass(tone: "green" | "amber" | "red" | "grey") {
  return {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    grey: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  }[tone];
}
function StatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "red" | "grey" }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs ${toneClass(tone)}`}>{label}</span>;
}

function occupancyTone(pct?: number | null): "green" | "amber" | "red" | "grey" {
  if (pct == null || Number.isNaN(pct)) return "grey";
  if (pct < 40) return "red";
  if (pct < 60) return "amber";
  if (pct <= 80) return "green";
  if (pct <= 95) return "amber";
  return "red";
}
function slaTone(pctOnTime: number): "green" | "amber" | "red" {
  if (pctOnTime >= 85) return "green";
  if (pctOnTime >= 70) return "amber";
  return "red";
}

/** ========= Small helpers to sanitize slug ========= */
function normalizeSlug(raw?: string) {
  const s = (raw || "").trim();
  if (!s || s === ":slug") return ""; // treat placeholder as missing
  return s;
}

/** ========= Page ========= */
export default function OwnerDashboard() {
  const paramsHook = useParams();
  const rawSlug = paramsHook.slug;
  const slug = normalizeSlug(rawSlug);

  // NEW: subscribe to tickets for this property and keep KPIs refreshed
  useTicketsRealtime(slug);

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
        setArrivals([]);
        setInhouse([]);
        setDepartures([]);
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
        setArrivals([]);
        setInhouse([]);
        setDepartures([]);
      }

      // 3) Rooms count (non-blocking)
      try {
        const { data: rooms } = await supabase.from("rooms").select("id").eq("hotel_id", hotelId);
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
        setSlaTargetMin(sla?.target_minutes ?? 20);
        setLiveOrders(orders || []);
      } catch {
        setSlaTargetMin(20);
        setLiveOrders([]);
      }

      // 6) Realtime KPI updates
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

      // 7) Optional RPCs
      if (HAS_FUNCS) {
        try {
          const { data } = await supabase.rpc("best_staff_performance_for_slug", { p_slug: slug });
          if (alive) setStaffPerf(data ?? null);
        } catch {
          setStaffPerf(null);
        }
        try {
          const { data } = await supabase.rpc("hrms_snapshot_for_slug", { p_slug: slug });
          if (alive) setHrms((data && data[0]) ?? null);
        } catch {
          setHrms(null);
        }
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
      <main className="max-w-3xl mx_auto p-6">
        <BackHome />
        {/* pass only the sanitized slug so we never forward ':slug' */}
        <AccessHelp slug={slug} message={accessProblem} inviteToken={params.get("invite") || undefined} />
      </main>
    );
  }
  if (!hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <div className="rounded-xl border p-6 text-center">
          <div className="text-lg font-medium mb-2">No property to show</div>
          <p className="text-sm text-gray-600">Open your property from the Owner Home.</p>
          <div className="mt-4">
            <Link to="/owner" className="btn btn-light">
              Owner Home
            </Link>
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

  const occTone = occupancyTone(occPct);

  /** ======= Render ======= */
  return (
    <main className="max-w-6xl mx-auto p-6">
      <BackHome />

      {/* Header */}
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{hotel.name}</h1>
          {hotel.city ? <p className="text-sm text-muted-foreground">{hotel.city}</p> : null}
          <p className="text-xs text-muted-foreground mt-1">
            Your daily control room: see what needs attention, who’s shining, and how to boost tonight’s revenue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/owner/${hotel.slug}/pricing`} className="btn btn-light">
            Open pricing
          </Link>
          <Link to={`/owner/${hotel.slug}/hrms`} className="btn">
            HRMS
          </Link>
          <Link to={`/owner/${hotel.slug}/settings`} className="btn btn-light">
            Settings
          </Link>
        </div>
      </header>

      {/* Today at a glance */}
      <section className="mb-2">
        <SectionHeader title="Today at a glance" desc="Quick pulse for today. Green is healthy; orange needs a nudge." />
        <KpiRow
          items={[
            {
              label: "Occupancy",
              value: `${occPct}%`,
              sub: `${occupied}/${total} rooms · 60–80% is healthy`,
              tone: occTone,
              link: `/owner/${hotel.slug}/rooms`,
              linkLabel: "See rooms",
            },
            {
              label: "ADR (Average Daily Rate)",
              value: `₹${adr.toFixed(0)}`,
              sub: "Today’s average price per occupied room",
              tone: "grey",
              link: `/owner/${hotel.slug}/revenue/adr`,
              linkLabel: "Open ADR",
            },
            {
              label: "RevPAR (Revenue Per Available Room)",
              value: `₹${revpar.toFixed(0)}`,
              sub: "Revenue ÷ total rooms (today)",
              tone: "grey",
              link: `/owner/${hotel.slug}/revenue/revpar`,
              linkLabel: "Open RevPAR",
            },
            {
              label: "Pick-up (7 days)",
              value: pickup7d,
              sub: "New nights added in the last week",
              tone: "grey",
              link: `/owner/${hotel.slug}/bookings/pickup?window=7d`,
              linkLabel: "View pick-up",
            },
          ]}
        />
      </section>

      {/* Pricing nudge */}
      <PricingNudge
        occupancy={occPct}
        suggestion={`Consider raising tonight’s base rate by ₹${suggestedBump(occPct)} to capture late demand.`}
        ctaTo={`/owner/${hotel.slug}/pricing`}
      />

      {/* Live ops */}
      <section className="grid gap-4 lg:grid-cols-3 mb-6">
        <SlaCard targetMin={slaTargetMin ?? 20} orders={liveOrders} />
        <LiveOrdersPanel orders={liveOrders} targetMin={slaTargetMin ?? 20} className="lg:col-span-2" />
      </section>

      {/* People & HRMS preview */}
      <section className="grid gap-4 lg:grid-cols-2 mb-6">
        <StaffPerformancePanel data={staffPerf} />
        <HrmsPanel data={hrms} slug={hotel.slug} />
      </section>

      {/* Outlook & HK */}
      <section className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2">
          <OccupancyHeatmap title="Booking curve (6-week view)" desc="See pacing vs target; add offers on soft nights." />
        </div>
        <HousekeepingProgress slug={hotel.slug} readyPct={Math.min(occPct, 100)} />
      </section>

      {/* Arrivals / In-house / Departures */}
      <section className="grid gap-4 md:grid-cols-3">
        <Board title="Arrivals today" desc="Who’s expected today — assign rooms in advance." items={arrivals} empty="No arrivals today." />
        <Board title="In-house" desc="Guests currently staying with you." items={inhouse} empty="No guests are currently in-house." />
        <Board title="Departures today" desc="Who’s checking out — plan housekeeping turns." items={departures} empty="No departures today." />
      </section>

      {/* Footer */}
      <footer className="mt-8">
        <div className="rounded-2xl border p-4 flex items-center justify-between bg-white">
          <div>
            <div className="font-medium">Need help or want to improve results?</div>
            <div className="text-sm text-muted-foreground">Our team can review your numbers and suggest quick wins.</div>
          </div>
          <a href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help" className="btn">
            Contact us
          </a>
        </div>
      </footer>
    </main>
  );
}

/** ========= Components ========= */
function SectionHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function KpiRow({
  items,
}: {
  items: { label: string; value: string | number; sub?: string; tone?: "green" | "amber" | "red" | "grey"; link?: string; linkLabel?: string }[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-muted-foreground">{k.label}</div>
              <div className="text-2xl font-semibold mt-1 flex items-center gap-2">
                <span>{k.value}</span>
                {k.tone && (
                  <StatusBadge
                    label={k.tone === "green" ? "Healthy" : k.tone === "amber" ? "Watch" : k.tone === "red" ? "Action" : "N/A"}
                    tone={k.tone}
                  />
                )}
              </div>
              {k.sub ? <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div> : null}
              {k.link && (
                <div className="mt-2">
                  <Link to={k.link} className="text-xs underline">
                    {k.linkLabel || "View details"}
                  </Link>
                </div>
              )}
            </div>
            <MiniSparkline />
          </div>
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

function PricingNudge({ occupancy, suggestion, ctaTo }: { occupancy: number; suggestion: string; ctaTo: string }) {
  const tone = occupancy >= 80 ? "Great momentum!" : occupancy >= 40 ? "Room to grow." : "Let’s boost pick-up.";
  return (
    <section className="mb-6 rounded-2xl border bg-gradient-to-r from-amber-50 to-white p-4">
      <SectionHeader title="Let’s boost tonight" desc="Small price moves can lift pick-up. Try this nudge and watch RevPAR." action={<Link to={ctaTo} className="btn">Open pricing</Link>} />
      <p className="text-gray-800">{suggestion}</p>
      <p className="text-xs text-muted-foreground mt-1">Tip: Auto-pricing can do this for you and report the uplift.</p>
    </section>
  );
}

function SlaCard({ targetMin, orders }: { targetMin: number; orders: LiveOrder[] }) {
  const total = orders.length;
  const onTime = orders.filter((o) => ageMin(o.created_at) <= targetMin).length;
  const pct = total ? Math.round((onTime / total) * 100) : 100;
  const tone = slaTone(pct);
  return (
    <div className="rounded-xl border bg-white p-4">
      <SectionHeader title="On-time delivery (SLA)" desc="How fast we’re closing requests today. Keep the green bar growing." />
      <div className="h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-2">
        {onTime}/{total} orders on time — Target: {targetMin} min
      </div>
    </div>
  );
}

function LiveOrdersPanel({ orders, targetMin, className = "" }: { orders: LiveOrder[]; targetMin: number; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${className}`}>
      <SectionHeader title="Live requests & orders" desc="What guests are asking for right now — jump in or assign to staff." action={<Link to="../ops" className="text-sm underline">Open operations</Link>} />
      {orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">No live requests right now — we’ll pop them here the moment something arrives.</div>
      ) : (
        <ul className="divide-y">
          {orders.map((o) => {
            const mins = ageMin(o.created_at);
            const breach = mins > targetMin;
            return (
              <li key={o.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm">#{o.id.slice(0, 8)} · {o.status}</div>
                  <div className="text-xs text-muted-foreground">Age: {mins} min</div>
                </div>
                <StatusBadge label={breach ? "SLA breach" : "On time"} tone={breach ? "red" : "green"} />
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
      <SectionHeader title="Staff leaderboard" desc="Top performers by order volume, rating, and speed — celebrate wins and coach the rest." />
      {!data || data.length === 0 ? (
        <div className="text-sm text-muted-foreground">We need a bit more activity to rank fairly — check back after a few days.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-left text-muted-foreground">
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
    </div>
  );
}

function HrmsPanel({ data, slug }: { data: HrmsSnapshot | null; slug: string }) {
  if (!data) {
    return (
      <div className="rounded-xl border bg-white p-4">
        <SectionHeader
          title="Attendance snapshot"
          desc="Presence pattern over the last 30 days — spot gaps early."
          action={<Link to={`/owner/${slug}/hrms`} className="text-sm underline">Open HRMS</Link>}
        />
        <div className="text-sm text-muted-foreground">Not connected to HR yet. We’re using activity-based presence as a proxy.</div>
      </div>
    );
  }
  const { staff_total, present_today, late_today, absent_today, attendance_pct_today, absences_7d, staff_with_absence_7d } = data;
  return (
    <div className="rounded-xl border bg-white p-4">
      <SectionHeader
        title="Attendance snapshot"
        desc="Presence pattern over the last 30 days — spot gaps early."
        action={<Link to={`/owner/${slug}/hrms/attendance`} className="text-sm underline">See details</Link>}
      />
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Metric label="Total staff" value={staff_total} />
        <Metric label="Present today" value={present_today} />
        <Metric label="Late today" value={late_today} />
        <Metric label="Absent today" value={absent_today} />
        <Metric label="Attendance %" value={`${attendance_pct_today}%`} />
        <Metric label="Absence days (7d)" value={absences_7d} />
      </div>
      <div className="text-xs text-muted-foreground mt-2">{staff_with_absence_7d} staff had at least one absence in 7 days.</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3 bg-gray-50">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function OccupancyHeatmap({ title, desc }: { title: string; desc?: string }) {
  const weeks = 6,
    days = 7;
  return (
    <div className="rounded-xl border bg-white p-4">
      <SectionHeader title={title} desc={desc} action={<Link to="../bookings/calendar" className="text-sm underline">Open calendar</Link>} />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * days }).map((_, i) => (
          <div key={i} className="aspect-square rounded-md bg-gray-100" style={{ opacity: 0.6 + 0.4 * Math.sin((i % 7) / 7) }} title="Occupancy placeholder" />
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">Deeper calendar with real data coming next.</div>
    </div>
  );
}

function HousekeepingProgress({ slug, readyPct }: { slug: string; readyPct: number }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <SectionHeader
        title="Room readiness"
        desc="How many rooms are ready for check-in — and what’s blocking the rest."
        action={<Link to={`/owner/${slug}/housekeeping`} className="text-sm underline">Open HK</Link>}
      />
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${readyPct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-2">{readyPct}% rooms ready</div>
    </div>
  );
}

function Board({ title, desc, items, empty }: { title: string; desc?: string; items: StayRow[]; empty: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <SectionHeader title={title} desc={desc} />
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.room ? `Room ${s.room}` : "Unassigned room"}</div>
                  <div className="text-muted-foreground text-xs">
                    {fmt(s.check_in_start)} → {fmt(s.check_out_end)}
                  </div>
                </div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.status || "—"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccessHelp({ slug, message, inviteToken }: { slug: string; message: string; inviteToken?: string }) {
  const hasValidSlug = !!normalizeSlug(slug);
  return (
    <div className="rounded-2xl border p-6 bg-amber-50">
      <div className="text-lg font-semibold mb-1">Property access needed</div>
      <p className="text-sm text-amber-900 mb-4">{message}</p>
      <div className="flex flex-wrap gap-2">
        {hasValidSlug ? (
          <Link to={`/owner/access?slug=${encodeURIComponent(slug)}`} className="btn">
            Request Access
          </Link>
        ) : null}
        <Link to="/owner" className="btn btn-light">
          Owner Home
        </Link>
        <Link to="/invite/accept" className="btn btn-light">
          Accept Invite
        </Link>
        {inviteToken ? (
          <Link to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`} className="btn btn-light">
            Accept via Code
          </Link>
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
