// web/src/routes/OwnerArrivals.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
    AlertCircle,
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ArrowUpDown,
    Bed,
    Calendar,
    Check,
    CheckCircle2,
    ChevronDown,
    Download,
    Filter,
    KeyRound,
    RefreshCw,
    MoreVertical,
    X,
    MoreHorizontal,
    Clock,
    ChevronRight,
    Search,
    User,
    Users,
    BarChart2
} from 'lucide-react';
import { SimpleTooltip } from "../components/SimpleTooltip";
import FolioDrawer from "../components/FolioDrawer";
import "./guestnew/guestnew.css";
import "./arrivals.css";
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
    arrival_operational_state: "CHECKED_IN" | "PARTIALLY_ARRIVED" | "WAITING_HOUSEKEEPING" | "WAITING_ROOM_ASSIGNMENT" | "READY_TO_CHECKIN" | "EXPECTED" | "NO_ROOMS" | "CHECKOUT_REQUESTED";
    rooms_ready_for_arrival: boolean;
    primary_action: "CHECKIN" | "ASSIGN_ROOM" | "WAIT_HOUSEKEEPING" | "NONE";
    minutes_since_scheduled_arrival: number | null;
    urgency_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    eligible_for_bulk_checkin: boolean;
    // New Enterprise Fields
    payment_pending: boolean;
    pending_amount: number;
    total_amount: number;
    paid_amount: number;
    arrival_badge: "VIP" | "OTA" | "DIRECT";
    vip_flag: boolean;
    cleaning_minutes_remaining: number | null;
    room_type_ids: string[];
    room_numbers: string | null;
    active_stay_id?: string | null;
}

type DateFilter = "TODAY" | "TOMORROW" | "LATE" | "CUSTOM" | "ALL";

/* ─────── components ─────── */

const MetricCard = ({ label, count, color, icon, onClick }: { label: string, count: number, color: string, icon: any, onClick?: () => void }) => (
    <div
        onClick={onClick}
        className={`p-5 rounded-2xl text-white shadow-xl ${color} flex justify-between items-center transform transition hover:scale-[1.03] hover:shadow-2xl ${onClick ? 'cursor-pointer' : ''}`}
    >
        <div>
            <span className="block text-xs font-bold opacity-80 uppercase tracking-widest">{label}</span>
            <span className="text-4xl font-black mt-1 block">{count}</span>
        </div>
        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-md border border-white/10">
            {icon}
        </div>
    </div>
);

const QuickFilterPill = ({ label, count, icon, color, active, onClick }: { label: string, count: number, icon: any, color: string, active?: boolean, onClick?: () => void }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2.5 px-4 py-2 rounded-full border text-xs font-bold whitespace-nowrap transition-all duration-300
        ${active
                ? 'bg-gradient-to-r from-[var(--gold-400)] to-[var(--gold-600)] text-black border-[var(--gold-300)] shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-gold)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'}`}
    >
        {active ? <Check className="w-3.5 h-3.5 text-black" /> : icon}
        <span>{label}</span>
        <span className={`${active ? 'text-black/70' : color} font-black ml-1`}>{count}</span>
    </button>
);

const StatusBadge = ({ state, urgency }: { state: string, urgency: string }) => {
    const baseClasses = "inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-bold border shadow-sm uppercase tracking-wider";

    if (state === "ARRIVED") return (
        <SimpleTooltip content="Arrived (Waiting): The guest has arrived at the property and is waiting for their check-in process to complete.">
            <span className={`${baseClasses} bg-orange-500/10 text-orange-400 border-orange-500/20`}>Arrived, Waiting...</span>
        </SimpleTooltip>
    );
    if (state === "CHECKOUT_REQUESTED") return (
        <SimpleTooltip content="Checkout Requested: The guest has requested to check out. Review folios and approve.">
            <span className={`${baseClasses} bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold gap-1.5`}>
                Checkout Requested
            </span>
        </SimpleTooltip>
    );
    if (state === "PARTIALLY_ARRIVED") return (
        <SimpleTooltip content="Partially Arrived: Some rooms in the booking are checked in, while others are still expected.">
            <span className={`${baseClasses} bg-orange-400/10 text-orange-300 border-orange-400/20`}>Partially Arrived</span>
        </SimpleTooltip>
    );
    if (state === "WAITING_HOUSEKEEPING") return (
        <SimpleTooltip content="Waiting Housekeeping: The guest can't check in yet because their assigned room(s) are still being cleaned.">
            <span className={`${baseClasses} bg-blue-500/10 text-blue-400 border-blue-500/20`}>Waiting Housekeeping</span>
        </SimpleTooltip>
    );
    if (state === "WAITING_ROOM_ASSIGNMENT") return (
        <SimpleTooltip content="Waiting Allocation: A physical room number hasn't been assigned to this booking yet.">
            <span className={`${baseClasses} bg-yellow-500/10 text-yellow-400 border-yellow-500/20`}>Waiting Allocation</span>
        </SimpleTooltip>
    );
    if (state === "CHECKED_IN") return (
        <SimpleTooltip content="Checked In: The guest has successfully checked in to all rooms in their booking.">
            <span className={`${baseClasses} bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold gap-1.5`}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Checked In
            </span>
        </SimpleTooltip>
    );
    if (state === "NO_ROOMS") return (
        <SimpleTooltip content="No Rooms: This booking currently has zero rooms. This is likely an administrative entry.">
            <span className={`${baseClasses} bg-red-500/10 text-red-400 border-red-500/20`}>No Rooms</span>
        </SimpleTooltip>
    );

    // Ready
    return (
        <SimpleTooltip content="Ready: All rooms are assigned and clean. The guest is ready for check-in.">
            <span className={`${baseClasses} bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1.5`}>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div> Ready
            </span>
        </SimpleTooltip>
    );
};

const RoomReadyBadge = ({ clean, dirty, inspected, total }: { clean: number, dirty: number, inspected: number, total: number }) => {
    // "Button" look: Solid colors, rounded-md, shadow-sm, white text
    if (dirty > 0) {
        return (
            <SimpleTooltip content={`${dirty} assigned room(s) are currently dirty and need housekeeping attention.`}>
                <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 min-w-[70px] uppercase tracking-wider">
                    {dirty} Dirty
                </span>
            </SimpleTooltip>
        );
    }
    if (clean === total && total > 0) {
        return (
            <SimpleTooltip content="All assigned rooms are clean and ready for the guest.">
                <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 min-w-[70px] uppercase tracking-wider">
                    Clean
                </span>
            </SimpleTooltip>
        );
    }
    return (
        <SimpleTooltip content={total > 0 && clean === 0 ? "No rooms are ready yet. This is usually because no physical rooms have been assigned to the booking." : `${clean} of ${total} rooms are currently ready.`}>
            <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[10px] font-bold bg-gray-500/10 text-gray-400 border border-gray-500/20 min-w-[70px] uppercase tracking-wider">
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

    // Approval State
    const [approvingCheckout, setApprovingCheckout] = useState<string | null>(null);

    const handleApproveCheckout = async (row: OperationalArrival) => {
        if (!row.active_stay_id) return;
        setApprovingCheckout(row.booking_id);
        try {
            const { error } = await supabase.rpc('checkout_stay', {
                p_hotel_id: row.hotel_id,
                p_booking_id: row.booking_id,
                p_stay_id: row.active_stay_id,
                p_force: row.pending_amount > 0
            });
            if (error) {
                console.error("Error approving checkout:", error);
                alert("Failed to approve checkout: " + error.message);
            } else {
                alert(`Checkout successfully approved for Room ${row.room_numbers || "Unassigned"}.`);
                fetchDashboard(); // Immediate refresh after success
            }
        } catch (err) {
            console.error(err);
        } finally {
            setApprovingCheckout(null);
        }
    };

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
    const [guestSearch, setGuestSearch] = useState("");
    const [refSearch, setRefSearch] = useState("");
    const [roomSearch, setRoomSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'scheduled_checkin_at', direction: 'asc' });

    // Google-Level Architectural State
    const [selectedTimelineLabel, setSelectedTimelineLabel] = useState<string | null>(null);
    const [visibleSeries, setVisibleSeries] = useState({ arrived: true, expected: true });
    const [showPhase2Modal, setShowPhase2Modal] = useState(false);

    // Initial load
    useEffect(() => {
        if (!slug) return;
        (async () => {
            const { data } = await supabase.from("hotels").select("id").eq("slug", slug).single();
            if (data) setHotelId(data.id);
        })();
    }, [slug]);

    // CSV Export Logic
    const exportToCSV = () => {
        const headers = ["Guest", "Booking Ref", "Arrival Time", "Rooms", "Status", "Room Number", "Balance"];
        const rows = filteredList.map(r => [
            `"${(r.guest_name || "").replace(/"/g, '""')}"`,
            `"${(r.booking_code || "").replace(/"/g, '""')}"`,
            `"${new Date(r.scheduled_checkin_at).toLocaleString().replace(/"/g, '""')}"`,
            r.rooms_total,
            `"${(r.arrival_operational_state || "").replace(/"/g, '""')}"`,
            `"${(r.room_numbers || "—").replace(/"/g, '""')}"`,
            r.pending_amount || 0
        ]);

        const csvContent = [headers.map(h => `"${h}"`).join(","), ...rows.map(row => row.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `arrivals_report_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Sorting Helper
    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current?.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };
    const fetchDashboard = useCallback(async () => {
        if (!hotelId) return;
        setLoading(true);

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
            query = query.lt("scheduled_checkin_at", now.toISOString())
                .not("arrival_operational_state", "in", "(PARTIALLY_ARRIVED,CHECKED_IN)");
        } else if (dateFilter === "CUSTOM") {
            const start = new Date(customFromDate);
            const end = new Date(customToDate);
            end.setDate(end.getDate() + 1);
            query = query.gte("scheduled_checkin_at", start.toISOString()).lt("scheduled_checkin_at", end.toISOString());
        }

        const { data } = await query;
        if (data) setArrivals(data);
        setLoading(false);
    }, [hotelId, dateFilter, customFromDate, customToDate]);

    // Initial Load & Filters
    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

    // Real-time Subscriptions
    useEffect(() => {
        if (!hotelId) return;

        const subscription = supabase
            .channel('public:arrivals')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => fetchDashboard())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_rooms' }, () => fetchDashboard())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'stays' }, () => fetchDashboard())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchDashboard())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => fetchDashboard())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'folio_entries' }, () => fetchDashboard())
            .subscribe();

        return () => { supabase.removeChannel(subscription); };
    }, [hotelId, fetchDashboard]);

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
        vip: contextArrivals.filter(a => a.vip_flag).length,
        checkoutRequested: contextArrivals.filter(a => a.arrival_operational_state === "CHECKOUT_REQUESTED").length
    }), [contextArrivals]);

    // Timeline Data (Driven by Context)
    const timelineData = useMemo(() => {
        const isMultiDay = dateFilter === "ALL" || dateFilter === "CUSTOM" || dateFilter === "LATE";
        
        if (isMultiDay) {
            // Aggregate by Date
            const dateMap: Record<string, { arrived: number, expected: number, total: number }> = {};
            const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

            contextArrivals.forEach(a => {
                const d = new Date(a.scheduled_checkin_at);
                const label = formatter.format(d);
                if (!dateMap[label]) {
                    dateMap[label] = { arrived: 0, expected: 0, total: 0 };
                }
                if (["PARTIALLY_ARRIVED", "CHECKED_IN"].includes(a.arrival_operational_state)) {
                    dateMap[label].arrived += 1;
                } else {
                    dateMap[label].expected += 1;
                }
                dateMap[label].total += 1;
            });

            return Object.entries(dateMap).sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()).map(([label, stats]) => ({
                label,
                ...stats,
                isDetail: true
            }));
        }

        // Default: Range: 06:00 to 22:00 (Hourly)
        const hours = Array.from({ length: 17 }, (_, i) => 6 + i);
        return hours.map(h => {
            const hourRows = contextArrivals.filter(a => {
                const d = new Date(a.scheduled_checkin_at);
                return d.getHours() === h;
            });

            const arrived = hourRows.filter(a => ["PARTIALLY_ARRIVED", "CHECKED_IN"].includes(a.arrival_operational_state)).length;
            const expected = hourRows.length - arrived;

            return {
                label: `${h}:00`,
                arrived,
                expected,
                total: hourRows.length
            };
        });
    }, [contextArrivals, dateFilter]);

    // Dynamic Peak Insight Logic
    const peakInsight = useMemo(() => {
        if (!timelineData.length) return null;
        const filteredData = timelineData.filter(d => d.total > 0);
        if (!filteredData.length) return null;

        return filteredData.reduce((prev, curr) => (curr.total > prev.total ? curr : prev));
    }, [timelineData]);

    // List Filtering (Robust, character-sensitive filter)
    const filteredList = useMemo(() => {
        let rows = [...contextArrivals];

        // 1. Timeline Drill-down
        if (selectedTimelineLabel) {
            const isMultiDay = dateFilter === "ALL" || dateFilter === "CUSTOM" || dateFilter === "LATE";
            const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
            rows = rows.filter(r => {
                const d = new Date(r.scheduled_checkin_at);
                const label = isMultiDay ? formatter.format(d) : `${d.getHours()}:00`;
                return label === selectedTimelineLabel;
            });
        }

        // 2. Global Search (Any character)
        const qSearch = search.toLowerCase();
        if (qSearch) {
            rows = rows.filter(r => 
                (r.guest_name || "").toLowerCase().includes(qSearch) || 
                (r.booking_code || "").toLowerCase().includes(qSearch)
            );
        }

        // 3. Column-Specific Searches - Immediate Feedback
        const qGuest = guestSearch.toLowerCase();
        if (qGuest) {
            rows = rows.filter(r => (r.guest_name || "").toLowerCase().includes(qGuest));
        }

        const qRef = refSearch.toLowerCase();
        if (qRef) {
            rows = rows.filter(r => (r.booking_code || "").toLowerCase().includes(qRef));
        }

        const qRoom = roomSearch.toLowerCase();
        if (qRoom) {
            rows = rows.filter(r => (r.room_numbers || "").toLowerCase().includes(qRoom));
        }

        // Status Filter Mapping
        if (statusFilter === "EXPECTED") rows = rows.filter(r => r.arrival_operational_state === "EXPECTED");
        else if (statusFilter === "WAITING_HOUSEKEEPING") rows = rows.filter(r => r.arrival_operational_state === "WAITING_HOUSEKEEPING");
        else if (statusFilter === "WAITING_ROOM") rows = rows.filter(r => r.arrival_operational_state === "WAITING_ROOM_ASSIGNMENT");
        else if (statusFilter === "READY") rows = rows.filter(r => r.arrival_operational_state === "READY_TO_CHECKIN");
        else if (statusFilter === "PARTIALLY_ARRIVED") rows = rows.filter(r => r.arrival_operational_state === "PARTIALLY_ARRIVED");
        else if (statusFilter === "ARRIVED") rows = rows.filter(r => ["PARTIALLY_ARRIVED", "CHECKED_IN"].includes(r.arrival_operational_state));
        else if (statusFilter === "CHECKOUT_REQUESTED") rows = rows.filter(r => r.arrival_operational_state === "CHECKOUT_REQUESTED");
        else if (statusFilter === "NO_ROOMS") rows = rows.filter(r => r.arrival_operational_state === "NO_ROOMS");
        else if (statusFilter === "PAYMENT_PENDING") rows = rows.filter(r => r.payment_pending);
        else if (statusFilter === "VIP") rows = rows.filter(r => r.vip_flag);
        else if (statusFilter === "PRE_CHECKED") rows = rows.filter(r => r.booking_status === "PRE_CHECKED_IN");
        // 4. Sorting logic
        if (sortConfig) {
            rows.sort((a, b) => {
                let aVal: any = a[sortConfig.key as keyof typeof a];
                let bVal: any = b[sortConfig.key as keyof typeof b];

                // Null safety
                if (aVal === null || aVal === undefined) aVal = "";
                if (bVal === null || bVal === undefined) bVal = "";

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return rows;
    }, [contextArrivals, search, guestSearch, refSearch, roomSearch, statusFilter, selectedTimelineLabel, dateFilter, sortConfig]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const flattenedRows = filteredList; // Rename for clarity
    const pageSize = 10;
    const totalPages = Math.ceil(flattenedRows.length / pageSize);

    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return flattenedRows.slice(start, start + pageSize);
    }, [flattenedRows, currentPage]);

    // Reset page on filter change
    useEffect(() => { setCurrentPage(1); }, [search, guestSearch, refSearch, statusFilter, roomTypeFilter, selectedTimelineLabel]);

    // Reset drill-down when date filter changes
    useEffect(() => { setSelectedTimelineLabel(null); }, [dateFilter, hotelId]);

    // Custom Tooltip for Timeline
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const arrived = payload.find((p: any) => p.dataKey === "arrived")?.value || 0;
            const expected = payload.find((p: any) => p.dataKey === "expected")?.value || 0;
            return (
                <div className="gn-card p-4 backdrop-blur-xl border border-[var(--border-gold)]/30 shadow-[0_20px_40px_rgba(0,0,0,0.6)] min-w-[140px]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-3 border-b border-[var(--border-subtle)] pb-2">
                        {label}
                    </p>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center gap-4">
                            <span className="text-[10px] font-bold text-[var(--text-gold)] uppercase tracking-wider flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-[var(--gold-400)] rounded-full"></div>
                                Arrived
                            </span>
                            <span className="text-sm font-black text-[var(--text-gold)]">{arrived}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                            <span className="text-[10px] font-bold text-[var(--text-gold)]/40 uppercase tracking-wider flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-[var(--gold-400)]/20 rounded-full border border-[var(--gold-400)]/30"></div>
                                Expected
                            </span>
                            <span className="text-sm font-black text-[var(--text-gold)]/40">{expected}</span>
                        </div>
                        <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex justify-between items-center">
                            <span className="text-[9px] font-black text-[var(--text-muted)] uppercase">Total</span>
                            <span className="text-xs font-black text-[var(--text-primary)]">
                                {Number(arrived) + Number(expected)}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;

    const getFormattedDateHeader = () => {
        const today = new Date();
        const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

        if (dateFilter === "TODAY") {
            return formatter.format(today);
        } else if (dateFilter === "TOMORROW") {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return formatter.format(tomorrow);
        } else if (dateFilter === "LATE") {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return `Before ${formatter.format(today)}`;
        } else if (dateFilter === "CUSTOM") {
            if (customFromDate && customToDate) {
                return `${formatter.format(new Date(customFromDate))} - ${formatter.format(new Date(customToDate))}`;
            }
            return "Custom Range";
        } else {
            return "All Dates";
        }
    };

    // Helper component for rendering a single arrival row
    const ArrivalRow = ({ arrival, onFolioOpen, onApproveCheckout, approvingCheckout }: {
        arrival: OperationalArrival;
        onFolioOpen: (arrival: OperationalArrival) => void;
        onApproveCheckout: (arrival: OperationalArrival) => void;
        approvingCheckout: boolean;
    }) => (
        <tr key={arrival.booking_id} className="hover:bg-[var(--gold-400)]/5 transition-all group">
            {/* Guest */}
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                    <div className="h-11 w-11 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-gold)] font-black text-base shadow-inner relative overflow-hidden group-hover:border-[var(--border-gold)] transition-colors">
                        <div className="absolute inset-0 bg-gradient-to-br from-[var(--gold-400)]/10 to-transparent"></div>
                        <span className="relative z-10">{arrival.guest_name.charAt(0)}</span>
                        {/* VIP Badge on Avatar */}
                        {arrival.vip_flag && (
                            <div className="absolute -top-1 -right-1 bg-gradient-to-r from-purple-500 to-purple-700 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full border border-black z-20 shadow-lg">
                                VIP
                            </div>
                        )}
                    </div>
                    <div className="ml-4">
                        <div className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--text-gold)] transition-colors">{arrival.guest_name}</div>
                        {/* Badges */}
                        <div className="flex gap-2 mt-1.5">
                            {arrival.arrival_badge === "VIP" && (
                                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[9px] font-black px-2 py-0.5 rounded tracking-widest uppercase">
                                    VIP
                                </span>
                            )}
                            {arrival.arrival_badge === "OTA" && (
                                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-black px-2 py-0.5 rounded tracking-widest uppercase">
                                    OTA
                                </span>
                            )}
                            {arrival.urgency_level === "CRITICAL" && (
                                <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] font-black px-2 py-0.5 rounded flex items-center gap-1 tracking-widest uppercase">
                                    <AlertCircle className="w-2.5 h-2.5" /> Late
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </td>

            {/* Booking Ref */}
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="text-[var(--text-gold)] font-black text-xs tracking-wider cursor-pointer hover:underline bg-[var(--gold-400)]/5 px-2 py-1 rounded border border-[var(--border-gold)]/10">
                    {arrival.booking_code}
                </span>
            </td>

            {/* Arrival Time */}
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-xs font-bold text-[var(--text-primary)]">
                    {dateFilter === "TODAY" || dateFilter === "TOMORROW" ? (
                        new Date(arrival.scheduled_checkin_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    ) : (
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--text-secondary)]">{new Date(arrival.scheduled_checkin_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            <span className="text-[var(--text-muted)]">•</span>
                            <span className="text-[var(--text-gold)]">{new Date(arrival.scheduled_checkin_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
                </div>
            </td>

            {/* Rooms / Guests */}
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="inline-flex items-center gap-4 text-xs text-[var(--text-secondary)] bg-white/5 px-3 py-2 rounded-xl border border-[var(--border-subtle)] shadow-inner">
                    <div className="flex items-center gap-2 font-black text-[var(--text-primary)]">
                        {arrival.rooms_total} <Bed className="w-4 h-4 text-[var(--text-gold)]" />
                    </div>
                    <span className="text-white/10">|</span>
                    <div className="flex items-center gap-2 font-black text-[var(--text-primary)]">
                        {arrival.rooms_total * 2} <Users className="w-4 h-4 text-[var(--text-gold)]" />
                    </div>
                </div>
            </td>

            {/* Status */}
            <td className="px-6 py-4 whitespace-nowrap">
                <StatusBadge state={arrival.arrival_operational_state} urgency={arrival.urgency_level} />
            </td>

            {/* Room */}
            <td className="px-6 py-4 whitespace-nowrap">
                {arrival.room_numbers ? (
                    <span className="text-[var(--text-primary)] font-bold text-sm tracking-tight bg-white/5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]">{arrival.room_numbers}</span>
                ) : (
                    <span className="text-[var(--text-muted)] text-sm">—</span>
                )}
            </td>

            {/* Room Ready */}
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col gap-1.5 items-start">
                    <RoomReadyBadge
                        clean={arrival.rooms_clean}
                        dirty={arrival.rooms_dirty}
                        inspected={0}
                        total={arrival.rooms_total}
                    />
                    {arrival.cleaning_minutes_remaining !== null && arrival.rooms_dirty > 0 && (
                        <span className="text-[9px] font-black text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 flex items-center gap-1 uppercase tracking-widest">
                            Cleaning - {Math.round(arrival.cleaning_minutes_remaining)}m left
                        </span>
                    )}
                    {arrival.rooms_dirty > 0 && arrival.cleaning_minutes_remaining === null && (
                        <span className="text-[9px] font-black text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20 flex items-center gap-1 uppercase tracking-widest">
                            Cleaning...
                        </span>
                    )}
                </div>
            </td>

            {/* Balance */}
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col gap-1.5 items-start">
                    {(arrival.pending_amount || 0) <= 0 && (arrival.total_amount || 0) > 0 ? (
                        <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg text-[9px] font-black tracking-widest inline-flex items-center gap-1.5 shadow-sm uppercase">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> PAID
                        </span>
                    ) : (arrival.pending_amount || 0) > 0 && (arrival.paid_amount || 0) > 0 ? (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1.5 rounded-lg text-[9px] font-black tracking-widest inline-flex items-center gap-1.5 shadow-sm uppercase">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div> PARTIAL
                            <span className="ml-1 opacity-80 font-bold tracking-normal text-xs text-white/90">₹{(arrival.pending_amount || 0).toLocaleString('en-IN')}</span>
                        </span>
                    ) : (arrival.pending_amount || 0) > 0 ? (
                        <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1.5 rounded-lg text-[9px] font-black tracking-widest inline-flex items-center gap-1.5 shadow-sm uppercase">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></div> UNPAID
                            <span className="ml-1 opacity-80 font-bold tracking-normal text-xs text-white/90">₹{(arrival.pending_amount || 0).toLocaleString('en-IN')}</span>
                        </span>
                    ) : (
                        <span className="text-[var(--text-muted)] text-sm font-medium">—</span>
                    )}
                </div>
            </td>

            {/* Actions */}
            <td className="px-6 py-4 whitespace-nowrap text-right sticky right-0 bg-[#0a0a10] group-hover:bg-[#15151a] shadow-[-10px_0_20px_rgba(0,0,0,0.5)] z-20 transition-all">
                <div className="flex items-center justify-end gap-2.5">
                    <button
                        onClick={() => onFolioOpen(arrival)}
                        className={`gn-btn ${arrival.pending_amount > 0 ? "gn-btn--primary" : "gn-btn--secondary"} px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-all`}
                    >
                        {arrival.pending_amount > 0 ? "Collect" : "Folio"}
                    </button>

                    {arrival.arrival_operational_state === "CHECKOUT_REQUESTED" && (
                        <button
                            onClick={() => onApproveCheckout(arrival)}
                            disabled={approvingCheckout}
                            className={`gn-btn ${arrival.pending_amount > 0 ? 'bg-red-500/20 text-red-400 border-red-500/30 font-black hover:bg-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-black hover:bg-emerald-500/30'} px-4 py-2 text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5 disabled:opacity-50 transition-all`}
                        >
                            {approvingCheckout ? <RefreshCw className="w-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            {arrival.pending_amount > 0 ? "Force Checkout" : "Approve"}
                        </button>
                    )}

                    {arrival.primary_action === "CHECKIN" && (
                        <button
                            onClick={() => navigate(`/checkin/booking?code=${arrival.booking_code}`)}
                            className="gn-btn gn-btn--primary px-4 py-2 text-[11px] font-black uppercase tracking-widest flex items-center gap-2"
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Check-In
                        </button>
                    )}

                    <button className="p-2 text-[var(--text-muted)] hover:text-[var(--text-gold)] hover:bg-white/5 rounded-full transition-all">
                        <MoreVertical className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );


    return (
        <div className="arrivals-board min-h-screen font-sans">
            <div className="arrivals-board-content p-6 space-y-6">

                {/* Header & Actions */}
                <div className="flex justify-between items-center gn-card p-6 shadow-2xl">
                    <div>
                        <h1 className="text-3xl font-black text-[var(--text-primary)] flex items-center gap-3 tracking-tighter">
                            Morning Arrivals <span className="text-[var(--text-gold)] text-xl font-light italic">– {getFormattedDateHeader()}</span>
                        </h1>
                    </div>

                    <div className="flex gap-4">
                        <button 
                            onClick={() => fetchDashboard()} 
                            className="gn-btn gn-btn--secondary gn-btn-icon border border-[var(--border-gold)]/30 hover:shadow-[0_0_20px_rgba(212,175,55,0.15)]"
                            title="Refresh Data"
                        >
                            <RefreshCw className={`w-5 h-5 text-[var(--text-gold)] ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button 
                            onClick={exportToCSV}
                            className="gn-btn gn-btn--secondary border border-[var(--border-gold)]/30 hover:shadow-[0_0_20px_rgba(212,175,55,0.15)]"
                        >
                            <Download className="w-4 h-4 text-[var(--text-gold)]" /> Export CSV
                        </button>
                        <button 
                            onClick={() => {
                                console.log("Phase 2 clicked!");
                                setShowPhase2Modal(true);
                            }}
                            className="gn-btn gn-btn--secondary border border-[var(--border-gold)]/10 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                        >
                            <Bed className="w-4 h-4 text-[var(--text-gold)]" /> Bulk Assign Rooms
                        </button>
                        <button 
                            onClick={() => setShowPhase2Modal(true)}
                            className="gn-btn gn-btn--secondary border border-[var(--border-gold)]/10 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                        >
                            <Check className="w-4 h-4 text-[var(--text-gold)]" /> Send Reminder
                        </button>
                        <button 
                            onClick={() => setShowPhase2Modal(true)}
                            className="gn-btn gn-btn--primary px-8 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                        >
                            <span className="text-lg">+</span> Bulk Check-In
                        </button>
                    </div>
                </div>

                {/* Premium Filter Toolbar */}
                <div className="gn-card p-2 shadow-xl">
                    <div className="flex flex-col md:flex-row items-center gap-3">

                        {/* Primary Search */}
                        <div className="relative w-full md:w-80 group">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <Search className="h-4 w-4 text-[var(--text-muted)] group-focus-within:text-[var(--text-gold)] transition-colors" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search guest or booking code..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="block w-full pl-11 pr-4 py-3 border-none rounded-xl bg-white/5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]/30 focus:bg-white/10 transition-all text-sm font-semibold"
                            />
                        </div>

                        <div className="hidden md:block h-8 w-px bg-[var(--border-subtle)] mx-1"></div>

                        <div className="flex flex-1 items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 gn-scrollbar">

                            {/* Date Filter Group */}
                            <div className="relative group">
                                <select
                                    value={dateFilter}
                                    onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                                    className="gn-filter-select py-3 pl-4 pr-10 min-w-[180px] font-bold"
                                >
                                    {(() => {
                                        const today = new Date();
                                        const tomorrow = new Date(today);
                                        tomorrow.setDate(tomorrow.getDate() + 1);
                                        const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

                                        return (
                                            <>
                                                <option value="TODAY">Today ({formatter.format(today)})</option>
                                                <option value="TOMORROW">Tomorrow ({formatter.format(tomorrow)})</option>
                                                <option value="LATE">Late (Before {formatter.format(today)})</option>
                                                <option value="CUSTOM">Custom Range</option>
                                                <option value="ALL">All Dates</option>
                                            </>
                                        );
                                    })()}
                                </select>

                                {dateFilter === 'CUSTOM' && (
                                    <div className="flex items-center gap-2 ml-2 p-1 bg-white/5 rounded-xl border border-[var(--border-subtle)]">
                                        <input
                                            type="date"
                                            value={customFromDate}
                                            onChange={(e) => setCustomFromDate(e.target.value)}
                                            className="bg-transparent border-none text-[var(--text-primary)] text-xs rounded px-2 py-1.5 focus:outline-none"
                                        />
                                        <span className="text-[var(--text-muted)]">-</span>
                                        <input
                                            type="date"
                                            value={customToDate}
                                            onChange={(e) => setCustomToDate(e.target.value)}
                                            className="bg-transparent border-none text-[var(--text-primary)] text-xs rounded px-2 py-1.5 focus:outline-none"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Status Filter */}
                            <div className="relative group">
                                <select
                                    value={statusFilter || ""}
                                    onChange={(e) => setStatusFilter(e.target.value || null)}
                                    className="gn-filter-select py-3 pl-4 pr-10 min-w-[160px] font-bold"
                                >
                                    <option value="">All Status</option>
                                    <option value="EXPECTED">Expected</option>
                                    <option value="WAITING_HOUSEKEEPING">Waiting HK</option>
                                    <option value="WAITING_ROOM">Assignment Fail</option>
                                    <option value="READY">Ready</option>
                                    <option value="PARTIALLY_ARRIVED">Partial</option>
                                    <option value="ARRIVED">Checked In</option>
                                    <option value="CHECKOUT_REQUESTED">Checkout Requested</option>
                                </select>
                            </div>

                            {/* Room Type Filter */}
                            <div className="relative group">
                                <select
                                    value={roomTypeFilter || ""}
                                    onChange={(e) => setRoomTypeFilter(e.target.value || null)}
                                    className="gn-filter-select py-3 pl-4 pr-10 min-w-[180px] max-w-[240px] truncate font-bold"
                                >
                                    <option value="">All Room Types</option>
                                    {roomTypes.map(rt => (
                                        <option key={rt.id} value={rt.id}>{rt.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Reset Filter Button */}
                            {(search || statusFilter || roomTypeFilter || dateFilter !== "TODAY") && (
                                <button
                                    onClick={() => {
                                        setSearch("");
                                        setGuestSearch("");
                                        setRefSearch("");
                                        setRoomSearch("");
                                        setStatusFilter(null);
                                        setRoomTypeFilter(null);
                                        setDateFilter("TODAY");
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 text-xs font-black text-[var(--text-gold)] hover:text-[var(--gold-300)] transition-colors uppercase tracking-widest"
                                >
                                    <X className="w-4 h-4" /> Clear Filters
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Timeline */}
                <div className="gn-card p-6 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold-400)]/5 blur-3xl rounded-full -mr-16 -mt-16 transition-all group-hover:bg-[var(--gold-400)]/10"></div>

                    <div className="flex justify-between items-center mb-6 relative z-10">
                        <h3 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] flex items-center gap-3">
                            {dateFilter === "TODAY" || dateFilter === "TOMORROW" ? "Hourly Arrivals" : "Daily Arrival Trend"}
                            {peakInsight && (
                                <span className="text-[9px] font-bold text-[var(--text-gold)] px-2 py-0.5 bg-[var(--gold-400)]/10 rounded-full border border-[var(--gold-400)]/20 normal-case tracking-normal">
                                    Peak: {peakInsight.label} ({peakInsight.total} arrivals)
                                </span>
                            )}
                            {selectedTimelineLabel && (
                                <button 
                                    onClick={() => setSelectedTimelineLabel(null)}
                                    className="text-[9px] font-black text-red-400/80 hover:text-red-400 transition-colors flex items-center gap-1 uppercase tracking-widest pl-2 border-l border-[var(--border-subtle)]"
                                >
                                    <X className="w-3 h-3" /> Clear Filter
                                </button>
                            )}
                        </h3>
                        <div className="flex gap-6 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                            <button 
                                onClick={() => setVisibleSeries(prev => ({ ...prev, arrived: !prev.arrived }))}
                                className={`flex items-center gap-2 transition-all ${visibleSeries.arrived ? 'opacity-100' : 'opacity-30 grayscale hover:opacity-50'}`}
                            >
                                <div className="w-3 h-3 bg-[var(--gold-400)] rounded-full shadow-[0_0_8px_rgba(212,175,55,0.4)]"></div> 
                                Arrived
                            </button>
                            <button 
                                onClick={() => setVisibleSeries(prev => ({ ...prev, expected: !prev.expected }))}
                                className={`flex items-center gap-2 transition-all ${visibleSeries.expected ? 'opacity-100' : 'opacity-30 grayscale hover:opacity-50'}`}
                            >
                                <div className="w-3 h-3 bg-[var(--gold-400)]/20 rounded-full border border-[var(--gold-400)]/40"></div> 
                                Expected
                            </button>
                        </div>
                    </div>
                    <div className="h-40 w-full relative z-10 group/chart">
                        {/* Zero State Overlay */}
                        {!timelineData.some(d => d.total > 0) && (
                            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0a0c]/40 backdrop-blur-[2px] rounded-xl border border-[var(--border-subtle)] group-hover/chart:border-[var(--border-gold)]/20 transition-all">
                                <div className="flex flex-col items-center gap-2 animate-in fade-in zoom-in duration-500">
                                    <div className="p-2 rounded-full bg-[var(--text-gold)]/5 border border-[var(--border-gold)]/10 text-[var(--text-gold)]/30">
                                        <BarChart2 className="w-5 h-5" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">No Activity Found</p>
                                        <p className="text-[9px] text-[var(--text-muted)] mt-1">Adjust filters to see trends</p>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            setSearch("");
                                            setGuestSearch("");
                                            setRefSearch("");
                                            setRoomSearch("");
                                            setStatusFilter(null);
                                            setRoomTypeFilter(null);
                                            setDateFilter("TODAY");
                                        }}
                                        className="mt-2 text-[9px] font-black text-[var(--text-gold)] hover:text-[var(--gold-300)] uppercase tracking-widest border-b border-[var(--border-gold)]/20 pb-0.5 transition-all"
                                    >
                                        Reset All
                                    </button>
                                </div>
                            </div>
                        )}
                        
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                                data={timelineData} 
                                margin={{ top: 5, right: 0, left: -20, bottom: 0 }} 
                                barSize={selectedTimelineLabel ? 24 : 16}
                                onClick={(data) => {
                                    if (data && data.activeLabel) {
                                        setSelectedTimelineLabel(data.activeLabel === selectedTimelineLabel ? null : data.activeLabel);
                                    }
                                }}
                            >
                                <XAxis
                                    dataKey="label"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={({ x, y, payload }) => (
                                        <g transform={`translate(${x},${y})`}>
                                            <text 
                                                x={0} y={0} dy={16} 
                                                textAnchor="middle" 
                                                fill={payload.value === selectedTimelineLabel ? 'var(--text-gold)' : 'var(--text-muted)'} 
                                                fontSize={9} fontWeight={payload.value === selectedTimelineLabel ? 900 : 700}
                                            >
                                                {payload.value}
                                            </text>
                                        </g>
                                    )}
                                    interval={timelineData.length > 20 ? 2 : 0}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(212,175,55,0.03)', radius: 4 }} />
                                {visibleSeries.arrived && (
                                    <Bar 
                                        dataKey="arrived" 
                                        stackId="a" 
                                        fill="var(--gold-400)" 
                                        radius={[2, 2, 2, 2]} 
                                        animationDuration={1000}
                                        isAnimationActive={true}
                                        className="cursor-pointer"
                                    />
                                )}
                                {visibleSeries.expected && (
                                    <Bar 
                                        dataKey="expected" 
                                        stackId="a" 
                                        fill="rgba(212, 175, 55, 0.15)" 
                                        stroke="rgba(212, 175, 55, 0.3)" 
                                        strokeWidth={1}
                                        radius={[4, 4, 4, 4]} 
                                        animationDuration={1000}
                                        isAnimationActive={true}
                                        className="cursor-pointer"
                                    />
                                )}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <MetricCard
                        label="Total Arrivals"
                        count={stats.total}
                        color={`bg-gradient-to-br transition-all ${statusFilter === null || statusFilter === "TOTAL" ? "from-[#145AF2] to-[#0A2E7A] ring-4 ring-blue-500/30 scale-[1.02]" : "from-[#145AF2]/60 to-[#0A2E7A]/60 opacity-80"}`}
                        icon={<Users className="w-7 h-7 text-white" />}
                        onClick={() => setStatusFilter(null)}
                    />
                    <MetricCard
                        label="Arrived"
                        count={stats.arrived}
                        color={`bg-gradient-to-br transition-all ${statusFilter === "ARRIVED" ? "from-[#F97316] to-[#C2410C] ring-4 ring-orange-500/30 scale-[1.02]" : "from-[#F97316]/60 to-[#C2410C]/60 opacity-80"}`}
                        icon={<Check className="w-7 h-7 text-white" />}
                        onClick={() => setStatusFilter(statusFilter === "ARRIVED" ? null : "ARRIVED")}
                    />
                    <MetricCard
                        label="Ready to Check-In"
                        count={stats.ready}
                        color={`bg-gradient-to-br transition-all ${statusFilter === "READY" ? "from-[#10B981] to-[#047857] ring-4 ring-emerald-500/30 scale-[1.02]" : "from-[#10B981]/60 to-[#047857]/60 opacity-80"}`}
                        icon={<Bed className="w-7 h-7 text-white" />}
                        onClick={() => setStatusFilter(statusFilter === "READY" ? null : "READY")}
                    />
                    <MetricCard
                        label="Pre-Checked-In"
                        count={stats.preChecked}
                        color={`bg-gradient-to-br transition-all ${statusFilter === "PRE_CHECKED" ? "from-[#14B8A6] to-[#0F766E] ring-4 ring-teal-500/30 scale-[1.02]" : "from-[#14B8A6]/60 to-[#0F766E]/60 opacity-80"}`}
                        icon={<Clock className="w-7 h-7 text-white" />}
                        onClick={() => setStatusFilter(statusFilter === "PRE_CHECKED" ? null : "PRE_CHECKED")}
                    />
                </div>

                {/* Quick Filter Pills */}
                <div className="flex gap-4 overflow-x-auto py-2 gn-scrollbar">
                    <QuickFilterPill
                        label="Ready to Check-In"
                        count={stats.ready}
                        icon={<Check className="w-4 h-4" />}
                        color="text-emerald-400"
                        active={statusFilter === "READY"}
                        onClick={() => setStatusFilter(statusFilter === "READY" ? null : "READY")}
                    />
                    <QuickFilterPill
                        label="Waiting Assignment"
                        count={stats.waitingRoom}
                        icon={<Bed className="w-4 h-4" />}
                        color="text-orange-400"
                        active={statusFilter === "WAITING_ROOM"}
                        onClick={() => setStatusFilter(statusFilter === "WAITING_ROOM" ? null : "WAITING_ROOM")}
                    />
                    <QuickFilterPill
                        label="Payment Pending"
                        count={stats.paymentPending}
                        icon={<AlertCircle className="w-4 h-4" />}
                        color="text-red-400"
                        active={statusFilter === "PAYMENT_PENDING"}
                        onClick={() => setStatusFilter(statusFilter === "PAYMENT_PENDING" ? null : "PAYMENT_PENDING")}
                    />
                    <QuickFilterPill
                        label="VIP Guests"
                        count={stats.vip}
                        icon={<User className="w-4 h-4" />}
                        color="text-purple-400"
                        active={statusFilter === "VIP"}
                        onClick={() => setStatusFilter(statusFilter === "VIP" ? null : "VIP")}
                    />
                    <QuickFilterPill
                        label="Checkout Requested"
                        count={stats.checkoutRequested}
                        icon={<ArrowRight className="w-4 h-4" />}
                        color="text-amber-400"
                        active={statusFilter === "CHECKOUT_REQUESTED"}
                        onClick={() => setStatusFilter(statusFilter === "CHECKOUT_REQUESTED" ? null : "CHECKOUT_REQUESTED")}
                    />
                </div>

                {/* Table */}
                <div className="gn-card shadow-2xl overflow-hidden flex flex-col border border-[var(--border-subtle)]">
                    <div className="overflow-x-auto w-full gn-scrollbar">
                        <table className="min-w-[1200px] lg:min-w-full divide-y divide-[var(--border-subtle)]">
                            <thead className="bg-white/5">
                                <tr>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] group">
                                        <div className="flex flex-col gap-2">
                                            <div 
                                                className="flex items-center gap-2 cursor-pointer hover:text-[var(--text-gold)] transition-colors"
                                                onClick={() => handleSort('guest_name')}
                                            >
                                                <span>Guest</span>
                                                {sortConfig?.key === 'guest_name' ? (
                                                    sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--text-gold)]" /> : <ArrowDown className="w-3 h-3 text-[var(--text-gold)]" />
                                                ) : (
                                                    <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                                                )}
                                            </div>
                                            <div className="relative group/search">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] group-focus-within/search:text-[var(--text-gold)] transition-colors" />
                                                <input 
                                                    type="text"
                                                    value={guestSearch}
                                                    onChange={(e) => setGuestSearch(e.target.value)}
                                                    placeholder="Filter Guest..."
                                                    className="w-full bg-white/5 border border-[var(--border-subtle)] focus:border-[var(--border-gold)]/50 focus:ring-1 focus:ring-[var(--border-gold)]/30 rounded px-7 py-1.5 text-[10px] lowercase placeholder:uppercase placeholder:text-[var(--text-muted)] outline-none transition-all font-bold"
                                                />
                                                {guestSearch && (
                                                    <button onClick={() => setGuestSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                                                        <X className="w-3 h-3 text-red-400/50 hover:text-red-400" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] group">
                                        <div className="flex flex-col gap-2">
                                            <div 
                                                className="flex items-center gap-2 cursor-pointer hover:text-[var(--text-gold)] transition-colors"
                                                onClick={() => handleSort('booking_code')}
                                            >
                                                <span>Booking Ref</span>
                                                {sortConfig?.key === 'booking_code' ? (
                                                    sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--text-gold)]" /> : <ArrowDown className="w-3 h-3 text-[var(--text-gold)]" />
                                                ) : (
                                                    <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                                                )}
                                            </div>
                                            <div className="relative group/search">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] group-focus-within/search:text-[var(--text-gold)] transition-colors" />
                                                <input 
                                                    type="text"
                                                    value={refSearch}
                                                    onChange={(e) => setRefSearch(e.target.value)}
                                                    placeholder="Filter Ref..."
                                                    className="w-full bg-white/5 border border-[var(--border-subtle)] focus:border-[var(--border-gold)]/50 focus:ring-1 focus:ring-[var(--border-gold)]/30 rounded px-7 py-1.5 text-[10px] lowercase placeholder:uppercase placeholder:text-[var(--text-muted)] outline-none transition-all font-bold"
                                                />
                                                {refSearch && (
                                                    <button onClick={() => setRefSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                                                        <X className="w-3 h-3 text-red-400/50 hover:text-red-400" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] group">
                                        <div 
                                            className="flex items-center gap-2 cursor-pointer hover:text-[var(--text-gold)] transition-colors"
                                            onClick={() => handleSort('scheduled_checkin_at')}
                                        >
                                            <span>Arrival Time</span>
                                            {sortConfig?.key === 'scheduled_checkin_at' ? (
                                                sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--text-gold)]" /> : <ArrowDown className="w-3 h-3 text-[var(--text-gold)]" />
                                            ) : (
                                                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] whitespace-nowrap">Rooms / Guests</th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em]">Status</th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em]">
                                        <div className="flex flex-col gap-2">
                                            <span>Room</span>
                                            <div className="relative group/search">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] group-focus-within/search:text-[var(--text-gold)] transition-colors" />
                                                <input 
                                                    type="text"
                                                    value={roomSearch}
                                                    onChange={(e) => setRoomSearch(e.target.value)}
                                                    placeholder="Filter Room..."
                                                    className="w-full bg-white/5 border border-[var(--border-subtle)] focus:border-[var(--border-gold)]/50 focus:ring-1 focus:ring-[var(--border-gold)]/30 rounded px-7 py-1.5 text-[10px] lowercase placeholder:uppercase placeholder:text-[var(--text-muted)] outline-none transition-all font-bold"
                                                />
                                                {roomSearch && (
                                                    <button onClick={() => setRoomSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                                                        <X className="w-3 h-3 text-red-400/50 hover:text-red-400" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] whitespace-nowrap">Room Ready</th>
                                    <th className="px-6 py-5 text-left text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] group">
                                        <div 
                                            className="flex items-center gap-2 cursor-pointer hover:text-[var(--text-gold)] transition-colors"
                                            onClick={() => handleSort('pending_amount')}
                                        >
                                            <span>Balance</span>
                                            {sortConfig?.key === 'pending_amount' ? (
                                                sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-[var(--text-gold)]" /> : <ArrowDown className="w-3 h-3 text-[var(--text-gold)]" />
                                            ) : (
                                                <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-right text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] sticky right-0 bg-[#0a0a10] z-20 w-48 shadow-[-10px_0_20px_rgba(0,0,0,0.5)]">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredList.length > 0 ? (
                                    filteredList.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((arrival) => (
                                        <ArrivalRow 
                                            key={arrival.booking_id} 
                                            arrival={arrival} 
                                            onFolioOpen={setSelectedFolioArrival}
                                            onApproveCheckout={handleApproveCheckout}
                                            approvingCheckout={approvingCheckout === arrival.booking_id}
                                        />
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in duration-700">
                                                <div className="relative">
                                                    <div className="absolute -inset-4 bg-[var(--text-gold)]/10 rounded-full blur-2xl animate-pulse"></div>
                                                    <Search className="w-16 h-16 text-[var(--text-gold)]/20 relative" />
                                                </div>
                                                <div className="space-y-1 relative">
                                                    <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">No Matching Arrivals</h3>
                                                    <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto">
                                                        We couldn't find any results matching your current filters or search criteria.
                                                    </p>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        setSearch("");
                                                        setGuestSearch("");
                                                        setRefSearch("");
                                                        setRoomSearch("");
                                                        setStatusFilter(null);
                                                    }}
                                                    className="gn-btn gn-btn--secondary border border-[var(--border-gold)]/20 text-[10px] uppercase tracking-widest py-2 px-6 mt-4 hover:bg-[var(--text-gold)]/5 transition-all"
                                                >
                                                    Clear All Filters
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="bg-white/5 px-6 py-6 flex items-center justify-between border-t border-[var(--border-subtle)]">
                        <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">
                            Showing <span className="text-[var(--text-primary)]">{(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, flattenedRows.length)}</span> of <span className="text-[var(--text-primary)]">{flattenedRows.length}</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="gn-btn gn-btn--secondary px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-30 transition-all"
                            >
                                Prev
                            </button>
                            <div className="flex gap-1.5">
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let p = i + 1;
                                    return (
                                        <button
                                            key={p}
                                            onClick={() => setCurrentPage(p)}
                                            className={`w-8 h-8 rounded-lg text-xs font-black transition-all flex items-center justify-center
                                            ${currentPage === p
                                                    ? "bg-[var(--gold-400)] text-black shadow-[0_0_15px_rgba(212,175,55,0.3)]"
                                                    : "bg-white/5 text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-gold)] hover:text-[var(--text-primary)]"
                                                }`}
                                        >
                                            {p}
                                        </button>
                                    );
                                })}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="gn-btn gn-btn--secondary px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] disabled:opacity-30 transition-all"
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

                {/* Phase 2 Modal */}
                {showPhase2Modal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                        <div className="gn-card max-w-md w-full p-8 text-center space-y-6 border border-[var(--border-gold)]/40 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--border-gold)] to-transparent"></div>
                            
                            <div className="mx-auto w-20 h-20 rounded-2xl bg-[var(--text-gold)]/10 flex items-center justify-center border border-[var(--border-gold)]/20">
                                <Clock className="w-10 h-10 text-[var(--text-gold)]" />
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tighter uppercase font-sans">Phase 2 Incoming</h3>
                                <p className="text-[var(--text-secondary)] text-sm leading-relaxed font-medium">
                                    This advanced automated feature is currently under high-precision development and will be available in the <span className="text-[var(--text-gold)] font-black">Phase 2 Release</span>.
                                </p>
                            </div>

                            <div className="pt-6">
                                <button 
                                    onClick={() => setShowPhase2Modal(false)}
                                    className="gn-btn gn-btn--primary w-full py-4 font-black tracking-[0.2em] uppercase text-xs"
                                >
                                    Understood
                                </button>
                            </div>

                            <p className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-widest opacity-50">
                                Vaiyu Enterprise Suite • v2.0 Roadmap
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
