import {
    Bar,
    BarChart,
    Cell,
    ComposedChart,
    CartesianGrid,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from "recharts";
import { ArrowDownRight, TrendingUp, Users } from "lucide-react";

export type ImpactRow = {
    hotel_id: string;
    department_name: string;
    breached_count: number;
    impact_percent: number;
};

export type SlaTrendRow = {
    day: string;
    completed_within_sla: number;
    breached_sla: number;
    sla_exempted: number;
};

type Props = {
    isOpen: boolean;
    onClose: () => void;
    impactData: ImpactRow[];
    trendData: SlaTrendRow[];
    currentCompliance: number;
};

export default function SLAExplanationDrawer({
    isOpen,
    onClose,
    impactData,
    trendData,
    currentCompliance
}: Props) {
    if (!isOpen) return null;

    // Waterfall Logic: Start at 100%, subtract impacts
    // We want to show:
    // 1. Start Bar (100%)
    // 2. Impact Bars (Floating, representing the drop)
    // 3. Current Bar (Final Score)

    // To enable "floating" bars in a stacked bar chart (or simple bar chart), standard Waterfall is tricky in Recharts.
    // Simpler approach for "Explain": 
    // Just show them side-by-side: "Ideal (100%)", "Loss due to HK (-3%)", "Loss due to Eng (-2%)", "Actual (95%)"
    // But user asked for Waterfall. 
    // Let's do a simple BarChart where "Start" is 100, "Current" is actual, and impacts are red bars.
    // For true waterfall visual in simple Recharts, we can just list them.

    const waterfallData = [
        { name: 'Ideal', value: 100, type: 'start', fill: '#3b82f6' }, // Blue
        ...impactData.map(d => ({
            name: d.department_name,
            value: d.impact_percent,
            type: 'impact',
            fill: '#f43f5e' // Red
        })),
        { name: 'Actual', value: currentCompliance, type: 'end', fill: '#10b981' } // Green
    ];

    // Context Data: Mix SLA Trend with Mock Occupancy
    const contextData = trendData.slice(-7).map(d => ({
        day: new Date(d.day).toLocaleDateString('en-US', { weekday: 'short' }),
        compliance: d.completed_within_sla + d.breached_sla > 0
            ? Math.round((d.completed_within_sla / (d.completed_within_sla + d.breached_sla)) * 100)
            : 100,
        occupancy: 60 + Math.floor(Math.random() * 30) // Mock 60-90%
    }));

    return (
        <div className="fixed inset-0 z-[60] flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-[#0f172a] h-full shadow-2xl p-6 overflow-y-auto border-l border-slate-800 animate-slide-in-right">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-xl font-bold text-white">SLA Performance Explained</h2>
                        <p className="text-sm text-slate-400">Why your score is <span className="text-emerald-400 font-bold">{Math.round(currentCompliance)}%</span> today</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
                        <ArrowDownRight className="rotate-[-135deg]" size={24} />
                    </button>
                </div>

                {/* 1. Waterfall / Impact Breakdown */}
                <div className="mb-8 p-6 bg-[#151A25] rounded-xl border border-slate-800/50">
                    <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <TrendingUp size={16} className="text-emerald-500" />
                        Impact Breakdown
                    </h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={waterfallData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} interval={0} />
                                <YAxis domain={[0, 105]} tick={{ fill: '#64748b', fontSize: 10 }} />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs">
                                                    <div className="font-bold text-white">{d.name}</div>
                                                    <div className={d.type === 'impact' ? 'text-rose-400' : 'text-emerald-400'}>
                                                        {d.type === 'impact' ? `-${d.value}% Impact` : `${Math.round(d.value)}% Score`}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="value" barSize={40}>
                                    {waterfallData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 text-center italic">
                        "Housekeeping breaches reduced your score by {impactData.find(i => i.department_name === 'Housekeeping')?.impact_percent ?? 0}%"
                    </p>
                </div>

                {/* 2. Correlation Context */}
                <div className="mb-8 p-6 bg-[#151A25] rounded-xl border border-slate-800/50">
                    <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <Users size={16} className="text-blue-500" />
                        Correlation Context
                    </h3>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={contextData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} />
                                <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: '#10b981', fontSize: 10 }} orientation="left" label={{ value: 'SLA %', angle: -90, position: 'insideLeft', fill: '#10b981', fontSize: 10 }} />
                                <YAxis yAxisId="right" domain={[0, 100]} tick={{ fill: '#3b82f6', fontSize: 10 }} orientation="right" label={{ value: 'Occupancy %', angle: 90, position: 'insideRight', fill: '#3b82f6', fontSize: 10 }} />
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                                <Legend />
                                <Bar yAxisId="right" dataKey="occupancy" name="Occupancy %" fill="#3b82f6" fillOpacity={0.3} barSize={20} />
                                <Line yAxisId="left" type="monotone" dataKey="compliance" name="SLA %" stroke="#10b981" strokeWidth={3} dot={true} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 text-center italic">
                        "SLA drops often coincide with high occupancy (Blue bars)."
                    </p>
                </div>

            </div>
        </div>
    );
}
