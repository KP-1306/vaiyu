import { useEffect, useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
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
    Bug,
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

type OpenBreachRow = { ticket_id: string; display_id: string; department_name: string; assignee_name: string; assignee_avatar: string | null; breach_context: string; hours_overdue: number }; 
type BacklogRow = { day: string; backlog_count: number };
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

function StatCard({
    title,
    value,
    subValue,
    trend,
    trendLabel,
    inverseTrend = false,
    icon: Icon,
    valueColor
}: {
    title: string;
    value: string | number;
    subValue?: string;
    trend?: number;
    trendLabel?: string;
    inverseTrend?: boolean;
    icon?: any;
    valueColor?: string;
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
                <span className={`text-3xl font-bold tracking-tight ${valueColor || 'text-white'}`}>{value}</span>
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
    const [timeRange, setTimeRange] = useState<"live" | "7d" | "30d">("30d");

    // Data State
    const [currentHotel, setCurrentHotel] = useState<{ id: string; name: string } | null>(null);
    const [kpi, setKpi] = useState<OpsKpiCurrent | null>(null);
    const [trend, setTrend] = useState<CreatedResolvedRow[]>([]);
    const [reasons, setReasons] = useState<BreachReasonRow[]>([]);
    const [atRiskDepts, setAtRiskDepts] = useState<AtRiskDeptRow[]>([]);
    const [slaExceptions, setSlaExceptions] = useState<SlaExceptionRow[]>([]);
    const [openBreaches, setOpenBreaches] = useState<OpenBreachRow[]>([]);
    const [backlog, setBacklog] = useState<BacklogRow[]>([]);
    const [agentRisk, setAgentRisk] = useState<AgentRiskRow[]>([]);
    const [blockedRisk, setBlockedRisk] = useState<BlockedStagnationRow[]>([]);
    const [exceptionDecisions, setExceptionDecisions] = useState<SLAExceptionDecisionRow[]>([]);
    const [isOpenBreachesDrawer, setIsOpenBreachesDrawer] = useState(false);

    // State for drill-down drawer
    const [selectedBlockedDept, setSelectedBlockedDept] = useState<string | null>(null);
    const [selectedExceptionCategory, setSelectedExceptionCategory] = useState<string | null>(null);
    const [selectedAgentRisk, setSelectedAgentRisk] = useState<string | null>(null);
    const [selectedAtRiskDept, setSelectedAtRiskDept] = useState<string | null>(null);

    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    useEffect(() => {
        if (!slug) return;
        let mounted = true;

        const fetchData = async () => {
            try {
                setLoading(true);
                const { data: hotel } = await supabase.from("hotels").select("id, name").eq("slug", slug).single();
                if (!hotel) throw new Error("Hotel not found");
                setCurrentHotel(hotel);

                const getLocalISODate = (d: Date) => {
                    const offset = d.getTimezoneOffset() * 60000;
                    return new Date(d.getTime() - offset).toISOString().split('T')[0];
                };

                const today = new Date();
                
                const results = await Promise.all([
                    supabase.from("v_owner_kpi_summary").select("*").eq("hotel_id", hotel.id).maybeSingle(),
                    supabase.from("v_owner_ticket_activity").select("*").eq("hotel_id", hotel.id).limit(60),
                    supabase.from("v_owner_sla_breach_breakdown").select("*").eq("hotel_id", hotel.id).limit(10),
                    supabase.from("v_ops_at_risk_departments").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_ops_open_breaches").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_ops_agent_risk").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_ops_blocked_stagnation_risk").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_ops_exceptions_30d").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_ops_ticket_backlog_30d").select("*").eq("hotel_id", hotel.id),
                    supabase.from("v_owner_sla_trend_daily").select("*").eq("hotel_id", hotel.id).order("day", { ascending: false }).limit(60),
                    supabase.from("v_ops_decisions_30d").select("*").eq("hotel_id", hotel.id),
                ]);

                if (mounted) {
                    const currentKpi = results[0].data || {};
                    const rawTrend = results[1].data || [];
                    const fetchedReasons = results[2].data || [];
                    const slaTrendRaw = results[9].data || [];
                    
                    const activeDays = timeRange === 'live' ? 1 : (timeRange === '7d' ? 7 : 30);
                    
                    const activeTrendSlice = rawTrend.slice(0, activeDays);
                    const createdSum = activeTrendSlice.reduce((sum: number, curr: any) => sum + (curr.created_count || 0), 0);
                    const resolvedSum = activeTrendSlice.reduce((sum: number, curr: any) => sum + (curr.resolved_count || 0), 0);

                    const activeSlaSlice = slaTrendRaw.slice(0, activeDays);
                    const rangeCompleted = activeSlaSlice.reduce((sum: number, curr: any) => sum + (curr.completed_within_sla || 0), 0);
                    const rangeBreached = activeSlaSlice.reduce((sum: number, curr: any) => sum + (curr.breached_sla || 0), 0);
                    const rangeTotalSla = rangeCompleted + rangeBreached;

                    const dynamicSlaCompliance = rangeTotalSla > 0 ? Math.round((rangeCompleted / rangeTotalSla) * 100) : 100;
                    const dynamicSlaBreach = rangeTotalSla > 0 ? Math.round((rangeBreached / rangeTotalSla) * 100) : 0;

                    setKpi({
                        sla_compliance_percent: dynamicSlaCompliance,
                        sla_breach_percent: dynamicSlaBreach,
                        created_today: createdSum,
                        resolved_today: resolvedSum,
                        at_risk_count: currentKpi?.at_risk_tickets || 0,
                        avg_at_risk_sla_percent: 0,
                    });
                    
                    setTrend(rawTrend.map((t: any) => ({ hotel_id: hotel.id, day: t.day, created_count: t.created_count, resolved_count: t.resolved_count })));
                    setReasons(fetchedReasons.map((r: any) => ({ reason_label: r.reason_label, breach_count: r.breached_count, percentage: 0 })));

                    setAtRiskDepts(results[3].data || []);
                    setOpenBreaches(results[4].data || []);
                    setAgentRisk(results[5].data || []);
                    setBlockedRisk(results[6].data || []);
                    setSlaExceptions(results[7].data || []);
                    setBacklog(results[8].data || []);
                    setExceptionDecisions(results[10].data || []);
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
        const intervalId = setInterval(fetchData, 60000);

        return () => {
            mounted = false;
            clearInterval(intervalId);
        };
    }, [slug, timeRange]);

    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    const EXCEPTION_COLORS = {
        guest: '#EAB308',
        infrastructure: '#F97316',
        policy: '#A855F7',
        external: '#EF4444',
        management: '#10B981',
        other: '#3B82F6'
    };

    const exceptionsChartData = useMemo(() => {
        return slaExceptions
            .map(r => {
                let shortName = r.department_name;
                if (shortName === 'Front Desk & Guest Services') shortName = 'Front Desk';
                if (shortName === 'Maintenance & Engineering') shortName = 'Maintenance';
                return { ...r, short_name: shortName };
            })
            .filter(r => r.department_name && r.department_name.trim().length > 0)
            .sort((a, b) => b.total_exception_requests - a.total_exception_requests)
            .slice(0, 8);
    }, [slaExceptions]);

    const getRiskLevel = (seconds: number) => {
        if (seconds <= 900) return { label: "High", color: "bg-rose-500/20 text-rose-500" };
        if (seconds <= 3600) return { label: "Elevated", color: "bg-orange-500/20 text-orange-500" };
        return { label: "Moderate", color: "bg-yellow-500/20 text-yellow-500" };
    };

    if (!slug) return <div className="p-8 text-center text-slate-500">Please select a property.</div>;
    if (loading) return <div className="min-h-screen bg-[#0f172a] grid place-items-center"><div className="text-white">Loading Dashboard...</div></div>;
    if (error) return <div className="p-8 text-rose-500">Error: {error}</div>;

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-200 p-6 lg:p-8 font-sans">
            <div className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-400">
                <Link to={`/owner/${slug}`} className="hover:text-white transition">Dashboard</Link>
                <span className="text-slate-600">/</span>
                <span className="text-slate-200">Ops Manager</span>
            </div>
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
                    <button onClick={() => setTimeRange('live')} className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${timeRange === 'live' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1e293b] hover:bg-[#334155] border-slate-700 text-slate-300'}`}>Live (Today)</button>
                    <button onClick={() => setTimeRange('7d')} className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${timeRange === '7d' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1e293b] hover:bg-[#334155] border-slate-700 text-slate-300'}`}>7 Days</button>
                    <button onClick={() => setTimeRange('30d')} className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${timeRange === '30d' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1e293b] hover:bg-[#334155] border-slate-700 text-slate-300'}`}>30 Days</button>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                <StatCard title="SLA Compliance" value={`${kpi?.sla_compliance_percent || 0}%`} icon={CheckCircle} valueColor="text-emerald-500" />
                <StatCard title="SLA Breach Rate" value={`${kpi?.sla_breach_percent || 0}%`} icon={AlertOctagon} valueColor="text-rose-500" />
                <StatCard title="Tickets at Risk" value={kpi?.at_risk_count || 0} icon={AlertTriangle} trendLabel="Avg SLA Remaining" trend={kpi?.avg_at_risk_sla_percent || 0} />
                <StatCard title={timeRange === 'live' ? "Created Today" : "Created Count"} value={kpi?.created_today || 0} icon={Activity} />
                <StatCard title={timeRange === 'live' ? "Resolved Today" : "Resolved Count"} value={kpi?.resolved_today || 0} icon={TrendingUp} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-6">Tickets Created vs Resolved</h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trend.slice(0, (timeRange === 'live' ? 1 : (timeRange === '7d' ? 7 : 30))).reverse().map(d => ({
                                ...d,
                                created_display: d.created_count > 0 && d.created_count === d.resolved_count ? d.created_count + 0.1 : d.created_count
                            }))} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
                                <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="day" tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} 
                                    formatter={(value: any, name: string) => [Math.floor(value), name]} 
                                />
                                <Legend />
                                <Area type="monotone" dataKey="resolved_count" name="Resolved" stroke="#10b981" strokeWidth={2} fillOpacity={0.1} fill="url(#colorResolved)" dot={{ r: 4, fill: '#10b981', stroke: '#1e293b', strokeWidth: 2 }} />
                                <Area type="monotone" dataKey="created_display" name="Created" stroke="#3b82f6" strokeWidth={4} fillOpacity={0} dot={{ r: 6, fill: '#1e293b', stroke: '#3b82f6', strokeWidth: 2 }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm flex flex-col">
                    <h3 className="text-md font-bold text-white mb-4">SLA Breach Reasons</h3>
                    <div className="flex-1 min-h-[250px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={reasons} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="breach_count">
                                    {reasons.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-y-auto">
                        <h3 className="text-md font-bold text-white mb-4">At-Risk Depts</h3>
                        <div className="space-y-4">
                            {atRiskDepts.map((item, i) => (
                                <div key={i} onClick={() => setSelectedAtRiskDept(item.department_name)} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-slate-800 cursor-pointer">
                                    <span className="font-medium text-slate-200">{item.department_name}</span>
                                    <span className="text-lg font-bold text-white">{item.at_risk_count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-y-auto">
                        <h3 className="text-md font-bold text-white mb-4">Blocked Tickets</h3>
                        <div className="space-y-4">
                            {blockedRisk.map((item, i) => (
                                <div key={i} onClick={() => setSelectedBlockedDept(item.department_name)} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-slate-800 cursor-pointer">
                                    <span className="font-medium text-slate-200">{item.department_name}</span>
                                    <span className="text-lg font-bold text-white">{item.blocked_count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-md font-bold text-white">Open Breaches</h3>
                        <button onClick={() => setIsOpenBreachesDrawer(true)} className="text-xs text-blue-400">Full List</button>
                    </div>
                    <table className="w-full text-sm text-left">
                        <tbody className="divide-y divide-slate-800">
                            {openBreaches.slice(0, 4).map((row) => (
                                <tr key={row.ticket_id} className="hover:bg-slate-800/50">
                                    <td className="px-4 py-3 font-medium text-white">#{row.display_id}</td>
                                    <td className="px-4 py-3 text-slate-300">{row.department_name}</td>
                                    <td className="px-4 py-3 text-rose-500 font-bold">{Math.round(row.hours_overdue)}h</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Ticket Backlog</h3>
                    <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={backlog} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBacklog" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="day" tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} stroke="#64748b" />
                                <YAxis stroke="#64748b" />
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a' }} />
                                <Area type="monotone" dataKey="backlog_count" stroke="#3b82f6" fillOpacity={1} fill="url(#colorBacklog)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Agent Risk Focus</h3>
                    <div className="space-y-4">
                        {agentRisk.map((agent, i) => (
                            <div key={i} onClick={() => setSelectedAgentRisk(agent.agent_name)} className="flex items-center gap-3 p-2 hover:bg-[#0f172a] rounded-lg cursor-pointer">
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-200 truncate">{agent.agent_name}</div>
                                    <div className="text-xs text-slate-500 truncate">{agent.department_name}</div>
                                </div>
                                <div className="text-rose-500 font-bold text-sm">{agent.at_risk_count}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <BlockedTicketsDrawer departmentName={selectedBlockedDept} category={selectedExceptionCategory} onClose={() => { setSelectedBlockedDept(null); setSelectedExceptionCategory(null); }} />
            {selectedAgentRisk && <AgentRiskDrawer agentName={selectedAgentRisk} hotelId={currentHotel?.id || ""} onClose={() => setSelectedAgentRisk(null)} />}
            {selectedAtRiskDept && <AtRiskDepartmentsDrawer departmentName={selectedAtRiskDept} hotelId={currentHotel?.id || ""} onClose={() => setSelectedAtRiskDept(null)} />}
            {isOpenBreachesDrawer && <OpenBreachesDrawer open={isOpenBreachesDrawer} breaches={openBreaches as any} onClose={() => setIsOpenBreachesDrawer(false)} />}
        </div>
    );
}
