
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type Props = {
    data: { date: string; occupancyPct: number }[];
    loading?: boolean;
};

export default function OccupancyTrendChart({ data, loading }: Props) {
    if (loading) {
        return (
            <div className="flex h-[120px] items-center justify-center rounded-lg bg-slate-50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex h-[120px] items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">
                No occupancy data
            </div>
        );
    }

    return (
        <div className="h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="colorOcc" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        interval="preserveStartEnd"
                    />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: "#fff",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                            fontSize: "12px",
                        }}
                        cursor={{ stroke: "#e2e8f0" }}
                    />
                    <Area
                        type="monotone"
                        dataKey="occupancyPct"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorOcc)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
