// web/src/routes/OwnerDashboard.tsx — ultra-premium owner dashboard
// NOTE: All data fetching / Supabase / hooks logic is preserved;
// we only add AI Ops Co-pilot (heatmap + staffing) and light feature flags
// so unfinished modules don’t send users to 404s.

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useSearchParams, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";
import { useTicketsRealtime } from "../hooks/useTicketsRealtime";
import UsageMeter from "../components/UsageMeter";
import {
  fetchOpsHeatmap,
  fetchStaffingPlan,
  type OpsHeatmapPoint,
  type StaffingPlanRow,
} from "../lib/api";

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

// RPC types
type VipStay = {
  stay_id: string;
  room: string | null;
  is_vip: boolean;
  has_open_complaint: boolean;
  needs_courtesy_call: boolean;
  check_in_start: string | null;
  check_out_end: string | null;
};

type EventRow = {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue: string | null;
  status: string;
  risk_status: string;
  progress_pct: number;
};

type NpsSnapshot = {
  hotel_id: string;
  total_responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps_30d: number | null;
};

type WorkforceJobSummary = {
  id: string;
  title?: string | null;
  department?: string | null;
  status?: string | null;
  city?: string | null;
  created_at?: string | null;
};

type DrawerKind = "pickup" | "opsBoard" | "rushRooms" | "vipList";
type DrawerState = { kind: DrawerKind };

/** ========= Feature flags ========= */
const HAS_FUNCS = import.meta.env.VITE_HAS_FUNCS === "true";
// New: feature flags so unfinished modules don’t cause 404s
const HAS_REVENUE = import.meta.env.VITE_HAS_REVENUE === "true";
const HAS_HRMS = import.meta.env.VITE_HAS_HRMS === "true";
const HAS_PRICING = import.meta.env.VITE_HAS_PRICING === "true";
const HAS_CALENDAR = import.meta.env.VITE_HAS_CALENDAR === "true";
const HAS_WORKFORCE = import.meta.env.VITE_HAS_WORKFORCE === "true";

/** ========= Tone helpers ========= */
function toneClass(tone: "green" | "amber" | "red" | "grey") {
  return {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    grey: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  }[tone];
}
function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "red" | "grey";
}) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${toneClass(tone)}`}>
      {label}
    </span>
  );
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

  // ✅ Subscribe to tickets for this property and keep KPIs refreshed
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

  // New RPC-backed state
  const [vipStays, setVipStays] = useState<VipStay[] | null>(null);
  const [eventsToday, setEventsToday] = useState<EventRow[] | null>(null);
  const [npsSnapshot, setNpsSnapshot] = useState<NpsSnapshot | null>(null);

  // Workforce snapshot (owner view)
  const [workforceJobs, setWorkforceJobs] = useState<WorkforceJobSummary[] | null>(null);
  const [workforceLoading, setWorkforceLoading] = useState(false);

  // NEW: AI Ops Co-pilot state (heatmap + staffing recommendations)
  const [opsHeatmap, setOpsHeatmap] = useState<OpsHeatmapPoint[] | null>(null);
  const [staffingPlan, setStaffingPlan] = useState<StaffingPlanRow[] | null>(
    null
  );
  const [opsLoading, setOpsLoading] = useState(false);

  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const inviteToken = params.get("invite");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // One-touch actions drawer
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

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
      setWorkforceJobs(null);
      setWorkforceLoading(false);

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
        const nowIso = new Date().toISOString();
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
            .lte("check_in_start", nowIso)
            .gte("check_out_end", nowIso)
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
        const { data: rooms } = await supabase
          .from("rooms")
          .select("id")
          .eq("hotel_id", hotelId);
        if (!alive) return;
        setTotalRooms(rooms?.length || 0);
      } catch {
        setTotalRooms(0);
      }

      // 4) KPI initial load (from cache table / materialized view)
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
          {
            event: "*",
            schema: "public",
            table: "owner_dashboard_kpis",
            filter: `hotel_id=eq.${hotelId}`,
          },
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
          const { data } = await supabase.rpc(
            "best_staff_performance_for_slug",
            { p_slug: slug }
          );
          if (alive) setStaffPerf(data ?? null);
        } catch {
          if (alive) setStaffPerf(null);
        }
        try {
          const { data } = await supabase.rpc("hrms_snapshot_for_slug", {
            p_slug: slug,
          });
          if (alive) setHrms((data && data[0]) ?? null);
        } catch {
          if (alive) setHrms(null);
        }
        // NEW: VIP arrivals
        try {
          const { data } = await supabase.rpc("vip_arrivals_for_slug", {
            p_slug: slug,
          });
          if (alive) setVipStays(data ?? []);
        } catch {
          if (alive) setVipStays([]);
        }
        // NEW: Events today
        try {
          const { data } = await supabase.rpc("events_today_for_slug", {
            p_slug: slug,
          });
          if (alive) setEventsToday(data ?? []);
        } catch {
          if (alive) setEventsToday([]);
        }
        // NEW: NPS snapshot
        try {
          const { data } = await supabase.rpc("owner_nps_for_slug", {
            p_slug: slug,
          });
          if (alive) setNpsSnapshot(data && data[0] ? data[0] : null);
        } catch {
          if (alive) setNpsSnapshot(null);
        }
      }



            // 8) Workforce snapshot (owner; optional)
      if (HAS_WORKFORCE) {
        try {
          setWorkforceLoading(true);

          const { data } = await supabase
            .from("workforce_jobs")
            .select("*")
            .eq("property_id", hotelId)
            .order("created_at", { ascending: false })
            .limit(10);

          if (alive) {
            setWorkforceJobs((data as WorkforceJobSummary[]) ?? []);
          }
        } catch {
          if (alive) {
            setWorkforceJobs([]);
          }
        } finally {
          if (alive) {
            setWorkforceLoading(false);
          }
        }
      } else {
        if (alive) {
          setWorkforceJobs(null);
          setWorkforceLoading(false);
        }
      }

      

      setLoading(false);
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [slug, today]);

  // NEW: AI Ops Co-pilot fetch (heatmap + staffing), purely additive
  useEffect(() => {
    if (!hotel?.id || !HAS_FUNCS) {
      // if functions are off, keep this section in "preview" mode
      setOpsHeatmap(null);
      setStaffingPlan(null);
      return;
    }

    let alive = true;

    (async () => {
      setOpsLoading(true);
      try {
        const now = new Date();
        const to = now.toISOString();
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        const fromIso = from.toISOString();

        const [heat, plan] = await Promise.all([
          fetchOpsHeatmap({
            hotelId: hotel.id,
            from: fromIso,
            to,
          }),
          fetchStaffingPlan({
            hotelId: hotel.id,
            date: today,
          }),
        ]);

        if (!alive) return;
        setOpsHeatmap(heat ?? []);
        setStaffingPlan(plan ?? []);
      } catch {
        if (!alive) return;
        // degrade gracefully if backend route is not ready yet
        setOpsHeatmap([]);
        setStaffingPlan([]);
      } finally {
        if (!alive) return;
        setOpsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [hotel?.id, today]);

  /** ======= UI States ======= */
  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center bg-slate-50">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }
  if (accessProblem) {
    return (
      <main className="max-w-3xl mx-auto p-6 bg-slate-50">
        <BackHome />
        {/* pass only the sanitized slug so we never forward ':slug' */}
        <AccessHelp
          slug={slug}
          message={accessProblem}
          inviteToken={inviteToken || undefined}
        />
      </main>
    );
  }
  if (!hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center bg-slate-50">
        <div className="rounded-xl border p-6 text-center bg-white shadow-sm">
          <div className="text-lg font-medium mb-2">No property to show</div>
          <p className="text-sm text-gray-600">
            Open your property from the Owner Home.
          </p>
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

  const targetMin = slaTargetMin ?? 20;
  const ordersTotal = liveOrders.length;
  const ordersOnTime = liveOrders.filter(
    (o) => ageMin(o.created_at) <= targetMin
  ).length;
  const ordersOverdue = liveOrders.filter(
    (o) => ageMin(o.created_at) > targetMin
  ).length;
  const slaPct = ordersTotal
    ? Math.round((ordersOnTime / ordersTotal) * 100)
    : 100;
  const slaToneLevel = slaTone(slaPct);

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const nightsOnBooks = occupied + pickup7d;

  // NEW: derived VIP / events / NPS
  const vipCount = vipStays?.length ?? 0;
  const eventsCount = eventsToday?.length ?? 0;
  const npsScore =
    typeof npsSnapshot?.nps_30d === "number"
      ? Math.round(npsSnapshot.nps_30d)
      : undefined;
  const npsResponses = npsSnapshot?.total_responses ?? 0;

  /** ======= Render ======= */
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-4 lg:px-6 lg:py-6 space-y-5">
        {/* Top bar / identity */}
        <OwnerTopBar
          hotel={hotel}
          slug={hotel.slug}
          dateLabel={dateLabel}
          timeLabel={timeLabel}
        />

        {/* Hero: Today’s Pulse */}
        <PulseStrip
          hotelName={hotel.name}
          city={hotel.city}
          occPct={occPct}
          occupied={occupied}
          totalRooms={total}
          arrivalsCount={arrivals.length}
          departuresCount={departures.length}
          revenueToday={revenueToday}
          adr={adr}
          revpar={revpar}
          pickup7d={pickup7d}
          slaPct={slaPct}
          slaTone={slaToneLevel}
          ordersTotal={ordersTotal}
          ordersOverdue={ordersOverdue}
          hrms={hrms}
          npsScore={npsScore}
          npsResponses={npsResponses}
          vipCount={vipCount}
          eventCount={eventsCount}
          onOpenDrawer={(kind) => setDrawer({ kind })}
        />

        {/* Detail KPIs strip */}
        <KpiStrip
          slug={hotel.slug}
          occPct={occPct}
          occTone={occTone}
          occupied={occupied}
          total={total}
          adr={adr}
          revpar={revpar}
          pickup7d={pickup7d}
          slaPct={slaPct}
          nightsOnBooks={nightsOnBooks}
        />

        {/* Middle section: Live Ops (L) + Performance (R) */}
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2 space-y-4">
            <LiveOpsColumn
              arrivals={arrivals}
              inhouse={inhouse}
              departures={departures}
            />
          </div>
          <PerformanceColumn
            slug={hotel.slug}
            revenueToday={revenueToday}
            adr={adr}
            revpar={revpar}
            pickup7d={pickup7d}
            occPct={occPct}
            kpi={kpi}
            npsScore={npsScore}
            npsResponses={npsResponses}
            vipStays={vipStays}
            eventsToday={eventsToday}
          />
        </section>

        {/* Ops & SLA row */}
        <section className="grid gap-4 lg:grid-cols-3">
          <SlaCard targetMin={targetMin} orders={liveOrders} />
          <LiveOrdersPanel
            orders={liveOrders}
            targetMin={targetMin}
            hotelId={hotel.id} // ✅ pass hotel.id so /ops?hotelId=… works
            className="lg:col-span-1"
          />
          <AttentionServicesCard orders={liveOrders} />
        </section>

        {/* Staff, HR & Workforce row */}
        <section className="grid gap-4 lg:grid-cols-3">
          <StaffPerformancePanel data={staffPerf} />
          <HrmsPanel data={hrms} slug={hotel.slug} />
          <div className="space-y-4">
            <OwnerTasksPanel occPct={occPct} kpi={kpi} slug={hotel.slug} />
            <OwnerWorkforcePanel
              slug={hotel.slug}
              jobs={workforceJobs}
              loading={workforceLoading}
            />
          </div>
        </section>

        {/* AI Ops Co-pilot (new, additive) */}
        <AiOpsSection
          hotelId={hotel.id}
          heatmap={opsHeatmap}
          staffingPlan={staffingPlan}
          loading={opsLoading}
        />

        {/* AI usage */}
        <section className="rounded-2xl border border-slate-100 bg-white/80 px-4 py-4 shadow-sm lg:px-5 lg:py-5">
          <SectionHeader
            title="AI helper usage"
            desc="Track how much of your monthly AI budget this property has used."
            action={
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                Owner view
              </span>
            }
          />
          <UsageMeter hotelId={hotel.id} />
        </section>

        {/* Outlook & Housekeeping */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OccupancyHeatmap
              title="Booking curve (6-week view)"
              desc="See pacing vs target; add offers on soft nights."
            />
          </div>
          <HousekeepingProgress
            slug={hotel.slug}
            readyPct={Math.min(occPct, 100)}
          />
        </section>

        {/* Bottom “Today at a glance” strip */}
        <TodayBottomStrip occPct={occPct} hrms={hrms} />

        {/* Support footer */}
        <footer className="pt-2">
          <OwnerSupportFooter />
        </footer>
      </div>

      {/* One-touch Action Drawer (stub for now) */}
      <ActionDrawer state={drawer} onClose={() => setDrawer(null)} />
    </main>
  );
}

/** ========= High-level layout components ========= */

function OwnerTopBar({
  hotel,
  slug,
  dateLabel,
  timeLabel,
}: {
  hotel: Hotel;
  slug: string;
  dateLabel: string;
  timeLabel: string;
}) {
  return (
    <header className="flex flex-col gap-3 rounded-3xl border border-slate-100 bg-white/90 px-3 py-3 shadow-sm shadow-slate-200/60 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
      {/* BackHome is rendered by layout; keep this space clean */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              {hotel.name}
            </h1>
            {hotel.city && (
              <span className="text-xs rounded-full bg-slate-50 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200">
                {hotel.city}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Owner Dashboard is a single-window command center for GMs and duty
            managers. In under 10 seconds they see the hotel’s health; in 1–2
            taps they can fix issues, reward staff, or protect revenue.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {dateLabel} · Local time {timeLabel}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <input
            className="h-8 w-full rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 sm:w-56"
            placeholder="Search guest, room, booking, ticket…"
          />
          <Link
            to="/owner"
            className="hidden rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 sm:inline-flex"
          >
            Switch property
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {HAS_PRICING && (
            <Link
              to={`/owner/${slug}/pricing`}
              className="btn btn-light h-8 text-xs"
            >
              Open pricing
            </Link>
          )}
          {HAS_HRMS && (
            <Link
              to={`/owner/${slug}/hrms`}
              className="btn btn-light h-8 text-xs"
            >
              HRMS
            </Link>
          )}
          <Link
            to={`/owner/${slug}/settings`}
            className="btn btn-light h-8 text-xs"
          >
            Settings
          </Link>
          <div className="flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-50">
              EM
            </div>
            <div className="leading-tight">
              <div className="text-xs font-medium text-slate-50">
                Emma — GM
              </div>
              <div className="text-[10px] text-slate-300">
                General Manager view
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function PulseStrip({
  hotelName,
  city,
  occPct,
  occupied,
  totalRooms,
  arrivalsCount,
  departuresCount,
  revenueToday,
  adr,
  revpar,
  pickup7d,
  slaPct,
  slaTone,
  ordersTotal,
  ordersOverdue,
  hrms,
  npsScore,
  npsResponses,
  vipCount,
  eventCount,
  onOpenDrawer,
}: {
  hotelName: string;
  city: string | null;
  occPct: number;
  occupied: number;
  totalRooms: number;
  arrivalsCount: number;
  departuresCount: number;
  revenueToday: number;
  adr: number;
  revpar: number;
  pickup7d: number;
  slaPct: number;
  slaTone: "green" | "amber" | "red";
  ordersTotal: number;
  ordersOverdue: number;
  hrms: HrmsSnapshot | null;
  npsScore?: number;
  npsResponses?: number;
  vipCount: number;
  eventCount: number;
  onOpenDrawer: (kind: DrawerKind) => void;
}) {
  const effectiveNps = typeof npsScore === "number" ? npsScore : 78;
  const effectiveResponses = npsResponses ?? 0;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-r from-sky-50 via-slate-50 to-emerald-50 px-4 py-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)] lg:px-6 lg:py-5">
      <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
      <div className="absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-sm">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-sky-700">
            Today’s pulse
          </div>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-900 lg:text-2xl">
            {hotelName}
            {city ? ` · ${city}` : ""} — today at a glance.
          </h2>
          <p className="mt-2 text-xs text-slate-600">
            At-a-glance health, one-touch fixes, zero hunting. Everything that
            matters today lives on this screen.
          </p>
        </div>
        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PulseTile
            label="Occupancy & rooms"
            primary={`${occPct || 0}% occupied`}
            secondary={`${occupied}/${totalRooms || 0} rooms · ${arrivalsCount} arrivals · ${departuresCount} departures`}
            badgeLabel="Action"
            badgeTone={occupancyTone(occPct)}
          />
          <PulseTile
            label="Revenue snapshot"
            primary={`₹${revenueToday.toFixed(0)} today`}
            secondary={`ADR ₹${adr.toFixed(0)} · RevPAR ₹${revpar.toFixed(0)}`}
            actionLabel={HAS_REVENUE ? "View pickup" : undefined}
            onAction={HAS_REVENUE ? () => onOpenDrawer("pickup") : undefined}
          />
          <PulseTile
            label="Guest experience"
            primary={`NPS ~${effectiveNps}`}
            secondary={
              effectiveResponses > 0
                ? `${effectiveResponses} responses (last 30 days)`
                : "Live rating & escalations"
            }
            badgeLabel="Guest"
            badgeTone="green"
          />
          <PulseTile
            label="Ops & service tickets"
            primary={`${ordersTotal} open tasks`}
            secondary={`${ordersOverdue} overdue · SLA ${slaPct}%`}
            actionLabel="Open ops board"
            onAction={() => onOpenDrawer("opsBoard")}
            badgeTone={slaTone}
            badgeLabel={
              slaTone === "green"
                ? "On track"
                : slaTone === "amber"
                ? "Watch"
                : "Risk"
            }
          />
          <PulseTile
            label="Housekeeping status"
            primary={`${Math.min(occPct, 100)}% rooms ready`}
            secondary={`Based on today’s occupancy; detailed HK board in Housekeeping`}
            actionLabel="Rush rooms"
            onAction={() => onOpenDrawer("rushRooms")}
          />
          <PulseTile
            label="Events & VIPs"
            primary={`${eventCount} events · ${vipCount} VIP arrivals`}
            secondary={
              eventCount + vipCount > 0
                ? "Tap to see today’s VIPs & events."
                : "Connect events & VIP list to see early alerts."
            }
            actionLabel="View VIP list"
            onAction={() => onOpenDrawer("vipList")}
          />
        </div>
      </div>
    </section>
  );
}

function PulseTile({
  label,
  primary,
  secondary,
  badgeLabel,
  badgeTone = "grey",
  actionLabel,
  onAction,
}: {
  label: string;
  primary: string;
  secondary: string;
  badgeLabel?: string;
  badgeTone?: "green" | "amber" | "red" | "grey";
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="relative flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/90 p-3 shadow-sm shadow-slate-200/60 backdrop-blur-sm transition-shadow hover:shadow-lg">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-slate-500">
            {label}
          </div>
          {badgeLabel && (
            <StatusBadge label={badgeLabel} tone={badgeTone} />
          )}
        </div>
        <div className="mt-1 text-lg font-semibold text-slate-900">
          {primary}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          {secondary}
        </p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 inline-flex items-center text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
        >
          {actionLabel}
          <span aria-hidden="true" className="ml-1">
            →
          </span>
        </button>
      )}
    </div>
  );
}

function KpiStrip({
  slug,
  occPct,
  occTone,
  occupied,
  total,
  adr,
  revpar,
  pickup7d,
  slaPct,
  nightsOnBooks,
}: {
  slug: string;
  occPct: number;
  occTone: "green" | "amber" | "red" | "grey";
  occupied: number;
  total: number;
  adr: number;
  revpar: number;
  pickup7d: number;
  slaPct: number;
  nightsOnBooks: number;
}) {
  return (
    <section>
      <SectionHeader
        title="Detail KPIs"
        desc="For owners who love the numbers — occupancy, revenue, SLA and on-books in one tight strip."
      />
      <KpiRow
        items={[
          {
            label: "Occupancy",
            value: `${occPct}%`,
            sub: `${occupied}/${total} rooms · 60–80% is healthy`,
            tone: occTone,
            link: `/owner/${slug}/rooms`,
            linkLabel: "See rooms",
          },
          {
            label: "ADR (Average Daily Rate)",
            value: `₹${adr.toFixed(0)}`,
            sub: "Today’s average price per occupied room",
            tone: "grey",
            link: HAS_REVENUE ? `/owner/${slug}/revenue/adr` : undefined,
            linkLabel: HAS_REVENUE ? "Open ADR" : undefined,
          },
          {
            label: "RevPAR (Revenue Per Available Room)",
            value: `₹${revpar.toFixed(0)}`,
            sub: "Revenue ÷ total rooms (today)",
            tone: "grey",
            link: HAS_REVENUE ? `/owner/${slug}/revenue/revpar` : undefined,
            linkLabel: HAS_REVENUE ? "Open RevPAR" : undefined,
          },
          {
            label: "Pick-up (7 days)",
            value: pickup7d,
            sub: "New room nights added in the last week",
            tone: "grey",
            link: HAS_REVENUE
              ? `/owner/${slug}/bookings/pickup?window=7d`
              : undefined,
            linkLabel: HAS_REVENUE ? "View pick-up" : undefined,
          },
          {
            label: "SLA on-time",
            value: `${slaPct}%`,
            sub: "Orders closed within target time today",
            tone: slaTone(slaPct),
          },
          {
            label: "Nights on books (next 7d)",
            value: nightsOnBooks,
            sub: "Approx. rooms on the books vs new pick-up",
            tone: "grey",
          },
        ]}
      />
    </section>
  );
}

function LiveOpsColumn({
  arrivals,
  inhouse,
  departures,
}: {
  arrivals: StayRow[];
  inhouse: StayRow[];
  departures: StayRow[];
}) {
  return (
    <section className="rounded-3xl border border-slate-100 bg-white/95 px-4 py-4 shadow-sm">
      <SectionHeader
        title="Live operations (today)"
        desc="Arrivals, in-house guests, and departures — your check-in/check-out timeline."
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Board
          title="Arrivals"
          desc="Who’s expected today — assign rooms in advance."
          items={arrivals}
          empty="No arrivals today."
        />
        <Board
          title="In-house"
          desc="Guests currently staying with you."
          items={inhouse}
          empty="No guests are currently in-house."
        />
        <Board
          title="Departures"
          desc="Who’s checking out — plan housekeeping turns."
          items={departures}
          empty="No departures today."
        />
      </div>
    </section>
  );
}

function PerformanceColumn({
  slug,
  revenueToday,
  adr,
  revpar,
  pickup7d,
  occPct,
  kpi,
  npsScore,
  npsResponses,
  vipStays,
  eventsToday,
}: {
  slug: string;
  revenueToday: number;
  adr: number;
  revpar: number;
  pickup7d: number;
  occPct: number;
  kpi: KpiRow | null;
  npsScore?: number;
  npsResponses?: number;
  vipStays: VipStay[] | null;
  eventsToday: EventRow[] | null;
}) {
  const rating = kpi?.avg_rating_30d ?? null;
  const fallbackNps =
    rating != null
      ? Math.min(100, Math.max(0, Math.round(rating * 20)))
      : 78;
  const npsDisplay = typeof npsScore === "number" ? npsScore : fallbackNps;
  const responsesDisplay = npsResponses ?? 0;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <SectionHeader
          title="Revenue & forecast"
          desc="Today vs budget and same day last year — simplified view."
          action={
            HAS_REVENUE ? (
              <Link
                to={`/owner/${slug}/revenue`}
                className="text-xs underline text-slate-700"
              >
                Open revenue view
              </Link>
            ) : null
          }
        />
        <div className="text-2xl font-semibold text-slate-900">
          ₹{revenueToday.toFixed(0)}
        </div>
        <div className="mt-1 text-xs text-slate-600">
          ADR ₹{adr.toFixed(0)} · RevPAR ₹{revpar.toFixed(
            0
          )} · Pick-up 7d {pickup7d}
        </div>
        <div className="mt-3 h-24 rounded-xl bg-gradient-to-r from-sky-100 via-emerald-100 to-amber-100 p-2">
          <div className="flex h-full items-end justify-between gap-1">
            {[40, 60, 55, 80, 70, 65, 75].map((h, i) => (
              <div
                key={i}
                className="w-3 rounded-t bg-emerald-500/80"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          This mini-chart gives a feel for revenue trend; detailed pacing &amp;
          segmentation live in the revenue module.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <SectionHeader
          title="Guest feedback & sentiment"
          desc="Live signal from ratings and feedback."
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">
              NPS ~{npsDisplay}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {responsesDisplay > 0
                ? `${responsesDisplay} responses in the last 30 days.`
                : "Based on last 30 days’ ratings. Detailed case list in the feedback view."}
            </div>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-emerald-400 bg-emerald-50 text-sm font-semibold text-emerald-700">
            {rating ? rating.toFixed(1) : "4.7"}
          </div>
        </div>
        <div className="mt-3 space-y-1 text-[11px] text-slate-600">
          <div>• 3 low ratings in the last few hours.</div>
          <div>• 2 open escalations waiting for call-back.</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <SectionHeader
          title="VIP & special attention"
          desc="Today’s VIPs, long-stays and guests with open complaints."
        />
        {(!vipStays || vipStays.length === 0) &&
        (!eventsToday || eventsToday.length === 0) ? (
          <div className="text-sm text-slate-500">
            Connect your CRM / PMS VIP flags to see a live list here. For now,
            use the guest list to manage special attention manually.
          </div>
        ) : (
          <div className="space-y-3 text-xs text-slate-700">
            {vipStays && vipStays.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-slate-900">
                  VIP arrivals & attention stays
                </div>
                <ul className="space-y-1">
                  {vipStays.slice(0, 4).map((v) => (
                    <li
                      key={v.stay_id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1"
                    >
                      <div>
                        <div className="font-medium">
                          {v.room ? `Room ${v.room}` : "Unassigned room"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {fmt(v.check_in_start)} → {fmt(v.check_out_end)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {v.is_vip && (
                          <StatusBadge label="VIP" tone="green" />
                        )}
                        {v.has_open_complaint && (
                          <StatusBadge label="Complaint" tone="amber" />
                        )}
                        {v.needs_courtesy_call && (
                          <StatusBadge label="Courtesy call" tone="grey" />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {eventsToday && eventsToday.length > 0 && (
              <div>
                <div className="mb-1 mt-2 font-semibold text-slate-900">
                  Events & banquets today
                </div>
                <ul className="space-y-1">
                  {eventsToday.slice(0, 3).map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1"
                    >
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {e.venue || "Venue TBC"} · {fmt(e.start_at)}
                        </div>
                      </div>
                      <StatusBadge
                        label={
                          e.risk_status === "risk"
                            ? "Risk"
                            : e.risk_status === "check"
                            ? "Check"
                            : "OK"
                        }
                        tone={
                          e.risk_status === "risk"
                            ? "red"
                            : e.risk_status === "check"
                            ? "amber"
                            : "green"
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** ========= Components (mostly existing, lightly tweaked) ========= */

function SectionHeader({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {desc && (
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function KpiRow({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    sub?: string;
    tone?: "green" | "amber" | "red" | "grey";
    link?: string;
    linkLabel?: string;
  }[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <div
          key={k.label}
          className="rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-lg"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                <span>{k.value}</span>
                {k.tone && (
                  <StatusBadge
                    label={
                      k.tone === "green"
                        ? "Healthy"
                        : k.tone === "amber"
                        ? "Watch"
                        : k.tone === "red"
                        ? "Action"
                        : "N/A"
                    }
                    tone={k.tone}
                  />
                )}
              </div>
              {k.sub ? (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {k.sub}
                </div>
              ) : null}
              {k.link && (
                <div className="mt-2">
                  <Link to={k.link} className="text-[11px] underline">
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
      <div className="absolute inset-0 rounded bg-gradient-to-tr from-emerald-500 to-indigo-500 opacity-20" />
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-1">
        {[4, 8, 3, 9, 6, 10, 7].map((h, i) => (
          <div
            key={i}
            className="w-1.5 rounded-t bg-emerald-500"
            style={{ height: `${h * 6}%` }}
          />
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
  const tone =
    occupancy >= 80
      ? "Great momentum!"
      : occupancy >= 40
      ? "Room to grow."
      : "Let’s boost pick-up.";
  return (
    <section className="mb-6 rounded-2xl border bg-gradient-to-r from-amber-50 to-white p-4">
      <SectionHeader
        title="Let’s boost tonight"
        desc="Small price moves can lift pick-up. Try this nudge and watch RevPAR."
        action={
          HAS_PRICING ? (
            <Link to={ctaTo} className="btn">
              Open pricing
            </Link>
          ) : null
        }
      />
      <p className="text-gray-800">{suggestion}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tip: Auto-pricing can do this for you and report the uplift.
      </p>
      <p className="mt-1 text-[11px] text-amber-700">{tone}</p>
    </section>
  );
}

function SlaCard({
  targetMin,
  orders,
}: {
  targetMin: number;
  orders: LiveOrder[];
}) {
  const total = orders.length;
  const onTime = orders.filter((o) => ageMin(o.created_at) <= targetMin).length;
  const pct = total ? Math.round((onTime / total) * 100) : 100;
  const tone = slaTone(pct);
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="On-time delivery (SLA)"
        desc="How fast we’re closing requests today. Keep the green bar growing."
      />
      <div className="h-2 rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full ${
            tone === "green"
              ? "bg-emerald-500"
              : tone === "amber"
              ? "bg-amber-500"
              : "bg-rose-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {onTime}/{total} orders on time — Target: {targetMin} min
      </div>
    </div>
  );
}

function LiveOrdersPanel({
  orders,
  targetMin,
  hotelId, // keeps the prop available for the link
  className = "",
}: {
  orders: LiveOrder[];
  targetMin: number;
  hotelId?: string | number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${className}`}>
      <SectionHeader
        title="Live requests & orders"
        desc="What guests are asking for right now — jump in or assign to staff."
        action={
          <Link
            to={
              hotelId
                ? `/ops?hotelId=${encodeURIComponent(String(hotelId))}`
                : "/ops"
            }
            className="text-sm underline"
          >
            Open operations
          </Link>
        }
      />
      {orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No live requests right now — we’ll pop them here the moment something
          arrives.
        </div>
      ) : (
        <ul className="divide-y">
          {orders.map((o) => {
            const mins = ageMin(o.created_at);
            const breach = mins > targetMin;
            return (
              <li
                key={o.id}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <div className="text-sm">
                    #{o.id.slice(0, 8)} · {o.status}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Age: {mins} min
                  </div>
                </div>
                <StatusBadge
                  label={breach ? "SLA breach" : "On time"}
                  tone={breach ? "red" : "green"}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AttentionServicesCard({ orders }: { orders: LiveOrder[] }) {
  const newCount = orders.filter((o) => o.status === "open").length;
  const inProgress = orders.filter((o) => o.status === "preparing").length;
  const others = orders.length - newCount - inProgress;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Services needing attention"
        desc="Quick snapshot of today’s request load by status."
      />
      {orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          We’ll show patterns here once more requests flow in.
        </div>
      ) : (
        <ul className="space-y-1 text-sm">
          <li className="flex items-center justify-between">
            <span>New</span>
            <span className="font-medium">{newCount}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>In progress</span>
            <span className="font-medium">{inProgress}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Other states</span>
            <span className="font-medium">{others}</span>
          </li>
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        In the next phase this will group by service type (in-room dining,
        housekeeping, engineering, etc.).
      </p>
    </div>
  );
}

function StaffPerformancePanel({ data }: { data: StaffPerf[] | null }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Staff leaderboard"
        desc="Top performers by order volume, rating, and speed — celebrate wins and coach the rest."
      />
      {!data || data.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          We need a bit more activity to rank fairly — check back after a few
          days.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                  <td className="py-1 pr-3 font-medium">
                    {r.performance_score ?? "—"}
                  </td>
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
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <SectionHeader
          title="Attendance snapshot"
          desc="Presence pattern over the last 30 days — spot gaps early."
          action={
            HAS_HRMS ? (
              <Link
                to={`/owner/${slug}/hrms`}
                className="text-sm underline"
              >
                Open HRMS
              </Link>
            ) : null
          }
        />
        <div className="text-sm text-muted-foreground">
          Not connected to HR yet. We’re using activity-based presence as a
          proxy.
        </div>
      </div>
    );
  }
  const {
    staff_total,
    present_today,
    late_today,
    absent_today,
    attendance_pct_today,
    absences_7d,
    staff_with_absence_7d,
  } = data;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Attendance snapshot"
        desc="Presence pattern over the last 30 days — spot gaps early."
        action={
          HAS_HRMS ? (
            <Link
              to={`/owner/${slug}/hrms/attendance`}
              className="text-sm underline"
            >
              See details
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Metric label="Total staff" value={staff_total} />
        <Metric label="Present today" value={present_today} />
        <Metric label="Late today" value={late_today} />
        <Metric label="Absent today" value={absent_today} />
        <Metric label="Attendance %" value={`${attendance_pct_today}%`} />
        <Metric label="Absence days (7d)" value={absences_7d} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {staff_with_absence_7d} staff had at least one absence in 7 days.
      </div>
    </div>
  );
}

function OwnerTasksPanel({
  occPct,
  kpi,
  slug,
}: {
  occPct: number;
  kpi: KpiRow | null;
  slug: string;
}) {
  const revenueToday = kpi?.revenue_today ?? 0;

  const tasks: string[] = [];
  if (occPct < 50) {
    tasks.push("Review weekend packages and push soft nights.");
  } else if (occPct > 80) {
    tasks.push("Increase rates slightly on high-demand nights.");
  } else {
    tasks.push("Monitor pacing; no urgent changes needed.");
  }
  if (revenueToday > 0) {
    tasks.push("Check top 5 services driving revenue today.");
  }
  if (HAS_WORKFORCE) {
    tasks.push(
      "Glance at open roles in Workforce to ensure staffing matches upcoming occupancy."
    );
  }
  tasks.push("Review any open low-rating stays and close the loop.");

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Owner tasks for today"
        desc="2–3 nudges that keep the property ahead of the curve."
        action={
          <div className="flex items-center gap-3">
            <Link
              to="/owner"
              className="text-xs underline text-slate-600"
            >
              Owner hub
            </Link>
            {HAS_WORKFORCE && (
              <Link
                to={`/owner/${slug}/workforce`}
                className="text-xs underline text-emerald-700"
              >
                Jobs & hiring
              </Link>
            )}
          </div>
        }
      />
      <ul className="space-y-1 text-xs text-slate-700">
        {tasks.map((t, i) => (
          <li key={i}>• {t}</li>
        ))}
      </ul>
    </div>
  );
}

function OwnerWorkforcePanel({
  slug,
  jobs,
  loading,
}: {
  slug: string;
  jobs: WorkforceJobSummary[] | null;
  loading: boolean;
}) {
  const hasFeature = HAS_WORKFORCE;
  const list = jobs ?? [];
  const openJobs = list.filter((j) =>
    (j.status || "open").toLowerCase().includes("open")
  ).length;

  if (!hasFeature) {
    return (
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <SectionHeader
          title="Local workforce (beta)"
          desc="Once enabled, this shows open roles and local applicants for this property."
        />
        <div className="text-xs text-muted-foreground">
          Workforce hiring beta is not enabled yet for this property. When
          switched on, you’ll see open roles, applicants and shortlists here.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Local workforce (beta)"
        desc="Quick view of open roles and hiring load."
        action={
          <Link
            to={`/owner/${slug}/workforce`}
            className="text-xs underline text-slate-600"
          >
            Open Workforce
          </Link>
        }
      />
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading roles…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No active roles yet. Create your first role in Workforce to start
          receiving nearby applicants.
        </div>
      ) : (
        <div className="space-y-2 text-xs text-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {openJobs} open role{openJobs === 1 ? "" : "s"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {list.length} total roles created for this property.
              </div>
            </div>
          </div>
          <ul className="space-y-1">
            {list.slice(0, 3).map((j) => {
              const status = (j.status || "open").toLowerCase();
              const isOpen =
                status.includes("open") || status === "draft";
              return (
                <li
                  key={j.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1"
                >
                  <div>
                    <div className="text-xs font-medium text-slate-900">
                      {j.title || j.department || "Role"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {(j.city || "").trim() || "Local"} ·{" "}
                      {j.status || "Open"}
                    </div>
                  </div>
                  <StatusBadge
                    label={isOpen ? "Hiring" : "Closed"}
                    tone={isOpen ? "green" : "grey"}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Applicant counts and shortlisting actions will appear here in the
            next update.
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

/** ========= AI Ops Co-pilot section (new) ========= */

function AiOpsSection({
  hotelId,
  heatmap,
  staffingPlan,
  loading,
}: {
  hotelId: string;
  heatmap: OpsHeatmapPoint[] | null;
  staffingPlan: StaffingPlanRow[] | null;
  loading: boolean;
}) {
  const hasPlan = !!(staffingPlan && staffingPlan.length);
  const hasHeatmap = !!(heatmap && heatmap.length);

  return (
    <section className="rounded-2xl border border-slate-100 bg-white/95 px-4 py-4 shadow-sm">
      <SectionHeader
        title="AI Ops Co-pilot (beta)"
        desc={
          HAS_FUNCS
            ? "Early-warning on overload and staffing risk, based on last 7 days of tickets."
            : "Turn on Supabase Functions to let VAiyu suggest staffing and highlight risky hours automatically."
        }
        action={
          <Link
            to={
              hotelId
                ? `/ops?hotelId=${encodeURIComponent(hotelId)}`
                : "/ops"
            }
            className="text-[11px] underline text-slate-700"
          >
            Open ops view
          </Link>
        }
      />
      <div className="grid gap-4 md:grid-cols-5">
        <div className="space-y-2 text-xs text-slate-700 md:col-span-2">
          {loading ? (
            <div className="text-xs text-slate-500">
              Analyzing last 7 days of tickets…
            </div>
          ) : hasPlan ? (
            <>
              <div className="font-semibold text-slate-900">
                Today’s suggested staffing bands
              </div>
              <ul className="space-y-1">
                {staffingPlan!.slice(0, 3).map((row) => (
                  <li
                    key={row.department}
                    className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1"
                  >
                    <div>
                      <div className="text-[11px] font-semibold text-slate-900">
                        {row.department}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Recommend {row.recommended_count} staff (min{" "}
                        {row.min_count}, max {row.max_count})
                      </div>
                      {row.reason && (
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          {row.reason}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">
                These are soft suggestions only. Final rosters stay under your
                HRMS / owner control.
              </p>
            </>
          ) : (
            <div className="text-xs text-slate-600">
              Once there’s enough recent ticket activity, this panel will
              suggest headcount bands per department. For now, use your standard
              roster and the HRMS attendance view.
            </div>
          )}
          {HAS_FUNCS && hasHeatmap && (
            <p className="text-[11px] text-emerald-700">
              Tip: Use this along with Ops board filters to smooth busy bands
              before SLAs slip.
            </p>
          )}
        </div>
        <div className="md:col-span-3">
          <AiOpsHeatmap heatmap={heatmap} loading={loading} />
        </div>
      </div>
    </section>
  );
}

function AiOpsHeatmap({
  heatmap,
  loading,
}: {
  heatmap: OpsHeatmapPoint[] | null;
  loading: boolean;
}) {
  const buckets = ["00–06", "06–12", "12–18", "18–24"];

  let zones: string[] = [];
  const matrix: Record<string, Record<string, number>> = {};

  if (heatmap && heatmap.length > 0) {
    const zoneTotals: Record<string, number> = {};
    for (const p of heatmap) {
      const zone = p.zone || "Other";
      const bucket = timeBucketFromISO(p.hour_bucket);
      if (!matrix[zone]) matrix[zone] = {};
      matrix[zone][bucket] =
        (matrix[zone][bucket] || 0) + (p.total_tickets ?? 0);
      zoneTotals[zone] = (zoneTotals[zone] || 0) + (p.total_tickets ?? 0);
    }
    zones = Object.keys(zoneTotals).sort(
      (a, b) => (zoneTotals[b] ?? 0) - (zoneTotals[a] ?? 0)
    );
    zones = zones.slice(0, 4);
  } else {
    // Fallback preview grid
    zones = ["Rooms", "F&B", "Front desk", "Engineering"];
    for (const z of zones) {
      matrix[z] = {};
    }
  }

  let maxValue = 0;
  for (const z of zones) {
    for (const b of buckets) {
      const v = matrix[z]?.[b] ?? 0;
      if (v > maxValue) maxValue = v;
    }
  }
  if (maxValue === 0) maxValue = 1;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500">
        {loading
          ? "Analyzing last 7 days of requests…"
          : "Darker cells ≈ more requests in that zone & time-band."}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/60 p-2">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left text-slate-500">
                Zone / Time
              </th>
              {buckets.map((b) => (
                <th
                  key={b}
                  className="px-1 py-1 text-center text-slate-500"
                >
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z}>
                <td className="py-1 pr-2 text-left text-slate-700">{z}</td>
                {buckets.map((b) => {
                  const v = matrix[z]?.[b] ?? 0;
                  const ratio = v / maxValue;
                  const opacity = v === 0 ? 0.08 : 0.2 + ratio * 0.7;
                  return (
                    <td key={b} className="px-1 py-1 text-center">
                      <div
                        className="flex h-6 items-center justify-center rounded bg-emerald-500 text-[10px] font-medium text-emerald-50"
                        style={{ opacity }}
                        title={
                          v > 0
                            ? `${v} request${v === 1 ? "" : "s"} in ${z}, ${b}`
                            : `No data yet in ${z}, ${b}`
                        }
                      >
                        {v > 0 ? v : "·"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        AI uses this pattern to suggest staffing and alert bands before SLAs
        slip. Detailed board lives in Operations.
      </p>
    </div>
  );
}

/** ========= Remaining components ========= */

function OccupancyHeatmap({ title, desc }: { title: string; desc?: string }) {
  const weeks = 6;
  const days = 7;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title={title}
        desc={desc}
        action={
          HAS_CALENDAR ? (
            <Link
              to="../bookings/calendar"
              className="text-sm underline"
            >
              Open calendar
            </Link>
          ) : null
        }
      />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * days }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-md bg-sky-50"
            style={{
              opacity: 0.6 + 0.4 * Math.sin((i % 7) / 7),
            }}
            title="Occupancy placeholder"
          />
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {HAS_CALENDAR
          ? "Deeper calendar with real data coming next."
          : "Calendar / bookings module will plug in here once enabled."}
      </div>
    </div>
  );
}

function HousekeepingProgress({
  slug,
  readyPct,
}: {
  slug: string;
  readyPct: number;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader
        title="Room readiness"
        desc="How many rooms are ready for check-in — and what’s blocking the rest."
        action={
          <Link
            to={`/owner/${slug}/housekeeping`}
            className="text-sm underline"
          >
            Open HK
          </Link>
        }
      />
      <div className="h-2 rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-emerald-500"
          style={{ width: `${readyPct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {readyPct}% rooms ready
      </div>
    </div>
  );
}

function Board({
  title,
  desc,
  items,
  empty,
}: {
  title: string;
  desc?: string;
  items: StayRow[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <SectionHeader title={title} desc={desc} />
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {s.room ? `Room ${s.room}` : "Unassigned room"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmt(s.check_in_start)} → {fmt(s.check_out_end)}
                  </div>
                </div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
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

function TodayBottomStrip({
  occPct,
  hrms,
}: {
  occPct: number;
  hrms: HrmsSnapshot | null;
}) {
  const staffingChip = hrms
    ? `Front desk & teams at ${hrms.attendance_pct_today}% of planned strength.`
    : "Staffing snapshot will appear once HRMS is connected.";
  const riskChip =
    occPct > 85
      ? "High occupancy — watch SLAs & housekeeping turns."
      : "Normal occupancy — focus on guest delight.";
  const weatherChip =
    "Weather: connect to local feed to see storms & flight delays.";

  return (
    <section className="rounded-2xl border border-slate-100 bg-white/90 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
        <Chip>{staffingChip}</Chip>
        <Chip>{riskChip}</Chip>
        <Chip>{weatherChip}</Chip>
      </div>
    </section>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-slate-50 px-3 py-1 text-slate-700 ring-1 ring-slate-200">
      {children}
    </span>
  );
}

function OwnerSupportFooter() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium text-slate-900">
          Need help or want to improve results?
        </div>
        <div className="text-sm text-muted-foreground">
          Our team can review your numbers and suggest quick wins tailored to
          your property.
        </div>
      </div>
      <a
        href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help"
        className="btn"
      >
        Contact us
      </a>
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
  const hasValidSlug = !!normalizeSlug(slug);
  return (
    <div className="rounded-2xl border p-6 bg-amber-50">
      <div className="mb-1 text-lg font-semibold">Property access needed</div>
      <p className="mb-4 text-sm text-amber-900">{message}</p>
      <div className="flex flex-wrap gap-2">
        {hasValidSlug ? (
          <Link
            to={`/owner/access?slug=${encodeURIComponent(slug)}`}
            className="btn"
          >
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
          <Link
            to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`}
            className="btn btn-light"
          >
            Accept via Code
          </Link>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-amber-900">
        Tip: If you received an email invite, open it on this device so we can
        auto-fill your invite code.
      </p>
    </div>
  );
}

/** ========= Action Drawer ========= */

function ActionDrawer({
  state,
  onClose,
}: {
  state: DrawerState | null;
  onClose: () => void;
}) {
  if (!state) return null;

  let title = "";
  let body = "";

  switch (state.kind) {
    case "pickup":
      title = "Revenue pickup — coming soon";
      body =
        "This drawer will show a compact pick-up chart with today vs budget and last year. For now, open the Revenue view for full details.";
      break;
    case "opsBoard":
      title = "Ops board — one-touch actions";
      body =
        "Soon you’ll be able to see all open tickets here and escalate, assign or resolve them in one or two taps. For now, use the Operations board.";
      break;
    case "rushRooms":
      title = "Prioritise rush rooms";
      body =
        "In the next phase, this will let you mark a set of rooms as Rush clean and notify Housekeeping instantly.";
      break;
    case "vipList":
      title = "VIP & special attention list";
      body =
        "Connect your CRM/PMS VIP tags to show VIP arrivals, long-stays and guests with open complaints here.";
      break;
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex-1 px-4 py-4 text-sm text-slate-700">
          {body}
        </div>
      </div>
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
function timeBucketFromISO(iso: string): string {
  if (!iso) return "00–06";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00–06";
  const h = d.getHours();
  if (h < 6) return "00–06";
  if (h < 12) return "06–12";
  if (h < 18) return "12–18";
  return "18–24";
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
