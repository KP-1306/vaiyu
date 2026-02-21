// web/src/routes/OwnerArrivals.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
    Check,
    Search,
    ChevronDown,
    Bed,
    Users,
    AlertCircle,
    User,
    Calendar,
    ArrowRight,
    Filter,
    KeyRound,
    CheckCircle2,
    RefreshCw,
    MoreVertical,
    X,
    MoreHorizontal,
    Clock,
    ChevronRight
} from 'lucide-react';
import { SimpleTooltip } from "../components/SimpleTooltip";
import FolioDrawer from "../components/FolioDrawer";
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
    arrival_operational_state: "CHECKED_IN" | "PARTIALLY_ARRIVED" | "WAITING_HOUSEKEEPING" | "WAITING_ROOM_ASSIGNMENT" | "READY_TO_CHECKIN" | "EXPECTED" | "NO_ROOMS";
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
    room_type_ids: string[];
    room_numbers: string | null;
}

type DateFilter = "TODAY" | "TOMORROW" | "LATE" | "CUSTOM" | "ALL";

/* ─────── components ─────── */

const MetricCard = ({ label, count, color, icon }: { label: string, count: number, color: string, icon: any }) => (
    <div className={`p-4 rounded-xl text-white shadow-lg ${color} flex justify-between items-center transform transition hover:scale-[1.02]`}>
        <div>
            <span className="block text-xs font-bold opacity-90 uppercase tracking-wider">{label}</span>
            <span className="text-3xl font-extrabold mt-1 block">{count}</span>
        </div>
        <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
            {icon}
        </div>
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
    const baseClasses = "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border shadow-sm";

    if (state === "ARRIVED") return (
        <SimpleTooltip content="Arrived (Waiting): The guest has arrived at the property and is waiting for their check-in process to complete.">
            <span className={`${baseClasses} bg-orange-50 text-orange-700 border-orange-200`}>Arrived, Waiting...</span>
        </SimpleTooltip>
    );
    if (state === "PARTIALLY_ARRIVED") return (
        <SimpleTooltip content="Partially Arrived: Some rooms in the booking are checked in, while others are still expected.">
            <span className={`${baseClasses} bg-orange-50 text-orange-600 border-orange-200`}>Partially Arrived</span>
        </SimpleTooltip>
    );
    if (state === "WAITING_HOUSEKEEPING") return (
        <SimpleTooltip content="Waiting Housekeeping: The guest can't check in yet because their assigned room(s) are still being cleaned.">
            <span className={`${baseClasses} bg-blue-50 text-blue-700 border-blue-200`}>Waiting Housekeeping</span>
        </SimpleTooltip>
    );
    if (state === "WAITING_ROOM_ASSIGNMENT") return (
        <SimpleTooltip content="Waiting Allocation: A physical room number hasn't been assigned to this booking yet.">
            <span className={`${baseClasses} bg-yellow-50 text-yellow-700 border-yellow-200`}>Waiting Allocation</span>
        </SimpleTooltip>
    );
    if (state === "CHECKED_IN") return (
        <SimpleTooltip content="Checked In: The guest has successfully checked in to all rooms in their booking.">
            <span className={`${baseClasses} bg-indigo-50 text-indigo-700 border-indigo-200 font-bold gap-1.5`}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Checked In
            </span>
        </SimpleTooltip>
    );
    if (state === "NO_ROOMS") return (
        <SimpleTooltip content="No Rooms: This booking currently has zero rooms. This is likely an administrative entry.">
            <span className={`${baseClasses} bg-red-50 text-red-700 border-red-200`}>No Rooms</span>
        </SimpleTooltip>
    );

    // Ready
    return (
        <SimpleTooltip content="Ready: All rooms are assigned and clean. The guest is ready for check-in.">
            <span className={`${baseClasses} bg-emerald-50 text-emerald-700 border-emerald-200 gap-1.5`}>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Ready
            </span>
        </SimpleTooltip>
    );
};

const RoomReadyBadge = ({ clean, dirty, inspected, total }: { clean: number, dirty: number, inspected: number, total: number }) => {
    // "Button" look: Solid colors, rounded-md, shadow-sm, white text
    if (dirty > 0) {
        return (
            <SimpleTooltip content={`${dirty} assigned room(s) are currently dirty and need housekeeping attention.`}>
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-red-50 text-red-600 border border-red-200 min-w-[70px]">
                    {dirty} Dirty
                </span>
            </SimpleTooltip>
        );
    }
    if (clean === total && total > 0) {
        return (
            <SimpleTooltip content="All assigned rooms are clean and ready for the guest.">
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 min-w-[70px]">
                    Clean
                </span>
            </SimpleTooltip>
        );
    }
    return (
        <SimpleTooltip content={total > 0 && clean === 0 ? "No rooms are ready yet. This is usually because no physical rooms have been assigned to the booking." : `${clean} of ${total} rooms are currently ready.`}>
            <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-bold bg-gray-50 text-gray-600 border border-gray-200 min-w-[70px]">
                {clean}/{total} Ready
            </span>
        </SimpleTooltip>
    );
};

/* ─────── main component ─────── */

export default function OwnerArrivals() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [arrivals, setArrivals] = useState<OperationalArrival[]>([]);
    const [selectedFolioArrival, setSelectedFolioArrival] = useState<OperationalArrival | null>(null);
    // Room Type State
    const [roomTypes, setRoomTypes] = useState<{ id: string, name: string }[]>([]);
    const [roomTypeFilter, setRoomTypeFilter] = useState<string | null>(null);

    // Fetch Room Types
    useEffect(() => {
        if (!hotelId) return;
        (async () => {
            const { data } = await supabase
                .from('room_types')
                .select('id, name')
                .eq('hotel_id', hotelId)
                .eq('is_active', true)
                .order('name', { ascending: true });
            if (data) setRoomTypes(data);
        })();
    }, [hotelId]);

    // UI State
    const [dateFilter, setDateFilter] = useState<DateFilter>("TODAY");
    const [customFromDate, setCustomFromDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [customToDate, setCustomToDate] = useState<string>(new Date().toISOString().split('T')[0]);
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
            // Determine Operational Date Range
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const endOfDay = new Date(startOfDay);
            endOfDay.setDate(endOfDay.getDate() + 1); // Next day 00:00

            let query = supabase
                .from("v_arrival_dashboard_rows")
                .select("*")
                .eq("hotel_id", hotelId)
                .order("scheduled_checkin_at", { ascending: true });

            // Backend Date Filtering
            if (dateFilter === "TODAY") {
                const todayStr = startOfDay.toISOString();
                const tomorrowStr = endOfDay.toISOString();
                query = query.gte("scheduled_checkin_at", todayStr).lt("scheduled_checkin_at", tomorrowStr);
            } else if (dateFilter === "TOMORROW") {
                const tmrStart = new Date(endOfDay);
                const tmrEnd = new Date(tmrStart);
                tmrEnd.setDate(tmrEnd.getDate() + 1);
                query = query.gte("scheduled_checkin_at", tmrStart.toISOString()).lt("scheduled_checkin_at", tmrEnd.toISOString());
            } else if (dateFilter === "LATE") {
                // Late: Scheduled < Now AND Not Arrived
                query = query.lt("scheduled_checkin_at", now.toISOString())
                    .not("arrival_operational_state", "in", "(PARTIALLY_ARRIVED,CHECKED_IN)");
            } else if (dateFilter === "CUSTOM") {
                const start = new Date(customFromDate);
                const end = new Date(customToDate);
                end.setDate(end.getDate() + 1); // Include the end date fully
                query = query.gte("scheduled_checkin_at", start.toISOString()).lt("scheduled_checkin_at", end.toISOString());
            } else if (dateFilter === "ALL") {
                // No date filter applied - show all future and past arrivals
            }

            const { data, error } = await query;
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

    }, [hotelId, dateFilter, customFromDate, customToDate]);

    // Global Filtered Data (Affects KPI, Timeline, AND List)
    const contextArrivals = useMemo(() => {
        let rows = arrivals;
        // Room Type Filter (Global Scope)
        if (roomTypeFilter) {
            rows = rows.filter(r => {
                const ids = r.room_type_ids;
                return Array.isArray(ids) && ids.includes(roomTypeFilter);
            });
        }
        return rows;
    }, [arrivals, roomTypeFilter]);

    // Stats (Driven by Context)
    const stats = useMemo(() => ({
        total: contextArrivals.length,
        arrived: contextArrivals.filter(a => a.arrival_operational_state === "CHECKED_IN" || a.arrival_operational_state === "PARTIALLY_ARRIVED").length,
        ready: contextArrivals.filter(a => a.arrival_operational_state === "READY_TO_CHECKIN").length,
        preChecked: contextArrivals.filter(a => a.booking_status === "PRE_CHECKED_IN").length,

        // Quick Filters - Enterprise Contract
        waitingRoom: contextArrivals.filter(a => a.arrival_operational_state === "WAITING_ROOM_ASSIGNMENT").length,
        paymentPending: contextArrivals.filter(a => a.payment_pending).length,
        vip: contextArrivals.filter(a => a.vip_flag).length
    }), [contextArrivals]);

    // Timeline Data (Driven by Context)
    const timelineData = useMemo(() => {
        // Range: 06:00 to 22:00 (16 hours)
        const hours = Array.from({ length: 17 }, (_, i) => 6 + i);
        return hours.map(h => {
            const hourRows = contextArrivals.filter(a => {
                const d = new Date(a.scheduled_checkin_at);
                return d.getHours() === h;
            });

            const arrived = hourRows.filter(a => ["PARTIALLY_ARRIVED", "CHECKED_IN"].includes(a.arrival_operational_state)).length;
            const expected = hourRows.length - arrived;

            return {
                hour: `${h}:00`,
                arrived,
                expected,
                total: hourRows.length
            };
        });
    }, [contextArrivals]);

    // List Filtering (Status Drill-down)
    const filteredList = useMemo(() => {
        let rows = contextArrivals; // Start with global context
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter(r => r.guest_name.toLowerCase().includes(q) || r.booking_code.toLowerCase().includes(q));
        }

        // Status Filter Mapping
        if (statusFilter === "EXPECTED") rows = rows.filter(r => r.arrival_operational_state === "EXPECTED");
        if (statusFilter === "WAITING_HOUSEKEEPING") rows = rows.filter(r => r.arrival_operational_state === "WAITING_HOUSEKEEPING");
        if (statusFilter === "WAITING_ROOM") rows = rows.filter(r => r.arrival_operational_state === "WAITING_ROOM_ASSIGNMENT");
        if (statusFilter === "READY") rows = rows.filter(r => r.arrival_operational_state === "READY_TO_CHECKIN");
        if (statusFilter === "PARTIALLY_ARRIVED") rows = rows.filter(r => r.arrival_operational_state === "PARTIALLY_ARRIVED");
        if (statusFilter === "ARRIVED") rows = rows.filter(r => ["PARTIALLY_ARRIVED", "CHECKED_IN"].includes(r.arrival_operational_state));
        if (statusFilter === "NO_ROOMS") rows = rows.filter(r => r.arrival_operational_state === "NO_ROOMS");

        return rows;
    }, [contextArrivals, search, statusFilter]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const flattenedRows = filteredList; // Rename for clarity
    const pageSize = 5;
    const totalPages = Math.ceil(flattenedRows.length / pageSize);

    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return flattenedRows.slice(start, start + pageSize);
    }, [flattenedRows, currentPage]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [search, statusFilter, roomTypeFilter]);

    if (loading) return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;

    return (
        <div className="min-h-screen bg-gray-50 p-6 space-y-5 font-sans">

            {/* Header & Actions */}
            <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 tracking-tight">
                        Morning Arrivals <span className="text-gray-400 font-normal">– {dateFilter === "TODAY" ? "Today" : dateFilter === "TOMORROW" ? "Tomorrow" : dateFilter === "LATE" ? "Late" : "Custom"}</span>
                    </h1>
                </div>

                <div className="flex gap-3">
                    <button className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition">
                        <Bed className="w-4 h-4 text-gray-500" /> Bulk Assign Rooms
                    </button>
                    <button className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-sm transition">
                        <Check className="w-4 h-4 text-gray-500" /> Send Reminder
                    </button>
                    <button className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2 shadow-md transition transform active:scale-95">
                        + Bulk Check-In
                    </button>
                </div>
            </div>

            {/* Premium Filter Toolbar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200/60 p-1 mb-6">
                <div className="flex flex-col md:flex-row items-center gap-2">

                    {/* Primary Search - Expanded on Mobile */}
                    <div className="relative w-full md:w-64 lg:w-72 group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search guest or booking..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2.5 border-none rounded-lg bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all text-sm font-medium"
                        />
                    </div>

                    {/* Divider (Desktop) */}
                    <div className="hidden md:block h-6 w-px bg-gray-200 mx-1"></div>

                    {/* Filters Container - Horizontal Scroll on Mobile if needed, or Wrap */}
                    <div className="flex flex-1 items-center gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">

                        {/* Date Filter Group */}
                        <div className="flex items-center bg-gray-50 rounded-lg p-1 border border-gray-100">
                            <select
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                                className="bg-transparent text-sm font-semibold text-gray-700 py-1.5 pl-3 pr-8 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer hover:text-indigo-600 transition-colors"
                                style={{ backgroundImage: 'none' }}
                            >
                                <option value="TODAY">Today</option>
                                <option value="TOMORROW">Tomorrow</option>
                                <option value="LATE">Late Arrivals</option>
                                <option value="CUSTOM">Custom Range</option>
                                <option value="ALL">All Dates</option>
                            </select>
                            {/* Custom Chevron since we removed default arrow */}
                            <ChevronDown className="w-3 h-3 text-gray-400 -ml-6 mr-2 pointer-events-none" />

                            {dateFilter === 'CUSTOM' && (
                                <div className="flex items-center gap-1 pl-2 border-l border-gray-200">
                                    <input
                                        type="date"
                                        value={customFromDate}
                                        onChange={(e) => setCustomFromDate(e.target.value)}
                                        className="bg-white border text-gray-600 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
                                    />
                                    <span className="text-gray-400">-</span>
                                    <input
                                        type="date"
                                        value={customToDate}
                                        onChange={(e) => setCustomToDate(e.target.value)}
                                        className="bg-white border text-gray-600 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 transition-colors shadow-sm"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Status Filter */}
                        <div className="relative group">
                            <select
                                value={statusFilter || ""}
                                onChange={(e) => setStatusFilter(e.target.value || null)}
                                className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 pl-3 pr-8 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 hover:border-gray-300 transition-colors cursor-pointer min-w-[140px]"
                            >
                                <option value="">All Status</option>
                                <option value="EXPECTED">Expected</option>
                                <option value="WAITING_HOUSEKEEPING">Waiting HK</option>
                                <option value="WAITING_ROOM">Assignment Fail</option>
                                <option value="READY">Ready</option>
                                <option value="PARTIALLY_ARRIVED">Partial</option>
                                <option value="ARRIVED">Checked In</option>
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-3 pointer-events-none group-hover:text-gray-600 transition-colors" />
                        </div>

                        {/* Room Type Filter */}
                        <div className="relative group">
                            <select
                                value={roomTypeFilter || ""}
                                onChange={(e) => setRoomTypeFilter(e.target.value || null)}
                                className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 pl-3 pr-8 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 hover:border-gray-300 transition-colors cursor-pointer min-w-[140px] max-w-[200px] truncate"
                            >
                                <option value="">All Room Types</option>
                                {roomTypes.map(rt => (
                                    <option key={rt.id} value={rt.id}>{rt.name}</option>
                                ))}
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-3 pointer-events-none group-hover:text-gray-600 transition-colors" />
                        </div>

                        {/* Reset Filter Button */}
                        {(search || statusFilter || roomTypeFilter || dateFilter !== "TODAY") && (
                            <button
                                onClick={() => {
                                    setSearch("");
                                    setStatusFilter(null);
                                    setRoomTypeFilter(null);
                                    setDateFilter("TODAY");
                                }}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-500 hover:text-indigo-600 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" /> Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Arrival Timeline (06:00 - 22:00)</h3>
                    <div className="flex gap-4 text-xs font-medium text-gray-500">
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Arrived</span>
                        <span className="flex items-center gap-1"><div className="w-3 h-3 bg-gray-300 rounded-sm"></div> Expected</span>
                    </div>
                </div>
                <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={timelineData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }} barSize={20}>
                            <XAxis
                                dataKey="hour"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#9ca3af' }}
                                interval={1}
                            />
                            <Tooltip
                                cursor={{ fill: '#f9fafb', opacity: 0.5 }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', fontSize: '12px' }}
                            />
                            {/* Stacked Bars */}
                            <Bar dataKey="arrived" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} />
                            <Bar dataKey="expected" stackId="a" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-4 gap-5">
                <MetricCard
                    label="Total Arrivals"
                    count={stats.total}
                    color="bg-gradient-to-br from-blue-500 to-blue-600"
                    icon={<Users className="w-6 h-6 text-white" />}
                />
                <MetricCard
                    label="Arrived"
                    count={stats.arrived}
                    color="bg-gradient-to-br from-orange-400 to-orange-500"
                    icon={<Check className="w-6 h-6 text-white" />}
                />
                <MetricCard
                    label="Ready to Check-In"
                    count={stats.ready}
                    color="bg-gradient-to-br from-emerald-500 to-emerald-600"
                    icon={<Bed className="w-6 h-6 text-white" />}
                />
                <MetricCard
                    label="Pre-Checked-In"
                    count={stats.preChecked}
                    color="bg-gradient-to-br from-teal-500 to-teal-600"
                    icon={<Clock className="w-6 h-6 text-white" />}
                />
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
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Balance</th>
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
                                    {row.room_numbers ? (
                                        <span className="text-gray-900 font-medium text-sm">{row.room_numbers}</span>
                                    ) : (
                                        <span className="text-gray-400 text-sm">—</span>
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

                                {/* Balance */}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {row.pending_amount > 0 ? (
                                        <div className="bg-[#5c2423] text-[#e37e7b] border border-[#a6403d] px-2 py-1 rounded text-xs font-bold tracking-wide inline-flex items-center">
                                            ₹ {row.pending_amount.toLocaleString('en-IN')} Due
                                        </div>
                                    ) : (
                                        <span className="text-gray-400 text-sm font-medium">—</span>
                                    )}
                                </td>

                                {/* Actions */}
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <div className="flex items-center justify-end gap-2">

                                        <button
                                            onClick={() => setSelectedFolioArrival(row)}
                                            className={`${row.pending_amount > 0 ? "bg-gradient-to-br from-[#CD955B] to-[#AD763D] text-white shadow-md border-transparent hover:shadow-lg" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"} px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap`}
                                        >
                                            {row.pending_amount > 0 ? "Collect Payment" : "Settle / Folio"}
                                        </button>

                                        {row.primary_action === "CHECKIN" && (
                                            <button
                                                onClick={() => navigate(`/checkin/booking?code=${row.booking_code}`)}
                                                className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 shadow-sm transition-all flex items-center gap-2"
                                            >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Check-In
                                            </button>
                                        )}
                                        {row.primary_action === "WAIT_HOUSEKEEPING" && (
                                            <button className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-all flex items-center gap-2">
                                                <RefreshCw className="w-3.5 h-3.5" /> Check Room
                                            </button>
                                        )}
                                        {row.primary_action === "ASSIGN_ROOM" && (
                                            <button className="bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-lg text-xs font-bold hover:bg-amber-100 transition-all flex items-center gap-2">
                                                <KeyRound className="w-3.5 h-3.5" /> Assign
                                            </button>
                                        )}
                                        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                            <MoreVertical className="w-4 h-4" />
                                        </button>
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

            <FolioDrawer
                isOpen={!!selectedFolioArrival}
                onClose={() => setSelectedFolioArrival(null)}
                arrival={selectedFolioArrival}
            />
        </div>
    );
}
