// web/src/components/analytics/TaskVolumeChart.tsx
// Task volume by hour chart for Owner Dashboard

import { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    Cell
} from 'recharts';

interface TaskVolumePoint {
    hour: number;
    count: number;
    label: string;
}

interface Props {
    data: TaskVolumePoint[];
    loading?: boolean;
}

export default function TaskVolumeChart({ data, loading }: Props) {
    const chartData = useMemo(() => {
        if (!data || data.length === 0) {
            // Generate mock data for 24 hours
            return Array.from({ length: 12 }, (_, i) => {
                const hour = 8 + i; // 8 AM to 8 PM
                return {
                    hour,
                    label: `${hour}:00`,
                    count: Math.floor(Math.random() * 15) + 2,
                };
            });
        }
        return data;
    }, [data]);

    if (loading) {
        return (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500">
                Loading task data...
            </div>
        );
    }

    return (
        <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 8, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        angle={-45}
                        textAnchor="end"
                    />
                    <YAxis
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        cursor={{ fill: '#f1f5f9' }}
                        content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const value = payload[0].value as number;
                            return (
                                <div className="rounded-lg border bg-white px-3 py-2 shadow-lg">
                                    <div className="text-xs font-medium text-slate-700">{label}</div>
                                    <div className="text-sm font-semibold text-slate-900">
                                        {value} Tasks
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill="#3b82f6" fillOpacity={0.8} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
