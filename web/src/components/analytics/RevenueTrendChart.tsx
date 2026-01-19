
import {
    Bar,
    BarChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

type Props = {
    data: { date: string; revenue: number }[];
    loading?: boolean;
};

export default function RevenueTrendChart({ data, loading }: Props) {
    if (loading) {
        return (
            <div className="flex h-24 items-center justify-center rounded-xl bg-slate-50">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex h-24 items-center justify-center rounded-xl bg-slate-50 text-[10px] text-slate-400">
                No revenue data
            </div>
        );
    }

    return (
        <div className="h-24 w-full rounded-xl bg-slate-50/50 p-2">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barCategoryGap={2}>
                    <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={false}
                        height={0}
                    />
                    <YAxis hide />
                    <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        contentStyle={{
                            fontSize: "10px",
                            borderRadius: "4px",
                            border: "none",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                            padding: "4px 8px",
                        }}
                        formatter={(value: number) => [`₹${value}`, "Revenue"]}
                    />
                    <Bar
                        dataKey="revenue"
                        fill="#10b981" // emerald-500
                        radius={[2, 2, 0, 0]}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
