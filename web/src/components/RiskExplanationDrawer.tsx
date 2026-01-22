import {
    Bar,
    BarChart,
    Cell,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";
import { ArrowDownRight, AlertTriangle } from "lucide-react";

export type RiskBreakdownRow = {
    hotel_id: string;
    risk_category: 'Blocked' | 'Unassigned' | 'Time Critical';
    ticket_count: number;
};

type Props = {
    isOpen: boolean;
    onClose: () => void;
    riskData: RiskBreakdownRow[];
};

export default function RiskExplanationDrawer({
    isOpen,
    onClose,
    riskData
}: Props) {
    if (!isOpen) return null;

    const totalAtRisk = riskData.reduce((acc, curr) => acc + curr.ticket_count, 0);

    // Map categories to colors
    const getCategoryColor = (cat: string) => {
        switch (cat) {
            case 'Blocked': return '#ef4444'; // Red
            case 'Unassigned': return '#f59e0b'; // Amber
            case 'Time Critical': return '#3b82f6'; // Blue
            default: return '#64748b';
        }
    };

    const getCategoryDescription = (cat: string) => {
        switch (cat) {
            case 'Blocked': return 'Tasks stopped due to an external blocker (e.g. "Do Not Disturb").';
            case 'Unassigned': return 'Tasks sitting in the queue picked up by no one.';
            case 'Time Critical': return 'Active tasks running out of time.';
            default: return '';
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-[#0f172a] h-full shadow-2xl p-6 overflow-y-auto border-l border-slate-800 animate-slide-in-right">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <AlertTriangle className="text-amber-500" size={24} />
                            Risk Analysis
                        </h2>
                        <p className="text-sm text-slate-400">
                            Breakdown of <span className="text-amber-400 font-bold">{totalAtRisk}</span> tickets currently at risk.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                        <ArrowDownRight className="rotate-[-135deg]" size={24} />
                    </button>
                </div>

                {/* Main Bar Chart */}
                <div className="mb-8 p-6 bg-[#151A25] rounded-xl border border-slate-800/50">
                    <h3 className="text-sm font-semibold text-slate-200 mb-4">Risk Factors</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="risk_category"
                                    type="category"
                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    width={100}
                                />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs">
                                                    <div className="font-bold text-white">{d.risk_category}</div>
                                                    <div className="text-slate-300">{d.ticket_count} Tickets</div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="ticket_count" barSize={32} radius={[0, 4, 4, 0]}>
                                    {riskData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={getCategoryColor(entry.risk_category)} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Detailed Explanations */}
                <div className="space-y-4">
                    {riskData.map((row) => (
                        <div key={row.risk_category} className="p-4 rounded-lg bg-[#151A25] border border-slate-800/50 flex items-start gap-4">
                            <div className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(row.risk_category) }} />
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-bold text-slate-200">{row.risk_category}</h4>
                                    <span className="text-xs font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">
                                        {row.ticket_count}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500">
                                    {getCategoryDescription(row.risk_category)}
                                </p>
                            </div>
                        </div>
                    ))}
                    {riskData.length === 0 && (
                        <div className="text-center text-slate-500 italic py-8">
                            No active tickets are currently at risk. Good job!
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
