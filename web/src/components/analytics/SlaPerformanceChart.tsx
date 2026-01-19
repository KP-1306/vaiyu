// web/src/components/analytics/SlaPerformanceChart.tsx
// SLA Performance trend chart for Owner Dashboard

import { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';

interface SlaDataPoint {
    date: string;
    compliance: number;
    breached: number;
    total: number;
}

interface Props {
    data: SlaDataPoint[];
    loading?: boolean;
}

export default function SlaPerformanceChart({ data, loading }: Props) {
    const chartData = useMemo(() => {
        if (!data || data.length === 0) {
            // Generate mock data for last 7 days if no real data
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            return days.map((day, i) => ({
                date: day,
                compliance: 85 + Math.random() * 15,
                breached: Math.floor(Math.random() * 5),
                total: 10 + Math.floor(Math.random() * 20),
            }));
        }
        return data;
    }, [data]);

    if (loading) {
        return (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500">
                Loading SLA data...
            </div>
        );
    }

    return (
        <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <defs>
                        <linearGradient id="slaGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                        content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const value = payload[0].value as number;
                            return (
                                <div className="rounded-lg border bg-white px-3 py-2 shadow-lg">
                                    <div className="text-xs font-medium text-slate-700">{label}</div>
                                    <div className="text-sm font-semibold text-emerald-600">
                                        {value.toFixed(1)}% SLA Compliance
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Area
                        type="monotone"
                        dataKey="compliance"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#slaGradient)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
