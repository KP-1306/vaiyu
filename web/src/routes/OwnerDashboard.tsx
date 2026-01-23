// web/src/routes/OwnerDashboard.tsx — owner dashboard (pilot-safe, DARK UI)
// This version preserves ALL existing data fetching / Supabase / hooks logic.
// Only the UI layout and styling is reworked to match the attached “VAiyu Dashboard” screenshot:
// - Dark 3-column layout (left nav + main + right rail)
// - KPI strip + ring active tasks + trend card + tables + staff + satisfaction
// - No synthetic/demo numbers; unknown values show "—" or "Not available"

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

/** ========= Tone helpers (dark) ========= */
function toneClass(tone: "green" | "amber" | "red" | "grey") {
  return {
    green:
      "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20 border border-emerald-400/10",
    amber:
      "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20 border border-amber-400/10",
    red: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20 border border-rose-400/10",
    grey: "bg-slate-500/10 text-slate-200 ring-1 ring-white/10 border border-white/5",
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
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${toneClass(
        tone
      )}`}
    >
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
      <main className="min-h-[60vh] grid place-items-center bg-slate-950 text-slate-100">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  if (accessProblem) {
    return (
      <main className="max-w-3xl mx-auto p-6 bg-slate-950 text-slate-100">
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
      <main className="min-h-[60vh] grid place-items-center bg-slate-950 text-slate-100">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-lg font-semibold mb-2">No property to show</div>
          <p className="text-sm text-slate-300">
            Open your property from the Owner Home.
          </p>
          <div className="mt-4">
            <Link
              to="/owner"
              className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
            >
              Owner Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /** ======= KPI Calculations (pilot-safe) ======= */
  const todayStats = (metrics as any)?.todayStats;

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

  const targetMin = slaTargetMin ?? 20;
  const ordersTotal = liveOrders.length;
  const ordersOverdue = liveOrders.filter((o) => ageMin(o.created_at) > targetMin)
    .length;

  // SLA % is only shown when we have real "completed" SLA metrics (pilot-safe)
  const slaSeries = (metrics as any)?.slaPerformance as any[] | undefined;
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

  const npsScore =
    typeof npsSnapshot?.nps_30d === "number" ? Math.round(npsSnapshot.nps_30d) : null;
  const npsResponses =
    typeof npsSnapshot?.total_responses === "number"
      ? npsSnapshot.total_responses
      : null;

  const avgRating30d = kpi?.avg_rating_30d ?? null;

  // “Avg response” (pilot-safe): attempt to read from metrics, else —
  // IMPORTANT: Must not use hooks here (this block is below early returns).
  const avgResponseMin: number | null = (() => {
    const last = slaSeries?.[slaSeries.length - 1];
    const v =
      typeof (last as any)?.avg_minutes === "number"
        ? (last as any).avg_minutes
        : typeof (last as any)?.avg_completion_min === "number"
          ? (last as any).avg_completion_min
          : typeof (last as any)?.avg_response_min === "number"
            ? (last as any).avg_response_min
            : null;
    return v == null || Number.isNaN(v) ? null : Math.round(v);
  })();

  // Guest satisfaction (pilot-safe): prefer NPS, else rating
  const guestPrimary =
    typeof npsScore === "number" && (npsResponses ?? 0) > 0
      ? `${npsScore}`
      : typeof avgRating30d === "number"
        ? `${avgRating30d.toFixed(1)}`
        : null;

  const guestTone =
    typeof npsScore === "number" && (npsResponses ?? 0) > 0
      ? "green"
      : ratingTone(avgRating30d);

  // “Blocked” proxy (pilot-safe): use breached (completed) if available
  const blockedCount = slaBreached != null ? slaBreached : null;

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  /** ======= Render (dark dashboard) ======= */
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      {/* subtle texture/gradient */}
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(56,189,248,0.10),transparent_60%),radial-gradient(900px_500px_at_90%_20%,rgba(16,185,129,0.10),transparent_55%),radial-gradient(900px_600px_at_50%_120%,rgba(245,158,11,0.06),transparent_60%)]" />
      </div>

      <div className="relative mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-6">
        <DashboardTopBar
          title="VAiyu Dashboard"
          hotelName={hotel.name}
          city={hotel.city}
          dateLabel={dateLabel}
          slug={hotel.slug}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[240px,minmax(0,1fr),340px]">
          {/* Left rail */}
          <aside className="hidden lg:block">
            <DarkCard className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                  Alerts
                </div>
                <StatusBadge
                  label={
                    ordersOverdue > 0 ? `${ordersOverdue} at risk` : "No risk"
                  }
                  tone={ordersOverdue > 0 ? "amber" : "grey"}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="At risk" value={ordersOverdue} tone="amber" />
                <MiniStat
                  label="Blocked"
                  value={blockedCount == null ? "—" : blockedCount}
                  tone={blockedCount && blockedCount > 0 ? "red" : "grey"}
                />
              </div>

              <div className="mt-3 border-t border-white/10 pt-3">
                <SidebarNav slug={hotel.slug} />
              </div>
            </DarkCard>
          </aside>

          {/* Main */}
          <section className="min-w-0 space-y-4">
            {/* KPI strip (matches screenshot row) */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <KpiTile label="Rooms" value={total ? `${total}` : "—"} sub="Total rooms" />
              <KpiTile
                label="Active tasks"
                value={`${ordersTotal}`}
                sub="Open requests"
              />
              <KpiTile
                label="At risk tasks"
                value={`${ordersOverdue}`}
                sub={`Over ${targetMin} min`}
                accent="amber"
              />
              <KpiTile
                label="Avg response"
                value={avgResponseMin == null ? "—" : `${avgResponseMin}m`}
                sub="From SLA metrics"
              />
              <KpiTile
                label="Guest satisfaction"
                value={guestPrimary ?? "—"}
                sub={
                  typeof npsScore === "number" && (npsResponses ?? 0) > 0
                    ? `${npsResponses} responses`
                    : typeof avgRating30d === "number"
                      ? "Avg rating (30d)"
                      : "Not available"
                }
                accent={guestTone === "green" ? "emerald" : guestTone === "amber" ? "amber" : guestTone === "red" ? "rose" : undefined}
              />
            </div>

            {/* Row: Ring + Trend */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-4">
                <CardHeader
                  title="Active Tasks"
                  right={
                    <StatusBadge
                      label={
                        slaPct == null
                          ? "SLA —"
                          : slaToneLevel === "green"
                            ? "On track"
                            : slaToneLevel === "amber"
                              ? "Watch"
                              : slaToneLevel === "red"
                                ? "Risk"
                                : "SLA —"
                      }
                      tone={slaToneLevel}
                    />
                  }
                />
                <div className="mt-3 grid grid-cols-[140px,minmax(0,1fr)] gap-4 items-center">
                  <RingGauge
                    value={ordersTotal}
                    // fill uses SLA % if available; otherwise fills based on occupancy (still real)
                    pct={
                      slaPct != null
                        ? slaPct
                        : occPct != null
                          ? Math.min(100, Math.max(0, occPct))
                          : 0
                    }
                    subtitle="Active tasks"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200">
                      {ordersTotal === 0
                        ? "No open requests right now."
                        : `${ordersTotal} open requests across services.`}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Overdue (&gt;{targetMin}m):{" "}
                      <span className="text-slate-200 font-medium">
                        {ordersOverdue}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <MiniStat label="Occupancy" value={`${occPct || 0}%`} tone={occupancyTone(occPct)} />
                      <MiniStat
                        label="Arrivals"
                        value={arrivalsCount}
                        tone={arrivalsCount > 0 ? "green" : "grey"}
                      />
                    </div>
                  </div>
                </div>
              </DarkCard>

              <DarkCard className="p-4 xl:col-span-2">
                <CardHeader
                  title="Alerts Trend"
                  subtitle="Request volume trend (real data only)"
                  right={
                    <div className="flex items-center gap-2">
                      <MiniBadge label={`${ordersOverdue} at risk`} tone={ordersOverdue > 0 ? "amber" : "grey"} />
                      <MiniBadge label={`Occ ${occPct || 0}%`} tone={occupancyTone(occPct)} />
                    </div>
                  }
                />
                <div className="mt-3">
                  {/* We reuse your existing chart component (no fake data). */}
                  {hasSeries((metrics as any)?.taskVolume) ? (
                    <TaskVolumeChart
                      // @ts-expect-error - chart expects its own type; we pass what dashboardApi returns
                      data={(metrics as any)?.taskVolume || []}
                      loading={!metrics}
                    />
                  ) : (
                    <EmptyState text="Not available" />
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniStat label="Blocked" value={blockedCount == null ? "—" : blockedCount} tone={blockedCount && blockedCount > 0 ? "red" : "grey"} />
                  <MiniStat label="Active" value={ordersTotal} tone={ordersTotal > 0 ? "green" : "grey"} />
                  <MiniStat label="At risk" value={ordersOverdue} tone={ordersOverdue > 0 ? "amber" : "grey"} />
                </div>
              </DarkCard>
            </div>

            {/* Row: Task Summary + Issue Breakdown */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-4 xl:col-span-2">
                <CardHeader
                  title="Task Summary"
                  subtitle="Latest open requests (pilot-safe)"
                  right={
                    <Link
                      to={`/ops?slug=${encodeURIComponent(hotel.slug)}`}
                      className="text-xs text-slate-300 hover:text-slate-100 underline"
                    >
                      Open ops →
                    </Link>
                  }
                />
                <div className="mt-3">
                  {liveOrders.length === 0 ? (
                    <EmptyState text="No live requests right now." />
                  ) : (
                    <DarkTable>
                      <thead>
                        <tr>
                          <Th>Task</Th>
                          <Th>Status</Th>
                          <Th>Age</Th>
                          <Th className="text-right">SLA</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveOrders.slice(0, 8).map((o) => {
                          const mins = ageMin(o.created_at);
                          const breach = mins > targetMin;
                          return (
                            <tr key={o.id} className="border-t border-white/10">
                              <Td>
                                <div className="font-medium text-slate-100">
                                  #{o.id.slice(0, 8)}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {fmtTime(o.created_at)}
                                </div>
                              </Td>
                              <Td>
                                <span className="text-slate-200">{o.status}</span>
                              </Td>
                              <Td>
                                <span className="text-slate-200">{mins}m</span>
                              </Td>
                              <Td className="text-right">
                                <StatusBadge
                                  label={breach ? "At risk" : "On time"}
                                  tone={breach ? "amber" : "green"}
                                />
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DarkTable>
                  )}
                </div>
              </DarkCard>

              <DarkCard className="p-4">
                <CardHeader
                  title="Issue Breakdown"
                  subtitle="Open requests by state"
                />
                <div className="mt-3">
                  {liveOrders.length === 0 ? (
                    <EmptyState text="Not available" />
                  ) : (
                    <IssueBreakdown orders={liveOrders} targetMin={targetMin} />
                  )}
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Recent feedback
                  </div>
                  <div className="mt-2">
                    {typeof npsScore === "number" && (npsResponses ?? 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">
                            NPS {npsScore}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {npsResponses} responses (30d)
                          </div>
                        </div>
                        <StatusBadge label="Guest" tone="green" />
                      </div>
                    ) : typeof avgRating30d === "number" ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">
                            Rating {avgRating30d.toFixed(1)}/5
                          </div>
                          <div className="text-[11px] text-slate-400">Last 30 days</div>
                        </div>
                        <StatusBadge label="Guest" tone={ratingTone(avgRating30d)} />
                      </div>
                    ) : (
                      <EmptyState text="Not available" />
                    )}
                  </div>
                </div>
              </DarkCard>
            </div>

            {/* Row: SLA chart + AI Ops + Usage (kept, but styled dark and pilot-safe) */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-4 xl:col-span-2">
                <CardHeader
                  title="Avg Resolution"
                  subtitle={`SLA performance (target ${targetMin}m).`}
                  right={
                    slaPct == null ? (
                      <MiniBadge label="SLA —" tone="grey" />
                    ) : (
                      <MiniBadge label={`SLA ${slaPct}%`} tone={slaToneLevel} />
                    )
                  }
                />
                <div className="mt-3">
                  {hasSeries(slaSeries) ? (
                    <SlaPerformanceChart
                      // @ts-expect-error chart expects its own shape
                      data={slaSeries || []}
                      loading={!metrics}
                    />
                  ) : (
                    <EmptyState text="Not available" />
                  )}
                </div>
              </DarkCard>

              <DarkCard className="p-4">
                <CardHeader title="AI Ops Snapshot" subtitle="From connected ticket history." />
                <div className="mt-3">
                  {!HAS_FUNCS ? (
                    <EmptyState text="Not available" />
                  ) : opsLoading ? (
                    <EmptyState text="Analyzing…" />
                  ) : (opsHeatmap && opsHeatmap.length) || (staffingPlan && staffingPlan.length) ? (
                    <div className="space-y-3">
                      <AiOpsMiniSummary heatmap={opsHeatmap} staffingPlan={staffingPlan} />
                    </div>
                  ) : (
                    <EmptyState text="Not available" />
                  )}
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      AI usage
                    </div>
                    <MiniBadge label="Owner view" tone="grey" />
                  </div>
                  <div className="mt-3">
                    <UsageMeter hotelId={hotel.id} />
                  </div>
                </div>
              </DarkCard>
            </div>
          </section>

          {/* Right rail */}
          <aside className="space-y-4">
            <DarkCard className="p-4">
              <CardHeader title="Staff Performance" subtitle="Active staff members" />
              <div className="mt-3">
                <StaffList data={staffPerf} />
              </div>

              {HAS_HRMS && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Attendance
                    </div>
                    <Link
                      to={`/owner/${hotel.slug}/hrms`}
                      className="text-[11px] text-slate-300 hover:text-slate-100 underline"
                    >
                      Open →
                    </Link>
                  </div>
                  <div className="mt-2">
                    <AttendanceMini data={hrms} />
                  </div>
                </div>
              )}
            </DarkCard>

            <DarkCard className="p-4">
              <CardHeader title="Guest Satisfaction" subtitle="NPS / Rating signal" />
              <div className="mt-3">
                <SatisfactionPanel
                  hotelName={hotel.name}
                  npsScore={npsScore}
                  npsResponses={npsResponses}
                  avgRating30d={avgRating30d}
                />
              </div>
            </DarkCard>

            {HAS_WORKFORCE && (
              <DarkCard className="p-4">
                <CardHeader title="Workforce" subtitle="Open roles (property-scoped)" />
                <div className="mt-3">
                  <WorkforceMini jobs={workforceJobs} loading={workforceLoading} />
                </div>
              </DarkCard>
            )}

            <DarkCard className="p-4">
              <CardHeader title="Support" subtitle="Owner help & escalation" />
              <div className="mt-3 space-y-2">
                <Link
                  to="/owner"
                  className="block rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  Switch property
                </Link>
                <a
                  href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help"
                  className="block rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  Contact support
                </a>
              </div>
            </DarkCard>
          </aside>
        </div>
      </div>
    </main>
  );
}

/** ========= UI (dark) components ========= */

function DashboardTopBar({
  title,
  hotelName,
  city,
  dateLabel,
  slug,
}: {
  title: string;
  hotelName: string;
  city: string | null;
  dateLabel: string;
  slug: string;
}) {
  return (
    <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <span className="text-[11px] text-slate-400">•</span>
          <div className="min-w-0 text-[11px] text-slate-300 truncate">
            {hotelName}
            {city ? ` · ${city}` : ""} · {dateLabel}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/owner"
          className="hidden lg:inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
        >
          Switch
        </Link>
        {HAS_PRICING && (
          <Link
            to={`/owner/${slug}/pricing`}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
          >
            Pricing
          </Link>
        )}
        <Link
          to={`/owner/${slug}/settings`}
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
        >
          Settings
        </Link>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 p-2 hover:bg-white/10"
          title="Sync"
        >
          <SvgSync />
        </button>

        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-slate-100">
            GM
          </div>
          <div className="leading-tight">
            <div className="text-[12px] font-medium text-slate-100">Owner</div>
            <div className="text-[10px] text-slate-400">View</div>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 p-2 hover:bg-white/10"
          title="Menu"
        >
          <SvgMenu />
        </button>
      </div>
    </header>
  );
}

function SidebarNav({ slug }: { slug: string }) {
  const encodedSlug = encodeURIComponent(slug);

  const servicesHref = `/owner/services?slug=${encodedSlug}`;
  const opsAnalyticsHref = `/ops/analytics?slug=${encodedSlug}`;
  const opsHref = `/ops?slug=${encodedSlug}`;
  const settingsHref = `/owner/${slug}/settings`;

  return (
    <nav aria-label="Owner dashboard navigation" className="space-y-1 text-sm">
      <NavItem href="#top" label="Overview" active />
      <NavItem to={opsHref} label="Operations" />
      <NavItem to={opsAnalyticsHref} label="Task trend" />
      <NavItem to={servicesHref} label="Departments / SLAs" />
      {HAS_STAFF_SHIFTS && <NavItem to={`/owner/${slug}/staff-shifts`} label="Staff & Shifts" />}
      <NavItem to={settingsHref} label="Settings" />
      {HAS_CALENDAR && <NavItem to="../bookings/calendar" label="Calendar" />}
    </nav>
  );
}

function NavItem({
  label,
  to,
  href,
  active,
}: {
  label: string;
  to?: string;
  href?: string;
  active?: boolean;
}) {
  const base =
    "flex items-center justify-between rounded-xl px-3 py-2 text-[13px] transition-colors";
  const cls = active
    ? `${base} bg-white/10 text-slate-50`
    : `${base} text-slate-300 hover:bg-white/10 hover:text-slate-50`;

  if (href) {
    return (
      <a href={href} className={cls}>
        <span>{label}</span>
        <span className="text-slate-500">→</span>
      </a>
    );
  }

  if (to) {
    return (
      <Link to={to} className={cls}>
        <span>{label}</span>
        <span className="text-slate-500">→</span>
      </Link>
    );
  }

  return null;
}

function DarkCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#0B1220]/70 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "amber" | "emerald" | "rose";
}) {
  const accentCls =
    accent === "amber"
      ? "from-amber-500/18"
      : accent === "emerald"
        ? "from-emerald-500/18"
        : accent === "rose"
          ? "from-rose-500/18"
          : "from-white/8";

  return (
    <DarkCard className={`p-3 bg-gradient-to-b ${accentCls} to-transparent`}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div> : null}
    </DarkCard>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "green" | "amber" | "red" | "grey";
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-100">{value}</div>
        <span className={`h-2.5 w-2.5 rounded-full ${dotTone(tone)}`} />
      </div>
    </div>
  );
}

function dotTone(t: "green" | "amber" | "red" | "grey") {
  return {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    red: "bg-rose-400",
    grey: "bg-slate-500",
  }[t];
}

function MiniBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "red" | "grey";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${toneClass(
        tone
      )}`}
    >
      {label}
    </span>
  );
}

function RingGauge({
  value,
  pct,
  subtitle,
}: {
  value: number;
  pct: number;
  subtitle: string;
}) {
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const ring = {
    background: `conic-gradient(rgba(245,158,11,0.95) ${safePct}%, rgba(255,255,255,0.08) 0)`,
  } as const;

  return (
    <div className="flex items-center justify-center">
      <div
        className="relative h-32 w-32 rounded-full p-[10px]"
        style={ring}
        aria-label={`${subtitle}: ${value}`}
      >
        <div className="h-full w-full rounded-full bg-[#0B1220]/90 border border-white/10 grid place-items-center">
          <div className="text-center">
            <div className="text-2xl font-semibold text-slate-100">{value}</div>
            <div className="text-[11px] text-slate-400">{subtitle}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
      {text}
    </div>
  );
}

/** ========= Tables ========= */

function DarkTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`bg-white/5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-slate-200 ${className}`}>
      {children}
    </td>
  );
}

/** ========= Breakdown ========= */

function IssueBreakdown({ orders, targetMin }: { orders: LiveOrder[]; targetMin: number }) {
  const classify = (status: string) => {
    const s = (status || "").toLowerCase();
    const isNew = ["open", "new", "created", "requested"].some((k) => s.includes(k));
    const isProgress = ["preparing", "in_progress", "accepted", "assigned", "working"].some((k) =>
      s.includes(k)
    );
    const isPaused = ["paused", "blocked", "hold"].some((k) => s.includes(k));
    return { isNew, isProgress, isPaused };
  };

  const newCount = orders.filter((o) => classify(o.status).isNew).length;
  const inProgress = orders.filter((o) => classify(o.status).isProgress).length;
  const blocked = orders.filter((o) => classify(o.status).isPaused).length;
  const overdue = orders.filter((o) => ageMin(o.created_at) > targetMin).length;
  const other = Math.max(0, orders.length - newCount - inProgress - blocked);

  return (
    <div className="space-y-2">
      <BreakRow label="New" value={newCount} tone={newCount > 0 ? "green" : "grey"} />
      <BreakRow label="In progress" value={inProgress} tone={inProgress > 0 ? "amber" : "grey"} />
      <BreakRow label="Blocked" value={blocked} tone={blocked > 0 ? "red" : "grey"} />
      <BreakRow label={`Overdue (> ${targetMin}m)`} value={overdue} tone={overdue > 0 ? "amber" : "grey"} />
      <BreakRow label="Other" value={other} tone={other > 0 ? "grey" : "grey"} />
      <div className="pt-2 text-[11px] text-slate-400">
        Service-type breakdown is not available in this view.
      </div>
    </div>
  );
}

function BreakRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "grey";
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-sm text-slate-200">{label}</div>
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold text-slate-100">{value}</div>
        <span className={`h-2.5 w-2.5 rounded-full ${dotTone(tone)}`} />
      </div>
    </div>
  );
}

/** ========= Right rail blocks ========= */

function StaffList({ data }: { data: StaffPerf[] | null }) {
  if (!data || data.length === 0) return <EmptyState text="Not available" />;

  return (
    <div className="space-y-2">
      {data.slice(0, 6).map((r) => (
        <div
          key={r.staff_id}
          className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-100 truncate">
              {r.display_name}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {r.department_name || r.role}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge label={r.is_online ? "Online" : "Away"} tone={r.is_online ? "green" : "grey"} />
          </div>
        </div>
      ))}
      {data.length > 6 ? (
        <div className="text-[11px] text-slate-400">+{data.length - 6} more</div>
      ) : null}
    </div>
  );
}

function AttendanceMini({ data }: { data: HrmsSnapshot | null }) {
  if (!data) return <EmptyState text="Not available" />;

  const tone =
    data.attendance_pct_today >= 85 ? "green" : data.attendance_pct_today >= 70 ? "amber" : "red";

  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="Present" value={data.present_today} tone={tone} />
      <MiniStat label="Absent" value={data.absent_today} tone={data.absent_today > 0 ? "amber" : "grey"} />
      <MiniStat label="Late" value={data.late_today} tone={data.late_today > 0 ? "amber" : "grey"} />
      <MiniStat label="Attendance" value={`${data.attendance_pct_today}%`} tone={tone} />
    </div>
  );
}

function SatisfactionPanel({
  hotelName,
  npsScore,
  npsResponses,
  avgRating30d,
}: {
  hotelName: string;
  npsScore: number | null;
  npsResponses: number | null;
  avgRating30d: number | null;
}) {
  const hasNps = typeof npsScore === "number" && (npsResponses ?? 0) > 0;
  const hasRating = typeof avgRating30d === "number" && !Number.isNaN(avgRating30d);

  if (!hasNps && !hasRating) return <EmptyState text="Not available" />;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {hotelName}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">
            {hasNps ? `NPS ${npsScore}` : `Rating ${avgRating30d!.toFixed(1)}/5`}
          </div>
          <StatusBadge label="Guest" tone={hasNps ? "green" : ratingTone(avgRating30d)} />
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          {hasNps ? `${npsResponses} responses (30d)` : "Avg rating (30d)"}
        </div>
      </div>
    </div>
  );
}

function WorkforceMini({
  jobs,
  loading,
}: {
  jobs: WorkforceJobSummary[] | null;
  loading: boolean;
}) {
  if (loading) return <EmptyState text="Loading roles…" />;
  if (!jobs || jobs.length === 0) return <EmptyState text="Not available" />;

  const openJobs = jobs.filter((j) =>
    (j.status || "open").toLowerCase().includes("open")
  ).length;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-sm font-semibold text-slate-100">
          {openJobs} open role{openJobs === 1 ? "" : "s"}
        </div>
        <div className="text-[11px] text-slate-400">{jobs.length} total roles</div>
      </div>

      {jobs.slice(0, 3).map((j) => {
        const status = (j.status || "open").toLowerCase();
        const isOpen = status.includes("open") || status === "draft";
        return (
          <div
            key={j.id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">
                {j.title || j.department || "Role"}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {(j.city || "").trim() || "Local"} · {j.status || "Open"}
              </div>
            </div>
            <StatusBadge label={isOpen ? "Hiring" : "Closed"} tone={isOpen ? "green" : "grey"} />
          </div>
        );
      })}
    </div>
  );
}

/** ========= AI mini summary ========= */

function AiOpsMiniSummary({
  heatmap,
  staffingPlan,
}: {
  heatmap: OpsHeatmapPoint[] | null;
  staffingPlan: StaffingPlanRow[] | null;
}) {
  const plan = staffingPlan || [];
  const heat = heatmap || [];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          Suggested staffing (today)
        </div>
        {plan.length === 0 ? (
          <div className="mt-2 text-sm text-slate-300">Not available</div>
        ) : (
          <div className="mt-2 space-y-2">
            {plan.slice(0, 3).map((row) => (
              <div key={row.department} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100">
                    {row.department}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Recommend {row.recommended_count} (min {row.min_count}, max{" "}
                    {row.max_count})
                  </div>
                </div>
                <StatusBadge label="AI" tone="grey" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          Heatmap (7d)
        </div>
        {heat.length === 0 ? (
          <div className="mt-2 text-sm text-slate-300">Not available</div>
        ) : (
          <div className="mt-2 text-[11px] text-slate-400">
            {heat.length} buckets analyzed. Open full view in Ops Analytics for details.
          </div>
        )}
      </div>
    </div>
  );
}

/** ========= Access help (dark) ========= */
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-1 text-lg font-semibold text-slate-100">
        Property access needed
      </div>
      <p className="mb-4 text-sm text-slate-300">{message}</p>
      <div className="flex flex-wrap gap-2">
        {hasValidSlug ? (
          <Link
            to={`/owner/access?slug=${encodeURIComponent(slug)}`}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
          >
            Request Access
          </Link>
        ) : null}
        <Link
          to="/owner"
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
        >
          Owner Home
        </Link>
        <Link
          to="/invite/accept"
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
        >
          Accept Invite
        </Link>
        {inviteToken ? (
          <Link
            to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`}
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
          >
            Accept via Code
          </Link>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Tip: If you received an email invite, open it on this device so we can
        auto-fill your invite code.
      </p>
    </div>
  );
}

/** ========= Utils ========= */
function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
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

function ageMin(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/** ========= Icons ========= */
function SvgSync() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 12a8 8 0 0 0-14.9-4M4 12a8 8 0 0 0 14.9 4"
        stroke="rgba(226,232,240,0.9)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M5 4v4h4"
        stroke="rgba(226,232,240,0.9)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 20v-4h-4"
        stroke="rgba(226,232,240,0.9)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SvgMenu() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="rgba(226,232,240,0.9)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
