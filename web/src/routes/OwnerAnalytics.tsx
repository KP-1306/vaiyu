import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
    Bar,
    BarChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    CartesianGrid,
    Legend,
    ComposedChart,
    Area,
    AreaChart,
    LineChart,
    Line
} from "recharts";
import {
    AlertTriangle,
    CheckCircle,
    Clock,
    ShieldAlert,
    TrendingUp,
    MoreHorizontal,
    ArrowUpRight,
    ArrowDownRight,
    Users,
    Filter,
    LayoutDashboard
} from "lucide-react";
import SLAExplanationDrawer, { ImpactRow } from "../components/SLAExplanationDrawer";
import RiskExplanationDrawer, { RiskBreakdownRow } from "../components/RiskExplanationDrawer";
import ActivityExplanationDrawer, { ActivityBreakdownRow } from "../components/ActivityExplanationDrawer";

/** --- Types --- */
type KpiSummary = {
    total_tickets: number;
    completed_within_sla: number;
    breached_sla: number;
    at_risk_tickets: number;
    sla_compliance_percent: number | null;
};

type SlaTrendRow = {
    day: string;
    completed_within_sla: number;
    breached_sla: number;
    sla_exempted: number;
};

type StaffPerfRow = {
    hotel_id: string;
    day: string;
    staff_id: string;
    full_name: string;
    completed_tasks: number;
    completed_within_sla: number;
};

type BreachRow = {
    hotel_id: string;
    day: string;
    reason_code: string;
    reason_label: string;
    breached_count: number;
};

type BlockReasonRow = {
    hotel_id: string;
    day: string;
    reason_code: string;
    block_count: number;
};

type TicketActivityRow = {
    hotel_id: string;
    day: string;
    created_count: number;
    resolved_count: number;
};

type CheckInTrendRow = {
    hotel_id: string;
    day: string;
    checkin_count: number;
};

type OccupancyStatsRow = {
    hotel_id: string;
    total_rooms: number;
    occupied_rooms: number;
    occupancy_percent: number;
    check_ins_today: number;
    check_ins_yesterday: number;
};



/** --- Components --- */

function CircularGauge({ value, label }: { value: number; label: string }) {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;

    // Color logic: >90 green, >75 amber, else red
    const strokeColor = value >= 90 ? "#10b981" : value >= 75 ? "#f59e0b" : "#f43f5e";

    return (
        <div className="relative flex flex-col items-center justify-center">
            <svg className="h-32 w-32 -rotate-90 transform">
                {/* Track */}
                <circle
                    cx="64"
                    cy="64"
                    r={radius}
                    stroke="#1e293b"
                    strokeWidth="8"
                    fill="transparent"
                />
                {/* Progress */}
                <circle
                    cx="64"
                    cy="64"
                    r={radius}
                    stroke={strokeColor}
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(value)}%</span>
                <span className="text-[10px] uppercase text-slate-500">{label}</span>
            </div>
        </div>
    );
}

function SectionTitle({ title, action }: { title: string, action?: any }) {
    return (
        <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                {title}
            </h3>
            {action}
        </div>
    );
}

// Custom Tooltip Component for Charts
function CustomTooltip({ active, payload }: any) {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl z-50" style={{ backgroundColor: '#0f172a', opacity: 1 }}>
                <div className="text-sm font-medium text-white mb-1">{data.name}</div>
                <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-400">Count: <span className="text-white font-mono">{data.value}</span></span>
                    <span className="text-slate-400">Impact: <span className="text-emerald-400 font-mono">{data.percent}%</span></span>
                </div>
            </div>
        );
    }
    return null;
}

// Custom Tooltip for Daily Trend Bar Chart
function DailyTrendTooltip({ active, payload, label }: any) {
    if (active && payload && payload.length) {
        // Deduplicate payload by dataKey to avoid counting/showing the same metric multiple times
        // (e.g. 'completed_within_sla' is used by Bar, Area, and Line)
        const uniquePayload = payload.filter((v: any, i: number, a: any[]) =>
            a.findIndex((t: any) => t.dataKey === v.dataKey) === i
        );

        // Calculate total for percentage based on the unique metrics
        const total = uniquePayload.reduce((acc: number, entry: any) => acc + (Number(entry.value) || 0), 0);

        return (
            <div className="bg-[#0f172a] border border-slate-700 p-3 rounded-lg shadow-xl z-50">
                <div className="text-sm font-medium text-white mb-2">
                    {new Date(label).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="flex flex-col gap-1.5">
                    {uniquePayload.map((entry: any) => {
                        // Map dataKey to Label
                        let name = "Unknown";
                        if (entry.dataKey === "completed_within_sla") name = "Completed";
                        if (entry.dataKey === "breached_sla") name = "Breached";
                        if (entry.dataKey === "sla_exempted") name = "Exempted";

                        const percent = total > 0 ? Math.round((entry.value / total) * 100) : 0;

                        return (
                            <div key={entry.dataKey} className="flex items-center justify-between gap-6 text-xs">
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                                    <span className="text-slate-400">{name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-white font-mono">{entry.value}</span>
                                    <span className="text-slate-500 w-8 text-right">{percent}%</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
    return null;
}

export default function OwnerAnalytics() {
    const { slug } = useParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Data state
    const [kpi, setKpi] = useState<KpiSummary | null>(null);
    const [trend, setTrend] = useState<SlaTrendRow[]>([]);
    const [breaches, setBreaches] = useState<BreachRow[]>([]);
    const [blocks, setBlocks] = useState<BlockReasonRow[]>([]);
    const [staff, setStaff] = useState<StaffPerfRow[]>([]);
    const [activity, setActivity] = useState<TicketActivityRow[]>([]);
    const [checkinTrend, setCheckinTrend] = useState<CheckInTrendRow[]>([]);
    const [impact, setImpact] = useState<ImpactRow[]>([]);
    const [risks, setRisks] = useState<RiskBreakdownRow[]>([]);
    const [activityBreakdown, setActivityBreakdown] = useState<ActivityBreakdownRow[]>([]);
    const [occupancy, setOccupancy] = useState<OccupancyStatsRow | null>(null);


    // UI State
    const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d'>('7d');
    const [slaDrawerOpen, setSlaDrawerOpen] = useState(false);
    const [riskDrawerOpen, setRiskDrawerOpen] = useState(false);
    const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);


    useEffect(() => {
        const rawSlug = slug;
        if (!rawSlug) return;
        const curSlug = rawSlug.trim();

        let mounted = true;
        (async () => {
            try {
                setLoading(true);
                const { data: hotel, error: hotelErr } = await supabase.from("hotels").select("id, name").eq("slug", curSlug).maybeSingle();

                if (hotelErr) throw hotelErr;
                if (!hotel) throw new Error(`Property not found (slug: ${curSlug})`);

                const [kpiRes, trendRes, breachesRes, blockRes, staffRes, activityRes, checkinRes, impactRes, riskRes, activityBreakdownRes, occupancyRes] = await Promise.all([
                    supabase.from("v_owner_kpi_summary").select("*").eq("hotel_id", hotel.id).maybeSingle(),
                    supabase.from("v_owner_sla_trend_daily").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }).limit(60),
                    supabase.from("v_owner_sla_breach_breakdown").select("*").eq("hotel_id", hotel.id).limit(10),
                    supabase.from("v_owner_block_reason_analysis").select("*").eq("hotel_id", hotel.id).limit(10),
                    supabase.from("v_owner_staff_performance").select("*").eq("hotel_id", hotel.id).order("completed_tasks", { ascending: false }).limit(6),
                    supabase.from("v_owner_ticket_activity").select("*").eq("hotel_id", hotel.id).limit(60),
                    supabase.from("v_owner_checkin_trend_daily").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }).limit(60),
                    supabase.from("v_owner_sla_impact_waterfall").select("*").eq("hotel_id", hotel.id).limit(180),
                    supabase.from("v_owner_at_risk_breakdown").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_owner_activity_breakdown").select("*").eq("hotel_id", hotel.id).limit(180),
                    supabase.from("v_owner_occupancy_stats").select("*").eq("hotel_id", hotel.id).maybeSingle(),
                ]);

                if (mounted) {
                    setKpi(kpiRes.data);
                    setTrend(trendRes.data || []);
                    setBreaches(breachesRes.data || []);
                    setBlocks(blockRes.data || []);
                    setStaff(staffRes.data || []);
                    setActivity(activityRes.data || []);
                    setCheckinTrend(checkinRes.data || []);
                    setImpact(impactRes.data || []);
                    setRisks(riskRes.data || []);
                    setActivityBreakdown(activityBreakdownRes.data || []);
                    setOccupancy(occupancyRes.data || null);
                }
            } catch (err: any) {
                if (mounted) setError(err.message);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [slug]);

    // Match colors from Image 1: Orange, Purple, Blue, Green, Indigo
    const COLORS = ['#f97316', '#a855f7', '#3b82f6', '#22c55e', '#6366f1'];

    // Derived Data based on Time Range
    const getActiveWindow = (arr: any[]) => {
        if (timeRange === 'today') return arr.slice(-1);
        if (timeRange === '7d') return arr.slice(-7);
        if (timeRange === '30d') return arr.slice(-30);
        return arr;
    };
    const getPrevWindow = (arr: any[]) => {
        if (timeRange === 'today') return arr.slice(-2, -1);
        if (timeRange === '7d') return arr.slice(-14, -7);
        if (timeRange === '30d') return arr.slice(-60, -30);
        return arr;
    };

    const activeTrend = useMemo(() => getActiveWindow(trend), [trend, timeRange]);
    const activeCheckins = useMemo(() => getActiveWindow(checkinTrend), [checkinTrend, timeRange]);
    const prevCheckins = useMemo(() => getPrevWindow(checkinTrend), [checkinTrend, timeRange]);
    const activeBreaches = useMemo(() => getActiveWindow(breaches), [breaches, timeRange]);
    const activeBlocks = useMemo(() => getActiveWindow(blocks), [blocks, timeRange]);
    const activeStaff = useMemo(() => getActiveWindow(staff), [staff, timeRange]);

    const aggregatedBreaches = useMemo(() => {
        const map = new Map<string, { label: string, count: number }>();
        activeBreaches.forEach(b => {
            const cur = map.get(b.reason_code) || { label: b.reason_label, count: 0 };
            map.set(b.reason_code, { label: b.reason_label, count: cur.count + b.breached_count });
        });
        const arr = Array.from(map.entries()).map(([code, data]) => ({
            reason_code: code,
            reason_label: data.label,
            breached_count: data.count
        })).sort((a, b) => b.breached_count - a.breached_count);

        const total = arr.reduce((acc, curr) => acc + curr.breached_count, 0);
        return arr.map(a => ({ ...a, breached_percent: total > 0 ? Math.round((a.breached_count / total) * 100) : 0 }));
    }, [activeBreaches]);

    const aggregatedBlocks = useMemo(() => {
        const map = new Map<string, number>();
        activeBlocks.forEach(b => {
            map.set(b.reason_code, (map.get(b.reason_code) || 0) + b.block_count);
        });
        return Array.from(map.entries()).map(([code, count]) => ({
            reason_code: code,
            block_count: count
        })).sort((a, b) => b.block_count - a.block_count).slice(0, 5);
    }, [activeBlocks]);

    const aggregatedStaff = useMemo(() => {
        const map = new Map<string, { name: string, completed: number, onTime: number }>();
        activeStaff.forEach(s => {
            const cur = map.get(s.staff_id) || { name: s.full_name, completed: 0, onTime: 0 };
            map.set(s.staff_id, { 
                name: s.full_name, 
                completed: cur.completed + s.completed_tasks, 
                onTime: cur.onTime + s.completed_within_sla 
            });
        });
        return Array.from(map.entries()).map(([id, data]) => ({
            staff_id: id,
            full_name: data.name,
            completed_tasks: data.completed,
            completed_within_sla: data.onTime,
            sla_success_rate: data.completed > 0 ? Math.round((data.onTime / data.completed) * 100) : 0
        })).sort((a, b) => b.completed_tasks - a.completed_tasks).slice(0, 6);
    }, [activeStaff]);

    const activeImpact = useMemo(() => getActiveWindow(impact), [impact, timeRange]);
    const activeActivityBreakdown = useMemo(() => getActiveWindow(activityBreakdown), [activityBreakdown, timeRange]);

    const aggregatedImpact = useMemo(() => {
        const map = new Map<string, number>();
        activeImpact.forEach(i => {
            map.set(i.department_name, (map.get(i.department_name) || 0) + i.breached_count);
        });
        const total = activeTrend.reduce((acc: number, curr: SlaTrendRow) => acc + curr.completed_within_sla + curr.breached_sla, 0);
        return Array.from(map.entries()).map(([name, count]) => ({
            department_name: name,
            breached_count: count,
            impact_percent: total > 0 ? Math.round((count / total) * 100 * 100) / 100 : 0
        })).sort((a, b) => (b.impact_percent || 0) - (a.impact_percent || 0));
    }, [activeImpact, activeTrend]);

    const aggregatedActivityBreakdown = useMemo(() => {
        const map = new Map<string, { created: number, resolved: number }>();
        activeActivityBreakdown.forEach(a => {
            const cur = map.get(a.department_name) || { created: 0, resolved: 0 };
            map.set(a.department_name, { 
                created: cur.created + a.created_count, 
                resolved: cur.resolved + a.resolved_count 
            });
        });
        return Array.from(map.entries()).map(([name, data]) => ({
            department_name: name,
            created_count: data.created,
            resolved_count: data.resolved
        }));
    }, [activeActivityBreakdown]);

    const pieData = useMemo(() => aggregatedBreaches.map(b => ({
        name: b.reason_label,
        value: b.breached_count,
        percent: b.breached_percent
    })), [aggregatedBreaches]);

    const rangeCompleted = activeTrend.reduce((acc: number, curr: SlaTrendRow) => acc + curr.completed_within_sla, 0);
    const rangeBreached = activeTrend.reduce((acc: number, curr: SlaTrendRow) => acc + curr.breached_sla, 0);
    const rangeExempted = activeTrend.reduce((acc: number, curr: SlaTrendRow) => acc + curr.sla_exempted, 0);
    const rangeTotal = rangeCompleted + rangeBreached; // Excluding exempted from compliance calc usually

    // Calculate dynamic compliance
    const dynamicCompliance = rangeTotal > 0
        ? Math.round((rangeCompleted / rangeTotal) * 100)
        : (kpi?.sla_compliance_percent ?? 0); // Fallback if no data in range

    const atRisk = kpi?.at_risk_tickets ?? 0;
    const active = kpi?.total_tickets ?? 0;

    // For specific charts, use activeTrend
    const pieDataTrend = [
        { name: 'Within SLA', value: rangeCompleted },
        { name: 'Breached', value: rangeBreached },
        { name: 'Exempt', value: rangeExempted }
    ];

    if (loading) return <div className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-500">Loading dashboard...</div>;
    if (error) return <div className="min-h-screen grid place-items-center bg-[#0B0E14] text-rose-500">Error: {error}</div>;



    return (
        <div className="min-h-screen bg-[#0B0E14] p-4 text-slate-200 font-sans selection:bg-emerald-500/30">
            {/* Header / Top Nav */}
            {/* Header / Top Nav - Aligned with Ops Manager */}
            <div className="mb-6">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
                    <Link to={slug ? `/owner/${slug}` : '/owner'} className="hover:text-white transition">Dashboard</Link>
                    <span className="text-slate-600">/</span>
                    <span className="text-slate-200">Owner Analytics</span>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                            <LayoutDashboard size={20} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Owner Analytics Dashboard</h1>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span>Real-time Operations Intelligence</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Global Time Filter */}
                        <div className="flex bg-[#11141d] rounded-lg p-1 border border-slate-800">
                            <button onClick={() => setTimeRange('today')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${timeRange === 'today' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}>Today</button>
                            <button onClick={() => setTimeRange('7d')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${timeRange === '7d' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}>Last 7 Days</button>
                            <button onClick={() => setTimeRange('30d')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${timeRange === '30d' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}>This Month</button>
                        </div>
                        <div className="h-8 w-px bg-slate-800" />
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-800 grid place-items-center text-xs text-white border border-slate-700">
                                OW
                            </div>
                            <div className="text-xs text-slate-300">
                                <div className="font-medium text-white">Owner View</div>
                                <div className="text-[10px] text-slate-500">Super Admin</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 1: Live Operations */}
            <div className="mb-6">
                <SectionTitle title="Live Operations (Right Now)" action={<div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />} />
                <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                    <div className="rounded-xl bg-[#151A25] p-5 border border-slate-800/50 flex items-center justify-between shadow-sm">
                        <div>
                            <div className="text-xs font-semibold text-slate-400 mb-1 tracking-wider uppercase">Live Occupancy</div>
                            <div className="text-3xl font-bold text-emerald-400">{occupancy ? `${Math.round(occupancy.occupancy_percent)}%` : "0%"}</div>
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <LayoutDashboard size={20} className="text-emerald-500" />
                        </div>
                    </div>
                    <div onClick={() => setRiskDrawerOpen(true)} className="rounded-xl bg-[#151A25] p-5 border border-slate-800/50 flex items-center justify-between shadow-sm cursor-pointer hover:bg-slate-800/50 transition">
                        <div>
                            <div className="text-xs font-semibold text-slate-400 mb-1 tracking-wider uppercase">At-Risk Tickets</div>
                            <div className="text-3xl font-bold text-amber-500">{atRisk}</div>
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                            <AlertTriangle size={20} className="text-amber-500" />
                        </div>
                    </div>
                    <div className="rounded-xl bg-[#151A25] p-5 border border-slate-800/50 flex items-center justify-between shadow-sm">
                        <div>
                            <div className="text-xs font-semibold text-slate-400 mb-1 tracking-wider uppercase">Total Active Issues</div>
                            <div className="text-3xl font-bold text-rose-400">{active}</div>
                        </div>
                        <div className="h-10 w-10 shrink-0 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                            <ShieldAlert size={20} className="text-rose-500" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 2: Performance Health (Time-Filtered) */}
            <SectionTitle title={`Performance Health (${timeRange === 'today' ? 'Today' : (timeRange === '7d' ? 'Last 7 Days' : 'This Month')})`} />
            <div className="mb-6 grid gap-4 grid-cols-1 lg:grid-cols-3">
                {(() => {
                    const curTrend = activeTrend;
                    const prevTrend = getPrevWindow(trend);
                    
                    const calcComp = (arr: SlaTrendRow[]) => {
                        const tot = arr.reduce((a, c) => a + c.completed_within_sla + c.breached_sla, 0);
                        return tot > 0 ? (arr.reduce((a, c) => a + c.completed_within_sla, 0) / tot) * 100 : 0;
                    };
                    const calcBreach = (arr: SlaTrendRow[]) => {
                        const tot = arr.reduce((a, c) => a + c.completed_within_sla + c.breached_sla, 0);
                        return tot > 0 ? (arr.reduce((a, c) => a + c.breached_sla, 0) / tot) * 100 : 0;
                    };

                    const curSla = calcComp(curTrend);
                    const prevSla = prevTrend.length ? calcComp(prevTrend) : curSla;
                    const diffSla = Math.round(curSla - prevSla);

                    const curBreach = calcBreach(curTrend);
                    const prevBreach = prevTrend.length ? calcBreach(prevTrend) : curBreach;
                    const diffBreach = Math.round(curBreach - prevBreach);
                    
                    const curCheckins = activeCheckins.reduce((a, c) => a + c.checkin_count, 0);
                    const lastCheckins = prevCheckins.reduce((a, c) => a + c.checkin_count, 0);
                    const checkinDiff = curCheckins - lastCheckins;

                    return [
                        {
                            label: "SLA Compliance",
                            value: `${Math.round(curSla)}%`,
                            trend: diffSla,
                            trendLabel: "vs Prev Period",
                            color: "text-emerald-500",
                            isUpGood: true,
                        },
                        {
                            label: "SLA Breach Rate",
                            value: `${Math.round(curBreach)}%`,
                            trend: diffBreach,
                            trendLabel: "vs Prev Period",
                            color: "text-rose-500",
                            isUpGood: false,
                        },
                        {
                            label: "Guest Check-Ins",
                            value: `${curCheckins}`,
                            trend: checkinDiff,
                            trendLabel: "vs Prev Period",
                            color: "text-blue-400",
                            isUpGood: true,
                        }
                    ];
                })().map((s, i) => (
                    <div key={i} className="rounded-xl bg-[#151A25] p-5 border border-slate-800/50 shadow-sm flex flex-col justify-between">
                        <div className="text-[12px] font-semibold text-slate-400 mb-2 uppercase tracking-wider">{s.label}</div>
                        <div className="flex items-end gap-2 mb-2">
                            <div className={`text-4xl font-bold ${s.color}`}>{s.value}</div>
                            <div className={`flex items-center gap-0.5 text-sm font-bold mb-1.5 ${s.trend === 0 ? 'text-slate-500' :
                                (s.isUpGood ? (s.trend > 0 ? 'text-emerald-500' : 'text-rose-500') : (s.trend > 0 ? 'text-rose-500' : 'text-emerald-500'))
                                }`}>
                                {s.trend !== 0 && (s.trend > 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />)}
                            </div>
                        </div>
                        <div className={`text-[12px] font-medium flex items-center gap-1.5 ${s.trend === 0 ? 'text-slate-500' :
                            (s.isUpGood ? (s.trend > 0 ? 'text-emerald-500' : 'text-rose-500') : (s.trend > 0 ? 'text-rose-500' : 'text-emerald-500'))
                            }`}>
                            <span>{s.trend > 0 ? '+' : ''}{s.trend}</span>
                            <span className="text-slate-500 font-normal">{s.trendLabel}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Mid-Level Dashboard (Activity, Occupancy, Risk Trend) */}
            <div className="mb-6 grid gap-6 lg:grid-cols-3">
                {/* 1. Activity Chart (Created vs Resolved) */}
                <div
                    onClick={() => setActivityDrawerOpen(true)}
                    className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50 lg:col-span-2 relative cursor-pointer hover:border-blue-500/30 transition group"
                >
                    <div className="absolute top-4 right-4 text-slate-600 group-hover:text-blue-400 transition">
                        <TrendingUp size={16} />
                    </div>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-slate-200">Tickets Created vs Tickets Resolved</h3>
                        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500">
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Tickets Created</span>
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Tickets Resolved</span>
                        </div>
                    </div>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={getActiveWindow(activity).slice().reverse()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis
                                    dataKey="day"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748b', fontSize: 10 }}
                                    tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                                    itemStyle={{ padding: 0 }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="created_count"
                                    stroke="#3b82f6"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorCreated)"
                                    name="Created"
                                />
                                <Area
                                    type="monotone"
                                    dataKey="resolved_count"
                                    stroke="#10b981"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorResolved)"
                                    name="Resolved"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Right Column Metrics */}
                <div className="grid gap-6">
                    {/* 2. Tickets Per Occupied Room */}
                    <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50 flex flex-col justify-between h-[140px]">
                        <div>
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tickets Per Occupied Room</h3>
                            <div className="mt-2 text-4xl font-bold text-slate-100 flex items-baseline gap-2">
                                1.8
                                <span className="text-xs font-bold text-rose-500 flex items-center gap-0.5">
                                    <ArrowUpRight size={12} /> vs Average
                                </span>
                            </div>
                        </div>
                        {/* Mock Sparkbar/Decoration */}
                        <div className="flex gap-1 h-1.5 mt-4 opacity-50">
                            <div className="w-1/4 bg-slate-700 rounded-full"></div>
                            <div className="w-1/2 bg-blue-500 rounded-full"></div>
                            <div className="w-1/4 bg-slate-700 rounded-full"></div>
                        </div>
                    </div>

                    {/* 3. At-Risk Tickets Trend */}
                    <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50 flex flex-col justify-between h-[155px]">
                        <div>
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">At-Risk Tickets Trend</h3>
                            <div className="mt-3 flex items-center gap-3">
                                <div className="bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                                    <AlertTriangle className="text-amber-500" size={24} />
                                </div>
                                <div>
                                    <div className="text-lg font-bold text-amber-500">Rising Risk</div>
                                    <div className="text-[10px] text-slate-500">Last 7 Days</div>
                                </div>
                            </div>
                        </div>
                        {/* Mock Trend Line */}
                        <div className="h-10 w-full mt-2">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={[{ val: 2 }, { val: 3 }, { val: 2 }, { val: 4 }, { val: 5 }, { val: 7 }, { val: 8 }]}>
                                    <Line type="monotone" dataKey="val" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Grid: Overview (2/3) + Donut (1/3) */}
            <div className="mb-6 grid gap-6 lg:grid-cols-3">

                {/* Overview Card - Redesigned */}
                <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50 lg:col-span-2 relative overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                            <SectionTitle title="Overview" />
                        </div>
                        <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                            {/* Filter removed to respect Global Filter */}
                        </div>
                    </div>

                    <div className="grid lg:grid-cols-3 gap-8 h-full">
                        {/* Left: Compliance Donut */}
                        <div className="col-span-1 flex flex-col items-center border-r border-slate-800/50 pr-6">
                            <div className="flex items-baseline gap-2 mb-2 w-full justify-center">
                                <span className="text-5xl font-bold text-emerald-400 tracking-tight">{dynamicCompliance}%</span>
                                <span className="text-[10px] uppercase font-bold text-amber-500">
                                    SLA Compliance
                                </span>
                            </div>
                            <div className="relative h-48 w-48 my-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieDataTrend}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={65}
                                            outerRadius={80}
                                            startAngle={90}
                                            endAngle={-270}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            <Cell fill="#10b981" /> {/* Emerald-500 */}
                                            <Cell fill="#ef4444" /> {/* Red-500 */}
                                            <Cell fill="#3b82f6" /> {/* Blue-500 */}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <div className="text-3xl font-bold text-white">{dynamicCompliance}%</div>
                                    <div className="text-[9px] text-slate-500 uppercase mt-1">Compliance</div>
                                </div>
                            </div>
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 w-full mt-auto">
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
                                    <span className="text-[10px] text-slate-400">Completed within SLA</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-red-500"></div>
                                    <span className="text-[10px] text-slate-400">Breached SLA</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                                    <span className="text-[10px] text-slate-400">Exceptions</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Stats & Main Chart */}
                        <div className="col-span-2 flex flex-col gap-6">
                            {/* Top Stats Row */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-[#11141d] rounded-xl p-4 border border-slate-800/60 shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/50"></div>
                                    <div className="flex flex-col h-full justify-between">
                                        <div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-bold text-white">{rangeCompleted}</span>
                                                <span className="text-[10px] text-slate-400 uppercase font-medium">Completed</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                                                <CheckCircle size={10} className="text-emerald-500" />
                                                <span>within SLA</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-[#11141d] rounded-xl p-4 border border-slate-800/60 shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/50"></div>
                                    <div className="flex flex-col h-full justify-between">
                                        <div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-bold text-rose-500">{rangeBreached}</span>
                                                <span className="text-[10px] text-slate-400 uppercase font-medium">Breached</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                                                <AlertTriangle size={10} className="text-rose-500" />
                                                <span>SLA violations</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-[#11141d] rounded-xl p-4 border border-slate-800/60 shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50"></div>
                                    <div className="flex flex-col h-full justify-between">
                                        <div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-bold text-blue-400">{rangeExempted}</span>
                                                <span className="text-[10px] text-slate-400 uppercase font-medium">Exceptions</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                                                <ShieldAlert size={10} className="text-blue-500" />
                                                <span>approved overrides</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Mixed Chart */}
                            <div className="flex-1 min-h-[220px] w-full bg-[#11141d] rounded-xl border border-slate-800/60 p-2 pt-4 relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={activeTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            {/* Glow for line & dots */}
                                            <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                                                <feGaussianBlur stdDeviation="4" result="blur" />
                                                <feMerge>
                                                    <feMergeNode in="blur" />
                                                    <feMergeNode in="SourceGraphic" />
                                                </feMerge>
                                            </filter>

                                            {/* Area gradient (shadow under line) */}
                                            <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                                                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>

                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis
                                            dataKey="day"
                                            stroke="#475569"
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                                            axisLine={false}
                                            tickLine={false}
                                            dy={10}
                                        />
                                        <YAxis stroke="#475569" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                        <Tooltip content={<DailyTrendTooltip />} cursor={{ fill: '#1e293b', opacity: 0.4 }} wrapperStyle={{ zIndex: 1000 }} />

                                        {/* Bars must render first */}
                                        <Bar dataKey="completed_within_sla" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={24} />
                                        <Bar dataKey="breached_sla" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} barSize={24} />
                                        <Bar dataKey="sla_exempted" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={24} />

                                        {/* Area shadow */}
                                        <Area
                                            type="monotone"
                                            dataKey="completed_within_sla"
                                            fill="url(#lineAreaGradient)"
                                            stroke="none"
                                            fillOpacity={1}
                                        />

                                        {/* Line on top */}
                                        <Line
                                            type="monotone"
                                            dataKey="completed_within_sla"
                                            stroke="#f59e0b"
                                            strokeWidth={3}
                                            dot={{
                                                r: 4,
                                                fill: "#f59e0b",
                                                stroke: "#fff",
                                                strokeWidth: 1,
                                                filter: "url(#lineGlow)"
                                            }}
                                            activeDot={{
                                                r: 6,
                                                fill: "#ffffff",
                                                stroke: "#f59e0b",
                                                strokeWidth: 2,
                                                filter: "url(#lineGlow)"
                                            }}
                                            style={{ filter: "url(#lineGlow)" }}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Breaches Donut & List - Exact Match */}
                <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50 flex flex-col">
                    <SectionTitle title="SLA Failure Causes" action={<MoreHorizontal size={16} className="text-slate-600" />} />

                    <div className="flex flex-col lg:flex-row gap-6 h-full">
                        {/* Left: Chart + Stats */}
                        <div className="flex-1 flex flex-col justify-between">
                            {/* Chart */}
                            <div className="relative h-40 w-full min-h-[160px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={50}
                                            outerRadius={70}
                                            paddingAngle={2}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {pieData.map((_, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={COLORS[index % COLORS.length]}
                                                />
                                            ))}
                                        </Pie>

                                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 1000, outline: 'none' }} />
                                    </PieChart>
                                </ResponsiveContainer>


                                {/* Center Text: Dominant Reason % */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <div className="text-3xl font-bold text-white">
                                        {pieData.length > 0 ? Math.round((pieData[0].value / pieData.reduce((a, c) => a + c.value, 0)) * 100) : 0}%
                                    </div>
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Failure Causes</div>
                                </div>
                            </div>

                            {/* Bottom Stats (Left Side) */}
                            <div className="mt-4 space-y-1.5 pl-2">
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <span className="font-bold text-white">{rangeBreached}</span>
                                    <span className="text-slate-400 font-light">Breached SLA</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <span className="font-bold text-white">{atRisk}</span>
                                    <span className="text-slate-400 font-light">AT RISK Tasks</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-300">
                                    <span className="font-bold text-white">{rangeTotal}</span>
                                    <span className="text-slate-400 font-light">Total Resolved</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Detailed List */}
                        <div className="flex-[1.2] flex flex-col justify-center space-y-5">
                            {pieData.map((entry, index) => {
                                const color = COLORS[index % COLORS.length];

                                return (
                                    <div key={index} className="w-full">
                                        {/* Row 1: Label + Pct */}
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }}></div>
                                                <span className="text-xs text-slate-300 capitalize truncate max-w-[120px]" title={entry.name}>
                                                    {entry.name}
                                                </span>
                                            </div>
                                            <span className="text-xs font-bold text-white">{entry.percent}%</span>
                                        </div>
                                        {/* Row 2: Progress Line */}
                                        <div className="flex items-center gap-2 ml-4">
                                            <div className="text-[10px] font-medium text-slate-500 w-6">{Math.round(entry.percent)}%</div>
                                            <div className="h-0.5 flex-1 bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full rounded-full" style={{ width: `${entry.percent}%`, backgroundColor: color }}></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {pieData.length === 0 && <div className="text-xs text-slate-500">No exceptions logged.</div>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Grid: Staff | Exceptions List | Risks */}
            <div className="grid gap-6 lg:grid-cols-3">

                {/* Staff Performance */}
                <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50">
                    <SectionTitle title="Staff Performance" />
                    <div className="space-y-4">
                        {aggregatedStaff.map((s, i) => (
                            <div key={s.staff_id} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-9 w-9 rounded-full bg-slate-800 grid place-items-center text-xs font-medium text-slate-300 border border-slate-700">
                                        {s.full_name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-white">{s.full_name}</div>
                                        <div className="text-[10px] text-slate-500">{s.completed_tasks} Tasks</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className={`text-sm font-bold ${s.sla_success_rate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {s.sla_success_rate}%
                                    </div>
                                    <div className="text-[10px] text-slate-500 text-center">Score</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Exception Details (Middle) - Reusing 'blocks' data as proxy if exceptions view is strictly counts */}
                <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50">
                    <SectionTitle title="Block & Exception Impact" />
                    <div className="space-y-4">
                        {aggregatedBlocks.map((b, i) => (
                            <div key={i} className="group">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle size={12} className="text-amber-500" />
                                        <span className="text-xs font-medium text-slate-200 capitalize">{b.reason_code.replace(/_/g, ' ')}</span>
                                    </div>
                                    <span className="text-xs font-bold text-white">{b.block_count}</span>
                                </div>
                                {/* Pseudo progress bar */}
                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-amber-500/80 rounded-full"
                                        style={{ width: `${Math.min(100, (b.block_count / 10) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                        {aggregatedBlocks.length === 0 && <div className="text-xs text-slate-500 italic">No historical blocks in range.</div>}
                    </div>
                </div>

                {/* Risk Insights */}
                <div className="rounded-2xl bg-[#151A25] p-6 border border-slate-800/50">
                    <SectionTitle title="Risk & Escalation Insight" action={<MoreHorizontal size={14} className="text-slate-600" />} />

                    <div className="space-y-5">
                        <div className="flex gap-3">
                            <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500">
                                <ShieldAlert size={14} />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-rose-400 mb-0.5">Frequent Breaches</h4>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    Room 216 had 4 SLA Breaches {timeRange === 'today' ? 'today' : (timeRange === '7d' ? 'in the last week' : 'this month')}. Investigation recommended.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                <ArrowUpRight size={14} />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-blue-400 mb-0.5">Frequent Exceptions</h4>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    "Spare parts unavailable" granted 12 times. Check inventory levels.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                                <Clock size={14} />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-amber-400 mb-0.5">At Risk Shift</h4>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    Night shift (22:00-06:00) has 12 At Risk tasks and 6 Breaches.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            {/* Explanation Drawers */}
            <SLAExplanationDrawer
                isOpen={slaDrawerOpen}
                onClose={() => setSlaDrawerOpen(false)}
                impactData={aggregatedImpact}
                trendData={activeTrend}
                currentCompliance={dynamicCompliance}
            />

            <RiskExplanationDrawer
                isOpen={riskDrawerOpen}
                onClose={() => setRiskDrawerOpen(false)}
                riskData={risks}
            />

            <ActivityExplanationDrawer
                isOpen={activityDrawerOpen}
                onClose={() => setActivityDrawerOpen(false)}
                activityData={aggregatedActivityBreakdown}
            />
        </div>
    );
}
