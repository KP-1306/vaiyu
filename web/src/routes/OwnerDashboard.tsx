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
import { useOwnerT, useOwnerLocale, useOwnerCommonT, localizeCode } from "../i18n/useOwnerT";
import { OwnerLangToggle } from "../i18n/OwnerLangToggle";

import { useTicketsRealtime } from "../hooks/useTicketsRealtime";
import ObservabilityCard from "../components/ObservabilityCard";
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
  Settings,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import SlaPerformanceChart from "../components/analytics/SlaPerformanceChart";
import TaskVolumeChart from "../components/analytics/TaskVolumeChart";
import { getDashboardMetrics, type DashboardMetrics } from "../lib/dashboardApi";
import { getOutstandingBalanceSummary, type OutstandingBalanceSummary, getHousekeepingSummary, type HousekeepingSummary, getArrivalsForecast, type ForecastSummary } from "../services/financeService";
import { LeadsSummaryCard } from "../components/owner/LeadsSummaryCard";
import { ActionRadarCard } from "../components/owner/ActionRadarCard";
import { FOLLOW_UP_RADAR_V0_ENABLED } from "../config/followUpRadar";
import { QuoteDraftCard } from "../components/owner/QuoteDraftCard";
import { PackageBuilderCard } from "../components/owner/PackageBuilderCard";
import { PACKAGE_BUILDER_V0_ENABLED } from "../config/packages";
import { LocalSeoPlannerCard } from "../components/owner/LocalSeoPlannerCard";
import { LOCAL_SEO_LANDING_PLANNER_V0_ENABLED } from "../config/localSeoPlanner";
import { AI_QUOTE_DRAFTS_V0_ENABLED } from "../config/quoteDrafts";
import { PartnersSummaryCard } from "../components/owner/PartnersSummaryCard";
import { PARTNER_NETWORK_V1_ENABLED } from "../config/partnerNetwork";
import { DripActivityCard } from "../components/owner/DripActivityCard";
import { DRIP_ENGINE_V1_ENABLED } from "../config/dripEngine";
import { AssetReadinessCard } from "../components/owner/AssetReadinessCard";
import { DIGITAL_ASSET_MANAGER_V0_ENABLED } from "../config/digitalAssetManager";
import { SeasonalCalendarCard } from "../components/owner/SeasonalCalendarCard";
import { SEASONAL_DEMAND_CALENDAR_V0_ENABLED } from "../config/seasonalCalendar";
import { OTAReadinessCard } from "../components/owner/OTAReadinessCard";
import { OTA_LISTING_OPTIMIZER_V0_ENABLED } from "../config/otaOptimizer";
import { VisibilityScoreCard } from "../components/owner/VisibilityScoreCard";
import { VISIBILITY_SCORE_ENABLED } from "../config/visibilityScore";
import { listPendingExtensions } from "../services/stayExtensionService";
import { getPricingSettings, listPricingRules } from "../services/pricingService";
import { Wallet, Sparkles, CalendarPlus, Tag, Search } from "lucide-react";

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

/* ===== Role-aware visibility =====================================
 * Sections that contain financial or HR data are gated. Operational
 * content (arrivals, housekeeping, live requests) stays visible to
 * everyone. Mapping is a single source of truth so adding a new
 * section means deciding once who can see it. */

type DashboardRole = "owner" | "manager" | "staff" | "viewer";

function normalizeRole(raw: string | null | undefined): DashboardRole {
  const r = (raw || "").trim().toLowerCase();
  if (r === "owner") return "owner";
  if (r === "manager") return "manager";
  if (r === "staff") return "staff";
  return "viewer";
}

const SECTION_VISIBILITY: Record<string, DashboardRole[]> = {
  // Money-flavored signals — owners + managers
  finance: ["owner", "manager"],
  // Hiring / workforce — owner only
  hr: ["owner"],
};

function canSee(role: DashboardRole | null, section: keyof typeof SECTION_VISIBILITY): boolean {
  if (role === null) return false; // restrict during initial role fetch
  const allowed = SECTION_VISIBILITY[section];
  return !allowed || allowed.includes(role);
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
  const t = useOwnerT("owner-dashboard");
  const ownerLocale = useOwnerLocale();
  const paramsHook = useParams();
  const rawSlug = paramsHook.slug;
  const slug = normalizeSlug(rawSlug);

  // Subscribe to tickets for this property and keep KPIs refreshed
  useTicketsRealtime(slug);

  const [params, setParams] = useSearchParams();

  // Tab IA — URL-driven so deep-links and browser back/forward work
  type DashboardTab = "today" | "week" | "pipeline";
  const tabParam = (params.get("tab") || "today") as string;
  const activeTab: DashboardTab =
    tabParam === "week" || tabParam === "pipeline" ? tabParam : "today";
  const setActiveTab = (next: DashboardTab) => {
    const newParams = new URLSearchParams(params);
    if (next === "today") newParams.delete("tab");
    else newParams.set("tab", next);
    setParams(newParams, { replace: true });
  };

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

  const [showMobileNav, setShowMobileNav] = useState(false);

  // Outstanding folio balance — money owed by currently in-house guests
  const [outstandingBalance, setOutstandingBalance] = useState<OutstandingBalanceSummary | null>(null);

  // Housekeeping board glance — inventory health
  const [housekeeping, setHousekeeping] = useState<HousekeepingSummary | null>(null);

  // Arrivals pipeline (next 7 days) — what's coming
  const [forecast, setForecast] = useState<ForecastSummary | null>(null);

  // Approvals: pending stay extensions
  const [pendingExtensionCount, setPendingExtensionCount] = useState(0);

  // Pricing review nudge — true when rules exist and engine is in manual-review mode
  const [pricingReviewActive, setPricingReviewActive] = useState<{ rulesCount: number } | null>(null);

  // Role-aware visibility — current user's role on this hotel
  const [currentRole, setCurrentRole] = useState<DashboardRole | null>(null);

  // Detail drawer state
  type DrawerType = null | 'rooms' | 'tasks' | 'atRisk' | 'sla' | 'satisfaction' | 'staff' | 'arrivals';
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);

  const [accessProblem, setAccessProblem] = useState<string | null>(null);

  // VAiyu platform admin? Gates the platform-wide System Health card below. This is
  // the canonical check (public.is_platform_admin() → active row in platform_admins),
  // independent of hotel role. Fails closed: stays false on any error.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (alive && !error) setIsPlatformAdmin(data === true);
    })();
    return () => { alive = false; };
  }, []);

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
        .select("id,name,slug,city, hotel_members!inner(id, user_id, role)")
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

      // 1b) Detailed Role Check (Block regular STAFF).
      // Accept EITHER the M2M source of truth (hotel_member_roles) OR the legacy
      // hotel_members.role, both case-insensitively — legacy-only owners (no M2M
      // row) must not be locked out of their own dashboard.
      const memberRow = hotelRow.hotel_members?.[0];
      const memberId = memberRow?.id;
      if (memberId) {
        const OWNER_MANAGER_CODES = [
          "OWNER", "OWNER_0", "HOTEL_OWNER",
          "ADMIN", "ADMINISTRATOR",
          "MANAGER", "GENERAL_MANAGER", "OPS_MANAGER",
        ];

        const { data: rolesData } = await supabase
          .from("hotel_member_roles")
          .select("hotel_roles(code)")
          .eq("hotel_member_id", memberId);

        const m2mAccess = (rolesData ?? []).some((r: any) =>
          OWNER_MANAGER_CODES.includes(String(r.hotel_roles?.code ?? "").toUpperCase())
        );

        const legacyAccess = OWNER_MANAGER_CODES.includes(
          String(memberRow?.role ?? "").toUpperCase()
        );

        if (!m2mAccess && !legacyAccess) {
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
  const [metricsFetchedAt, setMetricsFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadMetrics() {
      if (!hotel?.id) return;
      try {
        const data = await getDashboardMetrics(hotel.id);
        if (mounted) {
          setMetrics(data);
          setMetricsFetchedAt(new Date());
        }
      } catch (err) {
        // Metric load failed silently
      }
    }
    loadMetrics();
    return () => {
      mounted = false;
    };
  }, [hotel?.id]);

  // Force a re-render every 60s so "X min ago" relative-age text stays current
  // without us refetching the data.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  /* Outstanding folio balance — fetch + realtime */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;

    const load = async () => {
      const summary = await getOutstandingBalanceSummary(hotel.id);
      if (!cancelled) setOutstandingBalance(summary);
    };
    load();

    // Refresh whenever a folio entry or folio changes — captures payments,
    // new charges, refunds, and folio close events all on the same channel.
    const channel = supabase
      .channel(`outstanding-balance-${hotel.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "folio_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "folios" }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hotel?.id]);

  /* Housekeeping board glance — fetch + realtime on rooms */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;
    const load = async () => {
      const s = await getHousekeepingSummary(hotel.id);
      if (!cancelled) setHousekeeping(s);
    };
    load();
    const channel = supabase
      .channel(`hk-board-${hotel.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hotel?.id]);

  /* Arrivals forecast (next 7 days) — fetch + realtime on bookings */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;
    const load = async () => {
      const s = await getArrivalsForecast(hotel.id);
      if (!cancelled) setForecast(s);
    };
    load();
    const channel = supabase
      .channel(`forecast-${hotel.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hotel?.id]);

  /* Pending stay-extension requests — count + realtime */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await listPendingExtensions(hotel.id);
        if (!cancelled) setPendingExtensionCount(rows.length);
      } catch {
        // listPendingExtensions surfaces typed errors; for the dashboard
        // attention strip, a fetch failure should silently render zero
        // rather than crash the page.
        if (!cancelled) setPendingExtensionCount(0);
      }
    };
    load();
    const channel = supabase
      .channel(`pending-extensions-${hotel.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stay_extension_requests" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hotel?.id]);

  /* Current user's role for this hotel — drives section visibility */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setCurrentRole("viewer");
        return;
      }
      const { data } = await supabase
        .from("hotel_members")
        .select("role")
        .eq("hotel_id", hotel.id)
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (!cancelled) setCurrentRole(normalizeRole(data?.role));
    })();
    return () => { cancelled = true; };
  }, [hotel?.id]);

  /* Pricing review nudge — fires when rules exist AND engine is in recommend-only mode */
  useEffect(() => {
    if (!hotel?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [settings, rules] = await Promise.all([
          getPricingSettings(hotel.id),
          listPricingRules(hotel.id),
        ]);
        if (cancelled) return;
        // Surface only when the owner has set rules but is in manual-review
        // mode — that's a recurring decision they should be reminded about.
        // Auto-apply mode = no nudge (it's working as intended).
        // No rules = no nudge (would be onboarding noise on a fresh tenant).
        if (rules.length > 0 && (settings.recommend_only || !settings.auto_apply_enabled)) {
          setPricingReviewActive({ rulesCount: rules.length });
        } else {
          setPricingReviewActive(null);
        }
      } catch {
        if (!cancelled) setPricingReviewActive(null);
      }
    };
    load();
    const channel = supabase
      .channel(`pricing-nudge-${hotel.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing_rules" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "pricing_settings" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [hotel?.id]);


  /** ======= UI States ======= */
  if (loading) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Spinner label={t("loading", "Loading property dashboard…")} />
      </main>
    );
  }

  if (accessProblem) {
    return (
      <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200">
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
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <div className="rounded-2xl border border-slate-800/50 bg-[#151A25] p-8 text-center max-w-md">
          <div className="text-4xl mb-3">🏨</div>
          <div className="text-lg font-semibold mb-2 text-white">{t("noProperty.title", "No property to show")}</div>
          <p className="text-sm text-slate-400">{t("noProperty.body", "Open your property from the Owner Home.")}</p>
          <div className="mt-4">
            <Link to="/owner" className="inline-flex items-center rounded-lg border border-slate-700 bg-[#0B0E14] px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors">{t("noProperty.cta", "Owner Home")}</Link>
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
  const dateLabel = now.toLocaleDateString(ownerLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  /** ======= Shift-aware greeting ======= */
  const hour = now.getHours();
  const shiftGreeting = hour >= 6 && hour < 12 ? t("greeting.morning", "Good morning") : hour >= 12 && hour < 17 ? t("greeting.afternoon", "Good afternoon") : hour >= 17 && hour < 22 ? t("greeting.evening", "Good evening") : t("greeting.night", "Night operations");
  const shiftIcon = hour >= 6 && hour < 12 ? "☀️" : hour >= 12 && hour < 17 ? "🌤️" : hour >= 17 && hour < 22 ? "🌙" : "🌃";

  /** ======= Attention strip — single source of truth for "what needs me right now" =======
   *  NOTE: plain computation (no useMemo) — there are early returns above this point and
   *  hooks below them would violate rules-of-hooks. */
  const attentionItems: AttentionItem[] = [];

  if ((blockedCount ?? 0) > 0) {
    attentionItems.push({
      key: "sla",
      severity: "critical",
      icon: AlertTriangle,
      title: t("attn.slaBreach", "{{count}} SLA breaches", { count: blockedCount }),
      subtitle: t("attn.slaBreachSub", "Service requests past their target response time."),
      cta: { label: t("attn.openOpsBoard", "Open ops board"), to: `/ops?slug=${encodeURIComponent(hotel.slug)}` },
    });
  }

  if (tasksAtRisk > 0) {
    attentionItems.push({
      key: "atRisk",
      severity: "critical",
      icon: Clock,
      title: t("attn.tasksAtRisk", "{{count}} tasks at risk", { count: tasksAtRisk }),
      subtitle: t("attn.atRiskSub", "Approaching SLA threshold — triage now."),
      cta: { label: t("attn.triage", "Triage"), to: `/ops?slug=${encodeURIComponent(hotel.slug)}` },
    });
  }

  if (departuresCount > 0) {
    attentionItems.push({
      key: "departures",
      severity: "warning",
      icon: LogOut,
      title: t("attn.departures", "{{count}} pending departures", { count: departuresCount }),
      subtitle: departuresCount === 1
        ? t("attn.departuresSub_one", "Process checkout to free the room and close the folio.")
        : t("attn.departuresSub_other", "Process checkouts to free rooms and close folios."),
      cta: { label: t("attn.process", "Process"), to: `/owner/${hotel.slug}/arrivals` },
    });
  }

  if (pendingExtensionCount > 0) {
    attentionItems.push({
      key: "extensions",
      severity: "warning",
      icon: CalendarPlus,
      title: t("attn.extensions", "{{count}} stay extensions awaiting approval", { count: pendingExtensionCount }),
      subtitle: pendingExtensionCount === 1
        ? t("attn.extensionsSub_one", "Guest requested a longer stay — approve or decline before checkout.")
        : t("attn.extensionsSub_other", "Guests requested longer stays — approve or decline before checkout."),
      cta: { label: t("attn.review", "Review"), to: `/owner/${hotel.slug}/arrivals` },
    });
  }

  const openJobsCount = (workforceJobs ?? []).filter((j) =>
    (j.status || "open").toLowerCase().includes("open")
  ).length;
  if (openJobsCount > 0) {
    attentionItems.push({
      key: "hiring",
      severity: "info",
      icon: Users,
      title: t("attn.hiring", "{{count}} open hiring roles", { count: openJobsCount }),
      subtitle: t("attn.hiringSub", "Review applicants to close staffing gaps."),
      cta: { label: t("attn.review", "Review"), to: `/owner/${hotel.slug}/staff-shifts` },
    });
  }

  if (pricingReviewActive) {
    attentionItems.push({
      key: "pricing-review",
      severity: "info",
      icon: Tag,
      title: t("attn.pricingReview", "Pricing on manual review · {{count}} rules active", { count: pricingReviewActive.rulesCount }),
      subtitle: t("attn.pricingReviewSub", "Engine is producing recommendations but not auto-applying. Review tonight's rates."),
      cta: { label: t("attn.reviewRates", "Review rates"), to: `/owner/${hotel.slug}/pricing` },
    });
  }

  const topSeverity = attentionItems.find((i) => i.severity === "critical")
    ? "critical"
    : attentionItems.find((i) => i.severity === "warning")
      ? "warning"
      : attentionItems.length > 0
        ? "info"
        : null;

  /** ======= Today's money block (revenue · occupancy · ADR with vs-yesterday deltas) ======= */
  const revenueHistory = ((metrics as any)?.revenueHistory ?? []) as { date: string; revenue: number }[];
  const occupancyHistory = ((metrics as any)?.occupancyHistory ?? []) as { date: string; occupancyPct: number; occupiedCount: number; totalRooms: number }[];

  const todayRevenue = revenueHistory.length ? revenueHistory[revenueHistory.length - 1].revenue : 0;
  const yesterdayRevenue = revenueHistory.length >= 2 ? revenueHistory[revenueHistory.length - 2].revenue : 0;

  const todayOccPct = todayStats?.occupancyPct ?? (occupancyHistory.length ? occupancyHistory[occupancyHistory.length - 1].occupancyPct : occPct);
  const yesterdayOccPct = occupancyHistory.length >= 2 ? occupancyHistory[occupancyHistory.length - 2].occupancyPct : 0;
  const yesterdayOccupied = occupancyHistory.length >= 2 ? occupancyHistory[occupancyHistory.length - 2].occupiedCount : 0;

  const todayAdr = occupied > 0 ? todayRevenue / occupied : 0;
  const yesterdayAdr = yesterdayOccupied > 0 ? yesterdayRevenue / yesterdayOccupied : 0;

  // Recency context — used as fallback when today's value is empty so the hero
  // is informative on quiet days instead of three em-dashes.
  const last7Revenue = revenueHistory.slice(-7).reduce((s, d) => s + (d.revenue || 0), 0);
  const last7DaysCount = Math.min(revenueHistory.length, 7);
  const last7AvgRevenue = last7DaysCount > 0 ? last7Revenue / last7DaysCount : 0;

  const last7OccSamples = occupancyHistory.slice(-7);
  const last7AvgOcc = last7OccSamples.length > 0
    ? last7OccSamples.reduce((s, d) => s + (d.occupancyPct || 0), 0) / last7OccSamples.length
    : 0;
  const last7TotalOccupied = last7OccSamples.reduce((s, d) => s + (d.occupiedCount || 0), 0);
  const last7AvgAdr = last7TotalOccupied > 0 ? last7Revenue / last7TotalOccupied : 0;

  const todayMetrics = {
    revenue: todayRevenue,
    revenueDelta: todayRevenue - yesterdayRevenue,
    revenueDeltaPct: yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : null,
    occPct: todayOccPct,
    occupiedRooms: occupied,
    totalRooms: total,
    occDeltaPp: todayOccPct - yesterdayOccPct, // percentage points
    adr: todayAdr,
    adrDeltaPct: yesterdayAdr > 0 ? ((todayAdr - yesterdayAdr) / yesterdayAdr) * 100 : null,
    hasYesterday: revenueHistory.length >= 2 || occupancyHistory.length >= 2,
    // Recency context for empty-state pivot (last 7 days)
    last7Revenue,
    last7AvgRevenue,
    last7AvgOcc,
    last7AvgAdr,
    last7DaysCount,
  };

  /** ======= Render (operations command center) ======= */
  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Breadcrumb strip */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 text-xs font-medium text-slate-400 border-b border-slate-800/50 bg-[#0B0E14] sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link to="/owner" className="hover:text-white transition-colors truncate">{t("chrome.console", "Console")}</Link>
          <span className="text-slate-700">/</span>
          <span className="text-slate-200 truncate">{t("chrome.dashboard", "Dashboard")}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0" />
        {/* Removed loud "Live" indicator — it overpromised. Realtime only covers
            tickets/SLA; revenue, occupancy, and trends fetch on page load. The
            refresh button in the header is the honest way to force fresh data. */}
      </div>

      {/* Mobile Drawer */}
      {showMobileNav && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowMobileNav(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-[#0B0E14] border-r border-slate-800/50 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <div className="text-sm font-bold text-white uppercase tracking-widest">{t("chrome.navigation", "Navigation")}</div>
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
                title={t("chrome.menu", "Menu")}
              >
                <SvgMenu />
              </button>

              <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 text-lg">
                {shiftIcon}
              </div>
              <div className="min-w-0 flex-1">
                {/* Mobile-first: the time-of-day greeting + hotel name
                    combined was overflowing the 375px viewport ("Good
                    afternoo…"). Below sm we drop the greeting prefix
                    entirely and let the hotel name take the full width with
                    a 2-line clamp; from sm up we restore the full greeting.
                    Long real hotel names ("The Himalayan Boutique Stay")
                    fit cleanly in both. */}
                <h1 className="text-base sm:text-xl font-bold text-white tracking-tight leading-tight line-clamp-2">
                  <span className="hidden sm:inline">{shiftGreeting}, </span>
                  <span className="text-emerald-400 font-extrabold">{hotel.name}</span>
                </h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[11px] sm:text-xs text-slate-500">
                  {hotel.city && <span className="truncate">{hotel.city}</span>}
                  {hotel.city && <span className="h-1 w-1 rounded-full bg-slate-700 shrink-0" />}
                  <span>{dateLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {metricsFetchedAt && (
                <FreshnessStamp fetchedAt={metricsFetchedAt} />
              )}
              <OwnerLangToggle />
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#151A25] p-2.5 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
                title={t("chrome.refreshTitle", "Refresh metrics (revenue, occupancy, trends). Realtime data updates automatically.")}
              >
                <SvgSync />
              </button>
              <UserProfileMenu slug={hotel.slug} role={currentRole} />
            </div>
          </div>

          {/* Global search — opens the ⌘K command palette (find bookings/guests,
              jump to any feature). Visible bar for discoverability; the palette
              itself handles typing + keyboard nav. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("vaiyu:open-search"))}
            aria-label={t("chrome.searchAria", "Search bookings, guests, and pages (Command or Control + K)")}
            className="group flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-[#151A25] px-4 py-2.5 text-left text-sm text-slate-400 hover:border-indigo-500/40 hover:bg-[#1a2030] transition-colors"
          >
            <Search size={16} className="text-slate-500 group-hover:text-indigo-400 transition-colors" />
            <span className="flex-1 truncate">{t("chrome.searchPlaceholder", "Search bookings, guests, or jump to any page…")}</span>
            <kbd className="hidden sm:inline-flex items-center rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
            </kbd>
          </button>
        </header>

        <div className="mt-6 flex flex-col lg:grid gap-6 lg:grid-cols-[180px,1fr,260px] xl:grid-cols-[200px,1fr,300px]">
          {/* ─── Left Nav (grouped) ─── */}
          <aside className="hidden lg:block space-y-4 sticky top-24 self-start">
            <SidebarNav slug={hotel.slug} />
          </aside>

          {/* ─── Main Content ─── */}
          <section className="min-w-0 flex flex-col gap-5">
            {/* 🆕 Mobile Quick Navigation Hub */}
            {/* Mobile quick-tile grid — was 14 tiles in 2 cols, which meant
                operators scrolled past the entire app menu before seeing today's
                revenue. The hamburger button in the header already opens the
                full SidebarNav drawer; this grid now surfaces the four highest-
                frequency front-desk actions plus a "More" tile that opens that
                same drawer. Anything beyond these four is one extra tap, not a
                lost feature. */}
            <div className="grid grid-cols-3 gap-2 lg:hidden">
              <Link to={`/checkin?slug=${encodeURIComponent(hotel.slug)}`} className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-base mb-0.5">🛎️</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t("quick.frontDesk", "Front Desk")}</div>
              </Link>
              <Link to={`/owner/${hotel.slug}/arrivals`} className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-base mb-0.5">🛬</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t("quick.arrivals", "Arrivals")}</div>
              </Link>
              <Link to={`/owner/${hotel.slug}/housekeeping`} className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-base mb-0.5">🧹</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t("quick.hk", "HK")}</div>
              </Link>
              <Link to={`/ops?slug=${encodeURIComponent(hotel.slug)}`} className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-base mb-0.5">🕹️</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t("quick.opsBoard", "Ops Board")}</div>
              </Link>
              <Link to={`/owner/${hotel.slug}/leads`} className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-slate-800 bg-[#151A25] hover:bg-slate-800 transition-colors">
                <div className="text-base mb-0.5">📞</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{t("quick.leads", "Leads")}</div>
              </Link>
              <button
                type="button"
                onClick={() => setShowMobileNav(true)}
                className="flex flex-col items-center justify-center px-2 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/15 transition-colors text-emerald-300"
              >
                <div className="text-base mb-0.5">▤</div>
                <div className="text-[9px] font-bold uppercase tracking-widest">{t("quick.moreMenu", "More menu")}</div>
              </button>
            </div>

            {/* 🎯 Attention Strip — what needs me right now (or collapsed all-clear) */}
            <AttentionStrip items={attentionItems} topSeverity={topSeverity} />

            {/* Tab IA — Today / This Week / Pipeline (Week tab is finance-gated) */}
            <DashboardTabs
              active={activeTab}
              onChange={setActiveTab}
              showWeekTab={canSee(currentRole, 'finance')}
            />

            {activeTab === "week" && canSee(currentRole, 'finance') ? (
              <WeekView
                revenueHistory={revenueHistory}
                occupancyHistory={occupancyHistory}
                last7Revenue={last7Revenue}
                last7AvgOcc={last7AvgOcc}
                last7AvgAdr={last7AvgAdr}
                hotelSlug={hotel.slug}
              />
            ) : activeTab === "pipeline" ? (
              <PipelineView forecast={forecast} hotelSlug={hotel.slug} vipStays={vipStays} />
            ) : (
              <>
                {/* 💰 Priority 2: Today's money block — owner/manager only */}
                {canSee(currentRole, 'finance') && (
                  <TodayHero metrics={todayMetrics} dateLabel={dateLabel} hotelSlug={hotel.slug} />
                )}

            {/* Arrivals pipeline — next 7 days */}
            <ForecastStrip summary={forecast} hotelSlug={hotel.slug} />

            {/* Housekeeping board glance — inventory health */}
            <HousekeepingStrip summary={housekeeping} hotelSlug={hotel.slug} />

            {/* Ops at a glance — compact secondary strip; preserves drawer entry points.
                When every metric is zero/null (a brand-new hotel or a quiet day),
                collapse to a single ribbon-pill instead of paying full pixel rent
                for "0 · 0 · — · —". Click drops the operator into the same drawer
                as the expanded version. */}
            {(tasksTotal === 0 && tasksAtRisk === 0 && avgResponseMin == null && !guestPrimary) ? (
              <button
                type="button"
                onClick={() => setActiveDrawer('tasks')}
                className="self-start inline-flex items-center gap-3 px-3.5 py-2 rounded-xl border border-slate-800/60 bg-[#151A25] hover:bg-slate-800/40 transition-colors text-left"
              >
                <Clock size={14} className="text-slate-500" />
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{t("serviceOps.label", "Service ops")}</span>
                  <span className="text-xs text-slate-500">{t("serviceOps.summary", "all quiet · 0 open · — avg · awaiting first rating")}</span>
                </div>
              </button>
            ) : (
              <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                <OpsChip
                  label={t("ops.activeTasks", "Active Tasks")}
                  value={`${tasksTotal}`}
                  sub={tasksTotal === 0 ? t("ops.allClear", "All clear") : t("ops.openRequests", "Open requests")}
                  tone={tasksTotal > 0 ? "amber" : "neutral"}
                  icon={Clock}
                  onClick={() => setActiveDrawer('tasks')}
                />
                <OpsChip
                  label={t("ops.atRisk", "At Risk")}
                  value={`${tasksAtRisk}`}
                  sub={tasksAtRisk === 0 ? t("ops.underSla", "Under SLA") : t("ops.exceedingTargets", "Exceeding targets")}
                  tone={tasksAtRisk > 0 ? "rose" : "neutral"}
                  icon={AlertTriangle}
                  onClick={() => setActiveDrawer('atRisk')}
                />
                <OpsChip
                  label={t("ops.avgResponse", "Avg Response")}
                  value={avgResponseMin == null ? "—" : `${avgResponseMin}m`}
                  sub={avgResponseMin == null ? t("ops.awaitingFirstTicket", "Awaiting first ticket") : t("ops.slaPerformance", "SLA performance")}
                  tone="neutral"
                  icon={LayoutDashboard}
                  onClick={() => setActiveDrawer('sla')}
                />
                <OpsChip
                  label={t("ops.guestSatisfaction", "Guest Satisfaction")}
                  value={guestPrimary ?? "—"}
                  sub={typeof npsScore === "number" && (npsResponses ?? 0) > 0 ? t("ops.npsRes", "NPS · {{count}} res", { count: npsResponses }) : typeof avgRating30d === "number" ? t("ops.avgRating", "Avg rating") : t("ops.firstRatings", "First ratings appear here")}
                  tone={guestTone === "green" ? "emerald" : guestTone === "amber" ? "amber" : guestTone === "red" ? "rose" : "neutral"}
                  icon={MessageSquare}
                  onClick={() => setActiveDrawer('satisfaction')}
                />
              </div>
            )}

            {/* 🔄 Priority 3: Operations Pulse (Active Tasks + Trend).
                Same all-zero-collapse policy as Service Ops and HK: when
                Shift Workload has all three counts at zero AND Operations
                Pulse has no hourly data, the whole grid is dead weight. Skip
                it entirely — the Service Ops pill above already conveys the
                "nothing happening" signal once. */}
            {(() => {
              const tv = ((metrics as any)?.taskVolume ?? []) as any[];
              const hasMeaningfulPulse = tv.some((p: any) => (p?.count ?? 0) > 0);
              const allWorkloadZero = tasksTotal === 0 && tasksAtRisk === 0 && (blockedCount ?? 0) === 0;
              if (allWorkloadZero && !hasMeaningfulPulse) {
                return null;
              }
              return (
            <div className="grid gap-4 xl:grid-cols-3">
              <DarkCard className="p-5">
                <CardHeader
                  title={t("pulse.shiftWorkload", "Shift Workload")}
                  right={
                    <StatusBadge
                      label={slaPct == null ? t("pulse.slaDash", "SLA —") : slaToneLevel === "green" ? t("pulse.onTrack", "On track") : slaToneLevel === "amber" ? t("pulse.watch", "Watch") : t("pulse.risk", "Risk")}
                      tone={slaToneLevel}
                    />
                  }
                />
                <div className="mt-4 flex flex-col gap-3">
                  <BreakRow label={t("pulse.openRequests", "Open Requests")} value={tasksTotal} tone={tasksTotal > 0 ? "green" : "grey"} />
                  <BreakRow label={t("pulse.atRiskSla", "At Risk (> SLA)")} value={tasksAtRisk} tone={tasksAtRisk > 0 ? "amber" : "grey"} />
                  <BreakRow label={t("pulse.blockedIssues", "Blocked Issues")} value={blockedCount ?? 0} tone={(blockedCount ?? 0) > 0 ? "red" : "grey"} />
                </div>
              </DarkCard>

              <DarkCard className="p-5 xl:col-span-2">
                <CardHeader
                  title={t("pulse.operationsPulse", "Operations Pulse")}
                  subtitle={t("pulse.requestVolume", "Request volume (live data)")}
                  right={
                    /* Only render badges when they carry signal — a "0 at
                       risk · Occ 0%" pair is noise that competes for the eye
                       with the actual chart. */
                    (tasksAtRisk > 0 || occPct > 0) ? (
                      <div className="flex items-center gap-2">
                        {tasksAtRisk > 0 && <MiniBadge label={t("pulse.nAtRisk", "{{count}} at risk", { count: tasksAtRisk })} tone="amber" />}
                        {occPct > 0 && <MiniBadge label={t("pulse.occPct", "Occ {{pct}}%", { pct: occPct })} tone={occupancyTone(occPct)} />}
                      </div>
                    ) : null
                  }
                />
                <div className="mt-3">
                  {hasMeaningfulPulse ? (
                    <TaskVolumeChart data={tv} loading={!metrics} />
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] px-4 py-3 flex items-center gap-3">
                      <div className="text-lg">📊</div>
                      <div className="text-xs text-slate-400">
                        {t("pulse.noVolume", "No request volume today. The hourly chart will appear once tickets start flowing.")}
                      </div>
                    </div>
                  )}
                </div>
              </DarkCard>
            </div>
              );
            })()}

            {/* 📋 Priority 4: Task Summary + Issue Breakdown.
                Issue Breakdown is a *derivative* view of liveTasks — when
                there's nothing to break down AND no feedback to show, the
                whole card is dead weight. Drop it from the grid and let
                Live Requests span full width in that case. */}
            {(() => {
              const showIssueBreakdown =
                liveTasks.length > 0
                || (typeof npsScore === "number" && (npsResponses ?? 0) > 0)
                || typeof avgRating30d === "number";
              return (
            <div className={`grid gap-4 ${showIssueBreakdown ? "xl:grid-cols-3" : ""}`}>
              <DarkCard className={`p-5 ${showIssueBreakdown ? "xl:col-span-2" : ""}`}>
                <CardHeader
                  title={t("live.liveRequests", "Live Requests")}
                  subtitle={t("live.latestOpen", "Latest open service requests")}
                  right={
                    <Link to={`/ops?slug=${encodeURIComponent(hotel.slug)}`} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 px-2.5 py-1.5 rounded-lg transition-colors border border-emerald-500/20">
                      {t("live.openOpsBoard", "Open Ops Board →")}
                    </Link>
                  }
                />
                <div className="mt-3">
                  {liveTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] px-4 py-3 flex items-center gap-3">
                      <div className="text-lg">✅</div>
                      <div className="text-xs text-slate-400">{t("live.noLive", "No live requests right now — operations are running smoothly.")}</div>
                    </div>
                  ) : (
                    <DarkTable>
                      <thead>
                        <tr>
                          <Th>{t("live.thTask", "Task")}</Th>
                          <Th className="hidden sm:table-cell">{t("live.thStatus", "Status")}</Th>
                          <Th>{t("live.thAge", "Age")}</Th>
                          <Th className="text-right">{t("live.thSla", "SLA")}</Th>
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
                              <Td><span className={`font-mono text-sm ${breach ? "text-rose-400" : "text-slate-200"}`}>{t("live.ageMin", "{{m}}m", { m: mins })}</span></Td>
                              <Td className="text-right">
                                <StatusBadge label={breach ? t("live.atRiskBadge", "At risk") : t("live.onTime", "On time")} tone={breach ? "amber" : "green"} />
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DarkTable>
                  )}
                </div>
              </DarkCard>

              {showIssueBreakdown && (
              <DarkCard className="p-5">
                <CardHeader title={t("live.issueBreakdown", "Issue Breakdown")} subtitle={t("live.openByState", "Open requests by state")} />
                <div className="mt-3">
                  {liveTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] p-4 text-center text-sm text-slate-500">{t("live.allClear", "All clear")}</div>
                  ) : (
                    <IssueBreakdown orders={liveTasks} targetMin={targetMin} />
                  )}
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{t("live.recentFeedback", "Recent feedback")}</div>
                  <div className="mt-2">
                    {typeof npsScore === "number" && (npsResponses ?? 0) > 0 ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">{t("live.nps", "NPS {{score}}", { score: npsScore })}</div>
                          <div className="text-[11px] text-slate-400">{t("live.npsResponses", "{{count}} responses (30d)", { count: npsResponses })}</div>
                        </div>
                        <StatusBadge label={t("live.guest", "Guest")} tone="green" />
                      </div>
                    ) : typeof avgRating30d === "number" ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-100 font-semibold">{t("live.ratingScore", "Rating {{rating}}/5", { rating: avgRating30d.toFixed(1) })}</div>
                          <div className="text-[11px] text-slate-400">{t("live.last30days", "Last 30 days")}</div>
                        </div>
                        <StatusBadge label={t("live.guest", "Guest")} tone={ratingTone(avgRating30d)} />
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">{t("live.noFeedback", "No feedback data yet")}</div>
                    )}
                  </div>
                </div>
              </DarkCard>
              )}
            </div>
              );
            })()}

            {/* 📈 Priority 5: SLA Performance — only render when there's something
                to show. On a brand-new hotel with zero tickets, the empty
                200px chart placeholder makes the dashboard read "broken" rather
                than "new". Skip the section entirely until either live data
                or historical series exists. */}
            {(hasSeries(slaSeries) || liveTasks.length > 0) && (
              <div className="grid gap-4 xl:grid-cols-3">
                <DarkCard className="p-5 xl:col-span-2">
                  <CardHeader
                    title={t("slaPerf.title", "SLA Performance")}
                    subtitle={t("slaPerf.resolutionTrend", "Resolution trend (target {{m}}m)", { m: targetMin })}
                    right={
                      slaPct == null ? <MiniBadge label={t("slaPerf.slaDash", "SLA —")} tone="grey" /> : <MiniBadge label={t("slaPerf.slaPct", "SLA {{pct}}%", { pct: slaPct })} tone={slaToneLevel} />
                    }
                  />
                  <div className="mt-3">
                    {hasSeries(slaSeries) ? (
                      <SlaPerformanceChart data={slaSeries || []} loading={!metrics} />
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] px-4 py-3 flex items-center gap-3">
                        <div className="text-lg">📉</div>
                        <div className="text-xs text-slate-400">{t("slaPerf.trendAppears", "SLA trend appears after a few tickets are processed.")}</div>
                      </div>
                    )}
                  </div>
                </DarkCard>
              </div>
            )}
              </>
            )}
          </section>

          {/* ─── Right Rail ─── */}
          <aside className="space-y-4 xl:block">
            {/* Quick Stats — guest flow, today */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setActiveDrawer('arrivals')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveDrawer('arrivals');
                }
              }}
              className="cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
            >
              <DarkCard className="p-4 hover:border-slate-700 transition-colors">
                <CardHeader title={t("snapshot.title", "Today's Snapshot")} subtitle={t("snapshot.guestFlow", "Guest flow · {{date}}", { date: dateLabel })} />
                {(() => {
                  const inhouseCount = Array.isArray(inhouse) ? inhouse.length : 0;
                  const allZero = arrivalsCount === 0 && inhouseCount === 0 && departuresCount === 0;
                  // Quiet-day collapse — three rows of "0 / 0 / 0" carries no
                  // signal beyond what a one-line summary conveys. Compact it
                  // so the right rail uses ~30px instead of ~140px for the
                  // same information density.
                  if (allZero) {
                    return (
                      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800/60 bg-[#0B0E14]">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                        <span className="text-xs text-slate-400">{t("snapshot.quietDay", "Quiet day · no arrivals, in-house, or departures")}</span>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-3 flex flex-col gap-2">
                      <SnapshotRow
                        label={t("snapshot.arrivalsToday", "Arrivals today")}
                        hint={t("snapshot.expectedCheckins", "Expected check-ins")}
                        value={arrivalsCount}
                        dotClass={arrivalsCount > 0 ? "bg-blue-400" : "bg-slate-600"}
                      />
                      <SnapshotRow
                        label={t("snapshot.inHouseNow", "In-house now")}
                        hint={t("snapshot.checkedIn", "Guests physically checked in")}
                        value={inhouseCount}
                        dotClass={inhouseCount > 0 ? "bg-emerald-400" : "bg-slate-600"}
                        tone="emerald"
                      />
                      <SnapshotRow
                        label={t("snapshot.departuresToday", "Departures today")}
                        hint={t("snapshot.expectedCheckouts", "Expected check-outs")}
                        value={departuresCount}
                        dotClass={departuresCount > 0 ? "bg-amber-400" : "bg-slate-600"}
                      />
                    </div>
                  );
                })()}
                {/* Reconciliation note: a pending departure must be in-house — if not, flag it */}
                {departuresCount > 0 && (Array.isArray(inhouse) ? inhouse.length : 0) === 0 && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-[11px] leading-snug text-amber-200/90">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
                    <span>
                      <span className="font-semibold">{t("snapshot.headsUp", "Heads up:")}</span> {t("snapshot.headsUpMsg", "{{count}} departures expected today, but no guests are marked in-house — check-in records may be missing.", { count: departuresCount })}
                    </span>
                  </div>
                )}
              </DarkCard>
            </div>

            {/* Visibility Score — Position 9. Hero card, top of right rail.
                Stays in the right rail (alongside Outstanding Balance + Staff)
                because it's the meta-KPI that benefits from sitting next to
                operational status. All other Growth Hub cards moved below into
                the full-width <GrowthHubGrid> for better horizontal use. */}
            {VISIBILITY_SCORE_ENABLED && (
              <VisibilityScoreCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Outstanding Balance — money owed by in-house guests (owner/manager) */}
            {canSee(currentRole, 'finance') && (
              <OutstandingBalanceCard summary={outstandingBalance} hotelSlug={hotel.slug} />
            )}

            <div
              role="button"
              tabIndex={0}
              onClick={() => setActiveDrawer('staff')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveDrawer('staff');
                }
              }}
              className="cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
            >
              <DarkCard className="p-4 hover:border-slate-700 transition-colors">
                <CardHeader title={t("staffCard.title", "Staff On Duty")} subtitle={t("staffCard.activeTeam", "Active team members")} />
                <div className="mt-3">
                  <StaffList data={staffPerf} />
                </div>
                {HAS_HRMS && (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{t("staffCard.attendance", "Attendance")}</div>
                      <Link to={`/owner/${hotel.slug}/hrms`} className="text-[11px] text-slate-300 hover:text-slate-100 underline">{t("staffCard.open", "Open →")}</Link>
                    </div>
                    <div className="mt-2"><AttendanceMini data={hrms} /></div>
                  </div>
                )}
              </DarkCard>
            </div>

            {/* Guest Satisfaction conditionally shown */}
            {(typeof npsScore === "number" || typeof avgRating30d === "number") && (
              <DarkCard className="p-4">
                <CardHeader title={t("satCard.title", "Guest Satisfaction")} subtitle={t("satCard.signal", "NPS / Rating signal")} />
                <div className="mt-3">
                  <SatisfactionPanel hotelName={hotel.name} npsScore={npsScore} npsResponses={npsResponses} avgRating30d={avgRating30d} />
                </div>
              </DarkCard>
            )}

            {/* Workforce card — suppressed entirely when there are no jobs to
                show. A "Not available" stub on a brand-new hotel is dead pixel
                weight in the right rail; if the feature has no data, it should
                not occupy a slot. The card reappears as soon as a job exists. */}
            {HAS_WORKFORCE && canSee(currentRole, 'hr') && !workforceLoading && (workforceJobs?.length ?? 0) > 0 && (
              <DarkCard className="p-4">
                <CardHeader title={t("workforceCard.title", "Workforce")} subtitle={t("workforceCard.openRoles", "Open roles")} />
                <div className="mt-3"><WorkforceMini jobs={workforceJobs} loading={workforceLoading} /></div>
              </DarkCard>
            )}

            {/* Quick Links moved out of the right rail into the bottom footer
                strip — it was duplicating the sidebar at high pixel cost and
                stealing focus from Visibility/Outstanding. See <QuickLinksFooter /> below. */}
          </aside>
        </div>

        {/* ─── Growth Hub ──────────────────────────────────────────────
            Full-width 3-column grid below the main 3-col layout. Cards
            here are the strategic/exploratory features — not operational
            status. Visibility Score stays in the right rail as the meta-KPI.
            Mobile: 1 col · Tablet: 2 cols · Desktop: 3 cols.            */}
        <section className="mt-8" data-testid="growth-hub-grid">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              {t("growth.title", "Growth Hub")}
            </h2>
            <span className="text-[10px] text-slate-500">
              {t("growth.subtitle", "Lead capture · packages · SEO · partners · seasonal · OTA · assets · drips")}
            </span>
          </header>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr [&>a]:h-full [&>div]:h-full">
            {/* Day 11 — Open leads summary widget */}
            <LeadsSummaryCard hotelId={hotel.id} hotelSlug={hotel.slug} />

            {/* Follow-up Radar — real follow-ups */}
            {FOLLOW_UP_RADAR_V0_ENABLED && (
              <ActionRadarCard hotelSlug={hotel.slug} hotelId={hotel.id} />
            )}

            {/* AI Quote Drafts v0 */}
            {AI_QUOTE_DRAFTS_V0_ENABLED && (
              <QuoteDraftCard hotelSlug={hotel.slug} />
            )}

            {/* Experience Package Builder — Position 5 */}
            {PACKAGE_BUILDER_V0_ENABLED && (
              <PackageBuilderCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Local SEO Landing Planner — Position 7 */}
            {LOCAL_SEO_LANDING_PLANNER_V0_ENABLED && (
              <LocalSeoPlannerCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Local Partner Directory — Position 4 */}
            {PARTNER_NETWORK_V1_ENABLED && (
              <PartnersSummaryCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Follow-up email sequences — Position 2 (drip engine) */}
            {DRIP_ENGINE_V1_ENABLED && (
              <DripActivityCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Digital Asset Manager — Position 6 */}
            {DIGITAL_ASSET_MANAGER_V0_ENABLED && (
              <AssetReadinessCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* Seasonal Demand Calendar — Position 8 */}
            {SEASONAL_DEMAND_CALENDAR_V0_ENABLED && (
              <SeasonalCalendarCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}

            {/* OTA Listing Optimizer — Position 10 */}
            {OTA_LISTING_OPTIMIZER_V0_ENABLED && (
              <OTAReadinessCard hotelId={hotel.id} hotelSlug={hotel.slug} />
            )}
          </div>
        </section>

        {/* ─── Platform (admin-only) ──────────────────────────────────────
            System Health is VAiyu-wide infrastructure telemetry (all hotels'
            edge-function traffic), so it renders ONLY for platform admins —
            never for hotel owners/managers. Gate mirrors public.is_platform_admin().
            Reachable because a platform admin viewing this dashboard is, by the
            access check above, also an owner/manager of this hotel. */}
        {isPlatformAdmin && (
          <section className="mt-8 pt-5 border-t border-slate-800/50" data-testid="platform-admin-grid">
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Platform
              </h2>
              <span className="text-[10px] text-slate-500">VAiyu-wide infrastructure health · admin only</span>
            </header>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr [&>div]:h-full">
              <ObservabilityCard />
            </div>
          </section>
        )}

        {/* ─── Quick Links footer strip ──────────────────────────────────
            These are jump-points the operator may reach for at the end of a
            session (deep links to analytics or support). Lives below Growth
            Hub as a thin horizontal row instead of stealing right-rail real
            estate that's better used by Visibility/Outstanding/Staff. */}
        <section className="mt-8 pt-5 border-t border-slate-800/50">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
              {t("quickLinks.title", "Quick Links")}
            </h2>
            <span className="text-[10px] text-slate-500">{t("quickLinks.subtitle", "Deep links into the rest of the console")}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Link to={`/owner/${hotel.slug}/analytics`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#151A25] px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
              {t("quickLinks.ownerAnalytics", "Owner Analytics")} <span className="text-slate-600">→</span>
            </Link>
            <Link to={`/owner/${hotel.slug}/reviews`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#151A25] px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
              {t("quickLinks.guestReviews", "Guest Reviews")} <span className="text-slate-600">→</span>
            </Link>
            <Link to={`/ops/analytics?slug=${encodeURIComponent(hotel.slug)}`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#151A25] px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
              {t("quickLinks.opsManager", "Ops Manager")} <span className="text-slate-600">→</span>
            </Link>
            <Link to={`/checkin?slug=${encodeURIComponent(hotel.slug)}`} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#151A25] px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
              {t("quickLinks.frontDesk", "Front Desk")} <span className="text-slate-600">→</span>
            </Link>
            <a href="mailto:support@vaiyu.co.in?subject=Owner%20Dashboard%20help" className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#151A25] px-3 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
              {t("quickLinks.contactSupport", "Contact Support")} <span className="text-slate-600">→</span>
            </a>
          </div>
        </section>
      </div>
      {/* ─── Detail Drawers ─── */}
      {activeDrawer && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setActiveDrawer(null)} />
          <div className="relative w-full sm:max-w-2xl bg-[#0B0E14] h-full shadow-3xl overflow-y-auto border-l border-slate-800/50" style={{ animation: 'slideInRight 0.3s ease-out' }}>
            <div className="sticky top-0 z-10 bg-[#0B0E14]/95 backdrop-blur-md border-b border-slate-800/50 px-4 sm:px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {activeDrawer === 'rooms' && t("drawers.roomsTitle", "🏨 Room Occupancy Details")}
                {activeDrawer === 'tasks' && t("drawers.tasksTitle", "📋 Active Tasks")}
                {activeDrawer === 'atRisk' && t("drawers.atRiskTitle", "⚠️ At-Risk Analysis")}
                {activeDrawer === 'sla' && t("drawers.slaTitle", "📈 SLA Performance")}
                {activeDrawer === 'satisfaction' && t("drawers.satisfactionTitle", "⭐ Guest Satisfaction")}
                {activeDrawer === 'staff' && t("drawers.staffTitle", "👥 Staff On Duty")}
                {activeDrawer === 'arrivals' && t("drawers.arrivalsTitle", "🛬 Today's Guest Movement")}
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
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.totalRooms", "Total Rooms")}</div>
                      <div className="text-3xl font-bold text-white">{total || 0}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4">
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.occupied", "Occupied")}</div>
                      <div className="text-3xl font-bold text-emerald-400">{occupied || 0}</div>
                      <div className="text-xs text-slate-500 mt-1">{t("drawers.occupancyPct", "{{pct}}% occupancy", { pct: occPct || 0 })}</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-4">{t("drawers.guestFlow", "Today's Guest Flow")}</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-blue-400">{arrivalsCount}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.arrivals", "Arrivals")}</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-emerald-400">{Array.isArray(inhouse) ? inhouse.length : 0}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.inHouse", "In-House")}</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                        <div className="text-2xl font-bold text-amber-400">{departuresCount}</div>
                        <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.departures", "Departures")}</div>
                      </div>
                    </div>
                  </div>
                  {arrivals.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.expectedArrivals", "Expected Arrivals")}</div>
                      <div className="space-y-2">
                        {arrivals.slice(0, 10).map(a => (
                          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">{t("drawers.room", "Room {{room}}", { room: a.room || t("drawers.tbd", "TBD") })}</div>
                              <div className="text-[11px] text-slate-500">{t("drawers.guestId", "Guest ID: {{id}}...", { id: a.guest_id?.slice(0, 8) })}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">{a.check_in_start ? new Date(a.check_in_start).toLocaleTimeString(ownerLocale, { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
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
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.active", "Active")}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-amber-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-amber-400">{tasksAtRisk}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.atRisk", "At Risk")}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-rose-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-rose-400">{blockedCount || 0}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.blocked", "Blocked")}</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.allOpen", "All Open Requests ({{count}})", { count: liveTasks.length })}</div>
                    {liveTasks.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">{t("drawers.noOpen", "No open requests. Operations are running smoothly. ✅")}</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.map(task => {
                          const mins = ageMin(task.created_at);
                          const breach = mins > targetMin;
                          return (
                            <div key={task.id} className={`flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border ${breach ? 'border-rose-500/30' : 'border-slate-800/50'}`}>
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate">{task.title || `#${task.id.slice(0, 8)}`}</div>
                                <div className="text-[11px] text-slate-500">{t("drawers.statusAge", "{{status}} · {{m}}m ago", { status: task.status, m: mins })}</div>
                              </div>
                              <StatusBadge label={breach ? t("drawers.atRiskBadge", "At risk") : t("drawers.onTime", "On time")} tone={breach ? 'amber' : 'green'} />
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
                      <div className="text-sm font-semibold text-slate-200">{t("drawers.riskSummary", "Risk Summary")}</div>
                    </div>
                    <div className="text-3xl font-bold text-rose-400">{tasksAtRisk}</div>
                    <div className="text-xs text-slate-500 mt-1">{t("drawers.exceedingTarget", "Tasks exceeding {{m}}m SLA target", { m: targetMin })}</div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.overdueTasks", "Overdue Tasks")}</div>
                    {liveTasks.filter(task => ageMin(task.created_at) > targetMin).length === 0 ? (
                      <div className="text-center py-8 text-slate-500">{t("drawers.noneAtRisk", "No tasks currently at risk. All clear! ✅")}</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.filter(task => ageMin(task.created_at) > targetMin).map(task => {
                          const mins = ageMin(task.created_at);
                          return (
                            <div key={task.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-rose-500/20">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-200 truncate">{task.title || `#${task.id.slice(0, 8)}`}</div>
                                <div className="text-[11px] text-slate-500">{task.status}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-bold font-mono text-rose-400">{t("live.ageMin", "{{m}}m", { m: mins })}</div>
                                <div className="text-[10px] text-slate-500">{t("drawers.overdueBy", "overdue by {{m}}m", { m: mins - targetMin })}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.blockedTasks", "Blocked Tasks")}</div>
                    {(blockedCount ?? 0) === 0 ? (
                      <div className="text-center py-4 text-slate-500">{t("drawers.noBlocked", "No blocked tasks")}</div>
                    ) : (
                      <div className="space-y-2">
                        {liveTasks.filter(task => ['blocked', 'paused', 'hold'].some(k => (task.status || '').toLowerCase().includes(k))).map(task => (
                          <div key={task.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-amber-500/20">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate">{task.title || `#${task.id.slice(0, 8)}`}</div>
                              <div className="text-[11px] text-slate-500">{t("drawers.statusMin", "{{status}} · {{m}}m", { status: task.status, m: ageMin(task.created_at) })}</div>
                            </div>
                            <StatusBadge label={t("drawers.blockedBadge", "Blocked")} tone="red" />
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
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.avgResponse", "Avg Response")}</div>
                      <div className="text-3xl font-bold text-white">{avgResponseMin == null ? '—' : `${avgResponseMin}m`}</div>
                    </div>
                    <div className={`bg-[#151A25] rounded-xl border p-4 ${slaToneLevel === 'green' ? 'border-emerald-500/20' : slaToneLevel === 'amber' ? 'border-amber-500/20' : 'border-rose-500/20'}`}>
                      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.slaCompliance", "SLA Compliance")}</div>
                      <div className={`text-3xl font-bold ${slaToneLevel === 'green' ? 'text-emerald-400' : slaToneLevel === 'amber' ? 'text-amber-400' : 'text-rose-400'}`}>{slaPct == null ? '—' : `${slaPct}%`}</div>
                      <div className="text-xs text-slate-500 mt-1">{t("drawers.target", "Target: {{m}}m", { m: targetMin })}</div>
                    </div>
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.chartTitle", "SLA Performance Chart")}</div>
                    {hasSeries(slaSeries) ? (
                      <SlaPerformanceChart data={slaSeries || []} loading={false} />
                    ) : (
                      <div className="text-center py-8 text-slate-500">{t("drawers.dataAppears", "SLA data will appear after requests are processed.")}</div>
                    )}
                  </div>
                  <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                    <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.detailedAnalytics", "For detailed analytics")}</div>
                    <Link to={`/owner/${hotel.slug}/analytics`} className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20 transition-colors">
                      {t("drawers.openAnalytics", "Open Owner Analytics →")}
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
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.npsScore", "NPS Score")}</div>
                        <div className="text-3xl font-bold text-emerald-400">{npsScore}</div>
                        <div className="text-xs text-slate-500 mt-1">{t("drawers.npsResponses", "{{count}} responses (30d)", { count: npsResponses })}</div>
                      </div>
                    )}
                    {typeof avgRating30d === 'number' && (
                      <div className="bg-[#151A25] rounded-xl border border-blue-500/20 p-4">
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{t("drawers.avgRating", "Avg Rating")}</div>
                        <div className="text-3xl font-bold text-blue-400">{t("drawers.ratingOutOf", "{{rating}}/5", { rating: avgRating30d.toFixed(1) })}</div>
                        <div className="text-xs text-slate-500 mt-1">{t("drawers.last30days", "Last 30 days")}</div>
                      </div>
                    )}
                  </div>
                  {npsSnapshot && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.npsBreakdown", "NPS Breakdown")}</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-emerald-500/20">
                          <div className="text-2xl font-bold text-emerald-400">{npsSnapshot.promoters}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.promoters", "Promoters")}</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-amber-500/20">
                          <div className="text-2xl font-bold text-amber-400">{npsSnapshot.passives}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.passives", "Passives")}</div>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-[#0B0E14] border border-rose-500/20">
                          <div className="text-2xl font-bold text-rose-400">{npsSnapshot.detractors}</div>
                          <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.detractors", "Detractors")}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {typeof npsScore !== 'number' && typeof avgRating30d !== 'number' && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-8 text-center">
                      <div className="text-2xl mb-2">📊</div>
                      <div className="text-sm text-slate-400">{t("drawers.satNoData", "Guest satisfaction data will appear once feedback is collected.")}</div>
                    </div>
                  )}
                </>
              )}

              {/* STAFF DRAWER */}
              {activeDrawer === 'staff' && (
                <>
                  {staffPerf && staffPerf.length > 0 ? (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.fullRoster", "Full Staff Roster ({{count}})", { count: staffPerf.length })}</div>
                      <div className="space-y-2">
                        {staffPerf.map(r => (
                          <div key={r.staff_id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-200 truncate">{r.display_name}</div>
                              <div className="text-[11px] text-slate-500">{r.department_name || r.role}</div>
                            </div>
                            <StatusBadge label={r.is_online ? t("drawers.online", "Online") : t("drawers.away", "Away")} tone={r.is_online ? 'green' : 'grey'} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">{t("drawers.noStaff", "No staff data available")}</div>
                  )}
                  {hrms && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.attendanceSummary", "Attendance Summary")}</div>
                      <div className="grid grid-cols-2 gap-3">
                        <MiniStat label={t("drawers.present", "Present")} value={hrms.present_today} tone={hrms.attendance_pct_today >= 85 ? 'green' : 'amber'} />
                        <MiniStat label={t("drawers.absent", "Absent")} value={hrms.absent_today} tone={hrms.absent_today > 0 ? 'amber' : 'grey'} />
                        <MiniStat label={t("drawers.late", "Late")} value={hrms.late_today} tone={hrms.late_today > 0 ? 'amber' : 'grey'} />
                        <MiniStat label={t("drawers.attPct", "Att %")} value={`${hrms.attendance_pct_today}%`} tone={hrms.attendance_pct_today >= 85 ? 'green' : 'amber'} />
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
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.arrivals", "Arrivals")}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-emerald-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{Array.isArray(inhouse) ? inhouse.length : 0}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.inHouse", "In-House")}</div>
                    </div>
                    <div className="bg-[#151A25] rounded-xl border border-amber-500/20 p-4 text-center">
                      <div className="text-2xl font-bold text-amber-400">{departuresCount}</div>
                      <div className="text-[10px] uppercase text-slate-500 mt-1">{t("drawers.departures", "Departures")}</div>
                    </div>
                  </div>
                  {arrivals.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.arrivalsCount", "Arrivals ({{count}})", { count: arrivals.length })}</div>
                      <div className="space-y-2">
                        {arrivals.map(a => (
                          <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">{t("drawers.room", "Room {{room}}", { room: a.room || t("drawers.tbd", "TBD") })}</div>
                              <div className="text-[11px] text-slate-500">{t("drawers.guestId", "Guest ID: {{id}}...", { id: a.guest_id?.slice(0, 8) })}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {departures.length > 0 && (
                    <div className="bg-[#151A25] rounded-xl border border-slate-800/50 p-5">
                      <div className="text-sm font-semibold text-slate-200 mb-3">{t("drawers.departuresCount", "Departures ({{count}})", { count: departures.length })}</div>
                      <div className="space-y-2">
                        {departures.map(d => (
                          <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B0E14] border border-slate-800/50">
                            <div>
                              <div className="text-sm font-medium text-slate-200">{t("drawers.room", "Room {{room}}", { room: d.room || t("drawers.tbd", "TBD") })}</div>
                              <div className="text-[11px] text-slate-500">{t("drawers.guestId", "Guest ID: {{id}}...", { id: d.guest_id?.slice(0, 8) })}</div>
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

function UserProfileMenu({ slug, role }: { slug: string; role?: DashboardRole | null }) {
  const t = useOwnerT("owner-dashboard");
  const tc = useOwnerCommonT();
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
        // Role label is localised via the owner-common role display-map (keyed by
        // the UPPERCASE code) so it stays Hindi post-reveal; the code itself is
        // never translated, only its display.
        role: role ? t("profile.roleView", "{{role}} View", { role: localizeCode(tc, 'role', role.toUpperCase()) }) : t("profile.memberView", "Member View"),
      });
    }
    loadUser();
  }, [role, t, tc]);

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
              {t("profile.settings", "Settings")}
            </Link>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors text-left"
            >
              <LogOut className="h-4 w-4" />
              {t("profile.signOut", "Sign Out")}
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
  const t = useOwnerT("owner-dashboard");
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
          {t("topbar.switchProperty", "Switch Property")}
        </Link>

        {HAS_PRICING && (
          <Link
            to={`/owner/${slug}/pricing`}
            className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {t("topbar.pricing", "Pricing")}
          </Link>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 p-2 hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          title={t("topbar.sync", "Sync")}
        >
          <SvgSync />
        </button>

        <UserProfileMenu slug={slug} />

        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex lg:hidden items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 p-2 hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white"
          title={t("topbar.menu", "Menu")}
        >
          <SvgMenu />
        </button>
      </div>
    </header>
  );
}

function SidebarNav({ slug, onNavClick }: { slug: string; onNavClick?: () => void }) {
  const t = useOwnerT("owner-dashboard");
  const encodedSlug = encodeURIComponent(slug);
  const servicesHref = `/owner/services?slug=${encodedSlug}`;
  const opsAnalyticsHref = `/ops/analytics?slug=${encodedSlug}`;
  const settingsHref = `/owner/${slug}/settings`;

  return (
    <nav aria-label={t("nav.ariaLabel", "Owner dashboard navigation")} className="space-y-4 text-sm">
      {/* Operations */}
      <div>
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.operations", "Operations")}</div>
        <div className="space-y-1">
          <NavItem href="#top" label={t("nav.overview", "Overview")} active onClick={onNavClick} />
          <NavItem to={`/ops?slug=${encodedSlug}`} label={t("nav.supervisor", "Supervisor")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/arrivals`} label={t("nav.arrivals", "Arrivals")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/housekeeping`} label={t("nav.housekeeping", "Housekeeping")} onClick={onNavClick} />
          <NavItem to={`/checkin?slug=${encodedSlug}`} label={t("nav.frontDesk", "Front Desk")} onClick={onNavClick} />
        </div>
      </div>
      {/* Analytics */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.analytics", "Analytics")}</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/analytics`} label={t("nav.ownerAnalytics", "Owner Analytics")} onClick={onNavClick} />
          <NavItem to={opsAnalyticsHref} label={t("nav.opsManager", "Ops Manager")} onClick={onNavClick} />
        </div>
      </div>
      {/* Dynamic Pricing */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.pricing", "Pricing")}</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/pricing`} label={t("nav.dynamicPricing", "Dynamic Pricing")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/pricing/rules`} label={t("nav.rules", "↳ Rules")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/pricing/history`} label={t("nav.history", "↳ History")} onClick={onNavClick} />
        </div>
      </div>
      {/* Revenue & Finance — top-line revenue through to cash settlement */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.revenueFinance", "Revenue & Finance")}</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/revenue`} label={t("nav.revenue", "Revenue")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/finance`} label={t("nav.plOverview", "P&L Overview")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/finance/budgets`} label={t("nav.budgets", "↳ Budgets")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/finance/expenses`} label={t("nav.expenses", "↳ Expenses")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/payments`} label={t("nav.payments", "Payments & Settlements")} onClick={onNavClick} />
        </div>
      </div>
      {/* Staff */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.staff", "Staff")}</div>
        <div className="space-y-1">
          <NavItem to={servicesHref} label={t("nav.departmentsSlas", "Departments & SLAs")} onClick={onNavClick} />
          <NavItem to={`/owner/${slug}/staff-shifts`} label={t("nav.staffShifts", "Staff & Shifts")} onClick={onNavClick} />
          <NavItem to="/staff" label={t("nav.staffApp", "Staff App")} onClick={onNavClick} />
          <NavItem to="/kitchen" label={t("nav.kitchen", "Kitchen")} onClick={onNavClick} />
        </div>
      </div>
      {/* System */}
      <div className="pt-2">
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3 px-3">{t("nav.system", "System")}</div>
        <div className="space-y-1">
          <NavItem to={`/owner/${slug}/import-bookings`} label={t("nav.importBookings", "Import Bookings")} onClick={onNavClick} />
          <NavItem to={settingsHref} label={t("nav.settings", "Settings")} onClick={onNavClick} />
          {HAS_CALENDAR && <NavItem to="../bookings/calendar" label={t("nav.calendar", "Calendar")} onClick={onNavClick} />}
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

type AttentionSeverity = "critical" | "warning" | "info";
type AttentionItem = {
  key: string;
  severity: AttentionSeverity;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  cta: { label: string; to: string };
};

function AttentionStrip({
  items,
  topSeverity,
}: {
  items: AttentionItem[];
  topSeverity: AttentionSeverity | null;
}) {
  const t = useOwnerT("owner-dashboard");
  // Empty state — slim inline chip (was a full-row banner). When there's no
  // attention required, the dashboard shouldn't shout at the operator with a
  // big green panel; a quiet status pill aligned with the timestamp area is
  // honest signaling without stealing focus from the metrics below.
  if (items.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 self-start px-2.5 py-1 rounded-full border border-emerald-500/15 bg-emerald-500/[0.06]">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="text-[11px] text-emerald-300/80 font-medium">{t("attention.allClear", "All clear · nothing needs attention")}</span>
      </div>
    );
  }

  // Severity → shell tint + accent classes
  const shellByTop: Record<AttentionSeverity, string> = {
    critical: "border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-[#151A25] to-[#151A25]",
    warning: "border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-[#151A25] to-[#151A25]",
    info: "border-sky-500/25 bg-gradient-to-br from-sky-500/10 via-[#151A25] to-[#151A25]",
  };
  const top = topSeverity ?? "info";

  const tileBySeverity: Record<AttentionSeverity, string> = {
    critical: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    info: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  };
  const ctaBySeverity: Record<AttentionSeverity, string> = {
    critical: "text-rose-200 hover:text-white bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/30",
    warning: "text-amber-200 hover:text-white bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30",
    info: "text-sky-200 hover:text-white bg-sky-500/15 hover:bg-sky-500/25 border-sky-500/30",
  };
  const headlineTone: Record<AttentionSeverity, string> = {
    critical: "text-rose-300",
    warning: "text-amber-300",
    info: "text-sky-300",
  };

  const VISIBLE = 3;
  const visible = items.slice(0, VISIBLE);
  const overflow = items.length - visible.length;

  return (
    <div className={`rounded-xl border ${shellByTop[top]} backdrop-blur-md overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${top === "critical" ? "bg-rose-400" : top === "warning" ? "bg-amber-400" : "bg-sky-400"}`} />
          <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${headlineTone[top]}`}>
            {t("attention.needsAttention", "Needs your attention")}
          </span>
        </div>
        <span className="text-[11px] text-slate-500 font-medium">
          {t("attention.items", "{{count}} items", { count: items.length })}
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {visible.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="flex items-center gap-3 px-4 py-3">
              <div className={`h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center ${tileBySeverity[item.severity]}`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                <div className="text-xs text-slate-400 truncate">{item.subtitle}</div>
              </div>
              <Link
                to={item.cta.to}
                className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${ctaBySeverity[item.severity]}`}
              >
                {item.cta.label}
                <ArrowRight size={12} />
              </Link>
            </div>
          );
        })}
      </div>

      {overflow > 0 && (
        <div className="px-4 py-2 border-t border-white/5 text-[11px] text-slate-400 font-medium">
          {t("attention.overflow", "+{{count}} more — scroll down for the full ops view.", { count: overflow })}
        </div>
      )}
    </div>
  );
}

type TodayMetrics = {
  revenue: number;
  revenueDelta: number;
  revenueDeltaPct: number | null;
  occPct: number;
  occupiedRooms: number;
  totalRooms: number;
  occDeltaPp: number;
  adr: number;
  adrDeltaPct: number | null;
  hasYesterday: boolean;
  // Recency fallback for empty-state pivot
  last7Revenue: number;
  last7AvgRevenue: number;
  last7AvgOcc: number;
  last7AvgAdr: number;
  last7DaysCount: number;
};

function fmtINR(v: number) {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(v >= 10_00_000 ? 1 : 2)}L`;
  if (v >= 1000) return `₹${Math.round(v).toLocaleString("en-IN")}`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function TodayHero({
  metrics,
  dateLabel,
  hotelSlug,
}: {
  metrics: TodayMetrics;
  dateLabel: string;
  hotelSlug: string;
}) {
  const t = useOwnerT("owner-dashboard");
  const hasRevenue = metrics.revenue > 0;
  // `hasOccupancy` here = "rooms are configured", which drives whether the
  // HeroStat shows "0%" or "—" for the value cell. Different from the
  // allEmpty check below: a hotel with rooms but no occupants is still
  // visually broken-looking if every other tile is also empty.
  const hasOccupancy = metrics.totalRooms > 0;
  const hasMeaningfulOccupancy = hasOccupancy && metrics.occupiedRooms > 0;
  const hasAdr = metrics.adr > 0;
  // When *every* hero metric is empty (no revenue, no occupants, no ADR),
  // the three-column layout shows two skinny em-dashes flanking an awkward
  // "0%" — which makes the card read as half-broken. Collapse to a single
  // honest empty state that points the operator to the action that unblocks
  // the data: take a booking.
  const allEmpty = !hasRevenue && !hasMeaningfulOccupancy && !hasAdr;

  if (allEmpty) {
    // Compressed single-row banner — the previous 200px hero card was ~85%
    // whitespace on a brand-new tenant. Bringing it down to a thin pill keeps
    // the CTA visible without making "no data yet" look like the focal point
    // of the dashboard. The "TODAY" eyebrow is dropped here because the tab
    // strip directly above already labels this section as "TODAY · Live ops".
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-[#151A25] to-[#151A25] flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{t("today.allEmpty", "No revenue, occupancy, or ADR yet today")}</div>
            {(metrics.last7Revenue > 0 || metrics.last7AvgOcc > 0) && (
              <div className="text-[11px] text-emerald-400/80 font-medium mt-0.5">
                {t("today.last7Summary", "Last 7d: {{rev}} revenue · {{occ}}% avg occ", { rev: fmtINR(metrics.last7Revenue), occ: Math.round(metrics.last7AvgOcc) })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto shrink-0">
          <Link
            to={`/owner/${hotelSlug}/analytics`}
            className="text-[11px] font-semibold text-slate-400 hover:text-white inline-flex items-center gap-1 whitespace-nowrap"
          >
            {t("today.fullAnalytics", "Full analytics")} <ArrowRight size={11} />
          </Link>
          <Link
            to={`/checkin?slug=${hotelSlug}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-100 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {t("today.walkinCheckin", "Walk-in check-in")} <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.10] via-[#151A25] to-[#151A25] overflow-hidden shadow-[0_0_0_1px_rgba(16,185,129,0.06)_inset]">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">{t("today.eyebrow", "Today")}</span>
          <span className="text-[11px] text-slate-500 font-medium">· {dateLabel}</span>
        </div>
        <Link
          to={`/owner/${hotelSlug}/analytics`}
          className="text-[11px] font-semibold text-slate-400 hover:text-white inline-flex items-center gap-1"
        >
          {t("today.fullAnalytics", "Full analytics")} <ArrowRight size={11} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
        {/* Revenue — drills into the folio-backed Revenue overview */}
        <HeroStat
          label={t("hero.revenue", "Revenue")}
          to={`/owner/${hotelSlug}/revenue`}
          value={hasRevenue ? fmtINR(metrics.revenue) : "—"}
          empty={!hasRevenue}
          emptyHint={metrics.hasYesterday ? t("hero.noRevenueToday", "No revenue today") : t("hero.firstBookingAwaited", "First booking awaited")}
          delta={
            metrics.revenueDeltaPct == null
              ? null
              : {
                  pct: metrics.revenueDeltaPct,
                  abs: fmtINR(Math.abs(metrics.revenueDelta)),
                }
          }
          recency={!hasRevenue && metrics.last7Revenue > 0
            ? t("hero.revRecency", "Last 7d: {{total}} · {{avg}}/day avg", { total: fmtINR(metrics.last7Revenue), avg: fmtINR(metrics.last7AvgRevenue) })
            : undefined}
        />
        {/* Occupancy */}
        <HeroStat
          label={t("hero.occupancy", "Occupancy")}
          value={hasOccupancy ? `${Math.round(metrics.occPct)}%` : "—"}
          empty={!hasOccupancy}
          emptyHint={t("hero.noRoomsConfigured", "No rooms configured")}
          subValue={hasOccupancy ? t("hero.roomsSoldToday", "{{occupied}} of {{total}} rooms · sold today", { occupied: metrics.occupiedRooms, total: metrics.totalRooms }) : undefined}
          delta={
            metrics.hasYesterday
              ? {
                  pct: metrics.occDeltaPp,
                  abs: `${Math.abs(Math.round(metrics.occDeltaPp))}pp`,
                  unit: "pp",
                }
              : null
          }
          recency={metrics.occPct === 0 && metrics.last7AvgOcc > 0
            ? t("hero.occRecency", "Last 7d avg: {{occ}}%", { occ: Math.round(metrics.last7AvgOcc) })
            : undefined}
        />
        {/* ADR */}
        <HeroStat
          label={t("hero.adr", "ADR")}
          value={metrics.adr > 0 ? fmtINR(metrics.adr) : "—"}
          empty={metrics.adr <= 0}
          emptyHint={metrics.occupiedRooms === 0 ? t("hero.noOccupiedToday", "No occupied rooms today") : "—"}
          subValue={t("hero.avgDailyRate", "Avg daily rate")}
          delta={
            metrics.adrDeltaPct == null
              ? null
              : { pct: metrics.adrDeltaPct, abs: `${Math.abs(Math.round(metrics.adrDeltaPct))}%` }
          }
          recency={metrics.adr <= 0 && metrics.last7AvgAdr > 0
            ? t("hero.adrRecency", "Last 7d avg: {{adr}}", { adr: fmtINR(metrics.last7AvgAdr) })
            : undefined}
        />
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  subValue,
  empty,
  emptyHint,
  delta,
  recency,
  to,
}: {
  label: string;
  value: string;
  subValue?: string;
  empty?: boolean;
  emptyHint?: string;
  delta: { pct: number; abs: string; unit?: string } | null;
  recency?: string;
  to?: string;
}) {
  const t = useOwnerT("owner-dashboard");
  const up = delta != null && delta.pct > 0.5;
  const down = delta != null && delta.pct < -0.5;
  const flat = delta != null && !up && !down;

  const deltaTone = up ? "text-emerald-400" : down ? "text-rose-400" : "text-slate-500";
  const arrow = up ? "↑" : down ? "↓" : "·";

  const rootClass = "px-5 py-6 sm:py-7 flex flex-col gap-2 min-w-0";
  const inner = (
    <>
      {/* Label row — when this stat drills into a detail page (`to`), a chevron
          appears so the tile reads as clickable; it brightens on hover. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</span>
        {to && <ArrowRight size={13} className="shrink-0 text-slate-600 group-hover:text-emerald-300 transition-colors" />}
      </div>
      {/* `tabular-nums` gives column-aligned digits without forcing the mono
          font's awkward `%` glyph (which previously made "0%" read as a
          rendering bug). Display font for the body keeps the percent + digit
          spacing visually clean at hero size. */}
      <div className={`text-4xl sm:text-5xl xl:text-[2.75rem] leading-none font-bold tracking-tight tabular-nums ${empty ? "text-slate-600" : "text-white"}`}>
        {value}
      </div>
      {empty ? (
        <>
          <div className="text-xs text-slate-500 italic">{emptyHint}</div>
          {/* Recency pivot: when today is empty, surface last-7d context so the
              card is informative on quiet days instead of three em-dashes. */}
          {recency && (
            <div className="text-xs text-emerald-400/80 font-medium mt-0.5">
              {recency}
            </div>
          )}
        </>
      ) : (
        <>
          {subValue && <div className="text-xs text-slate-400">{subValue}</div>}
          {delta != null ? (
            <div className={`text-xs font-semibold ${deltaTone} flex items-center gap-1`}>
              <span>{arrow}</span>
              <span>
                {delta.abs}
                {delta.unit ? "" : delta.pct !== 0 ? ` (${Math.abs(Math.round(delta.pct))}%)` : ""}
              </span>
              <span className="text-slate-500 font-medium">{flat ? t("hero.flatVsYesterday", "flat vs yesterday") : t("hero.vsYesterday", "vs yesterday")}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500">{t("hero.noYesterday", "No yesterday data yet")}</div>
          )}
        </>
      )}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${label} — view detail`}
        className={`${rootClass} group cursor-pointer hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 focus-visible:ring-inset`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={rootClass}>{inner}</div>;
}

/** Small honest "metrics last fetched" stamp next to the refresh button.
 *  Realtime cards (folios, rooms, bookings, stay extensions) update on their
 *  own channels — this stamp specifically tracks one-shot RPC freshness so
 *  the user knows when revenue/occupancy/SLA charts were last refetched. */
function FreshnessStamp({ fetchedAt }: { fetchedAt: Date }) {
  const t = useOwnerT("owner-dashboard");
  const ageMs = Date.now() - fetchedAt.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  const istTime = fetchedAt.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
  const ageLabel = ageMin < 1
    ? t("freshness.justNow", "just now")
    : ageMin < 60
      ? t("freshness.minAgo", "{{m}}m ago", { m: ageMin })
      : t("freshness.hrAgo", "{{h}}h ago", { h: Math.floor(ageMin / 60) });
  // Past ~10 minutes, the data may be growing stale — nudge with amber tone
  const stale = ageMin >= 10;
  return (
    <div
      className={`hidden sm:flex flex-col items-end leading-tight ${stale ? "text-amber-400/80" : "text-slate-500"}`}
      title={t("freshness.title", "Metrics fetched at {{time}} IST. Realtime cards update independently.", { time: istTime })}
    >
      <span className="text-[9px] font-bold uppercase tracking-widest">{t("freshness.metrics", "Metrics")}</span>
      <span className="text-[10px] font-mono">{istTime} · {ageLabel}</span>
    </div>
  );
}

function DashboardTabs({
  active,
  onChange,
  showWeekTab = true,
}: {
  active: "today" | "week" | "pipeline";
  onChange: (next: "today" | "week" | "pipeline") => void;
  showWeekTab?: boolean;
}) {
  const t = useOwnerT("owner-dashboard");
  const allTabs: { key: "today" | "week" | "pipeline"; label: string; sub: string }[] = [
    { key: "today",    label: t("tabs.today", "Today"),        sub: t("tabs.todaySub", "Live ops") },
    { key: "week",     label: t("tabs.week", "This Week"),     sub: t("tabs.weekSub", "Last 7 days") },
    { key: "pipeline", label: t("tabs.pipeline", "Pipeline"),  sub: t("tabs.pipelineSub", "What’s coming") },
  ];
  const tabs = showWeekTab ? allTabs : allTabs.filter((t) => t.key !== "week");
  return (
    <div className="inline-flex p-1 rounded-xl border border-slate-800/60 bg-[#151A25] gap-1 self-start">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={isActive}
            className={`px-2.5 sm:px-4 py-2 rounded-lg text-xs font-bold transition-colors flex flex-col items-start gap-0.5 ${
              isActive
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent"
            }`}
          >
            <span className="uppercase tracking-widest whitespace-nowrap">{t.label}</span>
            {/* Sub-labels hidden below sm — they overflow / wrap awkwardly
                on 375px and the label alone is unambiguous. */}
            <span className={`hidden sm:block text-[9px] font-medium whitespace-nowrap ${isActive ? "text-emerald-400/70" : "text-slate-500"}`}>{t.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "This Week" tab — 7-day revenue + occupancy trend, derived from existing
 *  metrics history. No new RPC; reuses revenueHistory + occupancyHistory. */
function WeekView({
  revenueHistory,
  occupancyHistory,
  last7Revenue,
  last7AvgOcc,
  last7AvgAdr,
  hotelSlug,
}: {
  revenueHistory: { date: string; revenue: number }[];
  occupancyHistory: { date: string; occupancyPct: number; occupiedCount: number; totalRooms: number }[];
  last7Revenue: number;
  last7AvgOcc: number;
  last7AvgAdr: number;
  hotelSlug: string;
}) {
  const t = useOwnerT("owner-dashboard");
  const revLast7 = revenueHistory.slice(-7);
  const occLast7 = occupancyHistory.slice(-7);
  const peakRev = revLast7.reduce((m, d) => Math.max(m, d.revenue || 0), 0);
  const peakOcc = occLast7.reduce((m, d) => Math.max(m, d.occupancyPct || 0), 0);

  if (revLast7.length === 0 && occLast7.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0B0E14] p-8 text-center">
        <div className="text-2xl mb-2">📈</div>
        <div className="text-sm text-slate-400">{t("week.empty", "Trend data will appear after a few days of activity.")}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Week summary */}
      <div className="rounded-2xl border border-slate-800/60 bg-gradient-to-br from-emerald-500/[0.05] via-[#151A25] to-[#151A25] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">{t("week.thisWeek", "This week")}</span>
            <span className="text-[11px] text-slate-500 font-medium">{t("week.last7days", "· last 7 days")}</span>
          </div>
          <Link to={`/owner/${hotelSlug}/analytics`} className="text-[11px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1">
            {t("week.fullAnalytics", "Full analytics")} <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
          <div className="px-5 py-5 flex flex-col gap-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{t("week.revenue", "Revenue")}</div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono text-white">
              {last7Revenue > 0 ? fmtINR(last7Revenue) : "—"}
            </div>
            <div className="text-xs text-slate-400">{t("week.sevenDayTotal", "7-day total")}</div>
          </div>
          <div className="px-5 py-5 flex flex-col gap-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{t("week.avgOccupancy", "Avg occupancy")}</div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono text-white">
              {last7AvgOcc > 0 ? `${Math.round(last7AvgOcc)}%` : "—"}
            </div>
            <div className="text-xs text-slate-400">{t("week.acrossDays", "across {{count}} days", { count: occLast7.length })}</div>
          </div>
          <div className="px-5 py-5 flex flex-col gap-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{t("week.avgAdr", "Avg ADR")}</div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono text-white">
              {last7AvgAdr > 0 ? fmtINR(last7AvgAdr) : "—"}
            </div>
            <div className="text-xs text-slate-400">{t("week.sevenDayAvgRate", "7-day avg daily rate")}</div>
          </div>
        </div>
      </div>

      {/* Revenue trend */}
      <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/5">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">{t("week.revenueTrend", "Revenue trend")}</span>
          <span className="text-[11px] text-slate-500 font-medium">{t("week.peak", "peak: {{value}}", { value: peakRev > 0 ? fmtINR(peakRev) : "—" })}</span>
        </div>
        <div className={`grid grid-cols-${revLast7.length || 1} divide-x divide-white/5`}>
          {revLast7.map((d, i) => {
            const heightPct = peakRev > 0 ? Math.max(8, (d.revenue / peakRev) * 100) : 0;
            return (
              <div key={i} className="px-2 py-3 flex flex-col items-center gap-1.5 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate">{d.date}</div>
                <div className="relative w-full h-12 flex items-end justify-center">
                  {d.revenue > 0 ? (
                    <div className="w-3 rounded-t-md bg-emerald-400" style={{ height: `${heightPct}%` }} />
                  ) : (
                    <div className="w-3 h-1 rounded-full bg-slate-700" />
                  )}
                </div>
                <div className="text-[10px] font-mono text-slate-300">{d.revenue > 0 ? fmtINR(d.revenue) : "—"}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Occupancy trend */}
      <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/5">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">{t("week.occupancyTrend", "Occupancy trend")}</span>
          <span className="text-[11px] text-slate-500 font-medium">{t("week.peak", "peak: {{value}}", { value: peakOcc > 0 ? `${Math.round(peakOcc)}%` : "—" })}</span>
        </div>
        <div className={`grid grid-cols-${occLast7.length || 1} divide-x divide-white/5`}>
          {occLast7.map((d, i) => {
            const heightPct = peakOcc > 0 ? Math.max(8, (d.occupancyPct / peakOcc) * 100) : 0;
            return (
              <div key={i} className="px-2 py-3 flex flex-col items-center gap-1.5 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 truncate">{d.date}</div>
                <div className="relative w-full h-12 flex items-end justify-center">
                  {d.occupancyPct > 0 ? (
                    <div className="w-3 rounded-t-md bg-sky-400" style={{ height: `${heightPct}%` }} />
                  ) : (
                    <div className="w-3 h-1 rounded-full bg-slate-700" />
                  )}
                </div>
                <div className="text-[10px] font-mono text-slate-300">{d.occupancyPct > 0 ? `${Math.round(d.occupancyPct)}%` : "—"}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** "Pipeline" tab — emphasizes the 7-day forecast and arriving VIPs. */
function PipelineView({
  forecast,
  hotelSlug,
  vipStays,
}: {
  forecast: ForecastSummary | null;
  hotelSlug: string;
  vipStays: VipStay[] | null;
}) {
  const t = useOwnerT("owner-dashboard");
  return (
    <div className="flex flex-col gap-4">
      {/* Reuse the same forecast strip — it's the right size for this surface */}
      <ForecastStrip summary={forecast} hotelSlug={hotelSlug} />

      <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-300">{t("pipeline.vipArrivals", "VIP arrivals")}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t("pipeline.vipSub", "Flagged guests in the upcoming window")}</div>
          </div>
          <Link to={`/owner/${hotelSlug}/arrivals`} className="text-[11px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1">
            {t("pipeline.allArrivals", "All arrivals")} <ArrowRight size={11} />
          </Link>
        </div>
        {Array.isArray(vipStays) && vipStays.length > 0 ? (
          <div className="space-y-2">
            {vipStays.slice(0, 5).map((s) => (
              <div key={s.stay_id} className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-500/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {s.room ? t("pipeline.room", "Room {{room}}", { room: s.room }) : t("pipeline.roomTbd", "Room TBD")}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {t("pipeline.arrives", "Arrives {{date}}", { date: s.check_in_start ? new Date(s.check_in_start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "—" })}
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  {t("pipeline.vip", "VIP")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 bg-[#0B0E14] px-4 py-3 flex items-center gap-3">
            <div className="text-lg">⭐</div>
            <div className="text-xs text-slate-400">{t("pipeline.noVip", "No VIP arrivals in the upcoming window.")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ForecastStrip({
  summary,
  hotelSlug,
}: {
  summary: ForecastSummary | null;
  hotelSlug: string;
}) {
  const t = useOwnerT("owner-dashboard");
  if (!summary) {
    return <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] h-[88px] animate-pulse" />;
  }
  const { days, totalArrivals, peakDay } = summary;

  // All-zero collapse — when there are no arrivals across the entire 7-day
  // window, the bar chart is 7 empty placeholder slots stacked next to each
  // other, which looks like a broken visualization. Compact to a single
  // info-pill row that still surfaces the calendar deep-link.
  if (totalArrivals === 0) {
    return (
      <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] flex items-center gap-2.5 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-slate-600 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 whitespace-nowrap shrink-0">{t("forecast.next7days", "Next 7 days")}</span>
        <span className="text-xs text-slate-500 truncate min-w-0">{t("forecast.noArrivals", "· No arrivals expected")}</span>
        <Link
          to={`/owner/${hotelSlug}/arrivals`}
          className="ml-auto shrink-0 text-[11px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1"
        >
          <span className="hidden sm:inline">{t("forecast.viewCalendar", "View calendar")}</span>
          <span className="sm:hidden">{t("forecast.calendar", "Calendar")}</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }

  // Headline: how busy is the week?
  const eyebrowTone =
    totalArrivals === 0 ? "text-slate-400" : totalArrivals >= 5 ? "text-emerald-300" : "text-sky-300";
  const dotClass =
    totalArrivals === 0 ? "bg-slate-600" : totalArrivals >= 5 ? "bg-emerald-400" : "bg-sky-400";

  // Bar heights — proportional to peak so visual signal is preserved.
  const peakCount = days.reduce((m, d) => Math.max(m, d.arrivals), 0);

  return (
    <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${eyebrowTone}`}>
            {t("forecast.next7days", "Next 7 days")}
          </span>
          <span className="text-[11px] text-slate-500 font-medium truncate">
            {totalArrivals === 0
              ? t("forecast.noArrivals", "· No arrivals expected")
              : t("forecast.arrivalsCount", "· {{count}} arrivals", { count: totalArrivals })}
            {peakDay && peakDay.arrivals > 1 && (
              <span>{t("forecast.peak", " · peak {{day}} ({{count}})", { day: peakDay.dayLabel, count: peakDay.arrivals })}</span>
            )}
          </span>
        </div>
        <Link
          to={`/owner/${hotelSlug}/arrivals`}
          className="text-[11px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1 shrink-0"
        >
          {t("forecast.viewCalendar", "View calendar")} <ArrowRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-7 divide-x divide-white/5">
        {days.map((d) => {
          const heightPct = peakCount > 0 ? Math.max(8, (d.arrivals / peakCount) * 100) : 0;
          const muted = d.arrivals === 0;
          const labelTone = d.isToday ? "text-white" : "text-slate-400";
          return (
            <div key={d.dateISO} className="px-2 py-3 flex flex-col items-center gap-1.5 min-w-0">
              <div className={`text-[10px] font-bold uppercase tracking-widest truncate ${labelTone}`}>
                {d.dayLabel}
              </div>
              <div className="relative w-full h-10 flex items-end justify-center">
                {d.arrivals > 0 ? (
                  <div
                    className={`w-3 rounded-t-md ${d.isToday ? "bg-emerald-400" : "bg-sky-400"}`}
                    style={{ height: `${heightPct}%` }}
                  />
                ) : (
                  <div className="w-3 h-1 rounded-full bg-slate-700" />
                )}
              </div>
              <div className={`text-sm font-bold ${muted ? "text-slate-600" : "text-slate-100"}`}>
                {d.arrivals}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HousekeepingStrip({
  summary,
  hotelSlug,
}: {
  summary: HousekeepingSummary | null;
  hotelSlug: string;
}) {
  const t = useOwnerT("owner-dashboard");
  // Loading skeleton — same height as live state so the page doesn't jump
  if (!summary) {
    return (
      <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] px-5 py-4 h-[88px] animate-pulse" />
    );
  }
  if (summary.total === 0) {
    // No rooms configured — skip rather than show a confusing empty strip
    return null;
  }

  const { total, ready, dirty, pickup, inProgress, outOfOrder, readyPct } = summary;

  // Headline tone reflects the most concerning state present
  const headlineTone: "rose" | "amber" | "emerald" =
    outOfOrder > 0 ? "rose" : dirty + pickup > 0 ? "amber" : "emerald";
  const eyebrowClass = headlineTone === "rose"
    ? "text-rose-300"
    : headlineTone === "amber"
      ? "text-amber-300"
      : "text-emerald-300";
  const dotClass = headlineTone === "rose"
    ? "bg-rose-400"
    : headlineTone === "amber"
      ? "bg-amber-400"
      : "bg-emerald-400";

  type Cell = { count: number; label: string; tone: "emerald" | "amber" | "sky" | "rose" };
  // Always show Ready + Dirty (the two states with semantic meaning even at
  // zero — "no dirty rooms" is information, not noise). The remaining three
  // (Pickup / In progress / OOO) are exception states; hide them when zero
  // so the row stops paying full pixel rent for "0 · 0 · 0".
  const cells: Cell[] = [
    { count: ready,      label: t("hkStrip.ready", "Ready"),       tone: "emerald" },
    { count: dirty,      label: t("hkStrip.dirty", "Dirty"),       tone: "amber"   },
    ...(pickup > 0     ? [{ count: pickup,     label: t("hkStrip.pickup", "Pickup"),      tone: "amber" as const }] : []),
    ...(inProgress > 0 ? [{ count: inProgress, label: t("hkStrip.inProgress", "In progress"), tone: "sky"   as const }] : []),
    ...(outOfOrder > 0 ? [{ count: outOfOrder, label: t("hkStrip.ooo", "OOO"),         tone: "rose"  as const }] : []),
  ];
  // Adapt grid column count to the actual number of cells so we don't end up
  // with 2 wide cells in a 5-col grid (gets visually awkward).
  const gridColsClass = cells.length <= 2
    ? "grid-cols-2"
    : cells.length === 3
      ? "grid-cols-3"
      : cells.length === 4
        ? "grid-cols-2 sm:grid-cols-4"
        : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
  const toneClasses: Record<Cell["tone"], { tile: string; value: string }> = {
    emerald: { tile: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", value: "text-emerald-300" },
    amber:   { tile: "bg-amber-500/15 text-amber-300 border-amber-500/30",       value: "text-amber-300" },
    sky:     { tile: "bg-sky-500/15 text-sky-300 border-sky-500/30",             value: "text-sky-300" },
    rose:    { tile: "bg-rose-500/15 text-rose-300 border-rose-500/30",          value: "text-rose-300" },
  };

  return (
    <div className="rounded-2xl border border-slate-800/60 bg-[#151A25] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${eyebrowClass}`}>
            {t("hkStrip.housekeeping", "Housekeeping")}
          </span>
          <span className="text-[11px] text-slate-500 font-medium truncate">
            {t("hkStrip.readySummary", "· {{ready}} of {{total}} ready ({{pct}}%)", { ready, total, pct: readyPct })}
          </span>
        </div>
        <Link
          to={`/owner/${hotelSlug}/housekeeping`}
          className="text-[11px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1 shrink-0"
        >
          {t("hkStrip.openBoard", "Open board")} <ArrowRight size={11} />
        </Link>
      </div>
      <div className={`grid ${gridColsClass} divide-x divide-y sm:divide-y-0 divide-white/5`}>
        {cells.map((c) => {
          const tc = toneClasses[c.tone];
          const muted = c.count === 0;
          return (
            <div key={c.label} className="px-4 py-3 flex items-center gap-3 min-w-0">
              <div className={`h-8 w-8 shrink-0 rounded-lg border flex items-center justify-center ${
                muted ? "bg-slate-800/60 text-slate-500 border-slate-700/50" : tc.tile
              }`}>
                <Sparkles size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 truncate">
                  {c.label}
                </div>
                <div className={`text-sm font-bold ${muted ? "text-slate-600" : tc.value}`}>
                  {c.count}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OutstandingBalanceCard({
  summary,
  hotelSlug,
}: {
  summary: OutstandingBalanceSummary | null;
  hotelSlug: string;
}) {
  const t = useOwnerT("owner-dashboard");
  // Loading state — neutral placeholder so the rail doesn't jump
  if (!summary) {
    return (
      <DarkCard className="p-4">
        <CardHeader title={t("outstanding.title", "Outstanding Balance")} subtitle={t("outstanding.activeFolios", "Active folios")} />
        <div className="mt-3 h-12 rounded-lg bg-slate-800/40 animate-pulse" />
      </DarkCard>
    );
  }

  const { totalOwed, staysWithBalance, totalOpenFolios, guestRefundOwed, departedOwed, departedCount } = summary;
  const hasOwed = totalOwed > 0;
  const hasRefund = guestRefundOwed > 0;
  // Departed guests who left with a balance (forced / auto checkout) — receivables
  const hasDeparted = departedOwed > 0;
  // Fully settled: there are open folios but every one is at zero balance
  const allSettled = totalOpenFolios > 0 && !hasOwed && !hasRefund;
  // No active (in-house) folios at all
  const noActive = totalOpenFolios === 0;

  return (
    <DarkCard className="p-4">
      <CardHeader title={t("outstanding.title", "Outstanding Balance")} subtitle={t("outstanding.subtitle", "Money owed by in-house guests")} />

      <div className="mt-3 flex items-center gap-3">
        {/* Icon tone follows the data: warm amber when money is owed (action
            needed), emerald when everything is settled (positive state), muted
            slate when there's nothing to do at all (no folios open) — the
            previous always-tinted treatment implied action on a "nothing-to-do"
            card, which read as misleading. */}
        <div className={`h-10 w-10 shrink-0 rounded-xl border flex items-center justify-center ${
          hasOwed || hasDeparted
            ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
            : noActive
              ? "bg-slate-800/40 text-slate-600 border-slate-700/50"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        }`}>
          <Wallet size={18} />
        </div>
        <div className="min-w-0 flex-1">
          {noActive ? (
            <>
              <div className="text-base font-bold text-slate-400">—</div>
              <div className="text-xs text-slate-500">{t("outstanding.noActiveFolios", "No active folios")}</div>
            </>
          ) : hasOwed ? (
            <>
              <div className="text-lg font-bold text-amber-300 font-mono">
                {fmtINR(totalOwed)}
              </div>
              <div className="text-xs text-slate-400">
                {t("outstanding.acrossStays", "across {{count}} stays", { count: staysWithBalance })}
                {totalOpenFolios > staysWithBalance && (
                  <span className="text-slate-500">{t("outstanding.settled", " · {{count}} settled", { count: totalOpenFolios - staysWithBalance })}</span>
                )}
              </div>
            </>
          ) : allSettled ? (
            <>
              <div className="text-base font-bold text-emerald-400">{t("outstanding.allSettled", "All settled")}</div>
              <div className="text-xs text-slate-400">
                {t("outstanding.openFoliosZero", "{{count}} open folios at ₹0", { count: totalOpenFolios })}
              </div>
            </>
          ) : (
            <>
              <div className="text-base font-bold text-slate-200">{t("outstanding.noBalanceOwed", "No balance owed")}</div>
              <div className="text-xs text-slate-400">{t("outstanding.active", "{{count}} active", { count: totalOpenFolios })}</div>
            </>
          )}
        </div>
      </div>

      {/* Hotel owes guest a refund — separate signal, less common */}
      {hasRefund && (
        <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">{t("outstanding.refundPending", "Refund pending")}</span>
          <span className="text-xs font-mono text-sky-300 ml-auto">{fmtINR(guestRefundOwed)}</span>
        </div>
      )}

      {/* Departed guests who still owe — receivables (city ledger), chase later.
          Kept distinct from the in-house figure so front-desk "collect now"
          isn't conflated with "chase a guest who already left". */}
      {hasDeparted && (
        <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400">{t("outstanding.departedOwes", "Departed · owes")}</span>
          <span className="text-[11px] text-slate-400">{t("outstanding.guests", "{{count}} guests", { count: departedCount })}</span>
          <span className="text-xs font-mono text-rose-300 ml-auto">{fmtINR(departedOwed)}</span>
        </div>
      )}

      {hasOwed && (
        <Link
          to={`/owner/${hotelSlug}/arrivals`}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200 hover:text-white bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-3 py-1.5 rounded-lg transition-colors w-full justify-center"
        >
          {t("outstanding.reviewCollect", "Review & collect")}
          <ArrowRight size={12} />
        </Link>
      )}
    </DarkCard>
  );
}

function SnapshotRow({
  label,
  hint,
  value,
  dotClass,
  tone,
}: {
  label: string;
  hint: string;
  value: number;
  dotClass: string;
  tone?: "emerald";
}) {
  const wrapClass = tone === "emerald"
    ? "border-emerald-500/10 bg-emerald-500/5"
    : "border-slate-800/50 bg-[#0B0E14]";
  const labelClass = tone === "emerald" ? "text-emerald-500/70" : "text-slate-400";
  const valueClass = tone === "emerald" ? "text-emerald-400" : "text-slate-100";
  return (
    <div className={`flex justify-between items-center px-3 py-2.5 rounded-lg border ${wrapClass}`}>
      <div className="min-w-0">
        <div className={`text-[11px] font-bold uppercase tracking-widest ${labelClass} flex items-center gap-2`}>
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          {label}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5 ml-4">{hint}</div>
      </div>
      <span className={`font-bold text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

function OpsChip({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "neutral" | "emerald" | "amber" | "rose";
  icon: LucideIcon;
  onClick: () => void;
}) {
  const toneClasses: Record<typeof tone, { tile: string; value: string }> = {
    neutral: { tile: "bg-slate-800/60 text-slate-400 border-slate-700/50", value: "text-white" },
    emerald: { tile: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", value: "text-emerald-300" },
    amber: { tile: "bg-amber-500/15 text-amber-300 border-amber-500/30", value: "text-amber-300" },
    rose: { tile: "bg-rose-500/15 text-rose-300 border-rose-500/30", value: "text-rose-300" },
  };
  const t = toneClasses[tone];
  return (
    <button
      onClick={onClick}
      title={`${label} · ${sub}`}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-800/50 bg-[#151A25] hover:border-slate-700 hover:bg-slate-800/50 transition-colors text-left min-w-0 w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0E14]"
    >
      <div className={`h-8 w-8 shrink-0 rounded-lg border flex items-center justify-center ${t.tile}`}>
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 truncate">{label}</div>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`text-sm font-bold ${t.value} shrink-0`}>{value}</span>
          <span className="text-[10px] text-slate-500 truncate">{sub}</span>
        </div>
      </div>
    </button>
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
  const t = useOwnerT("owner-dashboard");
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
      <BreakRow label={t("breakdown.new", "New")} value={newCount} tone={newCount > 0 ? "green" : "grey"} />
      <BreakRow label={t("breakdown.inProgress", "In progress")} value={inProgress} tone={inProgress > 0 ? "amber" : "grey"} />
      <BreakRow label={t("breakdown.blocked", "Blocked")} value={blocked} tone={blocked > 0 ? "red" : "grey"} />
      <BreakRow label={t("breakdown.overdue", "Overdue (> {{min}}m)", { min: targetMin })} value={overdue} tone={overdue > 0 ? "amber" : "grey"} />
      <BreakRow label={t("breakdown.other", "Other")} value={other} tone={other > 0 ? "grey" : "grey"} />
      <div className="pt-2 text-[11px] text-slate-400">
        {t("breakdown.noServiceBreakdown", "Service-type breakdown is not available in this view.")}
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
  const t = useOwnerT("owner-dashboard");
  if (!data || data.length === 0) return <EmptyState text={t("rail.notAvailable", "Not available")} />;

  return (
    <div className="space-y-2">
      {data.slice(0, 6).map((r) => {
        const fullRoleString = r.department_name || r.role || "";
        const roles = fullRoleString.split(",").map((s) => s.trim()).filter(Boolean);
        const primary = roles[0] || fullRoleString;
        const extraCount = Math.max(0, roles.length - 1);
        return (
          <div
            key={r.staff_id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">
                {r.display_name}
              </div>
              <div
                className="text-[11px] text-slate-400 truncate"
                title={extraCount > 0 ? fullRoleString : undefined}
              >
                {primary}
                {extraCount > 0 && <span className="text-slate-500">{t("rail.moreSuffix", " · +{{count}} more", { count: extraCount })}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={r.is_online ? t("rail.online", "Online") : t("rail.away", "Away")} tone={r.is_online ? "green" : "grey"} />
            </div>
          </div>
        );
      })}
      {data.length > 6 ? (
        <div className="text-[11px] text-slate-400">{t("rail.moreCount", "+{{count}} more", { count: data.length - 6 })}</div>
      ) : null}
    </div>
  );
}

function AttendanceMini({ data }: { data: HrmsSnapshot | null }) {
  const t = useOwnerT("owner-dashboard");
  if (!data) return <EmptyState text={t("rail.notAvailable", "Not available")} />;

  const tone =
    data.attendance_pct_today >= 85 ? "green" : data.attendance_pct_today >= 70 ? "amber" : "red";

  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label={t("rail.present", "Present")} value={data.present_today} tone={tone} />
      <MiniStat label={t("rail.absent", "Absent")} value={data.absent_today} tone={data.absent_today > 0 ? "amber" : "grey"} />
      <MiniStat label={t("rail.late", "Late")} value={data.late_today} tone={data.late_today > 0 ? "amber" : "grey"} />
      <MiniStat label={t("rail.attendance", "Attendance")} value={`${data.attendance_pct_today}%`} tone={tone} />
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
  const t = useOwnerT("owner-dashboard");
  const hasNps = typeof npsScore === "number" && (npsResponses ?? 0) > 0;
  const hasRating = typeof avgRating30d === "number" && !Number.isNaN(avgRating30d);

  if (!hasNps && !hasRating) return <EmptyState text={t("rail.notAvailable", "Not available")} />;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {hotelName}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">
            {hasNps ? t("rail.nps", "NPS {{score}}", { score: npsScore }) : t("rail.rating", "Rating {{rating}}/5", { rating: avgRating30d!.toFixed(1) })}
          </div>
          <StatusBadge label={t("rail.guest", "Guest")} tone={hasNps ? "green" : ratingTone(avgRating30d)} />
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          {hasNps ? t("rail.npsResponses", "{{count}} responses (30d)", { count: npsResponses }) : t("rail.avgRating30d", "Avg rating (30d)")}
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
  const t = useOwnerT("owner-dashboard");
  if (loading) return <EmptyState text={t("rail.loadingRoles", "Loading roles…")} />;
  if (!jobs || jobs.length === 0) return <EmptyState text={t("rail.notAvailable", "Not available")} />;

  const openJobs = jobs.filter((j) =>
    (j.status || "open").toLowerCase().includes("open")
  ).length;

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-sm font-semibold text-slate-100">
          {t("rail.openRoles", "{{count}} open roles", { count: openJobs })}
        </div>
        <div className="text-[11px] text-slate-400">{t("rail.totalRoles", "{{count}} total roles", { count: jobs.length })}</div>
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
                {j.title || j.department || t("rail.roleFallback", "Role")}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {(j.city || "").trim() || t("rail.localFallback", "Local")} · {j.status || t("rail.openFallback", "Open")}
              </div>
            </div>
            <StatusBadge label={isOpen ? t("rail.hiring", "Hiring") : t("rail.closed", "Closed")} tone={isOpen ? "green" : "grey"} />
          </div>
        );
      })}
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
  const t = useOwnerT("owner-dashboard");
  const hasValidSlug = !!normalizeSlug(slug);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-1 text-lg font-semibold text-slate-100">
        {t("access.needed", "Property access needed")}
      </div>
      <p className="mb-4 text-sm text-slate-300">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/staff"
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
        >
          {t("access.returnToStaff", "Return to Staff App")}
        </Link>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        {t("access.tip", "Tip: If you received an email invite, open it on this device so we can auto-fill your invite code.")}
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
