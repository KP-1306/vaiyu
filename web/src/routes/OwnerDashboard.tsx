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

import { useTicketsRealtime } from "../hooks/useTicketsRealtime";
import UsageMeter from "../components/UsageMeter";
import {
  Users,
  Filter,
  LayoutDashboard,
  BedDouble,
  Clock,
  UserCheck,
  MessageSquare,
  AlertTriangle,
  LogOut,
  Settings
} from "lucide-react";
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

type LiveTask = {
  id: string;
  created_at: string;
  status: string;
  title?: string;
};

type KpiSummary = {
  total_tickets: number;
  completed_within_sla: number;
  breached_sla: number;
  at_risk_tickets: number;
  sla_compliance_percent: number | null;
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

/** ========= Hook-safe helpers ========= */
function computeAvgResponseMin(slaSeries?: any[] | null): number | null {
  const last =
    Array.isArray(slaSeries) && slaSeries.length
      ? slaSeries[slaSeries.length - 1]
      : null;

  const v =
    typeof last?.avg_minutes === "number"
      ? last.avg_minutes
      : typeof last?.avg_completion_min === "number"
        ? last.avg_completion_min
        : typeof last?.avg_response_min === "number"
          ? last.avg_response_min
          : null;

  return v == null || Number.isNaN(v) ? null : Math.round(v);
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

  // SLA + Live tasks
  const [slaTargetMin, setSlaTargetMin] = useState<number | null>(null);
  const [liveTasks, setLiveTasks] = useState<LiveTask[]>([]);
  const [kpiSummary, setKpiSummary] = useState<KpiSummary | null>(null);
  const [activeTaskCount, setActiveTaskCount] = useState<number>(0);

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
  const [showMobileNav, setShowMobileNav] = useState(false);

  // Detail drawer state
  type DrawerType = null | 'rooms' | 'tasks' | 'atRisk' | 'sla' | 'satisfaction' | 'staff' | 'arrivals';
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);

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
    let unsubscribe = () => { };

    (async () => {
      setLoading(true);
      setAccessProblem(null);
      setWorkforceJobs(null);
      setWorkforceLoading(false);

      // 1) Hotel (RLS-gated) and Base Member Check
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id,name,slug,city, hotel_members!inner(id, user_id)")
        .eq("slug", slug)
        .eq("hotel_members.user_id", (await supabase.auth.getUser()).data.user?.id)
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

      const hotelId = hotelRow.id;

      // 1b) Detailed Role Check (Block regular STAFF)
      const memberId = hotelRow.hotel_members?.[0]?.id;
      if (memberId) {
        const { data: rolesData, error: rolesErr } = await supabase
          .from("hotel_member_roles")
          .select("hotel_roles(code)")
          .eq("hotel_member_id", memberId);

        if (rolesErr || !rolesData || rolesData.length === 0) {
          setAccessProblem("Access denied: You must be an Owner or Manager to view the property dashboard.");
          setLoading(false);
          return;
        }

        const hasDashboardAccess = rolesData.some((r: any) =>
          ["OWNER", "ADMIN", "MANAGER", "OPS_MANAGER"].includes(r.hotel_roles?.code)
        );

        if (!hasDashboardAccess) {
          setAccessProblem("Access denied: You must be an Owner or Manager to view the property dashboard.");
          setLoading(false);
          return;
        }
      }

      setHotel({
        id: hotelRow.id,
        name: hotelRow.name,
        slug: hotelRow.slug,
        city: hotelRow.city
      });

      // 2) Ops lists (non-blocking)
      try {
        const nowIso = new Date().toISOString();
        const [{ data: arr }, { data: inh }, { data: dep }] =
          await Promise.all([
            supabase
              .from("stays")
              .select("id,guest_id,check_in_start:scheduled_checkin_at,check_out_end:scheduled_checkout_at,status,room:room_id")
              .eq("hotel_id", hotelId)
              .gte("scheduled_checkin_at", todayStartISO)
              .lt("scheduled_checkin_at", tomorrowStartISO)
              .order("scheduled_checkin_at", { ascending: true }),
            supabase
              .from("stays")
              .select("id,guest_id,check_in_start:scheduled_checkin_at,check_out_end:scheduled_checkout_at,status,room:room_id")
              .eq("hotel_id", hotelId)
              .lte("scheduled_checkin_at", nowIso)
              .gte("scheduled_checkout_at", nowIso)
              .order("scheduled_checkout_at", { ascending: true }),
            supabase
              .from("stays")
              .select("id,guest_id,check_in_start:scheduled_checkin_at,check_out_end:scheduled_checkout_at,status,room:room_id")
              .eq("hotel_id", hotelId)
              .gte("scheduled_checkout_at", todayStartISO)
              .lt("scheduled_checkout_at", tomorrowStartISO)
              .order("scheduled_checkout_at", { ascending: true }),
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

      // 5) SLA target + Live tasks + KPI Summary
      try {
        const { data: sla } = await supabase
          .from("sla_targets")
          .select("target_minutes")
          .eq("hotel_id", hotelId)
          .eq("key", "ticket_resolution_min")
          .maybeSingle();

        const { data: summaryData } = await supabase
          .from("v_owner_kpi_summary")
          .select("*")
          .eq("hotel_id", hotelId)
          .maybeSingle();

        const { count: activeCount } = await supabase
          .from("tickets")
          .select("*", { count: 'exact', head: true })
          .eq("hotel_id", hotelId)
          .in("status", ["NEW", "IN_PROGRESS", "BLOCKED"]);

        const { data: tasksData } = await supabase
          .from("tickets")
          .select("id,created_at,status,title")
          .eq("hotel_id", hotelId)
          .in("status", ["NEW", "IN_PROGRESS", "BLOCKED"])
          .order("created_at", { ascending: false })
          .limit(50);

        if (!alive) return;
        setSlaTargetMin(sla?.target_minutes ?? 20);
        setKpiSummary(summaryData ?? null);
        setActiveTaskCount(activeCount ?? 0);
        setLiveTasks((tasksData as LiveTask[]) || []);
      } catch {
        setSlaTargetMin(20);
        setKpiSummary(null);
        setActiveTaskCount(0);
        setLiveTasks([]);
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
        // Metric load failed silently
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
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  if (accessProblem) {
    return (
      <main className="min-h-screen bg-[#0B0E14] text-slate-200">
        <div className="max-w-3xl mx-auto p-6">
          <AccessHelp
            slug={slug}
            message={accessProblem}
            inviteToken={inviteToken || undefined}
          />
        </div>
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <div className="rounded-2xl border border-slate-800/50 bg-[#151A25] p-8 text-center max-w-md">
          <div className="text-4xl mb-3">🏨</div>
          <div className="text-lg font-semibold mb-2 text-white">No property to show</div>
          <p className="text-sm text-slate-400">Open your property from the Owner Home.</p>
          <div className="mt-4">
            <Link to="/owner" className="inline-flex items-center rounded-lg border border-slate-700 bg-[#0B0E14] px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors">Owner Home</Link>
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
  const tasksTotal = activeTaskCount;
  const tasksAtRisk = kpiSummary?.at_risk_tickets ?? 0;

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

  // ✅ FIX: hook-safe computation (no useMemo hook here)
  const avgResponseMin: number | null = computeAvgResponseMin(slaSeries);

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

  /** ======= Shift-aware greeting ======= */
  const hour = now.getHours();
  const shiftGreeting = hour >= 6 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : hour >= 17 && hour < 22 ? "Good evening" : "Night operations";
  const shiftIcon = hour >= 6 && hour < 12 ? "☀️" : hour >= 12 && hour < 17 ? "🌤️" : hour >= 17 && hour < 22 ? "🌙" : "🌃";

  /** ======= Render (operations command center) ======= */
  return (
    <main className="min-h-screen bg-[#0B0E14] text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Breadcrumb strip */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 text-xs font-medium text-slate-400 border-b border-slate-800/50 bg-[#0B0E14] sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link to="/owner" className="hover:text-white transition-colors truncate">Console</Link>
          <span className="text-slate-700">/</span>
          <span className="text-slate-200 truncate">Dashboard</span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-mono text-emerald-500/80">Live</span>
        </div>
      </div>

      {/* Mobile Drawer */}
      {showMobileNav && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMobileNav(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-[#0B0E14] border-r border-slate-800/50 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <div className="text-sm font-bold text-white uppercase tracking-widest">Navigation</div>
              <button onClick={() => setShowMobileNav(false)} className="p-2 text-slate-400 hover:text-white">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <SidebarNav slug={hotel.slug} onNavClick={() => setShowMobileNav(false)} />
          </aside>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">
        {/* Header: Greeting + Hotel + Controls */}
        <header className="flex flex-col gap-5 pb-6 border-b border-slate-800/50">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile Menu Button - Moved to Left for Visibility */}
              <button
                type="button"
                onClick={() => setShowMobileNav(true)}
                className="inline-flex lg:hidden items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 hover:bg-emerald-500/20 transition-colors text-emerald-400 shrink-0"
                title="Menu"
              >
                <SvgMenu />
              </button>

              <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 text-lg">
                {shiftIcon}
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                  {shiftGreeting}, <span className="text-emerald-400 font-extrabold">{hotel.name}</span>
                </h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[11px] sm:text-xs text-slate-500">
                  {hotel.city && <span className="truncate">{hotel.city}</span>}
                  {hotel.city && <span className="h-1 w-1 rounded-full bg-slate-700 shrink-0" />}
                  <span>{dateLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#151A25] p-2.5 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white" title="Refresh">
                <SvgSync />
              </button>
              <UserProfileMenu slug={hotel.slug} />
            </div>
          </div>


        </header>

        <div className="mt-6 flex flex-col lg:grid gap-6 lg:grid-cols-[200px,1fr] xl:grid-cols-[200px,1fr,300px]">
          {/* ─── Left Nav (grouped) ─── */}
          <aside className="hidden lg:block space-y-4 sticky top-24 self-start">
            <SidebarNav slug={hotel.slug} />
          </aside>

          {/* ─── Main Content ─── */}
          <section className="min-w-0 flex flex-col gap-5">
            {/* 🆕 Mobile Quick Navigation Hub */}
            <div className="grid grid-cols-2 gap-3 lg:hidden">
              <Link to={`/owner/${hotel.slug}/analytics`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">📊</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Owner Analytics</div>
              </Link>
              <Link to={`/ops?slug=${encodeURIComponent(hotel.slug)}`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🕹️</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ops Board</div>
              </Link>

              <Link to={`/owner/${hotel.slug}/arrivals`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🛬</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Arrivals</div>
              </Link>
              <Link to={`/owner/${hotel.slug}/housekeeping`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🧹</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">HK</div>
              </Link>

              <Link to={`/checkin?slug=${encodeURIComponent(hotel.slug)}`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🛎️</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Front Desk</div>
              </Link>
              <Link to={`/owner/${hotel.slug}/import-bookings`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">📥</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bookings</div>
              </Link>

              {/* <Link to={`/owner/${hotel.slug}/payments`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">💰</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Finance</div>
              </Link> */}
              <Link to={`/owner/${hotel.slug}/staff-shifts`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">👥</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Staff</div>
              </Link>

              <Link to={`/owner/services?slug=${encodeURIComponent(hotel.slug)}`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🏢</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Depts</div>
              </Link>
              <Link to="/kitchen" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🍳</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Kitchen</div>
              </Link>

              <Link to={`/owner/${hotel.slug}/settings`} className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">⚙️</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Settings</div>
              </Link>
              <Link to="/owner" className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-lg mb-1">🔄</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Switch</div>
              </Link>
            </div>

            {/* 🔴 Priority 1: Alert Banner */}
            {(tasksAtRisk > 0 || (blockedCount ?? 0) > 0) && (
              <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 backdrop-blur">
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                  <AlertTriangle size={16} />
                  Immediate Attention
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {tasksAtRisk > 0 && (
                    <span className="font-medium text-slate-300">
                      <span className="text-rose-400 font-bold">{tasksAtRisk}</span> tasks at risk
                    </span>
                  )}
                  {(blockedCount ?? 0) > 0 && (
                    <span className="font-medium text-slate-300">
                      <span className="text-rose-400 font-bold">{blockedCount}</span> SLA breaches
                    </span>
                  )}
                </div>
                <Link
                  to={`/ops?slug=${encodeURIComponent(hotel.slug)}`}
                  className="ml-auto text-xs font-semibold text-rose-300 hover:text-white bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/30 transition-colors"
                >
                  Open Ops Board →
                </Link>
              </div>
            )}

            {/* ✅ All clear banner (when no issues) */}
            {tasksAtRisk === 0 && (blockedCount ?? 0) === 0 && tasksTotal === 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
                  <UserCheck size={16} />
                </div>
                <div className="text-sm text-emerald-300 font-medium">All clear — no open requests or SLA breaches this shift ✓</div>
              </div>
            )}

            {/* 📊 Priority 2: KPI Strip (color-coded, clickable) */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div onClick={() => setActiveDrawer('rooms')} className="cursor-pointer">
                <KpiTile label="Rooms" value={total ? `${total}` : "—"} sub={`${occupied} occupied`} icon={BedDouble} />
              </div>
              <div onClick={() => setActiveDrawer('tasks')} className="cursor-pointer">
                <KpiTile label="Active Tasks" value={`${tasksTotal}`} sub={tasksTotal === 0 ? "All clear" : "Open requests"} accent={tasksTotal > 0 ? "amber" : "emerald"} icon={Clock} />
              </div>
              <div onClick={() => setActiveDrawer('atRisk')} className="cursor-pointer">
                <KpiTile label="At Risk" value={`${tasksAtRisk}`} sub={tasksAtRisk === 0 ? "Under SLA" : `Exceeding targets`} accent={tasksAtRisk > 0 ? "rose" : "emerald"} icon={AlertTriangle} />
              </div>
              <div onClick={() => setActiveDrawer('sla')} className="cursor-pointer">
                <KpiTile label="Avg Response" value={avgResponseMin == null ? "—" : `${avgResponseMin}m`} sub="SLA Performance" icon={LayoutDashboard} />
              </div>
              <div onClick={() => setActiveDrawer('satisfaction')} className="cursor-pointer">
                <KpiTile
                  label="Guest Satisfaction"
                  value={guestPrimary ?? "—"}
                  sub={typeof npsScore === "number" && (npsResponses ?? 0) > 0 ? `NPS Score · ${npsResponses} res` : typeof avgRating30d === "number" ? "Average Rating" : "No feedback data"}
                  accent={guestTone === "green" ? "emerald" : guestTone === "amber" ? "amber" : guestTone === "red" ? "rose" : undefined}
                  icon={MessageSquare}
                />
              </div>
            </div>

            {/* 🔄 Priority 3: Operations Pulse (Active Tasks + Trend) */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-5">
                <CardHeader
                  title="Shift Workload"
                  right={
                    <StatusBadge
                      label={slaPct == null ? "SLA —" : slaToneLevel === "green" ? "On track" : slaToneLevel === "amber" ? "Watch" : "Risk"}
                      tone={slaToneLevel}
                    />
                  }
                />
                <div className="mt-4 flex flex-col gap-3">
                  <BreakRow label="Open Requests" value={tasksTotal} tone={tasksTotal > 0 ? "green" : "grey"} />
                  <BreakRow label="At Risk (> SLA)" value={tasksAtRisk} tone={tasksAtRisk > 0 ? "amber" : "grey"} />
                  <BreakRow label="Blocked Issues" value={blockedCount ?? 0} tone={(blockedCount ?? 0) > 0 ? "red" : "grey"} />
                </div>
              </DarkCard>

              <DarkCard className="p-5 xl:col-span-2">
                <CardHeader
                  title="Operations Pulse"
                  subtitle="Request volume (live data)"
                  right={
                    <div className="flex items-center gap-2">
                      <MiniBadge label={`${tasksAtRisk} at risk`} tone={tasksAtRisk > 0 ? "amber" : "grey"} />
                      <MiniBadge label={`Occ ${occPct || 0}%`} tone={occupancyTone(occPct)} />
                    </div>
                  }
                />
                <div className="mt-3">
                  {hasSeries((metrics as any)?.taskVolume) ? (
                    <TaskVolumeChart data={(metrics as any)?.taskVolume || []} loading={!metrics} />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] p-8 text-center">
                      <div className="text-2xl mb-2">📊</div>
                      <div className="text-sm text-slate-400">Operations data will appear here as requests flow through the system.</div>
                    </div>
                  )}
                </div>
              </DarkCard>
            </div>

            {/* 📋 Priority 4: Task Summary + Issue Breakdown */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-5 xl:col-span-2">
                <CardHeader
                  title="Live Requests"
                  subtitle="Latest open service requests"
                  right={
                    <Link to={`/ops?slug=${encodeURIComponent(hotel.slug)}`} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 px-2.5 py-1.5 rounded-lg transition-colors border border-emerald-500/20">
                      Open Ops Board →
                    </Link>
                  }
                />
                <div className="mt-3">
                  {liveTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] p-6 text-center">
                      <div className="text-2xl mb-2">✅</div>
                      <div className="text-sm text-slate-400">No live requests right now. Operations are running smoothly.</div>
                    </div>
                  ) : (
                    <DarkTable>
                      <thead>
                        <tr>
                          <Th>Task</Th>
                          <Th className="hidden sm:table-cell">Status</Th>
                          <Th>Age</Th>
                          <Th className="text-right">SLA</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveTasks.slice(0, 8).map((o) => {
                          const mins = ageMin(o.created_at);
                          const breach = mins > targetMin;
                          return (
                            <tr key={o.id} className="border-t border-white/10 hover:bg-white/[0.02] transition-colors">
                              <Td>
                                <div className="font-medium text-slate-100">{o.title || `#${o.id.slice(0, 8)}`}</div>
                                <div className="text-[11px] text-slate-500 sm:hidden">{o.status}</div>
                              </Td>
                              <Td className="hidden sm:table-cell"><span className="text-slate-200">{o.status}</span></Td>
                              <Td><span className={`font-mono text-sm ${breach ? "text-rose-400" : "text-slate-200"}`}>{mins}m</span></Td>
                              <Td className="text-right">
                                <StatusBadge label={breach ? "At risk" : "On time"} tone={breach ? "amber" : "green"} />
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DarkTable>
                  )}
                </div>
              </DarkCard>

              <DarkCard className="p-5">
                <CardHeader title="Issue Breakdown" subtitle="Open requests by state" />
                <div className="mt-3">
                  {liveTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] p-4 text-center text-sm text-slate-500">All clear</div>
                  ) : (
                    <IssueBreakdown orders={liveTasks} targetMin={targetMin} />
                  )}
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Recent feedback</div>
                  <div className="mt-2">
                    {typeof npsScore === "number" && (npsResponses ?? 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">NPS {npsScore}</div>
                          <div className="text-[11px] text-slate-400">{npsResponses} responses (30d)</div>
                        </div>
                        <StatusBadge label="Guest" tone="green" />
                      </div>
                    ) : typeof avgRating30d === "number" ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">Rating {avgRating30d.toFixed(1)}/5</div>
                          <div className="text-[11px] text-slate-400">Last 30 days</div>
                        </div>
                        <StatusBadge label="Guest" tone={ratingTone(avgRating30d)} />
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">No feedback data yet</div>
                    )}
                  </div>
                </div>
              </DarkCard>
            </div>

            {/* 📈 Priority 5: SLA Performance + AI Ops */}
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-5 xl:col-span-2">
                <CardHeader
                  title="SLA Performance"
                  subtitle={`Resolution trend (target ${targetMin}m)`}
                  right={
                    slaPct == null ? <MiniBadge label="SLA —" tone="grey" /> : <MiniBadge label={`SLA ${slaPct}%`} tone={slaToneLevel} />
                  }
                />
                <div className="mt-3">
                  {hasSeries(slaSeries) ? (
                    <SlaPerformanceChart data={slaSeries || []} loading={!metrics} />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] p-8 text-center">
                      <div className="text-2xl mb-2">📉</div>
                      <div className="text-sm text-slate-400">SLA performance data will appear after service requests are processed.</div>
                    </div>
                  )}
                </div>
              </DarkCard>
            </div>
          </section>

          {/* ─── Right Rail ─── */}
          <aside className="space-y-4 xl:block">
            {/* Quick Stats */}
            <div onClick={() => setActiveDrawer('arrivals')} className="cursor-pointer">
              <DarkCard className="p-4 hover:border-slate-700 transition-colors">
                <CardHeader title="Today's Snapshot" subtitle={dateLabel} />
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex justify-between items-center px-3 py-2.5 rounded-lg border border-slate-800/50 bg-[#0B0E14]">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${arrivalsCount > 0 ? 'bg-blue-400' : 'bg-slate-600'}`}></span>
                      Pending Arrivals
                    </div>
                    <span className="text-slate-100 font-bold text-sm">{arrivalsCount}</span>
                  </div>
                  <div className="flex justify-between items-center px-3 py-2.5 rounded-lg border border-slate-800/50 bg-[#0B0E14]">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${departuresCount > 0 ? 'bg-amber-400' : 'bg-slate-600'}`}></span>
                      Pending Departures
                    </div>
                    <span className="text-slate-100 font-bold text-sm">{departuresCount}</span>
                  </div>
                  <div className="flex justify-between items-center px-3 py-2.5 rounded-lg border border-emerald-500/10 bg-emerald-500/5">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-500/70 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                      Currently In-House
                    </div>
                    <span className="text-emerald-400 font-bold text-sm">{Array.isArray(inhouse) ? inhouse.length : 0}</span>
                  </div>
                </div>
              </DarkCard>
            </div>

            <div onClick={() => setActiveDrawer('staff')} className="cursor-pointer">
              <DarkCard className="p-4 hover:border-slate-700 transition-colors">
                <CardHeader title="Staff On Duty" subtitle="Active team members" />
                <div className="mt-3">
                  <StaffList data={staffPerf} />
                </div>
                {HAS_HRMS && (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Attendance</div>
                      <Link to={`/owner/${hotel.slug}/hrms`} className="text-[11px] text-slate-300 hover:text-slate-100 underline">Open →</Link>
                    </div>
                    <div className="mt-2"><AttendanceMini data={hrms} /></div>
                  </div>
                )}
              </DarkCard>
            </div>

            {/* Guest Satisfaction conditionally shown */}
            {(typeof npsScore === "number" || typeof avgRating30d === "number") && (
              <DarkCard className="p-4">
                <CardHeader title="Guest Satisfaction" subtitle="NPS / Rating signal" />
                <div className="mt-3">
                  <SatisfactionPanel hotelName={hotel.name} npsScore={npsScore} npsResponses={npsResponses} avgRating30d={avgRating30d} />
                </div>
              </DarkCard>
            )}

            {HAS_WORKFORCE && (
              <DarkCard className="p-4">
                <CardHeader title="Workforce" subtitle="Open roles" />
                <div className="mt-3"><WorkforceMini jobs={workforceJobs} loading={workforceLoading} /></div>
              </DarkCard>
            )}

            {/* Quick Links */}
            <DarkCard className="p-4">
              <CardHeader title="Quick Links" />
              <div className="mt-2 space-y-1.5">
                <Link to={`/owner/${hotel.slug}/analytics`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                  Owner Analytics <span className="text-slate-600">→</span>
                </Link>
                <Link to={`/ops/analytics?slug=${encodeURIComponent(hotel.slug)}`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                  Ops Manager <span className="text-slate-600">→</span>
                </Link>
                <Link to={`/checkin?slug=${encodeURIComponent(hotel.slug)}`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                  Front Desk <span className="text-slate-600">→</span>
                </Link>
                <a href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help" className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                  Contact Support <span className="text-slate-600">→</span>
                </a>
              </div>
            </DarkCard>
          </aside>
        </div>
      </div>
      {/* ─── Detail Drawers ─── */}
      {activeDrawer && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setActiveDrawer(null)} />
          <div className="relative w-full sm:max-w-2xl bg-[#0B0E14] h-full shadow-3xl overflow-y-auto border-l border-slate-800/50" style={{ animation: 'slideInRight 0.3s ease-out' }}>
            <div className="sticky top-0 z-10 bg-[#0B0E14]/95 backdrop-blur-md border-b border-slate-800/50 px-4 sm:px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {activeDrawer === 'rooms' && '🏨 Room Occupancy Details'}
                {activeDrawer === 'tasks' && '📋 Active Tasks'}
                {activeDrawer === 'atRisk' && '⚠️ At-Risk Analysis'}
                {activeDrawer === 'sla' && '📈 SLA Performance'}
                {activeDrawer === 'satisfaction' && '⭐ Guest Satisfaction'}
                {activeDrawer === 'staff' && '👥 Staff On Duty'}
                {activeDrawer === 'arrivals' && '🛬 Today\'s Guest Movement'}
              </h2>
              <button onClick={() => setActiveDrawer(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-6">

              {/* ROOMS DRAWER */}
              {activeDrawer === 'rooms' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-4">
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Total Rooms</div>
                      <div className="text-3xl font-bold text-white">{total || 0}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4">
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Occupied</div>
                      <div className="text-3xl font-bold text-emerald-400">{occupied || 0}</div>
                      <div className="text-xs text-slate-500 mt-1">{occPct || 0}% occupancy</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-4">Today's Guest Flow</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-blue-400">{arrivalsCount}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">Arrivals</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-emerald-400">{Array.isArray(inhouse) ? inhouse.length : 0}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">In-House</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-amber-400">{departuresCount}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">Departures</div>
                      </div>
                    </div>
                  </div>
                  {arrivals.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">Expected Arrivals</div>
                      <div className="space-y-2">
                        {arrivals.slice(0, 10).map(a => (
                          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">Room {a.room || 'TBD'}</div>
                              <div className="text-[11px] text-slate-500">Guest ID: {a.guest_id?.slice(0, 8)}...</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">{a.check_in_start ? new Date(a.check_in_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TASKS DRAWER */}
              {activeDrawer === 'tasks' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{tasksTotal}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">Active</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-amber-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-amber-400">{tasksAtRisk}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">At Risk</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-rose-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-rose-400">{blockedCount || 0}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">Blocked</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">All Open Requests ({liveTasks.length})</div>
                    {liveTasks.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">No open requests. Operations are running smoothly. ✅</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.map(t => {
                          const mins = ageMin(t.created_at);
                          const breach = mins > targetMin;
                          return (
                            <div key={t.id} className={`flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border ${breach ? 'border-rose-500/30' : 'border-slate-800/50'}`}>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate">{t.title || `#${t.id.slice(0, 8)}`}</div>
                                <div className="text-[11px] text-slate-500">{t.status} · {mins}m ago</div>
                              </div>
                              <StatusBadge label={breach ? 'At risk' : 'On time'} tone={breach ? 'amber' : 'green'} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* AT RISK DRAWER */}
              {activeDrawer === 'atRisk' && (
                <>
                  <div className="bg-[#151A25] rounded-xl border border-rose-500/20 p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <AlertTriangle size={20} className="text-rose-400" />
                      <div className="text-sm font-semibold text-slate-200">Risk Summary</div>
                    </div>
                    <div className="text-3xl font-bold text-rose-400">{tasksAtRisk}</div>
                    <div className="text-xs text-slate-500 mt-1">Tasks exceeding {targetMin}m SLA target</div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">Overdue Tasks</div>
                    {liveTasks.filter(t => ageMin(t.created_at) > targetMin).length === 0 ? (
                      <div className="text-center py-8 text-slate-500">No tasks currently at risk. All clear! ✅</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.filter(t => ageMin(t.created_at) > targetMin).map(t => {
                          const mins = ageMin(t.created_at);
                          return (
                            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-rose-500/20">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate">{t.title || `#${t.id.slice(0, 8)}`}</div>
                                <div className="text-[11px] text-slate-500">{t.status}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-bold font-mono text-rose-400">{mins}m</div>
                                <div className="text-[10px] text-slate-500">overdue by {mins - targetMin}m</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">Blocked Tasks</div>
                    {(blockedCount ?? 0) === 0 ? (
                      <div className="text-center py-4 text-slate-500">No blocked tasks</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.filter(t => ['blocked', 'paused', 'hold'].some(k => (t.status || '').toLowerCase().includes(k))).map(t => (
                          <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-amber-500/20">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate">{t.title || `#${t.id.slice(0, 8)}`}</div>
                              <div className="text-[11px] text-slate-500">{t.status} · {ageMin(t.created_at)}m</div>
                            </div>
                            <StatusBadge label="Blocked" tone="red" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* SLA DRAWER */}
              {activeDrawer === 'sla' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-4">
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Avg Response</div>
                      <div className="text-3xl font-bold text-white">{avgResponseMin == null ? '—' : `${avgResponseMin}m`}</div>
                    </div>
                    <div className={`bg-[#151A25] rounded-xl border p-4 ${slaToneLevel === 'green' ? 'border-emerald-500/20' : slaToneLevel === 'amber' ? 'border-amber-500/20' : 'border-rose-500/20'}`}>
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">SLA Compliance</div>
                      <div className={`text-3xl font-bold ${slaToneLevel === 'green' ? 'text-emerald-400' : slaToneLevel === 'amber' ? 'text-amber-400' : 'text-rose-400'}`}>{slaPct == null ? '—' : `${slaPct}%`}</div>
                      <div className="text-xs text-slate-500 mt-1">Target: {targetMin}m</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">SLA Performance Chart</div>
                    {hasSeries(slaSeries) ? (
                      <SlaPerformanceChart data={slaSeries || []} loading={false} />
                    ) : (
                      <div className="text-center py-8 text-slate-500">SLA data will appear after requests are processed.</div>
                    )}
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">For detailed analytics</div>
                    <Link to={`/owner/${hotel.slug}/analytics`} className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20 transition-colors">
                      Open Owner Analytics →
                    </Link>
                  </div>
                </>
              )}

              {/* SATISFACTION DRAWER */}
              {activeDrawer === 'satisfaction' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {typeof npsScore === 'number' && (npsResponses ?? 0) > 0 && (
                      <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4">
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">NPS Score</div>
                        <div className="text-3xl font-bold text-emerald-400">{npsScore}</div>
                        <div className="text-xs text-slate-500 mt-1">{npsResponses} responses (30d)</div>
                      </div>
                    )}
                    {typeof avgRating30d === 'number' && (
                      <div className="bg-[#151A25] rounded-xl border border-blue-500/20 p-4">
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Avg Rating</div>
                        <div className="text-3xl font-bold text-blue-400">{avgRating30d.toFixed(1)}/5</div>
                        <div className="text-xs text-slate-500 mt-1">Last 30 days</div>
                      </div>
                    )}
                  </div>
                  {npsSnapshot && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">NPS Breakdown</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-emerald-500/20">
                          <div className="text-2xl font-bold text-emerald-400">{npsSnapshot.promoters}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">Promoters</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-amber-500/20">
                          <div className="text-2xl font-bold text-amber-400">{npsSnapshot.passives}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">Passives</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-rose-500/20">
                          <div className="text-2xl font-bold text-rose-400">{npsSnapshot.detractors}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">Detractors</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {typeof npsScore !== 'number' && typeof avgRating30d !== 'number' && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-8 text-center">
                      <div className="text-2xl mb-2">📊</div>
                      <div className="text-sm text-slate-400">Guest satisfaction data will appear once feedback is collected.</div>
                    </div>
                  )}
                </>
              )}

              {/* STAFF DRAWER */}
              {activeDrawer === 'staff' && (
                <>
                  {staffPerf && staffPerf.length > 0 ? (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">Full Staff Roster ({staffPerf.length})</div>
                      <div className="space-y-2">
                        {staffPerf.map(r => (
                          <div key={r.staff_id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate">{r.display_name}</div>
                              <div className="text-[11px] text-slate-500">{r.department_name || r.role}</div>
                            </div>
                            <StatusBadge label={r.is_online ? 'Online' : 'Away'} tone={r.is_online ? 'green' : 'grey'} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">No staff data available</div>
                  )}
                  {hrms && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">Attendance Summary</div>
                      <div className="grid grid-cols-2 gap-3">
                        <MiniStat label="Present" value={hrms.present_today} tone={hrms.attendance_pct_today >= 85 ? 'green' : 'amber'} />
                        <MiniStat label="Absent" value={hrms.absent_today} tone={hrms.absent_today > 0 ? 'amber' : 'grey'} />
                        <MiniStat label="Late" value={hrms.late_today} tone={hrms.late_today > 0 ? 'amber' : 'grey'} />
                        <MiniStat label="Att %" value={`${hrms.attendance_pct_today}%`} tone={hrms.attendance_pct_today >= 85 ? 'green' : 'amber'} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ARRIVALS DRAWER */}
              {activeDrawer === 'arrivals' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#151A25] rounded-xl border border-blue-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-blue-400">{arrivalsCount}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">Arrivals</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{Array.isArray(inhouse) ? inhouse.length : 0}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">In-House</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-amber-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-amber-400">{departuresCount}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">Departures</div>
                    </div>
                  </div>
                  {arrivals.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">Arrivals ({arrivals.length})</div>
                      <div className="space-y-2">
                        {arrivals.map(a => (
                          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">Room {a.room || 'TBD'}</div>
                              <div className="text-[11px] text-slate-500">Guest ID: {a.guest_id?.slice(0, 8)}...</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {departures.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">Departures ({departures.length})</div>
                      <div className="space-y-2">
                        {departures.map(d => (
                          <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">Room {d.room || 'TBD'}</div>
                              <div className="text-[11px] text-slate-500">Guest ID: {d.guest_id?.slice(0, 8)}...</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </main>
  );
}

/** ========= UI (dark) components ========= */

function UserProfileMenu({ slug }: { slug: string }) {
  const [userProfile, setUserProfile] = useState<{ fullName: string; role: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      setUserProfile({
        fullName: profile?.full_name || user.email?.split('@')[0] || "User",
        role: "Owner View"
      });
    }
    loadUser();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = 'https://vaiyu.co.in';
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  if (!userProfile) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 animate-pulse">
        <div className="h-6 w-6 rounded-full bg-white/10" />
        <div className="h-4 w-16 rounded bg-white/10" />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 hover:bg-white/10 transition-colors"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/20 text-blue-400 text-[11px] font-bold">
          {getInitials(userProfile.fullName)}
        </div>
        <div className="leading-tight text-left mr-2 hidden sm:block">
          <div className="text-[12px] font-medium text-slate-100 max-w-[100px] truncate">{userProfile.fullName}</div>
          <div className="text-[10px] text-slate-400">{userProfile.role}</div>
        </div>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-slate-800/50 bg-[#151A25] p-1 shadow-xl z-50">
            <Link
              to={`/owner/${slug}/settings`}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardTopBar({
  title,
  hotelName,
  city,
  dateLabel,
  slug,
  onMenuClick,
}: {
  title: string;
  hotelName: string;
  city: string | null;
  dateLabel: string;
  slug: string;
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between pb-6 border-b border-zinc-900">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-medium text-white tracking-tight">{title}</h1>
          <span className="text-zinc-600">/</span>
          <div className="text-sm text-zinc-400 truncate font-medium">
            {hotelName}
            {city ? ` · ${city}` : ""} · {dateLabel}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          to="/owner"
          className="hidden lg:inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          Switch Property
        </Link>

        {HAS_PRICING && (
          <Link
            to={`/owner/${slug}/pricing`}
            className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Pricing
          </Link>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 p-2 hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          title="Sync"
        >
          <SvgSync />
        </button>

        <UserProfileMenu slug={slug} />

        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex lg:hidden items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 p-2 hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          title="Menu"
        >
          <SvgMenu />
        </button>
      </div>
    </header>
  );
}

function SidebarNav({ slug, onNavClick }: { slug: string; onNavClick?: () => void }) {
  const encodedSlug = encodeURIComponent(slug);
  const servicesHref = `/owner/services?slug=${encodedSlug}`;
  const opsAnalyticsHref = `/ops/analytics?slug=${encodedSlug}`;
  const settingsHref = `/owner/${slug}/settings`;

  return (
    <nav aria-label="Owner dashboard navigation" className="space-y-4 text-sm">
      {/* Operations */}
      <div>
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">Operations</div>
        <div className="space-y-1">
          <NavItem href="#top" label="Overview" active onClick={onNavClick} />
          <NavItem to={`/ops?slug=${encodedSlug}`} label="Supervisor" onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/arrivals`} label="Arrivals" onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/housekeeping`} label="Housekeeping" onClick={onNavClick} />
          <NavItem to={`/checkin?slug=${encodedSlug}`} label="Front Desk" onClick={onNavClick} />
        </div>
      </div>
      {/* Analytics */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">Analytics</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/analytics`} label="Owner Analytics" onClick={onNavClick} />
          <NavItem to={opsAnalyticsHref} label="Ops Manager" onClick={onNavClick} />
        </div>
      </div>
      {/* Finance */}
      {/* <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">Finance</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/payments`} label="Payments & Ledger" onClick={onNavClick} />
        </div>
      </div> */}
      {/* Staff */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">Staff</div>
        <div className="space-y-1">
          <NavItem to={servicesHref} label="Departments & SLAs" onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/staff-shifts`} label="Staff & Shifts" onClick={onNavClick} />
          <NavItem to="/staff" label="Staff App" onClick={onNavClick} />
          <NavItem to="/kitchen" label="Kitchen" onClick={onNavClick} />
        </div>
      </div>
      {/* System */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">System</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/import-bookings`} label="Import Bookings" onClick={onNavClick} />
          <NavItem to={settingsHref} label="Settings" onClick={onNavClick} />
          {HAS_CALENDAR && <NavItem to="../bookings/calendar" label="Calendar" onClick={onNavClick} />}
        </div>
      </div>
    </nav>
  );
}

function NavItem({
  label,
  to,
  href,
  active,
  onClick,
}: {
  label: string;
  to?: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const base =
    "flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition-colors";
  const cls = active
    ? `${base} bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`
    : `${base} text-slate-500 hover:bg-white/[0.04] hover:text-slate-300`;

  if (href) {
    return (
      <a href={href} className={cls} onClick={onClick}>
        <span>{label}</span>
      </a>
    );
  }

  if (to) {
    return (
      <Link to={to} className={cls} onClick={onClick}>
        <span>{label}</span>
      </Link>
    );
  }

  return null;
}

// --- Components ---

function DarkCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-800/50 bg-[#151A25] ${className}`}
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
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-slate-200 uppercase tracking-widest">{title}</div>
        {subtitle ? (
          <div className="mt-1 text-[11px] text-slate-500">{subtitle}</div>
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
  icon: Icon
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "amber" | "emerald" | "rose";
  icon?: any;
}) {
  const accentBorder = accent === "rose" ? "border-rose-500/30" : accent === "amber" ? "border-amber-500/30" : accent === "emerald" ? "border-emerald-500/30" : "border-slate-800/50";
  const accentText = accent === "rose" ? "text-rose-400" : accent === "amber" ? "text-amber-400" : accent === "emerald" ? "text-emerald-400" : "text-white";

  return (
    <div className={`bg-[#151A25] p-3 sm:p-5 rounded-xl border ${accentBorder} flex flex-col justify-between h-full hover:bg-[#1a1f2e] transition-colors`}>
      <div className="flex justify-between items-start mb-4 sm:mb-6">
        <h3 className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{label}</h3>
        {Icon && <Icon size={14} className="text-slate-600 shrink-0" />}
      </div>

      <div className="flex items-baseline gap-1 sm:gap-2 mt-auto">
        <span className={`text-xl sm:text-3xl font-bold tracking-tight ${accentText}`}>{value}</span>
      </div>

      {sub && <div className="mt-1 sm:mt-2 text-[10px] sm:text-[11px] font-medium text-slate-500">{sub}</div>}
    </div>
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
    <div className="rounded-lg border border-slate-800/50 bg-[#0B0E14] px-2.5 py-2.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 truncate" title={label}>{label}</div>
      <div className="flex items-center justify-between gap-1">
        <div className="text-sm font-bold text-slate-100 truncate">{value}</div>
        <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone(tone)}`} />
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
    <div className="rounded-lg border border-dashed border-zinc-800 bg-transparent p-4 text-sm text-zinc-500 text-center flex items-center justify-center">
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

function IssueBreakdown({ orders, targetMin }: { orders: LiveTask[]; targetMin: number }) {
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
        <Link
          to="/staff"
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
        >
          Return to Staff App
        </Link>
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
