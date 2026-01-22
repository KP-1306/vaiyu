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
    AlertOctagon
} from "lucide-react";

/** --- Types (Matched to FINAL OPS SQL PACK) --- */
type OpsKpiCurrent = {
    // Replaces OpsKpiSummary
    sla_compliance_percent: number; // was sla_compliance_cur
    sla_breach_percent: number;     // was sla_breach_rate_cur
    at_risk_count: number;          // was risk_count_cur
    created_today: number;
    resolved_today: number;

    // Deltas are REMOVED in the new view (Current State Only)
    // We will either remove trend UI or calculate it if possible? 
    // For now, simpler UI.
};

type CreatedResolvedRow = { hotel_id: string; day: string; created_count: number; resolved_count: number };
type BreachReasonRow = { reason_label: string; breach_count: number; percentage: number }; // ticket_count -> breach_count
type AtRiskDeptRow = { department_name: string; at_risk_count: number; worst_remaining_seconds: number }; // Replaces AtRiskRow
type DeptBreachRow = {
    department_name: string;
    count_guest: number;
    count_dependency: number;
    count_inventory: number;
    count_approval: number;
    count_other: number;
};
type OpenBreachRow = { ticket_id: string; display_id: string; department_name: string; assignee_name: string; assignee_avatar: string | null; breach_reason: string; hours_overdue: number }; // sla_reason -> breach_reason
type BacklogRow = { day: string; backlog_count: number };
type AgentRiskRow = { agent_name: string; avatar_url: string | null; department_name: string; at_risk_count: number };


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

            {/* Only show trend if defined. The new view removes deltas. */}
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
    const [kpi, setKpi] = useState<OpsKpiCurrent | null>(null);
    const [trend, setTrend] = useState<CreatedResolvedRow[]>([]);
    const [reasons, setReasons] = useState<BreachReasonRow[]>([]);
    const [atRiskDepts, setAtRiskDepts] = useState<AtRiskDeptRow[]>([]);
    const [deptBreaches, setDeptBreaches] = useState<DeptBreachRow[]>([]);
    const [openBreaches, setOpenBreaches] = useState<OpenBreachRow[]>([]);
    const [backlog, setBacklog] = useState<BacklogRow[]>([]);
    const [agentRisk, setAgentRisk] = useState<AgentRiskRow[]>([]);

    useEffect(() => {
        if (!slug) return;
        let mounted = true;

        const fetchData = async () => {
            try {
                setLoading(true);
                const { data: hotel } = await supabase.from("hotels").select("id").eq("slug", slug).single();
                if (!hotel) throw new Error("Hotel not found");

                const results = await Promise.all([
                    // 1. v_ops_kpi_current
                    supabase.from("v_ops_kpi_current").select("*").eq("hotel_id", hotel.id).maybeSingle(),
                    // 2. v_ops_created_resolved_30d
                    supabase.from("v_ops_created_resolved_30d").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }),
                    // 3. v_ops_sla_breach_reasons
                    supabase.from("v_ops_sla_breach_reasons").select("*").eq("hotel_id", hotel.id),
                    // 4. v_ops_at_risk_departments
                    supabase.from("v_ops_at_risk_departments").select("*").eq("hotel_id", hotel.id),
                    // 5. v_ops_sla_breaches_by_dept (Preserved)
                    supabase.from("v_ops_sla_breaches_by_dept").select("*").eq("hotel_id", hotel.id),
                    // 6. v_ops_open_breaches
                    supabase.from("v_ops_open_breaches").select("*").eq("hotel_id", hotel.id),
                    // 7. v_ops_backlog_trend
                    supabase.from("v_ops_backlog_trend").select("*").eq("hotel_id", hotel.id).order("day", { ascending: true }),
                    // 8. v_ops_agent_risk
                    supabase.from("v_ops_agent_risk").select("*").eq("hotel_id", hotel.id),
                ]);

                if (mounted) {
                    setKpi(results[0].data);
                    setTrend(results[1].data || []);
                    setReasons(results[2].data || []);
                    setAtRiskDepts(results[3].data || []);
                    setDeptBreaches(results[4].data || []);
                    setOpenBreaches(results[5].data || []);
                    setBacklog(results[6].data || []);
                    setAgentRisk(results[7].data || []);
                }
            } catch (err: any) {
                console.error(err);
                if (mounted) setError(err.message);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchData();
        return () => { mounted = false; };
    }, [slug]);

    if (!slug) return <div className="p-8 text-center text-slate-500">Please select a property.</div>;
    if (loading) return <div className="min-h-screen bg-[#0f172a] grid place-items-center"><div className="text-white">Loading Dashboard...</div></div>;
    if (error) return <div className="p-8 text-rose-500">Error: {error}</div>;

    // Charts Colors
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    return (
        <div className="min-h-screen bg-[#0f172a] text-slate-200 p-6 lg:p-8 font-sans">
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                        <LayoutDashboard className="text-blue-500" />
                        Ops Manager Dashboard
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Real-time operational visibility & SLA tracking</p>
                </div>
                <div className="flex gap-3">
                    <button className="bg-[#1e293b] hover:bg-[#334155] px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 transition">Last 30 Days</button>
                    <button className="bg-[#1e293b] hover:bg-[#334155] px-4 py-2 rounded-lg text-sm font-medium border border-slate-700 transition">All Zones</button>
                </div>
            </header>

            {/* Top Grid: KPI Cards (Updated fields) */}
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
                    trendLabel="< 30m Remaining"
                    trend={0} // Just visual to align
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
                    <h3 className="text-md font-bold text-white mb-4">Breach Reasons</h3>
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
                        {/* Center Text */}
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
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-y-auto">
                    <h3 className="text-md font-bold text-white mb-4">At-Risk Depts (Next 4h)</h3>
                    <div className="space-y-4">
                        {atRiskDepts.map((item, i) => (
                            <div key={i} className="flex items-center justify-between p-3 bg-[#0f172a] rounded-lg border border-slate-800">
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
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${(item.worst_remaining_seconds || 0) < 1800 ? 'bg-rose-500/20 text-rose-500' :
                                        (item.worst_remaining_seconds || 0) < 3600 ? 'bg-orange-500/20 text-orange-500' :
                                            'bg-yellow-500/20 text-yellow-500'
                                        }`}>
                                        {/* Simple formatting for remaining time */}
                                        {Math.round(Math.max(0, item.worst_remaining_seconds) / 60)}m Left
                                    </span>
                                </div>
                            </div>
                        ))}
                        {atRiskDepts.length === 0 && <div className="text-center text-slate-500 py-4">No risk alerts</div>}
                    </div>
                </div>
            </div>

            {/* Bottom Section */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

                {/* SLA By Dept Stacked Bar (Span 1) */}
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Exceptions by Dept</h3>
                    <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={deptBreaches} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <CartesianGrid stroke="#334155" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="department_name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={80} />
                                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                                <Bar dataKey="count_guest" stackId="a" fill="#3b82f6" name="Guest" radius={[0, 4, 4, 0]} barSize={20} />
                                <Bar dataKey="count_dependency" stackId="a" fill="#8b5cf6" name="Dependency" radius={[0, 4, 4, 0]} barSize={20} />
                                <Bar dataKey="count_inventory" stackId="a" fill="#f59e0b" name="Inventory" radius={[0, 4, 4, 0]} barSize={20} />
                                <Bar dataKey="count_approval" stackId="a" fill="#ec4899" name="Approval" radius={[0, 4, 4, 0]} barSize={20} />
                                <Bar dataKey="count_other" stackId="a" fill="#64748b" name="Other" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Open Breaches Table (Span 2) */}
                <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-md font-bold text-white">Open Breaches (Actionable)</h3>
                        <button className="text-xs text-blue-400 hover:text-blue-300 font-medium">View All</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-[#0f172a]">
                                <tr>
                                    <th className="px-4 py-3 rounded-l-lg">Ticket</th>
                                    <th className="px-4 py-3">Dept</th>
                                    <th className="px-4 py-3">Assignee</th>
                                    <th className="px-4 py-3">Reason</th>
                                    <th className="px-4 py-3 text-right rounded-r-lg">Overdue</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {openBreaches.map((row) => (
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
                                        <td className="px-4 py-3 text-slate-400">{row.breach_reason}</td>
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

                {/* Agents Risk Sidebar (Span 1) */}
                <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm">
                    <h3 className="text-md font-bold text-white mb-4">Agent Risk Focus</h3>
                    <div className="space-y-4">
                        {agentRisk.map((agent, i) => (
                            <div key={i} className="flex items-center gap-3 p-2 hover:bg-[#0f172a] rounded-lg transition">
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

                    {/* Mock Action Button */}
                    <button className="w-full mt-6 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-lg transition shadow-lg shadow-rose-900/20 flex items-center justify-center gap-2">
                        <AlertTriangle size={18} />
                        Action Required
                    </button>
                </div>

            </div>

            {/* Backlog Area Chart (Last Row/Section) */}
            <div className="bg-[#1e293b] p-6 rounded-xl border border-slate-700 shadow-sm mt-8">
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
        </div>
    );
}
