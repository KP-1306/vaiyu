// web/src/routes/OwnerDashboard.tsx — owner dashboard (pilot-safe)
// NOTE: All data fetching / Supabase / hooks logic is preserved.
// Changes in this patch:
// - Pilot-safe rendering: no synthetic/demo numbers, no placeholder charts/heatmaps.
// - SLA math fixed: uses completed SLA metrics (when available) and avoids proxy % from open orders.
// - Unfinished modules are hidden (no “Soon/coming soon” UI).
// - Removed action drawers that only contained placeholder copy.

import { useEffect, useMemo, useState, type ReactNode } from "react";
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

import SlaPerformanceChart from "../components/analytics/SlaPerformanceChart";
import TaskVolumeChart from "../components/analytics/TaskVolumeChart";
import OccupancyTrendChart from "../components/analytics/OccupancyTrendChart";
import RevenueTrendChart from "../components/analytics/RevenueTrendChart";
import { getDashboardMetrics, type DashboardMetrics } from "../lib/dashboardApi";

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
  closed_at?: string | null;
};

type StaffPerf = {
  staff_id: string;
  display_name: string;
  department_name: string;
  role: string;
  tickets_completed: number;
  avg_completion_min: number | null;
  is_online: boolean;
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

/** ========= Feature flags ========= */
const HAS_FUNCS = import.meta.env.VITE_HAS_FUNCS === "true";
const HAS_REVENUE = import.meta.env.VITE_HAS_REVENUE === "true";
const HAS_HRMS = import.meta.env.VITE_HAS_HRMS === "true";
const HAS_PRICING = import.meta.env.VITE_HAS_PRICING === "true";
const HAS_CALENDAR = import.meta.env.VITE_HAS_CALENDAR === "true";
const HAS_STAFF_SHIFTS = import.meta.env.VITE_HAS_STAFF_SHIFTS === "true";
// Workforce ON by default unless explicitly disabled
const HAS_WORKFORCE =
  import.meta.env.VITE_HAS_WORKFORCE === "false" ? false : true;

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
function slaToneSafe(pct?: number | null): "green" | "amber" | "red" | "grey" {
  if (pct == null || Number.isNaN(pct)) return "grey";
  return slaTone(pct);
}
function ratingTone(avg?: number | null): "green" | "amber" | "red" | "grey" {
  if (avg == null || Number.isNaN(avg)) return "grey";
  if (avg >= 4.4) return "green";
  if (avg >= 3.8) return "amber";
  return "red";
}

function hasSeries<T>(arr?: T[] | null) {
  return Array.isArray(arr) && arr.length > 0;
}

/** ========= Small helpers to sanitize slug ========= */
function normalizeSlug(raw?: string) {
  const s = (raw || "").trim();
  if (!s || s === ":slug") return "";
  return s;
}

/** ========= Page ========= */
export default function OwnerDashboard() {
  const paramsHook = useParams();
  const rawSlug = paramsHook.slug;
  const slug = normalizeSlug(rawSlug);

  // Subscribe to tickets for this property and keep KPIs refreshed
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
  const [workforceJobs, setWorkforceJobs] = useState<
    WorkforceJobSummary[] | null
  >(null);
  const [workforceLoading, setWorkforceLoading] = useState(false);

  // AI Ops Co-pilot state (heatmap + staffing recommendations)
  const [opsHeatmap, setOpsHeatmap] = useState<OpsHeatmapPoint[] | null>(null);
  const [staffingPlan, setStaffingPlan] = useState<StaffingPlanRow[] | null>(
    null
  );
  const [opsLoading, setOpsLoading] = useState(false);

  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const inviteToken = params.get("invite");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayStartISO = useMemo(() => dayStartISO(today), [today]);
  const tomorrowStartISO = useMemo(() => nextDayStartISO(today), [today]);

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
        const [{ data: arr }, { data: inh }, { data: dep }] =
          await Promise.all([
            supabase
              .from("stays")
              .select("id,guest_id,check_in_start,check_out_end,status,room")
              .eq("hotel_id", hotelId)
              .gte("check_in_start", todayStartISO)
              .lt("check_in_start", tomorrowStartISO)
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
              .gte("check_out_end", todayStartISO)
              .lt("check_out_end", tomorrowStartISO)
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
        const { data: sla } = await supabase
          .from("sla_targets")
          .select("target_minutes")
          .eq("hotel_id", hotelId)
          .eq("key", "order_delivery_min")
          .maybeSingle();

        let ordersData: any[] | null = null;

        // Prefer closed_at IS NULL (prod-safe even if status enum differs)
        const { data: orders1, error: oErr1 } = await supabase
          .from("orders")
          .select("id,created_at,status,price,closed_at")
          .eq("hotel_id", hotelId)
          .is("closed_at", null)
          .order("created_at", { ascending: false })
          .limit(50);

        if (!oErr1) {
          ordersData = orders1 || [];
        } else {
          // Compatibility fallback if closed_at isn't present in older schemas
          const { data: orders2 } = await supabase
            .from("orders")
            .select("id,created_at,status,price")
            .eq("hotel_id", hotelId)
            .in("status", ["open", "preparing"])
            .order("created_at", { ascending: false })
            .limit(50);

          ordersData = orders2 || [];
        }

        if (!alive) return;
        setSlaTargetMin(sla?.target_minutes ?? 20);
        setLiveOrders((ordersData as LiveOrder[]) || []);
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

      // 7a) Staff leaderboard - with proper role joins
      try {
        const { data: staffData, error: staffError } = await supabase
          .from("hotel_members")
          .select(`id, role, is_active, user_id`)
          .eq("hotel_id", hotelId)
          .eq("is_active", true)
          .order("created_at", { ascending: true });

        if (staffError) {
          if (alive) setStaffPerf(null);
        } else if (staffData && staffData.length > 0 && alive) {
          const memberIds = staffData.map((s: any) => s.id);
          const userIds = staffData.map((s: any) => s.user_id);

          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          const profileMap = new Map(
            profiles?.map((p: any) => [p.id, p.full_name]) || []
          );

          const { data: memberRoles } = await supabase
            .from("hotel_member_roles")
            .select("hotel_member_id, role_id")
            .in("hotel_member_id", memberIds);

          const roleIds = [
            ...new Set(memberRoles?.map((mr: any) => mr.role_id) || []),
          ];
          const { data: hotelRoles } = await supabase
            .from("hotel_roles")
            .select("id, name, code")
            .in("id", roleIds);
          const roleMap = new Map(
            hotelRoles?.map((r: any) => [r.id, r.name]) || []
          );

          const memberRolesMap = new Map<string, string[]>();
          memberRoles?.forEach((mr: any) => {
            const roleName = roleMap.get(mr.role_id);
            if (roleName) {
              const existing = memberRolesMap.get(mr.hotel_member_id) || [];
              existing.push(roleName);
              memberRolesMap.set(mr.hotel_member_id, existing);
            }
          });

          const transformed: StaffPerf[] = staffData.map((s: any) => {
            const roles = memberRolesMap.get(s.id) || [];
            return {
              staff_id: s.id,
              display_name:
                profileMap.get(s.user_id) || `Staff ${s.id.slice(0, 8)}`,
              department_name: roles.join(", ") || s.role,
              role: s.role,
              tickets_completed: 0,
              avg_completion_min: null,
              is_online: s.is_active,
            };
          });
          setStaffPerf(transformed);
        } else if (alive) {
          setStaffPerf(null);
        }
      } catch {
        if (alive) setStaffPerf(null);
      }

      // 7b) Optional RPCs
      if (HAS_FUNCS) {
        try {
          const { data } = await supabase.rpc("hrms_snapshot_for_slug", {
            p_slug: slug,
          });
          if (alive) setHrms((data && data[0]) ?? null);
        } catch {
          if (alive) setHrms(null);
        }

        try {
          const { data } = await supabase.rpc("vip_arrivals_for_slug", {
            p_slug: slug,
          });
          if (alive) setVipStays(data ?? []);
        } catch {
          if (alive) setVipStays([]);
        }

        try {
          const { data } = await supabase.rpc("events_today_for_slug", {
            p_slug: slug,
          });
          if (alive) setEventsToday(data ?? []);
        } catch {
          if (alive) setEventsToday([]);
        }

        try {
          const { data } = await supabase.rpc("owner_nps_for_slug", {
            p_slug: slug,
          });
          if (alive) setNpsSnapshot(data && data[0] ? data[0] : null);
        } catch {
          if (alive) setNpsSnapshot(null);
        }
      } else {
        if (alive) {
          setHrms(null);
          setVipStays(null);
          setEventsToday(null);
          setNpsSnapshot(null);
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
  }, [slug, todayStartISO, tomorrowStartISO]);

  /* Dashboard Analytics */
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadMetrics() {
      if (!hotel?.id) return;
      try {
        const data = await getDashboardMetrics(hotel.id);
        if (mounted) setMetrics(data);
      } catch (err) {
        console.error("Failed to load dashboard metrics", err);
      }
    }
    loadMetrics();
    return () => {
      mounted = false;
    };
  }, [hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !HAS_FUNCS) {
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

  /** ======= KPI Calculations (pilot-safe) ======= */
  const todayStats = metrics?.todayStats;

  const total = todayStats?.totalRooms ?? totalRooms;
  const occupied =
    todayStats?.occupied ??
    kpi?.occupied_today ??
    (Array.isArray(inhouse) ? inhouse.length : 0);

  const occPct = total ? Math.round((occupied / total) * 100) : 0;

  const arrivalsCount = todayStats?.arrivals ?? arrivals.length;
  const departuresCount = todayStats?.departures ?? departures.length;

  const hasRevenueKpi = !!kpi;
  const revenueToday = hasRevenueKpi ? kpi!.revenue_today : 0;
  const pickup7d = hasRevenueKpi ? kpi!.pickup_7d : 0;

  const adr = occupied ? revenueToday / occupied : 0;
  const revpar = total ? (adr * occupied) / total : 0;

  const targetMin = slaTargetMin ?? 20;

  const ordersTotal = liveOrders.length;
  const ordersOverdue = liveOrders.filter((o) => ageMin(o.created_at) > targetMin)
    .length;

  // SLA % is only shown when we have real "completed" SLA metrics (pilot-safe)
  const slaSeries = metrics?.slaPerformance;
  const slaTodayMetric = slaSeries?.[slaSeries.length - 1];
  const slaCompletedTotal =
    typeof slaTodayMetric?.total === "number" ? slaTodayMetric.total : null;
  const slaBreached =
    typeof slaTodayMetric?.breached === "number" ? slaTodayMetric.breached : null;

  const slaPct =
    slaCompletedTotal != null &&
    slaBreached != null &&
    slaCompletedTotal > 0
      ? Math.round(
          (Math.max(0, slaCompletedTotal - slaBreached) / slaCompletedTotal) * 100
        )
      : null;

  const slaToneLevel = slaToneSafe(slaPct);

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

  // VIP / events / NPS (pilot-safe)
  const vipCount = vipStays?.length ?? 0;
  const eventsCount = eventsToday?.length ?? 0;

  const npsScore =
    typeof npsSnapshot?.nps_30d === "number" ? Math.round(npsSnapshot.nps_30d) : null;
  const npsResponses =
    typeof npsSnapshot?.total_responses === "number"
      ? npsSnapshot.total_responses
      : null;

  /** ======= Render ======= */
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-4 lg:px-6 lg:py-6">
        <div className="grid gap-4 lg:grid-cols-[230px,minmax(0,1fr)] xl:grid-cols-[260px,minmax(0,1fr)]">
          {/* Left: sticky sidebar navigation on desktop */}
          <aside className="hidden lg:block">
            <OwnerSidebarNav slug={hotel.slug} />
          </aside>

          {/* Right: main dashboard content */}
          <div className="space-y-3" id="top">
            {/* Top bar / identity */}
            <OwnerTopBar
              hotel={hotel}
              slug={hotel.slug}
              dateLabel={dateLabel}
              timeLabel={timeLabel}
            />

            {/* Hero: Today's Pulse */}
            <PulseStrip
              slug={hotel.slug}
              hotelName={hotel.name}
              city={hotel.city}
              occPct={occPct}
              occupied={occupied}
              totalRooms={total}
              arrivalsCount={arrivalsCount}
              departuresCount={departuresCount}
              hasRevenueKpi={hasRevenueKpi}
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
              avgRating30d={kpi?.avg_rating_30d ?? null}
              vipCount={vipCount}
              eventCount={eventsCount}
              metrics={metrics}
            />

            {/* Ops & SLA row */}
            <section className="grid gap-3 lg:grid-cols-3">
              <SlaCard targetMin={targetMin} metrics={metrics} />
              <LiveOrdersPanel
                orders={liveOrders}
                targetMin={targetMin}
                slug={hotel.slug}
                className="lg:col-span-1"
              />
              <AttentionServicesCard orders={liveOrders} />
            </section>

            {/* Live Ops (Arrivals/In-house/Departures) + Performance */}
            <section className="grid gap-3 lg:grid-cols-2">
              <PerformanceColumn
                slug={hotel.slug}
                hasRevenueKpi={hasRevenueKpi}
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
                metrics={metrics}
              />
              <LiveOpsColumn
                arrivals={arrivals}
                inhouse={inhouse}
                departures={departures}
              />
            </section>

            {/* Staff, HR & Workforce row */}
            <section className="grid gap-3 lg:grid-cols-3">
              <StaffPerformancePanel data={staffPerf} />
              <HrmsPanel data={hrms} slug={hotel.slug} />
              <div className="space-y-3">
                <OwnerTasksPanel occPct={occPct} kpi={kpi} slug={hotel.slug} />
                <OwnerWorkforcePanel
                  slug={hotel.slug}
                  jobs={workforceJobs}
                  loading={workforceLoading}
                />
              </div>
            </section>

            {/* Outlook & Housekeeping */}
            <section className="grid gap-3 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <BookingOutlookCard />
              </div>
              <HousekeepingStatusCard slug={hotel.slug} />
            </section>

            {/* AI Ops Co-pilot */}
            <AiOpsSection
              slug={hotel.slug}
              heatmap={opsHeatmap}
              staffingPlan={staffingPlan}
              loading={opsLoading}
            />

            {/* AI usage */}
            <section className="rounded-2xl border border-slate-100 bg-white/80 px-4 py-3 shadow-sm">
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

            {/* Support footer */}
            <footer className="pt-1">
              <OwnerSupportFooter />
            </footer>
          </div>
        </div>
      </div>
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
            managers.
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
            <Link to={`/owner/${slug}/pricing`} className="btn btn-light h-8 text-xs">
              Open pricing
            </Link>
          )}
          {HAS_HRMS && (
            <Link to={`/owner/${slug}/hrms`} className="btn btn-light h-8 text-xs">
              HRMS
            </Link>
          )}
          <Link to={`/owner/${slug}/settings`} className="btn btn-light h-8 text-xs">
            Settings
          </Link>
          <div className="flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-50">
              EM
            </div>
            <div className="leading-tight">
              <div className="text-xs font-medium text-slate-50">Emma — GM</div>
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

/** Sticky left sidebar (desktop only) */
function OwnerSidebarNav({ slug }: { slug: string }) {
  const encodedSlug = encodeURIComponent(slug);

  // Keep these links EXACT (they’re the two “must not break” routes)
  const servicesHref = `/owner/services?slug=${encodedSlug}`;
  const opsAnalyticsHref = `/ops/analytics?slug=${encodedSlug}`;

  const opsHref = `/ops?slug=${encodedSlug}`;
  const settingsHref = `/owner/${slug}/settings`;
  const pricingHref = `/owner/${slug}/pricing`;

  return (
    <nav
      className="sticky top-4 rounded-3xl border border-slate-100 bg-white/90 px-3 py-4 text-xs text-slate-700 shadow-sm shadow-slate-200/60"
      aria-label="Owner dashboard navigation"
    >
      {/* Overview */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Overview
        </div>
        <ul className="space-y-1">
          <li>
            <a
              href="#pulse"
              className="flex items-center gap-2 rounded-lg bg-slate-900/5 px-2 py-1.5 font-medium text-slate-900"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Dashboard &amp; KPIs</span>
            </a>
          </li>
          <li>
            <Link
              to={`/owner/${slug}/analytics`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-emerald-800"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Ops Analytics &amp; Reports</span>
            </Link>
          </li>
          <li>
            <a
              href="#revenue-panel"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Revenue &amp; forecast</span>
            </a>
          </li>
          <li>
            <a
              href="#rooms"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Rooms &amp; occupancy</span>
            </a>
          </li>
        </ul>
      </div>

      {/* Operations */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Operations
        </div>
        <ul className="space-y-1">
          <li>
            <a
              href="#live-ops"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Live operations (today)</span>
            </a>
          </li>
          <li>
            <a
              href="#live-orders"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Live requests &amp; orders</span>
            </a>
          </li>
          <li>
            <Link
              to={opsAnalyticsHref}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-emerald-800"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span>Ops Manager Dashboard</span>
            </Link>
          </li>
          <li>
            <a
              href="#housekeeping"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Housekeeping</span>
            </a>
          </li>
          <li>
            <Link
              to={servicesHref}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Departments/Services &amp; SLAs</span>
            </Link>
          </li>
          {HAS_STAFF_SHIFTS && (
            <li>
              <Link
                to={`/owner/${slug}/staff-shifts`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>Staff &amp; Shifts</span>
              </Link>
            </li>
          )}
          <li>
            <Link
              to={opsHref}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Ops board</span>
            </Link>
          </li>
        </ul>
      </div>

      {/* People & HR */}
      <div className="mb-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          People &amp; HR
        </div>
        <ul className="space-y-1">
          <li>
            <a
              href="#attendance"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Attendance snapshot</span>
            </a>
          </li>
          {HAS_HRMS && (
            <li>
              <Link
                to={`/owner/${slug}/hrms/attendance`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>Attendance details</span>
              </Link>
            </li>
          )}
          <li>
            <a
              href="#workforce"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Workforce</span>
            </a>
          </li>
        </ul>
      </div>

      {/* Pricing & setup */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Pricing &amp; setup
        </div>
        <ul className="space-y-1">
          {HAS_PRICING && (
            <li>
              <Link
                to={pricingHref}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>Pricing &amp; packages</span>
              </Link>
            </li>
          )}
          <li>
            <Link
              to={settingsHref}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Owner settings</span>
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}

function PulseStrip({
  slug,
  hotelName,
  city,
  occPct,
  occupied,
  totalRooms,
  arrivalsCount,
  departuresCount,
  hasRevenueKpi,
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
  avgRating30d,
  vipCount,
  eventCount,
  metrics,
}: {
  slug: string;
  hotelName: string;
  city: string | null;
  occPct: number;
  occupied: number;
  totalRooms: number;
  arrivalsCount: number;
  departuresCount: number;

  hasRevenueKpi: boolean;
  revenueToday: number;
  adr: number;
  revpar: number;
  pickup7d: number;

  slaPct: number | null;
  slaTone: "green" | "amber" | "red" | "grey";

  ordersTotal: number;
  ordersOverdue: number;

  hrms: HrmsSnapshot | null;

  npsScore: number | null;
  npsResponses: number | null;
  avgRating30d: number | null;

  vipCount: number;
  eventCount: number;

  metrics: DashboardMetrics | null;
}) {
  const hasNps = typeof npsScore === "number" && (npsResponses ?? 0) > 0;
  const hasRating = typeof avgRating30d === "number" && !Number.isNaN(avgRating30d);

  const guestPrimary = hasNps
    ? `NPS ${npsScore}`
    : hasRating
      ? `Avg rating ${avgRating30d!.toFixed(1)}/5`
      : "Not available";

  const guestSecondary = hasNps
    ? `${npsResponses} responses (30d)`
    : hasRating
      ? "Last 30 days"
      : "Guest feedback is not connected.";

  const guestTone = hasNps ? "green" : ratingTone(avgRating30d);

  const occHasTrend = hasSeries(metrics?.occupancyHistory);

  return (
    <section
      id="pulse"
      className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-r from-sky-50 via-slate-50 to-emerald-50 px-4 py-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)] lg:px-6 lg:py-5"
    >
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
            At-a-glance health and operational signals for today.
          </p>
        </div>

        <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3">
          <PulseTile
            label="Occupancy & rooms"
            primary={`${occPct || 0}% occupied`}
            secondary={`${occupied}/${totalRooms || 0} rooms · ${arrivalsCount} arrivals · ${departuresCount} departures`}
            badgeLabel="Action"
            badgeTone={occupancyTone(occPct)}
          >
            <div className="mt-3 border-t pt-2">
              <div className="mb-1 text-[10px] font-medium text-slate-400">
                30-Day Trend
              </div>
              <div className="h-16">
                {occHasTrend ? (
                  <OccupancyTrendChart
                    data={metrics?.occupancyHistory || []}
                    loading={!metrics}
                  />
                ) : (
                  <div className="h-16 grid place-items-center text-[11px] text-slate-500">
                    Not available
                  </div>
                )}
              </div>
            </div>
          </PulseTile>

          <PulseTile
            label="Revenue snapshot"
            primary={hasRevenueKpi ? `₹${revenueToday.toFixed(0)} today` : "Not available"}
            secondary={
              hasRevenueKpi
                ? `ADR ₹${adr.toFixed(0)} · RevPAR ₹${revpar.toFixed(0)} · Pick-up 7d ${pickup7d}`
                : "Revenue KPIs are not available."
            }
            actionLabel={HAS_REVENUE ? "Open revenue" : undefined}
            actionHref={HAS_REVENUE ? `/owner/${slug}/revenue` : undefined}
          />

          <PulseTile
            label="Guest experience"
            primary={guestPrimary}
            secondary={guestSecondary}
            badgeLabel={hasNps || hasRating ? "Guest" : "NA"}
            badgeTone={hasNps || hasRating ? guestTone : "grey"}
          />

          <PulseTile
            label="Ops & service tickets"
            primary={`${ordersTotal} open tasks`}
            secondary={
              slaPct == null
                ? `${ordersOverdue} overdue · SLA not available`
                : `${ordersOverdue} overdue · SLA ${slaPct}%`
            }
            actionLabel="Open ops board"
            actionHref={`/ops?slug=${encodeURIComponent(slug)}`}
            badgeTone={slaTone}
            badgeLabel={
              slaTone === "green"
                ? "On track"
                : slaTone === "amber"
                  ? "Watch"
                  : slaTone === "red"
                    ? "Risk"
                    : "NA"
            }
          />

          <PulseTile
            label="Housekeeping status"
            primary="Not available"
            secondary="Room readiness signal is not connected."
            actionLabel="Open housekeeping"
            actionHref={`/owner/${slug}/housekeeping`}
            badgeLabel="NA"
            badgeTone="grey"
          />

          <PulseTile
            label="Events & VIPs"
            primary={`${eventCount} events · ${vipCount} VIP arrivals`}
            secondary={
              eventCount + vipCount > 0
                ? "See details in the VIP & events panel."
                : "No VIP or event flags for today."
            }
            badgeLabel={eventCount + vipCount > 0 ? "Info" : "NA"}
            badgeTone={eventCount + vipCount > 0 ? "green" : "grey"}
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
  actionHref,
  onAction,
  children,
}: {
  label: string;
  primary: string;
  secondary: string;
  badgeLabel?: string;
  badgeTone?: "green" | "amber" | "red" | "grey";
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/90 p-3 shadow-sm shadow-slate-200/60 backdrop-blur-sm transition-shadow hover:shadow-lg">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-slate-500">{label}</div>
          {badgeLabel && <StatusBadge label={badgeLabel} tone={badgeTone} />}
        </div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{primary}</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">{secondary}</p>
      </div>

      {actionLabel && actionHref && (
        <Link
          to={actionHref}
          className="mt-3 inline-flex items-center text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
        >
          {actionLabel}
          <span aria-hidden="true" className="ml-1">
            →
          </span>
        </Link>
      )}

      {actionLabel && onAction && !actionHref && (
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

      {children}
    </div>
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
  const allEmpty =
    arrivals.length === 0 && inhouse.length === 0 && departures.length === 0;

  return (
    <section
      id="live-ops"
      className="rounded-2xl border border-slate-100 bg-white/95 px-3 py-3 shadow-sm"
    >
      <SectionHeader
        title="Live operations (today)"
        desc={allEmpty ? "No guest movements today." : "Arrivals, in-house guests, and departures."}
      />
      {allEmpty ? (
        <div className="text-sm text-slate-400 py-2">
          All guest boards are empty.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          <Board title="Arrivals" desc="Expected today" items={arrivals} empty="None" />
          <Board title="In-house" desc="Currently staying" items={inhouse} empty="None" />
          <Board title="Departures" desc="Checking out" items={departures} empty="None" />
        </div>
      )}
    </section>
  );
}

function PerformanceColumn({
  slug,
  hasRevenueKpi,
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
  metrics,
}: {
  slug: string;
  hasRevenueKpi: boolean;
  revenueToday: number;
  adr: number;
  revpar: number;
  pickup7d: number;
  occPct: number;
  kpi: KpiRow | null;
  npsScore: number | null;
  npsResponses: number | null;
  vipStays: VipStay[] | null;
  eventsToday: EventRow[] | null;
  metrics: DashboardMetrics | null;
}) {
  const rating = kpi?.avg_rating_30d ?? null;

  const hasNps = typeof npsScore === "number" && (npsResponses ?? 0) > 0;
  const hasRating = typeof rating === "number" && !Number.isNaN(rating);

  const revenueTrendOk = hasSeries(metrics?.revenueHistory);
  const taskVolumeOk = hasSeries(metrics?.taskVolume);

  return (
    <section className="space-y-3" id="revenue-panel">
      {/* Revenue */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <SectionHeader
          title="Revenue"
          desc="Today’s revenue signal from owner KPIs."
          action={
            HAS_REVENUE ? (
              <Link to={`/owner/${slug}/revenue`} className="text-xs underline text-slate-700">
                Open
              </Link>
            ) : null
          }
        />
        {!hasRevenueKpi ? (
          <div className="text-xs text-slate-600">Not available</div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-slate-900">
                ₹{revenueToday.toFixed(0)}
              </div>
              <div className="text-xs text-slate-600">
                ADR ₹{adr.toFixed(0)} · RevPAR ₹{revpar.toFixed(0)} · Pick-up 7d {pickup7d}
              </div>
            </div>
            <div className="w-48 h-16">
              {revenueTrendOk ? (
                <RevenueTrendChart data={metrics?.revenueHistory || []} loading={!metrics} />
              ) : (
                <div className="h-16 grid place-items-center text-[11px] text-slate-500">
                  Not available
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Task Demand */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <SectionHeader title="Task demand (24h)" desc="Hourly volume of requests today." />
        {taskVolumeOk ? (
          <TaskVolumeChart data={metrics?.taskVolume || []} loading={!metrics} />
        ) : (
          <div className="text-xs text-slate-600">Not available</div>
        )}
      </div>

      {/* Guest feedback + VIP/events */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <SectionHeader title="Guest feedback" desc="From connected NPS and ratings." />
          {hasNps ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">NPS {npsScore}</div>
                <div className="text-xs text-slate-600">
                  {npsResponses} responses (30d)
                </div>
              </div>
            </div>
          ) : hasRating ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  Avg rating {rating!.toFixed(1)}/5
                </div>
                <div className="text-xs text-slate-600">Last 30 days</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-emerald-400 bg-emerald-50 text-sm font-semibold text-emerald-700">
                {rating!.toFixed(1)}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-600">Not available</div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <SectionHeader
            title="VIP & events"
            desc="Flags for today from connected sources."
          />
          {(!vipStays || vipStays.length === 0) && (!eventsToday || eventsToday.length === 0) ? (
            <div className="text-xs text-slate-600">Not available</div>
          ) : (
            <div className="space-y-2 text-xs text-slate-700">
              {vipStays && vipStays.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-900">
                    VIP arrivals ({vipStays.length})
                  </div>
                  <ul className="mt-1 space-y-1">
                    {vipStays.slice(0, 3).map((v) => (
                      <li key={v.stay_id} className="rounded-lg bg-slate-50 px-2 py-1">
                        <div className="flex items-center justify-between">
                          <span>{v.room ? `Room ${v.room}` : "Room unassigned"}</span>
                          <span className="text-[10px] text-slate-500">
                            {v.has_open_complaint ? "Open issue" : v.needs_courtesy_call ? "Courtesy call" : "VIP"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {eventsToday && eventsToday.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-900">
                    Events ({eventsToday.length})
                  </div>
                  <ul className="mt-1 space-y-1">
                    {eventsToday.slice(0, 2).map((e) => (
                      <li key={e.id} className="rounded-lg bg-slate-50 px-2 py-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate">{e.name}</span>
                          <span className="text-[10px] text-slate-500">{fmt(e.start_at)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** ========= Components ========= */

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
    <div className="mb-2 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function SlaCard({
  targetMin,
  metrics,
}: {
  targetMin: number;
  metrics: DashboardMetrics | null;
}) {
  // Pilot-safe: SLA % only from completed SLA metrics
  const series = metrics?.slaPerformance;
  const todayMetric = series?.[series.length - 1];

  const hasToday =
    todayMetric &&
    typeof todayMetric.total === "number" &&
    typeof todayMetric.breached === "number";

  const total = hasToday ? todayMetric.total : 0;
  const breached = hasToday ? todayMetric.breached : 0;

  const onTime = hasToday ? Math.max(0, total - breached) : 0;
  const pct = hasToday && total > 0 ? Math.round((onTime / total) * 100) : null;

  const tone = slaToneSafe(pct);
  const trendOk = hasSeries(series);

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="sla">
      <SectionHeader
        title="On-time delivery (SLA)"
        desc={`Target: ${targetMin} minutes. SLA score is shown when completed-request metrics are available.`}
      />

      {!hasToday ? (
        <div className="text-xs text-slate-600">Not available</div>
      ) : total === 0 ? (
        <div className="text-xs text-slate-600">No completed requests recorded today.</div>
      ) : (
        <>
          <div className="h-2 rounded-full bg-gray-100">
            <div
              className={`h-2 rounded-full ${
                tone === "green"
                  ? "bg-emerald-500"
                  : tone === "amber"
                    ? "bg-amber-500"
                    : tone === "red"
                      ? "bg-rose-500"
                      : "bg-slate-300"
              }`}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground flex justify-between">
            <span>
              {onTime}/{total} on time
            </span>
            <span>{pct}%</span>
          </div>
        </>
      )}

      <div className="mt-6 border-t pt-4">
        <div className="mb-2 text-xs font-medium text-slate-600">7-Day Trend</div>
        {trendOk ? (
          <SlaPerformanceChart data={series || []} loading={!metrics} />
        ) : (
          <div className="text-xs text-slate-600">Not available</div>
        )}
      </div>
    </div>
  );
}

function LiveOrdersPanel({
  orders,
  targetMin,
  slug,
  className = "",
}: {
  orders: LiveOrder[];
  targetMin: number;
  slug?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${className}`} id="live-orders">
      <SectionHeader
        title="Live requests & orders"
        desc="Open requests right now."
        action={
          <Link
            to={slug ? `/ops?slug=${encodeURIComponent(slug)}` : "/ops"}
            className="text-sm underline"
          >
            Open operations
          </Link>
        }
      />
      {orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">No live requests right now.</div>
      ) : (
        <>
          <ul className="divide-y">
            {orders.slice(0, 5).map((o) => {
              const mins = ageMin(o.created_at);
              const breach = mins > targetMin;
              return (
                <li key={o.id} className="flex items-center justify-between py-1.5">
                  <div>
                    <div className="text-sm">
                      #{o.id.slice(0, 8)} · {o.status}
                    </div>
                    <div className="text-xs text-muted-foreground">Age: {mins} min</div>
                  </div>
                  <StatusBadge
                    label={breach ? "SLA breach" : "On time"}
                    tone={breach ? "red" : "green"}
                  />
                </li>
              );
            })}
          </ul>
          {orders.length > 5 && (
            <div className="mt-2 text-xs text-slate-500">
              +{orders.length - 5} more requests →{" "}
              <Link
                to={slug ? `/ops?slug=${encodeURIComponent(slug)}` : "/ops"}
                className="underline text-emerald-700"
              >
                View all
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AttentionServicesCard({ orders }: { orders: LiveOrder[] }) {
  const classify = (status: string) => {
    const s = (status || "").toLowerCase();
    const isNew = ["open", "new", "created", "requested"].some((k) => s.includes(k));
    const isProgress = ["preparing", "in_progress", "accepted", "assigned", "working"].some((k) =>
      s.includes(k)
    );
    return { isNew, isProgress };
  };

  const newCount = orders.filter((o) => classify(o.status).isNew).length;
  const inProgress = orders.filter((o) => classify(o.status).isProgress).length;
  const others = Math.max(0, orders.length - newCount - inProgress);

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <SectionHeader title="Services snapshot" desc="Open requests grouped by status." />
      {orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">No open requests to summarize.</div>
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
        Service-type grouping is not available in this view.
      </p>
    </div>
  );
}

function StaffPerformancePanel({ data }: { data: StaffPerf[] | null }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <SectionHeader title="Staff leaderboard" desc="Active staff members (role + assignment context)." />
      {!data || data.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No staff members found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Dept</th>
                <th className="py-1 pr-2">Tasks</th>
                <th className="py-1 pr-2">Avg min</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 8).map((r) => (
                <tr key={r.staff_id} className="border-t">
                  <td className="py-1.5 pr-2 font-medium">{r.display_name}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{r.department_name}</td>
                  <td className="py-1.5 pr-2">{r.tickets_completed}</td>
                  <td className="py-1.5 pr-2">{r.avg_completion_min ?? "—"}</td>
                  <td className="py-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        r.is_online ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {r.is_online ? "Active" : "Away"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 8 && (
            <div className="mt-2 text-xs text-slate-500">
              +{data.length - 8} more staff members
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HrmsPanel({ data, slug }: { data: HrmsSnapshot | null; slug: string }) {
  const showHrmsLink = HAS_HRMS;

  if (!data) {
    return (
      <div className="rounded-xl border bg-white p-4 shadow-sm" id="attendance">
        <SectionHeader
          title="Attendance snapshot"
          desc="Connected attendance signal for today."
          action={
            showHrmsLink ? (
              <Link to={`/owner/${slug}/hrms`} className="text-sm underline">
                Open HRMS
              </Link>
            ) : null
          }
        />
        <div className="text-sm text-muted-foreground">
          Not available
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
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="attendance">
      <SectionHeader
        title="Attendance snapshot"
        desc="Presence signal for today."
        action={
          showHrmsLink ? (
            <Link to={`/owner/${slug}/hrms/attendance`} className="text-sm underline">
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
  const revenueToday = kpi?.revenue_today;

  const tasks: string[] = [];
  if (occPct < 50) {
    tasks.push("Review packages and distribution for soft nights.");
  } else if (occPct > 80) {
    tasks.push("Review rates and restrictions on high-demand nights.");
  } else {
    tasks.push("Monitor pacing; no urgent rate changes indicated.");
  }
  if (typeof revenueToday === "number") {
    tasks.push("Review top services driving revenue today.");
  }
  if (HAS_WORKFORCE) {
    tasks.push("Review open roles in Workforce for coverage gaps.");
  }
  tasks.push("Review low ratings and close the loop on open guest issues.");

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="owner-tasks">
      <SectionHeader
        title="Owner tasks for today"
        desc="Short operational nudges based on today’s signals."
        action={
          <div className="flex items-center gap-3">
            <Link to="/owner" className="text-xs underline text-slate-600">
              Owner hub
            </Link>
            {HAS_WORKFORCE && (
              <Link to={`/owner/${slug}/workforce`} className="text-xs underline text-emerald-700">
                Jobs &amp; hiring
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
      <div className="rounded-xl border bg-white p-4 shadow-sm" id="workforce">
        <SectionHeader
          title="Workforce"
          desc="Hiring view for this property."
        />
        <div className="text-xs text-muted-foreground">
          Not available
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="workforce">
      <SectionHeader
        title="Workforce"
        desc="Open roles for this property."
        action={
          <Link to={`/owner/${slug}/workforce`} className="text-xs underline text-slate-600">
            Open Workforce
          </Link>
        }
      />
      {loading ? (
        <div className="text-xs text-muted-foreground">Loading roles…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-muted-foreground">No roles found.</div>
      ) : (
        <div className="space-y-2 text-xs text-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {openJobs} open role{openJobs === 1 ? "" : "s"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {list.length} total roles.
              </div>
            </div>
          </div>
          <ul className="space-y-1">
            {list.slice(0, 3).map((j) => {
              const status = (j.status || "open").toLowerCase();
              const isOpen = status.includes("open") || status === "draft";
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
                      {(j.city || "").trim() || "Local"} · {j.status || "Open"}
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

/** ========= AI Ops Co-pilot section (pilot-safe) ========= */

function AiOpsSection({
  slug,
  heatmap,
  staffingPlan,
  loading,
}: {
  slug: string;
  heatmap: OpsHeatmapPoint[] | null;
  staffingPlan: StaffingPlanRow[] | null;
  loading: boolean;
}) {
  const hasPlan = !!(staffingPlan && staffingPlan.length);
  const hasHeatmap = !!(heatmap && heatmap.length);

  const showAny = HAS_FUNCS && (loading || hasPlan || hasHeatmap);

  return (
    <section className="rounded-2xl border border-slate-100 bg-white/95 px-4 py-4 shadow-sm">
      <SectionHeader
        title="AI Ops Co-pilot"
        desc={
          HAS_FUNCS
            ? "Operational patterns from connected ticket history."
            : "Not available"
        }
        action={
          <Link
            to={slug ? `/ops?slug=${encodeURIComponent(slug)}` : "/ops"}
            className="text-[11px] underline text-slate-700"
          >
            Open ops view
          </Link>
        }
      />

      {!showAny ? (
        <div className="text-xs text-slate-600">Not available</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="space-y-2 text-xs text-slate-700 md:col-span-2">
            {loading ? (
              <div className="text-xs text-slate-500">Analyzing recent requests…</div>
            ) : hasPlan ? (
              <>
                <div className="font-semibold text-slate-900">Suggested staffing bands (today)</div>
                <ul className="space-y-1">
                  {staffingPlan!.slice(0, 3).map((row) => (
                    <li
                      key={row.department}
                      className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1"
                    >
                      <div>
                        <div className="text-[11px] font-semibold text-slate-900">{row.department}</div>
                        <div className="text-[11px] text-slate-600">
                          Recommend {row.recommended_count} staff (min {row.min_count}, max {row.max_count})
                        </div>
                        {row.reason && (
                          <div className="mt-0.5 text-[10px] text-slate-500">{row.reason}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-xs text-slate-600">Not available</div>
            )}
          </div>

          <div className="md:col-span-3">
            <AiOpsHeatmap heatmap={heatmap} loading={loading} />
          </div>
        </div>
      )}
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
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
        Analyzing…
      </div>
    );
  }

  if (!heatmap || heatmap.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
        Not available
      </div>
    );
  }

  const buckets = ["00–06", "06–12", "12–18", "18–24"];

  const matrix: Record<string, Record<string, number>> = {};
  const zoneTotals: Record<string, number> = {};

  for (const p of heatmap) {
    const zone = p.zone || "Other";
    const bucket = timeBucketFromISO(p.hour_bucket);
    if (!matrix[zone]) matrix[zone] = {};
    matrix[zone][bucket] = (matrix[zone][bucket] || 0) + (p.total_tickets ?? 0);
    zoneTotals[zone] = (zoneTotals[zone] || 0) + (p.total_tickets ?? 0);
  }

  let zones = Object.keys(zoneTotals).sort(
    (a, b) => (zoneTotals[b] ?? 0) - (zoneTotals[a] ?? 0)
  );
  zones = zones.slice(0, 6);

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
        Darker cells ≈ more requests in that zone & time band.
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/60 p-2">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left text-slate-500">Zone / Time</th>
              {buckets.map((b) => (
                <th key={b} className="px-1 py-1 text-center text-slate-500">
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
                        title={`${v} request${v === 1 ? "" : "s"} in ${z}, ${b}`}
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
    </div>
  );
}

/** ========= Pilot-safe cards for areas that previously used placeholders ========= */

function BookingOutlookCard() {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="rooms">
      <SectionHeader
        title="Booking outlook"
        desc="Availability and pacing view from your bookings calendar."
        action={
          HAS_CALENDAR ? (
            <Link to="../bookings/calendar" className="text-sm underline">
              Open calendar
            </Link>
          ) : null
        }
      />
      <div className="text-xs text-slate-600">Not available</div>
    </div>
  );
}

function HousekeepingStatusCard({ slug }: { slug: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" id="housekeeping">
      <SectionHeader
        title="Housekeeping"
        desc="Room readiness and blockers from housekeeping data."
        action={
          <Link to={`/owner/${slug}/housekeeping`} className="text-sm underline">
            Open housekeeping
          </Link>
        }
      />
      <div className="text-xs text-slate-600">Not available</div>
    </div>
  );
}

/** ========= Remaining components ========= */

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
    <div className="rounded-lg border bg-white p-2 shadow-sm">
      <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
      {desc ? <div className="text-[11px] text-slate-500 mb-1">{desc}</div> : null}
      {items.length === 0 ? (
        <div className="text-xs text-slate-400">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.room ? `Room ${s.room}` : "Unassigned room"}</div>
                  <div className="text-xs text-muted-foreground">
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

function OwnerSupportFooter() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium text-slate-900">Need help?</div>
        <div className="text-sm text-muted-foreground">
          Our team can review your numbers and suggest operational quick wins.
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
      <p className="mt-3 text-xs text-amber-900">
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

function dayStartISO(yyyy_mm_dd: string) {
  return `${yyyy_mm_dd}T00:00:00.000Z`;
}

function nextDayStartISO(yyyy_mm_dd: string) {
  const d = new Date(`${yyyy_mm_dd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
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

function ageMin(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}
