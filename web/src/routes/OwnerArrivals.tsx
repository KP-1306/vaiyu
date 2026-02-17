// web/src/routes/OwnerArrivals.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Search, User, Users, Bed, Check, Clock, AlertCircle, ChevronRight, Filter } from "lucide-react";

/* ─────── types ─────── */

interface OperationalArrival {
    booking_id: string;
    hotel_id: string;
    booking_code: string;
    guest_name: string;
    phone: string | null;
    booking_status: string;
    scheduled_checkin_at: string;
    scheduled_checkout_at: string;
    rooms_total: number;
    rooms_checked_in: number;
    rooms_unassigned: number;
    rooms_dirty: number;
    rooms_clean: number;
    inhouse_rooms: number;
    arrival_operational_state: "ARRIVED" | "PARTIALLY_ARRIVED" | "WAITING_HOUSEKEEPING" | "WAITING_ROOM_ASSIGNMENT" | "READY_TO_CHECKIN" | "EXPECTED";
    rooms_ready_for_arrival: boolean;
    primary_action: "CHECKIN" | "ASSIGN_ROOM" | "WAIT_HOUSEKEEPING" | "NONE";
    minutes_since_scheduled_arrival: number | null;
    urgency_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    eligible_for_bulk_checkin: boolean;
    // New Enterprise Fields
    payment_pending: boolean;
    pending_amount: number;
    arrival_badge: "VIP" | "OTA" | "DIRECT";
    vip_flag: boolean;
    cleaning_minutes_remaining: number | null;
}

/* ─────── components ─────── */

const MetricCard = ({ label, count, color }: { label: string, count: number, color: string }) => (
    <div className={`p-4 rounded-lg text-white shadow-md ${color} flex justify-between items-center`}>
        <span className="font-semibold text-sm">{label}</span>
        <span className="text-2xl font-bold">{count}</span>
    </div>
);

const QuickFilterPill = ({ label, count, icon, color, active, onClick }: { label: string, count: number, icon: any, color: string, active?: boolean, onClick?: () => void }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-all shadow-sm
        ${active ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
    >
        {active ? <Check className="w-3.5 h-3.5 text-white" /> : icon}
        <span className={active ? 'text-white' : ''}>{label}</span>
        <span className={`${active ? 'text-gray-300' : color} font-bold ml-1`}>{count}</span>
    </button>
);

const StatusBadge = ({ state, urgency }: { state: string, urgency: string }) => {
    if (state === "ARRIVED") return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Arrived, Waiting...</span>;
    if (state === "PARTIALLY_ARRIVED") return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-600">Partially Arrived</span>;
    if (state === "WAITING_HOUSEKEEPING") return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">Waiting Housekeeping</span>;
    if (state === "WAITING_ROOM_ASSIGNMENT") return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700">Waiting Allocation</span>;

    // Ready
    return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Ready
        </span>
    );
};

const RoomReadyBadge = ({ clean, dirty, inspected, total }: { clean: number, dirty: number, inspected: number, total: number }) => {
    // "Button" look: Solid colors, rounded-md, shadow-sm, white text
    if (dirty > 0) {
        return (
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-red-500 text-white shadow-sm min-w-[70px]">
                Dirty
            </span>
        );
    }
    if (clean === total && total > 0) {
        return (
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-emerald-600 text-white shadow-sm min-w-[70px]">
                Clean
            </span>
        );
    }
    return (
        <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 min-w-[70px]">
            {clean}/{total} Ready
        </span>
    );
};

/* ─────── main component ─────── */

export default function OwnerArrivals() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [arrivals, setArrivals] = useState<OperationalArrival[]>([]);

    // UI State
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    // Initial load
    useEffect(() => {
        if (!slug) return;
        (async () => {
            const { data } = await supabase.from("hotels").select("id").eq("slug", slug).single();
            if (data) setHotelId(data.id);
        })();
    }, [slug]);

    // Data Fetching
    useEffect(() => {
        if (!hotelId) return;
        setLoading(true);

        const fetchDashboard = async () => {
            // Enterprise Contract: v_arrival_dashboard_rows
            const { data, error } = await supabase
                .from("v_arrival_dashboard_rows")
                .select("*")
                .eq("hotel_id", hotelId)
                .order("scheduled_checkin_at", { ascending: true });

            if (data) setArrivals(data);
            setLoading(false);
        };

        fetchDashboard();

        const subscription = supabase
            .channel('public:arrivals')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetchDashboard)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_rooms' }, fetchDashboard)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'stays' }, fetchDashboard)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchDashboard) // Added rooms for HK updates
            // Listen to enterprise tables too if needed, but core triggers cover most
            .subscribe();

        return () => { supabase.removeChannel(subscription); };

    }, [hotelId]);

    // Stats
    const stats = useMemo(() => ({
        total: arrivals.length,
        arrived: arrivals.filter(a => a.arrival_operational_state === "ARRIVED" || a.arrival_operational_state === "PARTIALLY_ARRIVED").length,
        ready: arrivals.filter(a => a.arrival_operational_state === "READY_TO_CHECKIN").length,
        preChecked: arrivals.filter(a => a.booking_status === "PRE_CHECKED_IN").length,

        // Quick Filters - Enterprise Contract
        waitingRoom: arrivals.filter(a => a.arrival_operational_state === "WAITING_ROOM_ASSIGNMENT").length,
        paymentPending: arrivals.filter(a => a.payment_pending).length,
        vip: arrivals.filter(a => a.vip_flag).length
    }), [arrivals]);

    // Timeline Data (Distribution by Hour)
    const timelineData = useMemo(() => {
        const hours = Array.from({ length: 9 }, (_, i) => 8 + i); // 08:00 to 16:00
        return hours.map(h => {
            const count = arrivals.filter(a => {
                const d = new Date(a.scheduled_checkin_at);
                return d.getHours() === h;
            }).length;
            return { hour: `${h}:00`, count };
        });
    }, [arrivals]);

    // Filtering
    const filtered = useMemo(() => {
        let rows = arrivals;
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter(r => r.guest_name.toLowerCase().includes(q) || r.booking_code.toLowerCase().includes(q));
        }
        if (statusFilter === "READY") rows = rows.filter(r => r.arrival_operational_state === "READY_TO_CHECKIN");
        if (statusFilter === "WAITING_ROOM") rows = rows.filter(r => r.arrival_operational_state === "WAITING_ROOM_ASSIGNMENT");
        if (statusFilter === "PAYMENT_PENDING") rows = rows.filter(r => r.payment_pending);
        if (statusFilter === "VIP") rows = rows.filter(r => r.vip_flag);

        return rows;
    }, [arrivals, search, statusFilter]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const flattenedRows = filtered; // Rename for clarity
    const pageSize = 5;
    const totalPages = Math.ceil(flattenedRows.length / pageSize);

    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return flattenedRows.slice(start, start + pageSize);
    }, [flattenedRows, currentPage]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [search, statusFilter]);

    if (loading) return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;

    return (
        <div className="min-h-screen bg-gray-50 p-6 space-y-5 font-sans">

            {/* Header & Actions */}
            <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 tracking-tight">
                        Morning Arrivals <span className="text-gray-400 font-normal">– Today</span>
                    </h1>
                </div>
                <div className="flex gap-3">
                    <button className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition">
                        <Bed className="w-4 h-4 text-gray-500" /> Bulk Assign Rooms
                    </button>
                    <button className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition">
                        <Check className="w-4 h-4 text-gray-500" /> Send Pre-Check-In Reminder
                    </button>
                    <button className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2 shadow-md transition transform active:scale-95">
                        + Bulk Check-In
                    </button>
                </div>
            </div>

            {/* Filters & Search - Styled like design bar */}
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center">
                <div className="flex gap-6">
                    <div className="flex items-center gap-3 text-sm text-gray-600 font-medium">
                        Date: <span className="font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-md cursor-pointer hover:bg-gray-200 transition">Today</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-600 font-medium">
                        Status: <span className="font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-md cursor-pointer hover:bg-gray-200 transition">All</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-600 font-medium">
                        Room Type: <span className="font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-md cursor-pointer hover:bg-gray-200 transition">All</span>
                    </div>
                </div>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search Guest or Booking Ref"
                        className="pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm w-72 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Timeline */}
            <div className="bg-white pt-5 pb-1 px-5 rounded-xl border border-gray-200 shadow-sm h-28">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timelineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barSize={32}>
                        <Tooltip
                            cursor={{ fill: '#f3f4f6', radius: 4 }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                        />
                        <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af', fontWeight: 500 }} dy={-5} />
                        <Bar dataKey="count" radius={[4, 4, 4, 4]}>
                            {timelineData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#60a5fa' : '#f3f4f6'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-4 gap-5">
                <MetricCard label="Total Arrivals" count={stats.total} color="bg-blue-600" />
                <MetricCard label="Arrived" count={stats.arrived} color="bg-orange-400" />
                <MetricCard label="Ready to Check-In" count={stats.ready} color="bg-emerald-600" />
                <MetricCard label="Pre-Checked-In" count={stats.preChecked} color="bg-teal-600" />
            </div>

            {/* Quick Filter Pills */}
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                <QuickFilterPill
                    label="Ready to Check-In"
                    count={stats.ready}
                    icon={<Check className="w-3.5 h-3.5" />}
                    color="text-emerald-600"
                    active={statusFilter === "READY"}
                    onClick={() => setStatusFilter(statusFilter === "READY" ? null : "READY")}
                />
                <QuickFilterPill
                    label="Waiting Room Assignment"
                    count={stats.waitingRoom}
                    icon={<Bed className="w-3.5 h-3.5" />}
                    color="text-orange-500"
                    active={statusFilter === "WAITING_ROOM"}
                    onClick={() => setStatusFilter(statusFilter === "WAITING_ROOM" ? null : "WAITING_ROOM")}
                />
                <QuickFilterPill
                    label="Payment Pending"
                    count={stats.paymentPending}
                    icon={<AlertCircle className="w-3.5 h-3.5" />}
                    color="text-red-500"
                    active={statusFilter === "PAYMENT_PENDING"}
                    onClick={() => setStatusFilter(statusFilter === "PAYMENT_PENDING" ? null : "PAYMENT_PENDING")}
                />
                <QuickFilterPill
                    label="VIP Today"
                    count={stats.vip}
                    icon={<User className="w-3.5 h-3.5" />}
                    color="text-purple-500"
                    active={statusFilter === "VIP"}
                    onClick={() => setStatusFilter(statusFilter === "VIP" ? null : "VIP")}
                />
            </div>

            {/* Table */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Guest</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Booking Ref</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Arrival Time</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Rooms / Guests</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Room</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Room Ready</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Rooms Checked-In</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {paginatedRows.map(row => (
                            <tr key={row.booking_id} className="hover:bg-blue-50/30 transition group">
                                {/* Guest */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-sm shadow-sm relative">
                                            {row.guest_name.charAt(0)}
                                            {/* VIP Badge on Avatar */}
                                            {row.vip_flag && (
                                                <div className="absolute -top-1 -right-1 bg-purple-600 text-white text-[9px] font-bold px-1 rounded-full border border-white">
                                                    VIP
                                                </div>
                                            )}
                                        </div>
                                        <div className="ml-3">
                                            <div className="text-sm font-bold text-gray-900">{row.guest_name}</div>
                                            {/* Badges */}
                                            <div className="flex gap-1.5 mt-1">
                                                {row.arrival_badge === "VIP" && (
                                                    <span className="bg-purple-50 text-purple-600 border border-purple-100 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                        VIP
                                                    </span>
                                                )}
                                                {row.arrival_badge === "OTA" && (
                                                    <span className="bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                        OTA
                                                    </span>
                                                )}
                                                {row.urgency_level === "CRITICAL" && (
                                                    <span className="bg-red-50 text-red-600 border border-red-100 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                                                        <AlertCircle className="w-2.5 h-2.5" /> Late
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </td>

                                {/* Booking Ref */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-blue-600 font-semibold text-sm cursor-pointer hover:underline">
                                        {row.booking_code}
                                    </span>
                                </td>

                                {/* Arrival Time */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">
                                        {new Date(row.scheduled_checkin_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </td>

                                {/* Rooms / Guests */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="inline-flex items-center gap-3 text-sm text-gray-700 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                                        <div className="flex items-center gap-1.5 font-medium">
                                            {row.rooms_total} <Bed className="w-3.5 h-3.5 text-gray-400" />
                                        </div>
                                        <span className="text-gray-300">|</span>
                                        <div className="flex items-center gap-1.5 font-medium">
                                            {row.rooms_total * 2} <Users className="w-3.5 h-3.5 text-gray-400" />
                                        </div>
                                    </div>
                                </td>

                                {/* Status */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <StatusBadge state={row.arrival_operational_state} urgency={row.urgency_level} />
                                </td>

                                {/* Room */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {row.rooms_unassigned > 0 ? (
                                        <span className="text-gray-400 text-sm">—</span>
                                    ) : (
                                        <span className="text-gray-900 font-medium text-sm">104</span>
                                    )}
                                </td>

                                {/* Room Ready - The Button Look + HK ETA */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex flex-col gap-1 items-start">
                                        <RoomReadyBadge
                                            clean={row.rooms_clean}
                                            dirty={row.rooms_dirty}
                                            inspected={0}
                                            total={row.rooms_total}
                                        />
                                        {/* HK ETA Badge */}
                                        {row.cleaning_minutes_remaining !== null && row.rooms_dirty > 0 && (
                                            <span className="text-[10px] font-medium text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-100 flex items-center gap-1">
                                                Cleaning - {Math.round(row.cleaning_minutes_remaining)}m left
                                            </span>
                                        )}
                                        {/* Fallback mock for demo if no data */}
                                        {row.rooms_dirty > 0 && row.cleaning_minutes_remaining === null && (
                                            <span className="text-[10px] font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100 flex items-center gap-1">
                                                Cleaning...
                                            </span>
                                        )}
                                    </div>
                                </td>

                                {/* Checks */}
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-600 pl-8">
                                    {row.rooms_checked_in} <span className="text-gray-400 text-xs">/ {row.rooms_total}</span>
                                </td>

                                {/* Actions */}
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        {/* Payment Pending Indicator */}
                                        {row.payment_pending && (
                                            <span className="text-xs font-bold text-gray-500 border border-gray-200 px-2 py-1 rounded bg-gray-50">
                                                Paid <span className="text-gray-300">?</span>
                                            </span>
                                        )}

                                        {row.primary_action === "CHECKIN" && (
                                            <button
                                                onClick={() => navigate(`/checkin/booking?code=${row.booking_code}`)}
                                                className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-md transition transform active:scale-95"
                                            >
                                                Check-In
                                            </button>
                                        )}
                                        {row.primary_action === "WAIT_HOUSEKEEPING" && (
                                            <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 shadow-md transition transform active:scale-95">
                                                Check Room
                                            </button>
                                        )}
                                        {row.primary_action === "ASSIGN_ROOM" && (
                                            <button className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 shadow-sm transition">
                                                Assign
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Pagination Footer */}
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        Showing <span className="font-medium">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(currentPage * pageSize, flattenedRows.length)}</span> of <span className="font-medium">{flattenedRows.length}</span> entries
                    </div>
                    <div className="flex gap-1">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1 border border-gray-300 rounded bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Prev
                        </button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            // Simple pagination logic for demo
                            // (In real app, complex windowing needed if > 5 pages)
                            let p = i + 1;
                            return (
                                <button
                                    key={p}
                                    onClick={() => setCurrentPage(p)}
                                    className={`px-3 py-1 border rounded text-sm font-medium ${currentPage === p
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                                        }`}
                                >
                                    {p}
                                </button>
                            );
                        })}
                        {totalPages > 5 && <span className="px-2 text-gray-400">...</span>}
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1 border border-gray-300 rounded bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
