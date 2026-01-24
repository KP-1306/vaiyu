import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    Area,
    AreaChart
} from "recharts";
import {
    ArrowDownRight,
    ArrowUpRight,
    LayoutDashboard,
    AlertTriangle,
    Clock,
    CheckCircle,
    TrendingUp,
    Users,
    Activity,
    AlertOctagon,
    Bug, // Import Bug icon if used, else ensure we have what we need
    Info
} from "lucide-react";
import { BlockedTicketsDrawer } from "../components/BlockedTicketsDrawer";
import { OpenBreachesDrawer } from "../components/OpenBreachesDrawer";
import { AgentRiskDrawer } from "../components/AgentRiskDrawer";
import { AtRiskDepartmentsDrawer } from "../components/AtRiskDepartmentsDrawer";
import { SimpleTooltip } from "../components/SimpleTooltip";

/** --- Types (Matched to FINAL OPS SQL PACK) --- */
type OpsKpiCurrent = {
    sla_compliance_percent: number;
    sla_breach_percent: number;
    at_risk_count: number;
    avg_at_risk_sla_percent: number | null;
    created_today: number;
    resolved_today: number;
};

type CreatedResolvedRow = { hotel_id: string; day: string; created_count: number; resolved_count: number };
type BreachReasonRow = { reason_label: string; breach_count: number; percentage: number };
type AtRiskDeptRow = { department_name: string; at_risk_count: number; worst_remaining_seconds: number };
// type DeptBreachRow = { ... } // REMOVED (Replaced by SlaExceptionRow)
type SlaExceptionRow = {
    department_name: string;
    guest_count: number;
    infra_count: number;
    policy_count: number;
    external_count: number;
    approval_count: number;
    other_count: number;
    total_exception_requests: number;
};

type OpenBreachRow = { ticket_id: string; display_id: string; department_name: string; assignee_name: string; assignee_avatar: string | null; breach_context: string; hours_overdue: number }; type BacklogRow = { day: string; backlog_count: number };
type AgentRiskRow = { agent_name: string; avatar_url: string | null; department_name: string; at_risk_count: number };
type BlockedStagnationRow = { department_name: string; blocked_count: number; max_hours_blocked: number };
type SLAExceptionDecisionRow = {
    hotel_id: string;
    department_name: string;
    reason_label: string;
    reason_category: string;
    requested_count: number;
    granted_count: number;
    rejected_count: number;
    pending_count: number;
};


// --- Components ---

function StatCard({
    title,
    value,
    subValue,
    trend,
    trendLabel,
    inverseTrend = false,
    icon: Icon
}: {
    title: string;
    value: string | number;
    subValue?: string;
    trend?: number;
    trendLabel?: string;
    inverseTrend?: boolean;
    icon?: any;
}) {
    const isUp = (trend || 0) > 0;
    const isGood = inverseTrend ? !isUp : isUp;
    const trendColor = isGood ? "text-emerald-500" : "text-rose-500";
    const TrendIcon = isUp ? ArrowUpRight : ArrowDownRight;

    return (
        <div className="bg-[#1e293b] p-5 rounded-xl border border-slate-700 shadow-sm flex flex-col justify-between h-full">
            <div className="flex justify-between items-start mb-2">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">{title}</h3>
                {Icon && <Icon size={18} className="text-slate-500" />}
            </div>

            <div className="flex items-baseline gap-2 mt-auto">
                <span className="text-3xl font-bold text-white tracking-tight">{value}</span>
                {subValue && <span className="text-sm text-slate-500 font-medium">{subValue}</span>}
            </div>

            {trend !== undefined && (
                <div className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${trendColor}`}>
                    <TrendIcon size={14} />
                    <span>{Math.abs(trend)}%</span>
                    <span className="text-slate-500 ml-1">{trendLabel || "vs Last Week"}</span>
                </div>
            )}
        </div>
    );
}

export default function OpsManagerAnalytics() {
    const [searchParams] = useSearchParams();
    const slug = searchParams.get("slug");

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Data State
    const [currentHotel, setCurrentHotel] = useState<{ id: string; name: string } | null>(null);
    const [kpi, setKpi] = useState<OpsKpiCurrent | null>(null);
    const [trend, setTrend] = useState<CreatedResolvedRow[]>([]);
    const [reasons, setReasons] = useState<BreachReasonRow[]>([]);
    const [atRiskDepts, setAtRiskDepts] = useState<AtRiskDeptRow[]>([]);

    // const [deptBreaches, setDeptBreaches] = useState<DeptBreachRow[]>([]); // REMOVED
    const [slaExceptions, setSlaExceptions] = useState<SlaExceptionRow[]>([]); // NEW

    const [openBreaches, setOpenBreaches] = useState<OpenBreachRow[]>([]);
    const [backlog, setBacklog] = useState<BacklogRow[]>([]);
    const [agentRisk, setAgentRisk] = useState<AgentRiskRow[]>([]);
    const [blockedRisk, setBlockedRisk] = useState<BlockedStagnationRow[]>([]);
    const [exceptionDecisions, setExceptionDecisions] = useState<SLAExceptionDecisionRow[]>([]);
    const [isOpenBreachesDrawer, setIsOpenBreachesDrawer] = useState(false);

    // State for drill-down drawer
    const [selectedBlockedDept, setSelectedBlockedDept] = useState<string | null>(null);
    const [selectedExceptionCategory, setSelectedExceptionCategory] = useState<string | null>(null); // For exceptions drill-down
    const [selectedAgentRisk, setSelectedAgentRisk] = useState<string | null>(null); // For agent risk drill-down
    const [selectedAtRiskDept, setSelectedAtRiskDept] = useState<string | null>(null); // For at-risk dept drill-down

    // Auto-refresh state
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    useEffect(() => {
        if (!slug) return;
        let mounted = true;

        const fetchData = async () => {
            try {
                setLoading(true);
                const { data: hotel } = await supabase.from("hotels").select("id, name").eq("slug", slug).single();
                if (!hotel) throw new Error("Hotel not found");
                setCurrentHotel(hotel); // Store in state for render access

                const results = await Promise.all([
                    // 1. v_ops_kpi_current
                    supabase.from("v_ops_kpi_current").select("*").eq("hotel_id", hotel.id).maybeSingle(),
                    // 2. v_ops_created_resolved_30d
                    supabase.from("v_ops_created_resolved_30d").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }),
                    // 3. v_ops_sla_breach_reasons
                    supabase.from("v_ops_sla_breach_reasons").select("*").eq("hotel_id", hotel.id),
                    // 4. v_ops_at_risk_departments
                    supabase.from("v_ops_at_risk_departments").select("*").eq("hotel_id", hotel.id),
                    // 5. v_ops_sla_exceptions_by_department (NEW)
                    supabase.from("v_ops_sla_exceptions_by_department").select("*").eq("hotel_id", hotel.id),
                    // 6. v_ops_open_breaches
                    supabase.from("v_ops_open_breaches").select("*").eq("hotel_id", hotel.id),
                    // 7. v_ops_backlog_trend
                    supabase.from("v_ops_backlog_trend").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }),
                    // 8. v_ops_agent_risk
                    supabase.from("v_ops_agent_risk").select("*").eq("hotel_id", hotel.id),
                    // 9. v_ops_blocked_stagnation_risk
                    supabase.from("v_ops_blocked_stagnation_risk").select("*").eq("hotel_id", hotel.id),
                    // 10. v_ops_sla_exception_decisions_by_reason
                    supabase.from("v_ops_sla_exception_decisions_by_reason").select("*").eq("hotel_id", hotel.id),
                ]);

                if (mounted) {
                    setKpi(results[0].data);
                    setTrend(results[1].data || []);
                    setReasons(results[2].data || []);
                    setAtRiskDepts(results[3].data || []);
                    setSlaExceptions(results[4].data || []); // Updated
                    setOpenBreaches(results[5].data || []);
                    setBacklog(results[6].data || []);
                    setAgentRisk(results[7].data || []);
                    setBlockedRisk(results[8].data || []);
                    setExceptionDecisions(results[9].data || []);
                    setLastUpdated(new Date());
                }
            } catch (err: any) {
                console.error(err);
                if (mounted) setError(err.message);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchData();

        // Auto-refresh every 60 seconds
        const intervalId = setInterval(fetchData, 60000);

        return () => {
            mounted = false;
            clearInterval(intervalId);
        };
    }, [slug]);

    // Charts Colors
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    // Exception Category Colors (Matched to new View Categories)
    const EXCEPTION_COLORS = {
        guest: '#EAB308',        // Yellow (GUEST_DEPENDENCY)
        infrastructure: '#F97316', // Orange (INFRASTRUCTURE)
        policy: '#A855F7',       // Purple (POLICY)
        external: '#EF4444',     // Red (EXTERNAL_DEPENDENCY)
        management: '#10B981',   // Emerald (MANAGEMENT)
        other: '#3B82F6'         // Blue (OTHER)
    };

    // Department Aliases to fit X-Axis
    const formatDeptName = (name: string) => {
        const ALIASES: Record<string, string> = {
            'Housekeeping': 'Hskp',
            'Engineering': 'Eng',
            'Front Desk': 'Front D.',
            'Maintenance': 'Maint',
            'Food & Beverage': 'F&B',
            'Kitchen / F&B': 'F&B',
            'Security': 'Sec',
            'Concierge': 'Conc.',
            'Reservations': 'Resv',
            'Finance': 'Fin',
            'Human Resources': 'HR',
            'Administration': 'Admin',
            'Sales & Marketing': 'S&M',
            'Information Technology': 'IT'
        };
        return ALIASES[name] || (name.length > 8 ? name.substring(0, 8) + '..' : name);
    };

    // Transform Exceptions Data for Chart (Sorted by Total)
    const exceptionsChartData = useMemo(() => {
        // Data is already pivoted by the view.
        // Filter out any departments with missing names (causes gaps).
        // Sort by total descending, then by name ascending for stability.
        // Also rename 'Front Desk & Guest Services' to 'Front Desk' for cleaner UI.
        return slaExceptions
            .map(r => {
                let shortName = r.department_name;
                if (shortName === 'Front Desk & Guest Services') shortName = 'Front Desk';
                if (shortName === 'Maintenance & Engineering') shortName = 'Maintenance';
                return { ...r, short_name: shortName };
            })
            .filter(r => r.department_name && r.department_name.trim().length > 0)
            .sort((a, b) => {
                const diff = b.total_exception_requests - a.total_exception_requests;
                if (diff !== 0) return diff;
                return a.department_name.localeCompare(b.department_name);
            })
            .slice(0, 8); // Top 8 depts
    }, [slaExceptions]);

    // Helper for At-Risk Logic (Matches User Request: <=15m High, <=60m Elevated, <=4h Moderate)
    const getRiskLevel = (seconds: number) => {
        if (seconds <= 900) return { label: "High", color: "bg-rose-500/20 text-rose-500" }; // <= 15m
        if (seconds <= 3600) return { label: "Elevated", color: "bg-orange-500/20 text-orange-500" }; // <= 60m
        return { label: "Moderate", color: "bg-yellow-500/20 text-yellow-500" }; // <= 4h
    };

    if (!slug) return <div className="p-8 text-center text-slate-500">Please select a property.</div>;
    if (loading) return <div className="min-h-screen bg-[#0f172a] grid place-items-center"><div className="text-white">Loading Dashboard...</div></div>;
    if (error) return <div className="p-8 text-rose-500">Error: {error}</div>;

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-200 p-6 lg:p-8 font-sans">
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                        <LayoutDashboard className="text-blue-500" />
                        Ops Manager Dashboard
                    </h1>
                    <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
                        Real-time operational visibility & SLA tracking
                        <span className="text-slate-600">•</span>
                        <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </p>
                </div>
                <div className="flex gap-3">
                    <button className="bg-[#1e293b] hover:bg-[#334155] px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 transition">Last 30 Days</button>
                    <button className="bg-[#1e293b] hover:bg-[#334155] px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 transition">All Zones</button>
                </div>
            </header>

            {/* Top Grid: KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                <StatCard
                    title="SLA Compliance"
                    value={`${kpi?.sla_compliance_percent || 0}%`}
                    icon={CheckCircle}
                />
                <StatCard
                    title="SLA Breach Rate"
                    value={`${kpi?.sla_breach_percent || 0}%`}
                    inverseTrend
                    icon={AlertOctagon}
                />
                <StatCard
                    title="Tickets at Risk"
                    value={kpi?.at_risk_count || 0}
                    inverseTrend
                    icon={AlertTriangle}
                    trendLabel="Avg SLA Remaining"
                    trend={kpi?.avg_at_risk_sla_percent || 0}
                />
                <StatCard
                    title="Created Today"
                    value={kpi?.created_today || 0}
                    icon={Activity}
                />
                <StatCard
                    title="Resolved Today"
                    value={kpi?.resolved_today || 0}
                    icon={TrendingUp}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">

                {/* Main Line Chart (Span 2) */}
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-6">Tickets Created vs Resolved (30d)</h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="day"
                                    tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                                    itemStyle={{ color: '#f8fafc' }}
                                />
                                <Legend />
                                <Line type="monotone" dataKey="created_count" name="Created" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                                <Line type="monotone" dataKey="resolved_count" name="Resolved" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* SLA Exceptions Donut (Span 1) */}
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm flex flex-col">
                    <h3 className="text-md font-bold text-white mb-4">SLA Breach Reasons</h3>
                    <div className="flex-1 min-h-[250px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={reasons}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="breach_count"
                                >
                                    {reasons.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-2xl font-bold text-white">{reasons.reduce((a, b) => a + b.breach_count, 0)}</span>
                            <span className="text-xs text-slate-500 uppercase">Total</span>
                        </div>
                    </div>
                    <div className="mt-4 space-y-2">
                        {reasons.slice(0, 4).map((r, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                    <span className="text-slate-300">{r.reason_label}</span>
                                </div>
                                <span className="text-slate-500">{r.breach_count} ({r.percentage}%)</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* At-Risk Departments (Span 1) - Updated */}
                <div className="flex flex-col gap-6">
                    {/* At-Risk Departments (Card 1) */}
                    <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-y-auto">
                        <h3 className="text-md font-bold text-white mb-4">At-Risk Depts (Next 4h)</h3>
                        <div className="space-y-4">
                            {atRiskDepts.map((item, i) => {
                                const seconds = item.worst_remaining_seconds || 0;
                                const level = getRiskLevel(seconds);

                                return (
                                    <div
                                        key={i}
                                        onClick={() => setSelectedAtRiskDept(item.department_name)}
                                        className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-slate-800 hover:bg-slate-700/50 hover:border-slate-600 transition cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${item.department_name === 'Housekeeping' ? 'bg-amber-500/10 text-amber-500' :
                                                item.department_name === 'Maintenance' ? 'bg-blue-500/10 text-blue-500' :
                                                    'bg-purple-500/10 text-purple-500'
                                                }`}>
                                                <Clock size={16} />
                                            </div>
                                            <span className="font-medium text-slate-200">{item.department_name}</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-white">{item.at_risk_count}</div>
                                            <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${level.color}`}>
                                                {level.label}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {atRiskDepts.length === 0 && <div className="text-center text-slate-500 py-4">No risk alerts</div>}
                        </div>
                    </div>

                    {/* Blocked / Stuck (Card 2) */}
                    <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-md font-bold text-white flex items-center gap-2">
                                <div className="bg-rose-600 rounded p-1"><span className="block w-2 h-2 border-l-2 border-r-2 border-white"></span></div>
                                Blocked Tickets
                            </h3>
                            <span className="text-xs text-orange-400 font-medium">(Stuck &gt; 2 Hours)</span>
                        </div>

                        <div className="space-y-4">
                            {blockedRisk.map((item, i) => (
                                <div
                                    key={i}
                                    onClick={() => setSelectedBlockedDept(item.department_name)}
                                    className="bg-[#0f172a] rounded-lg border border-slate-800 p-3 cursor-pointer hover:bg-slate-700/50 hover:border-slate-600 transition group"
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-500 group-hover:bg-rose-500/20 transition">
                                                <span className="block w-3 h-3 border-l-2 border-r-2 border-current"></span>
                                            </div>
                                            <span className="font-medium text-slate-200 group-hover:text-white transition">{item.department_name}</span>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-white">{item.blocked_count}</div>
                                            <span className="bg-rose-500/20 text-rose-500 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">Blocked</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-end gap-1 text-xs text-slate-500 group-hover:text-slate-400">
                                        <span>Longest:</span>
                                        <span className="text-slate-300 font-mono group-hover:text-slate-200">
                                            {Math.floor(item.max_hours_blocked)}h {Math.round((item.max_hours_blocked % 1) * 60)}m
                                        </span>
                                        <ArrowUpRight size={12} />
                                    </div>
                                </div>
                            ))}
                            {blockedRisk.length === 0 && <div className="text-center text-slate-500 py-4">No blocked tickets</div>}
                        </div>
                    </div>
                </div>


            </div>

            {/* Middle Section: Open Breaches (Now First) */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                {/* Open Breaches Table (Span 2) */}
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-hidden">

                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-md font-bold text-white">Open Breaches (Actionable)</h3>
                        <button
                            onClick={() => setIsOpenBreachesDrawer(true)}
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium bg-blue-500/10 px-2.5 py-1.5 rounded-lg transition-colors border border-blue-500/20"
                        >
                            Full List
                            <ArrowUpRight size={14} />
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-[#0f172a]">
                                <tr>
                                    <th className="px-4 py-3 rounded-l-lg">Ticket</th>
                                    <th className="px-4 py-3">Dept</th>
                                    <th className="px-4 py-3">Assignee</th>
                                    <th className="px-4 py-3">
                                        <div className="flex items-center gap-1.5">
                                            Reason
                                            <SimpleTooltip content={`Direct SLA Breach: Time expired naturally without a blocker.\n[Reason]: Violation caused by a specific blocker (e.g. Inventory).`}>
                                                <Info size={14} className="text-slate-500 cursor-help" />
                                            </SimpleTooltip>
                                        </div>
                                    </th>
                                    <th className="px-4 py-3 text-right rounded-r-lg">Overdue</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {openBreaches.slice(0, 4).map((row) => (
                                    <tr key={row.ticket_id} className="hover:bg-slate-800/50 transition">
                                        <td className="px-4 py-3 font-medium text-white">#{row.display_id}</td>
                                        <td className="px-4 py-3 text-slate-300">{row.department_name}</td>
                                        <td className="px-4 py-3 flex items-center gap-2">
                                            {row.assignee_avatar ? (
                                                <img src={row.assignee_avatar} alt="" className="w-6 h-6 rounded-full" />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-slate-700 grid place-items-center text-xs">?</div>
                                            )}
                                            <span className="text-slate-300 truncate max-w-[100px]">{row.assignee_name || 'Unassigned'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400">{row.breach_context}</td>
                                        <td className="px-4 py-3 text-right font-mono text-rose-500 font-bold">
                                            {Math.round(row.hours_overdue)}h
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {openBreaches.length === 0 && <div className="text-center text-slate-500 py-8">No open breaches. Great work!</div>}
                    </div>
                </div>


                {/* Ticket Backlog Trend (Span 1) */}
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Ticket Backlog Trend (30 Days)</h3>
                    <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={backlog} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBacklog" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="day" tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                                <Area type="monotone" dataKey="backlog_count" stroke="#3b82f6" fillOpacity={1} fill="url(#colorBacklog)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Agent Risk Focus (Span 1) */}
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Agent Risk Focus</h3>
                    <div className="space-y-4">
                        {agentRisk.map((agent, i) => (
                            <div
                                key={i}
                                onClick={() => setSelectedAgentRisk(agent.agent_name)}
                                className="flex items-center gap-3 p-2 hover:bg-[#0f172a] rounded-lg transition cursor-pointer"
                            >
                                {agent.avatar_url ? (
                                    <img src={agent.avatar_url} className="w-10 h-10 rounded-full border border-slate-600" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-xs">N/A</div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-200 truncate">{agent.agent_name}</div>
                                    <div className="text-xs text-slate-500 truncate">{agent.department_name}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-rose-500 font-bold text-sm">{agent.at_risk_count}</div>
                                    <div className="text-[10px] text-slate-600 uppercase">Risks</div>
                                </div>
                            </div>
                        ))}
                        {agentRisk.length === 0 && <div className="text-center text-slate-500 py-4">No agents flagged</div>}
                    </div>

                    <button
                        onClick={() => {
                            if (agentRisk.length > 0) {
                                setSelectedAgentRisk(agentRisk[0].agent_name);
                            }
                        }}
                        className="w-full mt-6 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-lg transition shadow-lg shadow-rose-900/20 flex items-center justify-center gap-2"
                    >
                        <AlertTriangle size={18} />
                        Action Required
                    </button>
                </div>
            </div>

            {/* Bottom Section */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* SLA Exceptions by Dept (Stacked Bar) */}
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-md font-bold text-white whitespace-nowrap">SLA Exceptions by Dept</h3>
                        <div className="flex items-center gap-3 text-xs bg-[#0f172a] px-3 py-1.5 rounded-lg border border-slate-700/50">
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444]"></span>Ext</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#F97316]"></span>Infra</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#EAB308]"></span>Guest</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#A855F7]"></span>Policy</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#10B981]"></span>Mgmt</div>
                            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#3B82F6]"></span>Other</div>
                        </div>
                    </div>
                    <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={exceptionsChartData}
                                margin={{ top: 10, right: 10, left: -20, bottom: 50 }}
                                barSize={40}
                            >
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="short_name"
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500, angle: -90, textAnchor: 'end' }}
                                    tickLine={false}
                                    axisLine={false}
                                    dy={10}
                                    interval={0}
                                    height={80}
                                />


                                <YAxis
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#334155', opacity: 0.2 }}
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '8px' }}
                                    itemStyle={{ padding: 0 }}
                                    formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1).replace('_', ' ')]}
                                    labelFormatter={(label, payload) => {
                                        if (payload && payload.length > 0) {
                                            return payload[0].payload.department_name;
                                        }
                                        return label;
                                    }}
                                />
                                <Bar
                                    dataKey="external_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.external}
                                    name="External"
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('EXTERNAL_DEPENDENCY');
                                    }}
                                    cursor="pointer"
                                />
                                <Bar
                                    dataKey="infra_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.infrastructure}
                                    name="Infrastructure"
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('INFRASTRUCTURE');
                                    }}
                                    cursor="pointer"
                                />
                                <Bar
                                    dataKey="guest_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.guest}
                                    name="Guest"
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('GUEST_DEPENDENCY');
                                    }}
                                    cursor="pointer"
                                />
                                <Bar
                                    dataKey="policy_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.policy}
                                    name="Policy"
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('POLICY');
                                    }}
                                    cursor="pointer"
                                />
                                <Bar
                                    dataKey="approval_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.management}
                                    name="Management"
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('MANAGEMENT');
                                    }}
                                    cursor="pointer"
                                />
                                <Bar
                                    dataKey="other_count"
                                    stackId="a"
                                    fill={EXCEPTION_COLORS.other}
                                    name="Other"
                                    radius={[4, 4, 0, 0]}
                                    onClick={(data) => {
                                        setSelectedBlockedDept(data.department_name);
                                        setSelectedExceptionCategory('OTHER');
                                    }}
                                    cursor="pointer"
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>



                {/* SLA Exception Decisions (Span 2) */}
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-md font-bold text-white">SLA Exemption Requests & Decisions</h3>
                                <SimpleTooltip content="Based on supervisor-governed exceptions in the last 30 days.">
                                    <Info size={14} className="text-slate-400 cursor-help" />
                                </SimpleTooltip>
                            </div>
                            <p className="text-xs text-slate-500">Last 30 days • Supervisor-governed exceptions</p>
                        </div>
                    </div>

                    {/* Summary Progress Bar */}
                    <div className="bg-[#0f172a] p-4 rounded-lg border border-slate-700/50 mb-6">
                        <div className="flex h-8 w-full rounded-md overflow-hidden mb-2">
                            {/* Granted */}
                            <div
                                style={{ width: `${(exceptionDecisions.reduce((acc, curr) => acc + curr.granted_count, 0) / Math.max(exceptionDecisions.reduce((acc, curr) => acc + curr.requested_count, 0), 1)) * 100}%` }}
                                className="bg-emerald-500 flex items-center justify-center text-white font-bold text-sm"
                            >
                                {exceptionDecisions.reduce((acc, curr) => acc + curr.granted_count, 0) || ''}
                            </div>
                            {/* Rejected */}
                            <div
                                style={{ width: `${(exceptionDecisions.reduce((acc, curr) => acc + curr.rejected_count, 0) / Math.max(exceptionDecisions.reduce((acc, curr) => acc + curr.requested_count, 0), 1)) * 100}%` }}
                                className="bg-rose-500 flex items-center justify-center text-white font-bold text-sm"
                            >
                                {exceptionDecisions.reduce((acc, curr) => acc + curr.rejected_count, 0) || ''}
                            </div>
                            {/* Pending */}
                            <div
                                style={{ width: `${(exceptionDecisions.reduce((acc, curr) => acc + curr.pending_count, 0) / Math.max(exceptionDecisions.reduce((acc, curr) => acc + curr.requested_count, 0), 1)) * 100}%` }}
                                className="bg-amber-400 flex items-center justify-center text-white font-bold text-sm"
                            >
                                {exceptionDecisions.reduce((acc, curr) => acc + curr.pending_count, 0) || ''}
                            </div>
                        </div>
                        <div className="flex justify-between text-xs font-medium text-slate-400 px-1">
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>Granted</div>
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>Rejected</div>
                            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>Pending</div>
                        </div>
                    </div>

                    {/* Stacked Chart */}
                    <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={exceptionDecisions}
                                margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
                                barSize={32}
                            >
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="reason_label"
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                                    tickLine={false}
                                    axisLine={false}
                                    dy={10}
                                    interval={0}
                                    tickFormatter={(val) => val.length > 10 ? `${val.substring(0, 10)}...` : val}
                                />
                                <YAxis
                                    stroke="#64748b"
                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#334155', opacity: 0.2 }}
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ fontSize: '12px', fontWeight: 500 }}
                                />
                                <Bar dataKey="granted_count" stackId="a" fill="#10b981" name="Granted" radius={[0, 0, 4, 4]} />
                                <Bar dataKey="rejected_count" stackId="a" fill="#ef4444" name="Rejected" />
                                <Bar dataKey="pending_count" stackId="a" fill="#fbbf24" name="Pending" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Insights (Static for now) */}
                    <div className="mt-4 space-y-2">
                        <div className="flex items-start gap-2 text-xs text-slate-400">
                            <CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                            <span><strong>Guest-related requests</strong> have the highest approval rate ({Math.round((exceptionDecisions.filter(d => d.reason_category === 'GUEST_DEPENDENCY').reduce((acc, curr) => acc + curr.granted_count, 0) / Math.max(exceptionDecisions.filter(d => d.reason_category === 'GUEST_DEPENDENCY').reduce((acc, curr) => acc + curr.requested_count, 0), 1)) * 100)}%)</span>
                        </div>
                        <div className="flex items-start gap-2 text-xs text-slate-400">
                            <TrendingUp size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                            <span>Supervisor approvals are increasing WoW (+12%)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Drawers */}
            <BlockedTicketsDrawer
                departmentName={selectedBlockedDept}
                category={selectedExceptionCategory}
                onClose={() => {
                    setSelectedBlockedDept(null);
                    setSelectedExceptionCategory(null);
                }}
            />

            {currentHotel && (
                <AgentRiskDrawer
                    hotelId={currentHotel.id}
                    agentName={selectedAgentRisk}
                    onClose={() => setSelectedAgentRisk(null)}
                />
            )}

            {currentHotel && (
                <AtRiskDepartmentsDrawer
                    hotelId={currentHotel.id}
                    departmentName={selectedAtRiskDept}
                    onClose={() => setSelectedAtRiskDept(null)}
                />
            )}

            {currentHotel && (
                <OpenBreachesDrawer
                    isOpen={isOpenBreachesDrawer}
                    hotelId={currentHotel.id}
                    onClose={() => setIsOpenBreachesDrawer(false)}
                />
            )}
        </div>
    );
}
