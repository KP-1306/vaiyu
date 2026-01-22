import {
    Bar,
    BarChart,
    Cell,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";
import { ArrowDownRight, TrendingUp } from "lucide-react";

export type ActivityBreakdownRow = {
    hotel_id: string;
    department_name: string;
    created_count: number;
    resolved_count: number;
};

type Props = {
    isOpen: boolean;
    onClose: () => void;
    activityData: ActivityBreakdownRow[];
};

export default function ActivityExplanationDrawer({
    isOpen,
    onClose,
    activityData
}: Props) {
    if (!isOpen) return null;

    // Filter out departments with 0 activity to keep chart clean
    const activeDepts = activityData.filter(d => d.created_count > 0 || d.resolved_count > 0);
    const totalCreated = activeDepts.reduce((acc, curr) => acc + curr.created_count, 0);
    const totalResolved = activeDepts.reduce((acc, curr) => acc + curr.resolved_count, 0);

    return (
        <div className="fixed inset-0 z-[60] flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-[#0f172a] h-full shadow-2xl p-6 overflow-y-auto border-l border-slate-800 animate-slide-in-right">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <TrendingUp className="text-blue-400" size={24} />
                            Activity Breakdown
                        </h2>
                        <p className="text-sm text-slate-400">
                            Departmental contributions to <span className="text-blue-400 font-bold">{totalCreated}</span> created vs <span className="text-emerald-400 font-bold">{totalResolved}</span> resolved tickets (Last 7 Days).
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                        <ArrowDownRight className="rotate-[-135deg]" size={24} />
                    </button>
                </div>

                {/* Main Bar Chart */}
                <div className="mb-8 p-6 bg-[#151A25] rounded-xl border border-slate-800/50">
                    <h3 className="text-sm font-semibold text-slate-200 mb-4">Volume by Department</h3>
                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeDepts} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="department_name" tick={{ fill: '#64748b', fontSize: 10 }} interval={0} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs">
                                                    <div className="font-bold text-white mb-1">{d.department_name}</div>
                                                    <div className="text-blue-400">Created: {d.created_count}</div>
                                                    <div className="text-emerald-400">Resolved: {d.resolved_count}</div>
                                                    <div className="text-slate-500 mt-1 italic">
                                                        {d.resolved_count >= d.created_count ? 'Keepin\' up! 👍' : 'Falling behind ⚠️'}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Legend />
                                <Bar dataKey="created_count" name="Created" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                <Bar dataKey="resolved_count" name="Resolved" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Detailed List */}
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-200">Department Performance</h3>
                    {activeDepts.map((row) => (
                        <div key={row.department_name} className="p-4 rounded-lg bg-[#151A25] border border-slate-800/50 flex items-center justify-between">
                            <div>
                                <div className="font-bold text-slate-200">{row.department_name}</div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                    Efficiency: {row.created_count > 0 ? Math.round((row.resolved_count / row.created_count) * 100) : 0}% clearance
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-mono">
                                <div className="flex flex-col items-end">
                                    <span className="text-blue-400 font-bold">{row.created_count}</span>
                                    <span className="text-slate-600 text-[10px] uppercase">New</span>
                                </div>
                                <div className="h-8 w-px bg-slate-800" />
                                <div className="flex flex-col items-end">
                                    <span className="text-emerald-400 font-bold">{row.resolved_count}</span>
                                    <span className="text-slate-600 text-[10px] uppercase">Done</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {activeDepts.length === 0 && (
                        <div className="text-center text-slate-500 italic py-8">
                            No activity recorded in the last 7 days.
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
