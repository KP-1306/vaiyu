import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Spinner from '../components/Spinner';
import './OwnerStaffShifts.css';
import {
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    User,
    Users,
    Sun,
    Moon,
    Clock,
    Plus,
    BarChart2,
    Layout,
    Shield,
    UserPlus,
    AlertTriangle,
    RefreshCw,
    Search,
    Check,
    Loader2,
    X,
    Settings,
    Sunset,
    Save,
    MoreVertical,
    Scissors,
    Move,
    Repeat,
    Lock,
    Unlock,
    Trash2,
    Edit3,
    ExternalLink,
    AlertCircle,
    UserX,
    Brain,
    CalendarDays,
    Sparkles,
    History,
    ArrowLeft
} from 'lucide-react';

// ----------------------------------------------------------------------
// Types based on RPC output
// ----------------------------------------------------------------------

interface Shift {
    shift_id: string;
    staff_id: string;
    shift_start: string;
    shift_end: string;
    shift_type: 'morning' | 'evening' | 'night';
    status: 'scheduled' | 'completed' | 'cancelled';
    zone_id: string | null;
    zone_name: string | null;
    department_id?: string | null;
    department_name?: string | null;
    is_on_shift?: boolean; // Now calculated locally
    is_locked: boolean;
    locked_by: string | null;
    locked_by_name: string | null;
    version: number;
}

interface StaffMember {
    staff_id: string;
    full_name: string;
    email: string | null;
    avatar_url: string | null;
    department_id: string | null;
    department_name: string | null;
    departments?: { department_id: string; name: string; is_primary: boolean }[];
    assigned_zone_id: string | null;
    assigned_zone_name: string | null;
    is_active: boolean;
    is_verified: boolean;
    has_shift: boolean;
    shifts: Shift[];
}

interface AvailableStaff {
    staff_id: string;
    full_name: string;
    email: string | null;
    avatar_url: string | null;
    department_id: string | null;
    department_name: string | null;
    zone_id: string | null;
    zone_name: string | null;
    is_active: boolean;
    is_verified: boolean;
}

interface DashboardSummary {
    total_staff: number;
    on_shift: number;
    off_shift: number;
    morning: number;
    evening: number;
    night: number;
}

interface DashboardData {
    timeline: StaffMember[];
    available: AvailableStaff[];
    summary: DashboardSummary;
}

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

export default function OwnerStaffShifts() {
    const { slug } = useParams();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [pulseTime, setPulseTime] = useState(new Date());
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [currentMemberId, setCurrentMemberId] = useState<string | null>(null);
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
    const [success, setSuccess] = useState(false);

    /* ── Toast System ── */
    const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'warning' }[]>([]);
    const toastIdRef = useRef(0);
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' = 'success') => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    /* ── Role Assignment Modal State ── */
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [roleModalLoading, setRoleModalLoading] = useState(false);
    const [roleModalSaving, setRoleModalSaving] = useState(false);
    const [modalMembersList, setModalMembersList] = useState<{ id: string; user_id: string; email: string; name: string }[]>([]);
    const [modalRolesList, setModalRolesList] = useState<{ id: string; name: string; code: string; description?: string; isTemplate?: boolean }[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string>("");
    const [initialRoleIds, setInitialRoleIds] = useState<string[]>([]);
    const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
    const [hotelZones, setHotelZones] = useState<{ id: string, name: string }[]>([]);
    const [hotelDepartments, setHotelDepartments] = useState<{ id: string, name: string }[]>([]);
    const [staffDepartments, setStaffDepartments] = useState<any[]>([]);
    
    /* ── Shift Assignment Modal State ── */
    const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
    const [shiftModalData, setShiftModalData] = useState({
        staffId: "",
        startTime: "09:00",
        endTime: "17:00",
        type: "morning",
        zoneId: ""
    });

    /* ── Operational Command Center State ── */
    const timelineRef = useRef<HTMLDivElement>(null);
    const [activeDepartment, setActiveDepartment] = useState<string>("All Departments");
    const [activeZone, setActiveZone] = useState<string>("All Zones");
    const [isDepartmentModalOpen, setIsDepartmentModalOpen] = useState(false);
    const [isAddDeptDropdownOpen, setIsAddDeptDropdownOpen] = useState(false);
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
    const [rosterDetailType, setRosterDetailType] = useState<'on_shift' | 'off_duty' | null>(null);
    const [globalAssignOpen, setGlobalAssignOpen] = useState(false);
    const [globalBulkOpen, setGlobalBulkOpen] = useState(false);
    const [activeStaffMenuId, setActiveStaffMenuId] = useState<string | null>(null);
    const [activeAssignMenuId, setActiveAssignMenuId] = useState<string | null>(null);
    const [activeShiftPopoverId, setActiveShiftPopoverId] = useState<string | null>(null);

    const [editStaffModal, setEditStaffModal] = useState<any>(null);
    const [isUpdatingStaff, setIsUpdatingStaff] = useState(false);
    const [editStaffRoles, setEditStaffRoles] = useState<{ id: string; name: string; code: string }[]>([]);
    const [editStaffDepts, setEditStaffDepts] = useState<{ id: string; name: string; is_primary: boolean }[]>([]);
    const [deactivateUserModal, setDeactivateUserModal] = useState<any>(null);
    const [isDeactivatingUser, setIsDeactivatingUser] = useState(false);
    const [deactivateReason, setDeactivateReason] = useState("");

    // Filter Menu States
    const [isDeptFilterOpen, setIsDeptFilterOpen] = useState(false);
    const [isZoneFilterOpen, setIsZoneFilterOpen] = useState(false);


    const activeAssignStaffData = useMemo(() => {
        if (!activeAssignMenuId || !data) return null;
        for (const staff of data.timeline) {
            if (staff.staff_id === activeAssignMenuId) return staff;
        }
        return null;
    }, [activeAssignMenuId, data]);

    const handleDeactivateUser = async () => {
        if (!deactivateReason.trim()) {
            return; // Needs reason
        }
        setIsDeactivatingUser(true);
        try {
            const { error } = await supabase
                .rpc('update_hotel_member', {
                    p_member_id: deactivateUserModal.staff_id,
                    p_is_active: false
                });

            if (error) throw error;
            
            setDeactivateUserModal(null);
            loadData();
        } catch (err: any) {
            console.error(err);
        } finally {
            setIsDeactivatingUser(false);
        }
    };
    const [shiftExplanation, setShiftExplanation] = useState<any>(null);
    const [showFullExplanation, setShowFullExplanation] = useState(false);
    const [showShiftDetails, setShowShiftDetails] = useState(false);

    // Fetch AI Explanation dynamically when Shift Popover opens
    useEffect(() => {
        if (activeShiftPopoverId) {
            supabase
                .from('shift_audit_log')
                .select('explanation')
                .eq('shift_id', activeShiftPopoverId)
                .not('explanation', 'is', null) // 🔥 FIXED: Correct PostgREST syntax for is not null
                .order('changed_at', { ascending: false }) // Use changed_at (correct schema)
                .limit(1)
                .then(({ data, error }) => {
                    if (error) console.error('[REST] Audit Fetch Error:', error);
                    const explanation = data?.[0]?.explanation;
                    setShiftExplanation(explanation || null);
                    setShowFullExplanation(false);
                });
        } else {
            setShiftExplanation(null);
            setShowFullExplanation(false);
        }
    }, [activeShiftPopoverId]);

    // Bulk Assignment State
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [bulkModalData, setBulkModalData] = useState({
        staffIds: [] as string[],
        startTime: "09:00",
        endTime: "17:00",
        type: "morning",
        zoneId: ""
    });

    // Drag & Drop / Resize State
    const [isDragging, setIsDragging] = useState(false);
    const [draggedShift, setDraggedShift] = useState<Shift | null>(null);
    const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);
    const [resizingShift, setResizingShift] = useState<{ shift: Shift; direction: 'left' | 'right' } | null>(null);
    const isEditingRef = useRef(false);

    // Weekly Scheduler State
    const [isWeeklyModalOpen, setIsWeeklyModalOpen] = useState(false);
    const [weeklyData, setWeeklyData] = useState({
        staffId: "",
        days: [1, 2, 3, 4, 5] as number[], // Mon-Fri
        startTime: "09:00",
        endTime: "17:00",
        type: "morning",
        zoneId: "",
        rangeStart: new Date().toISOString().split('T')[0],
        rangeEnd: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    });
    const [weeklyPreview, setWeeklyPreview] = useState<{ date: Date; iso_start: string; iso_end: string; conflict: boolean; conflictReason?: string }[] | null>(null);
    const [weeklyApplying, setWeeklyApplying] = useState(false);

    // Smart Scheduler State
    const [isSmartModalOpen, setIsSmartModalOpen] = useState(false);
    const [smartState, setSmartState] = useState<{
        weekStart: string;
        zoneId: string;
        demand: { shift_type: string; required: number }[];
        loading: boolean;
        plan: { assignments: any[]; conflicts: any[] } | null;
        error: string | null;
        showConflicts: boolean;
    }>({
        weekStart: (() => { const d = new Date(); d.setDate(d.getDate() + (8 - d.getDay()) % 7); return d.toISOString().split('T')[0]; })(),
        zoneId: "",
        demand: [
            { shift_type: 'morning', required: 1 },
            { shift_type: 'evening', required: 1 },
            { shift_type: 'night', required: 1 }
        ],
        loading: false,
        plan: null,
        error: null,
        showConflicts: false
    });
    const [smartOptimized, setSmartOptimized] = useState<{
        improving: boolean;
        improvedPlan: any[] | null;
        improvedScore: number;
        baseScore: number;
        showBanner: boolean;
    }>({ improving: false, improvedPlan: null, improvedScore: 0, baseScore: 0, showBanner: false });
    const [smartApplying, setSmartApplying] = useState(false);

    // Shift History State
    const [historyView, setHistoryView] = useState<'hidden' | 'global' | string>('hidden');
    const [historyData, setHistoryData] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [hasMoreHistory, setHasMoreHistory] = useState(false);
    const [historyOffset, setHistoryOffset] = useState(0);

    const dashboardLink = slug ? `/owner/${slug}` : '/owner';

    // 1. Clock Pulse (10s)
    useEffect(() => {
        const timer = setInterval(() => {
            if (!isEditingRef.current && !isDragging) setPulseTime(new Date());
        }, 10000);
        return () => clearInterval(timer);
    }, [isDragging]);

    // 2. Resolve slug -> hotelId
    useEffect(() => {
        if (!slug) return;
        async function fetchHotel() {
            const { data: hotelRow, error: hErr } = await supabase
                .from("hotels")
                .select("id")
                .eq("slug", slug)
                .maybeSingle();

            if (hErr) {
                console.error("Hotel fetch error:", hErr);
                setError("Failed to load property information.");
                setLoading(false);
                return;
            }
            if (!hotelRow) {
                setError("Property not found.");
                setLoading(false);
                return;
            }
            setHotelId(hotelRow.id);
        }
        fetchHotel();
    }, [slug]);

    // 2b. Resolve current user's hotel_member.id
    useEffect(() => {
        if (!hotelId) return;
        async function resolveMember() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data: member } = await supabase
                .from('hotel_members')
                .select('id')
                .eq('hotel_id', hotelId)
                .eq('user_id', user.id)
                .eq('is_active', true)
                .maybeSingle();
            if (member) setCurrentMemberId(member.id);
        }
        resolveMember();
    }, [hotelId]);

    // 3. Refetch Dashboard (no page reload)
    const refetchDashboard = useCallback(async () => {
        if (!hotelId) return;
        const now = new Date();
        const isToday = currentDate.toDateString() === now.toDateString();
        const fetchTime = isToday ? now : new Date(new Date(currentDate).setHours(12, 0, 0, 0));

        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_staff_shifts_dashboard', {
            p_hotel_id: hotelId,
            p_selected_day: fetchTime.toISOString(),
            p_now: now.toISOString()
        });

        if (rpcErr) {
            console.error('Dashboard refetch error:', rpcErr);
            return;
        }

        if (rpcData && rpcData.timeline) {
            const staffIds = rpcData.timeline.map((s: any) => s.staff_id);
            
            // 1. Fetch all departments for these staff members
            const { data: allDepts, error: deptsErr } = await supabase
                .from('staff_departments')
                .select('staff_id, department_id, is_primary, departments(name)')
                .in('staff_id', staffIds);

            // 2. Fetch verified status and email separately (safer than PostgREST joins without explicit FKs)
            const { data: membersInfo, error: membersErr } = await supabase
                .from('hotel_members')
                .select('id, is_verified, user_id')
                .in('id', staffIds);

            const userIds = membersInfo?.map(m => m.user_id).filter(Boolean) || [];
            const { data: profilesInfo } = await supabase
                .from('profiles')
                .select('id, email')
                .in('id', userIds);

            if (!deptsErr && !membersErr) {
                const enrichedTimeline = rpcData.timeline.map((staff: any) => {
                    const depts = allDepts
                        ?.filter(d => d.staff_id === staff.staff_id)
                        .map(d => ({
                            department_id: d.department_id,
                            name: d.departments?.name || 'Unknown',
                            is_primary: d.is_primary
                        })) || [];
                    
                    const mInfo = membersInfo?.find(m => m.id === staff.staff_id);
                    const pInfo = profilesInfo?.find(p => p.id === mInfo?.user_id);
                    
                    return {
                        ...staff,
                        departments: depts,
                        is_verified: mInfo ? mInfo.is_verified : staff.is_verified,
                        email: pInfo?.email || staff.email
                    };
                });
                setData({ ...rpcData, timeline: enrichedTimeline });
            } else {
                setData(rpcData);
            }
        } else {
            setData(rpcData);
        }
        setError(null);
    }, [hotelId, currentDate]);

    // 3b. Conflict-aware error handler
    const handleShiftError = useCallback((e: any) => {
        const msg = (e?.message || e?.details || String(e)).toLowerCase();
        if (msg.includes('version')) {
            showToast('Shift was updated by another user — refreshing…', 'warning');
        } else if (msg.includes('locked') || msg.includes('lock')) {
            showToast('Shift is locked by another user', 'error');
        } else if (msg.includes('overlap') || msg.includes('exclusion')) {
            showToast('Shift conflicts with an existing schedule', 'error');
        } else if (msg.includes('not found')) {
            showToast('Shift no longer exists', 'error');
        } else if (msg.includes('not editable')) {
            showToast('Only active scheduled shifts can be edited', 'error');
        } else {
            showToast(msg || 'Operation failed', 'error');
        }
        refetchDashboard();
    }, [showToast, refetchDashboard]);

    // 3c. Core RPC helper (with optimistic revert + version retry)
    const handleShiftOperation = useCallback(async (
        operation: string,
        params: any,
        opts?: { optimisticFn?: () => void; revertFn?: () => void; silent?: boolean }
    ) => {
        try {
            console.log(`[RPC] ${operation}`, params);
            opts?.optimisticFn?.();
            const { data: rpcResult, error: rpcErr } = await supabase.rpc(operation, params);
            if (rpcErr) throw rpcErr;
            if (!opts?.silent) showToast('Operation successful', 'success');
            await refetchDashboard();
            return rpcResult;
        } catch (err: any) {
            const msg = (err?.message || '').toLowerCase();
            // Retry once on version mismatch: refetch → get fresh version → retry
            if (msg.includes('version') && params.p_version !== undefined) {
                console.warn(`[RPC] Version mismatch on ${operation}, retrying with fresh data...`);
                opts?.revertFn?.();
                await refetchDashboard();
                // Don't auto-retry — the refetch will give the user the latest state.
                // The toast below guides them to retry manually.
                showToast('Data refreshed — please try again', 'warning');
                return null;
            }
            console.error(`Error in ${operation}:`, err);
            opts?.revertFn?.();
            handleShiftError(err);
            return null;
        }
    }, [refetchDashboard, handleShiftError, showToast]);

    // 4. Operation Handlers (CORRECT PARAM NAMES)
    const userId = currentMemberId || hotelId; // fallback to hotelId if member not resolved yet

    const handleMoveShift = useCallback((shift: Shift, newStart: Date, newEnd: Date) => {
        // Duration guard
        const duration = newEnd.getTime() - newStart.getTime();
        if (duration > 24 * 60 * 60 * 1000 || duration <= 0) {
            showToast(`Invalid shift duration (${(duration / 3600000).toFixed(1)}h)`, 'error');
            return;
        }
        const prevData = data;
        handleShiftOperation('move_shift', {
            p_id: shift.shift_id,
            p_start: newStart.toISOString(),
            p_end: newEnd.toISOString(),
            p_version: shift.version,
            p_user: userId
        }, {
            optimisticFn: () => {
                // Optimistic: update shift times in local state
                if (!data) return;
                setData({
                    ...data,
                    timeline: data.timeline.map(staff => ({
                        ...staff,
                        shifts: staff.shifts.map(s =>
                            s.shift_id === shift.shift_id
                                ? { ...s, shift_start: newStart.toISOString(), shift_end: newEnd.toISOString() }
                                : s
                        )
                    }))
                });
            },
            revertFn: () => { if (prevData) setData(prevData); }
        });
    }, [data, handleShiftOperation, userId]);

    const handleReassignShift = useCallback((shift: Shift, newStaffId: string, newStart: Date, newEnd: Date) => {
        // Duration guard
        const duration = newEnd.getTime() - newStart.getTime();
        if (duration > 24 * 60 * 60 * 1000 || duration <= 0) {
            showToast(`Invalid shift duration (${(duration / 3600000).toFixed(1)}h)`, 'error');
            return;
        }
        const prevData = data;
        handleShiftOperation('reassign_shift', {
            p_id: shift.shift_id,
            p_staff: newStaffId,
            p_start: newStart.toISOString(),
            p_end: newEnd.toISOString(),
            p_zone: shift.zone_id || null,
            p_version: shift.version,
            p_user: userId
        }, {
            optimisticFn: () => {
                if (!data) return;
                setData({
                    ...data,
                    timeline: data.timeline.map(staff => {
                        // Remove from old staff
                        if (staff.staff_id === shift.staff_id) {
                            return { ...staff, shifts: staff.shifts.filter(s => s.shift_id !== shift.shift_id) };
                        }
                        // Add to new staff
                        if (staff.staff_id === newStaffId) {
                            const updatedShift = { ...shift, staff_id: newStaffId, shift_start: newStart.toISOString(), shift_end: newEnd.toISOString() };
                            return { ...staff, shifts: [...staff.shifts, updatedShift].sort((a, b) => a.shift_start.localeCompare(b.shift_start)) };
                        }
                        return staff;
                    })
                });
            },
            revertFn: () => { if (prevData) setData(prevData); }
        });
    }, [data, handleShiftOperation, userId]);

    const handleCancelShift = useCallback((shift: Shift) => {
        if (!confirm('Are you sure you want to cancel this shift?')) return;
        const prevData = data;
        handleShiftOperation('cancel_shift', {
            p_shift_id: shift.shift_id,
            p_version: shift.version,
            p_user: userId
        }, {
            optimisticFn: () => {
                if (!data) return;
                setData({
                    ...data,
                    timeline: data.timeline.map(staff => ({
                        ...staff,
                        shifts: staff.shifts.filter(s => s.shift_id !== shift.shift_id)
                    }))
                });
            },
            revertFn: () => { if (prevData) setData(prevData); }
        });
    }, [data, handleShiftOperation, userId]);

    const handleLockToggle = useCallback((shift: Shift) => {
        const operation = shift.is_locked ? 'unlock_shift' : 'lock_shift';
        handleShiftOperation(operation, {
            p_id: shift.shift_id,
            p_user: userId
        }, { silent: true });
    }, [handleShiftOperation, userId]);

    const handleSplitShiftPrompt = useCallback(async (shift: Shift) => {
        const sStart = new Date(shift.shift_start);
        const sEnd = new Date(shift.shift_end);

        const splitTimeStr = prompt(
            `Split Shift at what time? (Between ${sStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} and ${sEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })})`,
            new Date(sStart.getTime() + (sEnd.getTime() - sStart.getTime()) / 2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        );

        if (!splitTimeStr) return;

        try {
            const [hours, minutes] = splitTimeStr.split(':').map(Number);
            const splitDate = new Date(sStart);
            splitDate.setHours(hours, minutes, 0, 0);

            if (splitDate <= sStart || splitDate >= sEnd) {
                showToast('Split point must be within the shift duration', 'warning');
                return;
            }

            handleShiftOperation('split_shift', {
                p_id: shift.shift_id,
                p_split: splitDate.toISOString(),
                p_version: shift.version,
                p_user: userId
            });
        } catch (err) {
            showToast('Invalid time format. Use HH:MM (24h)', 'error');
        }
    }, [handleShiftOperation, userId, showToast]);

    const handleRequestOverridePrompt = useCallback(async (shift: Shift) => {
        const reason = prompt('Why do you need to override this lock?', 'Urgent operational change');
        if (!reason) return;

        handleShiftOperation('request_shift_override', {
            p_shift_id: shift.shift_id,
            p_user: userId,
            p_reason: reason
        });
    }, [handleShiftOperation, userId]);

    // Quick inline assign for the grid cells
    const handleQuickAssign = useCallback(async (staffId: string, type: 'morning' | 'evening' | 'night') => {
        setActiveAssignMenuId(null);
        let startTime = "09:00";
        let endTime = "17:00";
        if (type === 'morning') { startTime = "07:00"; endTime = "15:00"; }
        else if (type === 'evening') { startTime = "15:00"; endTime = "23:00"; }
        else if (type === 'night') { startTime = "23:00"; endTime = "07:00"; }

        const start = new Date(currentDate);
        const [sH, sM] = startTime.split(':').map(Number);
        start.setHours(sH, sM, 0, 0);

        const end = new Date(currentDate);
        const [eH, eM] = endTime.split(':').map(Number);
        end.setHours(eH, eM, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);

        const prevData = data;
        await handleShiftOperation('assign_shift', {
            p_staff_id: staffId,
            p_shift_start: start.toISOString(),
            p_shift_end: end.toISOString(),
            p_shift_type: type,
            p_zone_id: activeZone === 'All Zones' ? null : activeZone,
            p_created_by: userId
        }, {
            optimisticFn: () => {
                if (!data) return;
                const newShift: Shift = {
                    shift_id: `temp-${Math.random()}`,
                    staff_id: staffId,
                    shift_start: start.toISOString(),
                    shift_end: end.toISOString(),
                    shift_type: type as any,
                    status: 'scheduled',
                    zone_id: activeZone === 'All Zones' ? null : activeZone,
                    zone_name: activeZone === 'All Zones' ? 'No Zone' : (hotelZones.find(z => z.id === activeZone)?.name || 'No Zone'),
                    is_locked: false,
                    locked_by: null,
                    locked_by_name: null,
                    version: 0
                };
                setData({
                    ...data,
                    timeline: data.timeline.map(staff =>
                        staff.staff_id === staffId
                            ? { ...staff, shifts: [...staff.shifts, newShift].sort((a, b) => a.shift_start.localeCompare(b.shift_start)) }
                            : staff
                    )
                });
            },
            revertFn: () => { if (prevData) setData(prevData); }
        });
    }, [currentDate, activeZone, handleShiftOperation, userId, data, hotelZones]);

    const handleAssignShift = useCallback(() => {
        const start = new Date(currentDate);
        const [sH, sM] = shiftModalData.startTime.split(':').map(Number);
        start.setHours(sH, sM, 0, 0);

        const end = new Date(currentDate);
        const [eH, eM] = shiftModalData.endTime.split(':').map(Number);
        end.setHours(eH, eM, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);

        const prevData = data;
        handleShiftOperation('assign_shift', {
            p_staff_id: shiftModalData.staffId,
            p_shift_start: start.toISOString(),
            p_shift_end: end.toISOString(),
            p_shift_type: shiftModalData.type,
            p_zone_id: shiftModalData.zoneId || null,
            p_created_by: userId
        }, {
            optimisticFn: () => {
                if (!data) return;
                const newShift: Shift = {
                    shift_id: `temp-${Math.random()}`,
                    staff_id: shiftModalData.staffId,
                    shift_start: start.toISOString(),
                    shift_end: end.toISOString(),
                    shift_type: shiftModalData.type as any,
                    status: 'scheduled',
                    zone_id: shiftModalData.zoneId,
                    zone_name: hotelZones.find(z => z.id === shiftModalData.zoneId)?.name || 'No Zone',
                    is_locked: false,
                    locked_by: null,
                    locked_by_name: null,
                    version: 0
                };
                setData({
                    ...data,
                    timeline: data.timeline.map(staff =>
                        staff.staff_id === shiftModalData.staffId
                            ? { ...staff, shifts: [...staff.shifts, newShift].sort((a, b) => a.shift_start.localeCompare(b.shift_start)) }
                            : staff
                    )
                });
            },
            revertFn: () => { if (prevData) setData(prevData); }
        });
        setIsShiftModalOpen(false);
    }, [currentDate, shiftModalData, handleShiftOperation, userId, data, hotelZones]);

    const handleBulkAssign = useCallback(async () => {
        if (bulkModalData.staffIds.length === 0) return;

        const start = new Date(currentDate);
        const [sH, sM] = bulkModalData.startTime.split(':').map(Number);
        start.setHours(sH, sM, 0, 0);

        const end = new Date(currentDate);
        const [eH, eM] = bulkModalData.endTime.split(':').map(Number);
        end.setHours(eH, eM, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);

        const shiftsArray = bulkModalData.staffIds.map(staffId => ({
            staff_id: staffId,
            shift_start: start.toISOString(),
            shift_end: end.toISOString(),
            shift_type: bulkModalData.type,
            zone_id: bulkModalData.zoneId || null
        }));

        const result = await handleShiftOperation('bulk_assign_shifts', {
            p_shifts: shiftsArray,
            p_user: userId
        });

        if (result && Array.isArray(result)) {
            const failures = result.filter(r => r.status !== 'success');
            if (failures.length > 0) {
                showToast(`Partial success: ${failures.length} conflicts`, 'warning');
            }
        }
        setIsBulkModalOpen(false);
    }, [currentDate, bulkModalData, handleShiftOperation, userId, showToast]);

    // Weekly Scheduler Helpers
    const generateWeeklyShifts = useCallback(() => {
        const shifts: { date: Date; iso_start: string; iso_end: string }[] = [];
        const rangeStart = new Date(weeklyData.rangeStart + 'T00:00:00');
        const rangeEnd = new Date(weeklyData.rangeEnd + 'T23:59:59');
        const [sH, sM] = weeklyData.startTime.split(':').map(Number);
        const [eH, eM] = weeklyData.endTime.split(':').map(Number);

        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            if (weeklyData.days.includes(current.getDay())) {
                const start = new Date(current);
                start.setHours(sH, sM, 0, 0);
                const end = new Date(current);
                end.setHours(eH, eM, 0, 0);
                if (end <= start) end.setDate(end.getDate() + 1);

                shifts.push({
                    date: new Date(current),
                    iso_start: start.toISOString(),
                    iso_end: end.toISOString()
                });
            }
            current.setDate(current.getDate() + 1);
        }
        return shifts;
    }, [weeklyData]);

    const handleWeeklyPreview = useCallback(async () => {
        if (!weeklyData.staffId) {
            showToast('Please select a staff member', 'warning');
            return;
        }
        if (!weeklyData.rangeStart || !weeklyData.rangeEnd) {
            showToast('Please select a date range', 'warning');
            return;
        }
        const generated = generateWeeklyShifts();
        if (generated.length === 0) {
            showToast('No shifts to generate — check your days and date range', 'warning');
            return;
        }

        // 🛡️ CRITICAL Architecture Upgrade: Dry-Run via Production DB Engine
        setWeeklyApplying(true); // Re-using this flag for the loading state of preview

        const payload = generated.map(s => ({
            staff_id: weeklyData.staffId,
            shift_start: s.iso_start,
            shift_end: s.iso_end,
            shift_type: weeklyData.type,
            zone_id: weeklyData.zoneId || null
        }));

        const result = await handleShiftOperation('bulk_assign_shifts', {
            p_shifts: payload,
            p_user: userId,
            p_dry_run: true
        }, { silent: true });

        setWeeklyApplying(false);

        if (!result || !Array.isArray(result)) {
            showToast('Failed to generate preview', 'error');
            return;
        }

        const preview = generated.map((g, idx) => {
            const res = result[idx]; // Result array structurally matches input array
            return {
                ...g,
                conflict: res?.status !== 'success',
                conflictReason: res?.status !== 'success' ? res?.message : undefined
            };
        });

        setWeeklyPreview(preview);
    }, [weeklyData, generateWeeklyShifts, handleShiftOperation, userId, showToast]);

    const handleWeeklyApply = useCallback(async () => {
        if (!weeklyPreview || weeklyPreview.length === 0) return;
        const nonConflicting = weeklyPreview.filter(p => !p.conflict);
        if (nonConflicting.length === 0) {
            showToast('All shifts have conflicts — nothing to apply', 'error');
            return;
        }

        setWeeklyApplying(true);
        const shiftsArray = nonConflicting.map(s => ({
            staff_id: weeklyData.staffId,
            shift_start: s.iso_start,
            shift_end: s.iso_end,
            shift_type: weeklyData.type,
            zone_id: weeklyData.zoneId || null
        }));

        const result = await handleShiftOperation('bulk_assign_shifts', {
            p_shifts: shiftsArray,
            p_user: userId
        });

        if (result && Array.isArray(result)) {
            const successes = result.filter(r => r.status === 'success').length;
            const failures = result.filter(r => r.status !== 'success').length;
            if (failures > 0) {
                showToast(`${successes} shifts created, ${failures} conflicts`, 'warning');
            } else {
                showToast(`${successes} shifts scheduled successfully`, 'success');
            }
        }
        setWeeklyApplying(false);
        setIsWeeklyModalOpen(false);
        setWeeklyPreview(null);
    }, [weeklyPreview, weeklyData, handleShiftOperation, userId, showToast]);

    // Smart Scheduler Handlers
    const handleGeneratePlan = useCallback(async () => {
        if (!hotelId) return;
        setSmartState(prev => ({ ...prev, loading: true, error: null, plan: null }));
        setSmartOptimized({ improving: true, improvedPlan: null, improvedScore: 0, baseScore: 0, showBanner: false });

        const { data: baseData, error } = await supabase.rpc('generate_ai_schedule_v2', {
            p_week_start: smartState.weekStart,
            p_zone_id: smartState.zoneId || null,
            p_demand: smartState.demand,
            p_hotel_id: hotelId
        });

        if (error) {
            setSmartState(prev => ({ ...prev, loading: false, error: error.message }));
            setSmartOptimized(prev => ({ ...prev, improving: false }));
            showToast(error.message, 'error');
            return;
        }

        const assignments = baseData.filter((r: any) => r.status !== 'unfilled');
        const conflicts = baseData.filter((r: any) => r.status === 'unfilled');

        setSmartState(prev => ({ ...prev, loading: false, plan: { assignments, conflicts } }));

        supabase.functions.invoke('ai-scheduler', {
            body: {
                week_start: smartState.weekStart,
                zone_id: smartState.zoneId || null,
                demand: smartState.demand,
                hotel_id: hotelId
            }
        }).then(({ data, error: edgeError }) => {
            if (!edgeError && data && data.improved) {
                setSmartOptimized(prev => ({
                    ...prev,
                    improving: false,
                    improvedPlan: data.schedule.filter((r: any) => r.status !== 'unfilled'),
                    improvedScore: data.improved_score,
                    baseScore: data.base_score,
                    showBanner: true
                }));
            } else {
                setSmartOptimized(prev => ({ ...prev, improving: false }));
            }
        }).catch(err => {
            console.error('Optimizer failed:', err);
            setSmartOptimized(prev => ({ ...prev, improving: false }));
        });

    }, [hotelId, smartState.weekStart, smartState.zoneId, smartState.demand, showToast]);

    const handleApplyPlan = useCallback(async (useImproved: boolean | any = false) => {
        const planToApply = (useImproved === true) && smartOptimized.improvedPlan
            ? smartOptimized.improvedPlan
            : smartState.plan?.assignments;

        if (!planToApply || planToApply.length === 0) return;
        setSmartApplying(true);

        const result = await handleShiftOperation('bulk_assign_shifts', {
            p_shifts: planToApply,
            p_user: userId
        });

        if (result && Array.isArray(result)) {
            const successes = result.filter((r: any) => r.status === 'success').length;
            const failures = result.filter((r: any) => r.status !== 'success').length;
            if (failures > 0) {
                showToast(`${successes} shifts created, ${failures} conflicts`, 'warning');
            } else {
                showToast(`${successes} shifts scheduled successfully`, 'success');
            }
        }
        setSmartApplying(false);
        setIsSmartModalOpen(false);
        setSmartState(prev => ({ ...prev, plan: null }));
        setSmartOptimized(prev => ({ ...prev, showBanner: false, improvedPlan: null }));
    }, [smartState.plan, smartOptimized.improvedPlan, handleShiftOperation, userId, showToast]);

    // 4. Fetch Dashboard & Core Data
    useEffect(() => {
        if (!hotelId) return;

        async function fetchZones() {
            const { data: zData } = await supabase.from('hotel_zones').select('id, name').eq('hotel_id', hotelId).order('name');
            if (zData) setHotelZones(zData);
        }
        fetchZones();

        async function fetchDepartments() {
            const { data: dData } = await supabase.from('departments').select('id, name').eq('hotel_id', hotelId).order('name');
            if (dData) setHotelDepartments(dData);
        }
        fetchDepartments();

        async function fetchDashboard() {
            setLoading(true);
            await refetchDashboard();
            setLoading(false);
        }

        fetchDashboard();
    }, [hotelId, currentDate, refetchDashboard]);

    // 4a. Fetch Staff Specific Departments when modal opens
    const fetchStaffDepts = useCallback(async () => {
        if (!selectedStaffId) return;
        const { data, error } = await supabase
            .from('staff_departments')
            .select(`
                department_id,
                is_primary,
                priority,
                departments (
                    id,
                    name
                )
            `)
            .eq('staff_id', selectedStaffId)
            .order('priority', { ascending: true });
            
        if (data && !error) {
            setStaffDepartments(data);
        }
    }, [selectedStaffId]);

    useEffect(() => {
        if (isDepartmentModalOpen) {
            fetchStaffDepts();
        }
    }, [isDepartmentModalOpen, fetchStaffDepts]);

    // 4b. Polling: refetch every 30s (pause during edits/drags/popover)
    useEffect(() => {
        if (!hotelId) return;
        const interval = setInterval(() => {
            if (!isEditingRef.current && !isDragging && !activeShiftPopoverId) {
                refetchDashboard();
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [hotelId, refetchDashboard, isDragging, activeShiftPopoverId]);

    // 5. Fetch History Data
    const fetchHistory = useCallback(async (append = false) => {
        if (historyView === 'hidden' || !hotelId) return;

        setHistoryLoading(true);
        const offset = append ? historyOffset : 0;

        try {
            const { data: res, error } = await supabase.rpc('get_shift_history', {
                p_hotel_id: hotelId,
                p_staff_id: historyView === 'global' ? null : historyView,
                p_limit: 20,
                p_offset: offset
            });

            if (error) throw error;

            const newLogs = res?.data || [];
            const hasMore = res?.has_more || false;

            setHistoryData(prev => append ? [...prev, ...newLogs] : newLogs);
            setHasMoreHistory(hasMore);
            if (append) setHistoryOffset(prev => prev + 20);
            else setHistoryOffset(20);

        } catch (err: any) {
            console.error("History fetch error:", err);
            showToast(err.message || "Failed to load history", 'error');
        } finally {
            setHistoryLoading(false);
        }
    }, [historyView, hotelId, historyOffset, showToast]);

    useEffect(() => {
        if (historyView !== 'hidden') {
            fetchHistory(false);
        } else {
            setHistoryData([]);
            setHistoryOffset(0);
            setHasMoreHistory(false);
        }
    }, [historyView]); // Only trigger on view change

    // 4c. Global Rezize Listener
    useEffect(() => {
        if (!resizingShift) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingShift || !timelineRef.current) return;
            const rect = timelineRef.current.getBoundingClientRect();
            const staffColumnWidth = 256;
            const timelineWidth = rect.width - staffColumnWidth;
            const x = e.clientX - rect.left - staffColumnWidth;

            const startOfTimeline = new Date(currentDate);
            startOfTimeline.setHours(6, 0, 0, 0);
            const totalMinutes = 24 * 60;
            const currentMinutes = (x / timelineWidth) * totalMinutes;
            const newTime = new Date(startOfTimeline.getTime() + currentMinutes * 60000);

            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    timeline: prev.timeline.map(staff => ({
                        ...staff,
                        shifts: staff.shifts.map(s => {
                            if (s.shift_id !== resizingShift.shift.shift_id) return s;
                            if (resizingShift.direction === 'left') {
                                return { ...s, shift_start: newTime.toISOString() };
                            } else {
                                return { ...s, shift_end: newTime.toISOString() };
                            }
                        })
                    }))
                };
            });
        };

        const handleMouseUp = () => {
            if (resizingShift && data) {
                // Use the ORIGINAL shift's version (from resizingShift snapshot),
                // not the mutated state which mousemove has been updating
                const originalShift = resizingShift.shift;
                const staff = data.timeline.find(st => st.staff_id === originalShift.staff_id);
                const mutatedShift = staff?.shifts.find(s => s.shift_id === originalShift.shift_id);
                if (mutatedShift) {
                    // Build a shift with mutated times but ORIGINAL version
                    const shiftForRpc = { ...mutatedShift, version: originalShift.version };
                    handleMoveShift(shiftForRpc, new Date(mutatedShift.shift_start), new Date(mutatedShift.shift_end));
                }
            }
            setResizingShift(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingShift, currentDate, data, handleMoveShift]);

    /* ── Role Assignment Helper Functions ── */
    async function fetchRoleModalData() {
        if (!hotelId || !data) return;
        setRoleModalLoading(true);
        try {
            // 1. Use members already fetched by the dashboard RPC (contains ALL active members)
            const formattedMembers = data.timeline.map(m => ({
                id: m.staff_id,
                user_id: "", // Note: Not strictly needed for hotel_member_roles mapping
                name: m.full_name,
                email: "" // Email is already coalesced into full_name in the RPC if available
            }));
            setModalMembersList(formattedMembers);

            // 2. Fetch Existing Hotel Roles
            const { data: hRoles, error: hRoleErr } = await supabase
                .from("hotel_roles")
                .select("id, name, code, description")
                .eq("hotel_id", hotelId)
                .eq("is_active", true);

            if (hRoleErr) throw hRoleErr;

            // 4. Fetch System Role Templates
            const { data: sTemplates, error: sTemplErr } = await supabase
                .from("system_role_templates")
                .select("code, name, description")
                .eq("is_active", true);

            if (sTemplErr) throw sTemplErr;

            // 5. Merge Roles (Prefer existing hotel roles)
            const mergedRoles: any[] = [];
            const processedCodes = new Set<string>();

            (hRoles || []).forEach(r => {
                if (r.code === 'OWNER_0' && processedCodes.has('OWNER')) return;
                mergedRoles.push({ ...r, isTemplate: false });
                processedCodes.add(r.code);
            });

            (sTemplates || []).forEach(t => {
                if (t.code === 'OWNER' && (processedCodes.has('OWNER') || processedCodes.has('OWNER_0'))) return;
                if (!processedCodes.has(t.code)) {
                    mergedRoles.push({
                        id: `template_${t.code}`,
                        name: t.name,
                        code: t.code,
                        description: t.description,
                        isTemplate: true
                    });
                    processedCodes.add(t.code);
                }
            });

            setModalRolesList(mergedRoles);
            setSelectedMemberId("");
            setSelectedRoleIds([]);
        } catch (err: any) {
            console.error("Error fetching modal data:", err);
            setError("Failed to load role assignment data.");
        } finally {
            setRoleModalLoading(false);
        }
    }

    async function handleMemberSelection(memberId: string) {
        setSelectedMemberId(memberId);
        if (!memberId) {
            setSelectedRoleIds([]);
            return;
        }
        try {
            const { data: existingRoles, error } = await supabase
                .from("hotel_member_roles")
                .select("role_id")
                .eq("hotel_member_id", memberId);
            if (error) throw error;
            const roleIds = (existingRoles || []).map((r: any) => r.role_id);
            setSelectedRoleIds(roleIds);
            setInitialRoleIds(roleIds);
        } catch (err) {
            console.error("Error fetching existing roles:", err);
            setSelectedRoleIds([]);
        }
    }

    async function handleSaveRoleAssignments() {
        if (!selectedMemberId || selectedRoleIds.length === 0) {
            alert("Please select a user and at least one role.");
            return;
        }
        setRoleModalSaving(true);
        try {
            const finalRoleIds: string[] = [];
            const templateRoleIds = selectedRoleIds.filter(id => id.startsWith("template_"));
            const existingRoleIds = selectedRoleIds.filter(id => !id.startsWith("template_"));

            finalRoleIds.push(...existingRoleIds);

            if (templateRoleIds.length > 0) {
                const rolesToCreate = templateRoleIds.map(tempId => {
                    const templateCode = tempId.replace("template_", "");
                    const roleData = modalRolesList.find(r => r.code === templateCode);
                    return {
                        hotel_id: hotelId,
                        code: templateCode,
                        name: roleData?.name || templateCode,
                        description: roleData?.description || "",
                        is_active: true
                    };
                });

                const { data: createdRoles, error: createErr } = await supabase
                    .from("hotel_roles")
                    .upsert(rolesToCreate, { onConflict: 'hotel_id,code' })
                    .select("id");

                if (createErr) throw createErr;
                if (createdRoles) {
                    finalRoleIds.push(...createdRoles.map(r => r.id));
                }
            }

            if (finalRoleIds.length === 0) throw new Error("No valid roles selected.");

            // Proper Sync Logic: Calculate Diff
            const toAdd = finalRoleIds.filter(id => !initialRoleIds.includes(id));
            const toDelete = initialRoleIds.filter(id => !finalRoleIds.includes(id));

            // Execute Delete (Targeted)
            if (toDelete.length > 0) {
                const { error: delErr } = await supabase
                    .from("hotel_member_roles")
                    .delete()
                    .eq("hotel_member_id", selectedMemberId)
                    .in("role_id", toDelete);
                if (delErr) throw delErr;
            }

            // Execute Insert (Targeted)
            if (toAdd.length > 0) {
                const { error: insErr } = await supabase
                    .from("hotel_member_roles")
                    .insert(toAdd.map(rid => ({ hotel_member_id: selectedMemberId, role_id: rid })));
                if (insErr) throw insErr;
            }

            setIsRoleModalOpen(false);
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err: any) {
            console.error("Error saving roles:", err);
            alert("Failed to save role assignments.");
        } finally {
            setRoleModalSaving(false);
        }
    }

    // 5b. Fetch roles & departments for Edit Staff modal
    useEffect(() => {
        if (!editStaffModal?.staff_id) {
            setEditStaffRoles([]);
            setEditStaffDepts([]);
            return;
        }
        const staffId = editStaffModal.staff_id;

        // Fetch departments
        supabase
            .from('staff_departments')
            .select('department_id, is_primary, departments(id, name)')
            .eq('staff_id', staffId)
            .then(({ data }) => {
                if (data) {
                    setEditStaffDepts(data.map((sd: any) => ({
                        id: sd.department_id,
                        name: sd.departments?.name || 'Unknown',
                        is_primary: sd.is_primary
                    })));
                }
            });

        // Fetch roles
        supabase
            .from('hotel_member_roles')
            .select('role_id, hotel_roles(id, name, code)')
            .eq('hotel_member_id', staffId)
            .then(({ data }) => {
                if (data) {
                    setEditStaffRoles(data.map((r: any) => ({
                        id: r.role_id,
                        name: r.hotel_roles?.name || 'Unknown',
                        code: r.hotel_roles?.code || ''
                    })));
                }
            });
    }, [editStaffModal?.staff_id]);

    // 6. Filter Logic (MUST be before early returns to respect React hook rules)
    const rawTimeline = data?.timeline || [];
    const filteredTimeline = useMemo(() => {
        return rawTimeline.filter(staff => {
            const matchesDept = activeDepartment === "All Departments" || 
                (staff.departments && staff.departments.some((d: any) => d.name === activeDepartment)) ||
                (staff.department_name === activeDepartment);
                
            const matchesZone = activeZone === "All Zones" || 
                staff.zone_id === activeZone || 
                staff.zone_name === activeZone;
                
            return matchesDept && matchesZone;
        });
    }, [rawTimeline, activeDepartment, activeZone]);

    if (loading && !data) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#0a0a0c]">
                <Spinner label="Syncing roster..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#0a0a0c] p-4 text-center">
                <div className="glass-card p-8 border border-white/5">
                    <div className="text-4xl mb-4">⚠️</div>
                    <div className="text-lg font-bold text-white mb-2">{error}</div>
                    <button onClick={() => window.location.reload()} className="text-sm font-black text-indigo-400">Try again</button>
                </div>
            </div>
        );
    }
    const { timeline = [], available = [], summary } = data || {};

    return (
        <div className="staff-shifts-dark flex h-screen flex-col overflow-hidden">
            {/* Nav Header */}
            <header className="flex h-14 items-center justify-between border-b border-white/5 bg-black/40 px-8 backdrop-blur-md">
                <div className="flex items-center gap-4">
                    <button className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-all">
                        <ChevronLeft size={20} />
                    </button>
                    <div className="flex items-center gap-2 text-sm">
                        <Link to={dashboardLink} className="font-medium text-slate-400 hover:text-white transition-colors">Dashboard</Link>
                        <span className="text-slate-600">›</span>
                        <span className="font-bold text-white">Staff & Shifts</span>
                    </div>
                </div>
            </header>

            <div className="flex flex-1 gap-6 overflow-hidden p-6">

                {/* LEFT SIDEBAR: Stats & Navigation */}
                <div className="flex w-72 shrink-0 flex-col gap-6 overflow-y-auto no-scrollbar pr-1 pb-10">
                    <div className="glass-card p-6 border border-white/5">
                        <h2 className="mb-6 text-xl font-black text-white">Staff Roster</h2>

                        <div className="mb-6">
                            <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Live Status</h3>
                            <div className="flex items-end gap-3">
                                <div className="text-4xl font-black text-white">{(summary?.total_staff ?? 0)}</div>
                                <div className="mb-1 text-sm font-bold text-slate-500">Members</div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div 
                                onClick={() => setRosterDetailType('on_shift')}
                                className="flex items-center justify-between rounded-xl bg-emerald-500/10 p-3 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-all active:scale-[0.98]"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                    <span className="text-sm font-bold text-emerald-100/90 pointer-events-none">On Shift</span>
                                </div>
                                <span className="text-sm font-black text-emerald-500 pointer-events-none">{summary?.on_shift || 0}</span>
                            </div>
                            <div 
                                onClick={() => setRosterDetailType('off_duty')}
                                className="flex items-center justify-between rounded-xl bg-white/5 p-3 border border-white/5 cursor-pointer hover:bg-white/10 transition-all active:scale-[0.98]"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-slate-600" />
                                    <span className="text-sm font-bold text-slate-300 pointer-events-none">Off Duty</span>
                                </div>
                                <span className="text-sm font-black text-slate-500 pointer-events-none">{summary?.off_shift || 0}</span>
                            </div>
                        </div>
                    </div>

                    {/* Nav Pills */}
                    <div className="flex flex-col gap-1">
                        <button
                            onClick={() => setHistoryView('hidden')}
                            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all ${historyView === 'hidden' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                        >
                            <span>📅</span> Daily Shifts
                        </button>
                        <button
                            onClick={() => setHistoryView('global')}
                            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all ${historyView === 'global' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                        >
                            <span>📄</span> Shift History
                        </button>
                    </div>

                    {/* Analytics Section (Moved from Right) */}
                    <div className="glass-card p-6 border border-white/5">
                        <h2 className="mb-6 flex items-center gap-2 text-lg font-black text-white">
                            <BarChart2 size={20} className="text-indigo-500" /> Analytics
                        </h2>
                        <div className="space-y-4">
                            {['Morning', 'Evening', 'Night'].map(type => {
                                const count = summary ? (summary as any)[type.toLowerCase()] : 0;
                                const color = type === 'Morning' ? 'bg-amber-400' : type === 'Evening' ? 'bg-orange-500' : 'bg-indigo-500';
                                return (
                                    <div key={type}>
                                        <div className="mb-1.5 flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            <span>{type}</span>
                                            <span className="text-white">{count}</span>
                                        </div>
                                        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                                            <div className={`h-full ${color} transition-all shadow-[0_0_10px_rgba(99,102,241,0.2)]`} style={{ width: `${Math.min(100, count * 20)}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* MAIN CONTENT: Shift Timeline or History Panel */}
                <div className="flex flex-1 flex-col rounded-3xl bg-[#0a0a0c] shadow-2xl shadow-black/50 overflow-hidden ring-1 ring-white/5 relative">

                    {historyView !== 'hidden' ? (
                        <div className="flex-1 flex flex-col h-full bg-[#0a0a0c] animate-in fade-in zoom-in-95 duration-200">
                            {/* History Header */}
                            <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-white/[0.02]">
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => setHistoryView('hidden')}
                                        className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
                                    >
                                        <ArrowLeft size={18} />
                                    </button>
                                    <div>
                                        <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                                            <Clock size={20} className="text-indigo-400" />
                                            {historyView === 'global' ? 'Global Shift History' : 'Staff Shift History'}
                                        </h2>
                                        <p className="text-xs font-bold text-slate-500 mt-1">Audit trail of all scheduling changes</p>
                                    </div>
                                </div>
                            </div>

                            {/* History Content */}
                            <div className="flex-1 overflow-y-auto p-8 relative">
                                {historyLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <Loader2 size={32} className="text-indigo-500 animate-spin" />
                                            <span className="text-sm font-black text-slate-400 tracking-widest uppercase">Fetching Logs...</span>
                                        </div>
                                    </div>
                                ) : historyData.length === 0 ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="flex flex-col items-center gap-4 text-slate-500">
                                            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                                                <History size={24} className="opacity-50" />
                                            </div>
                                            <span className="text-sm font-bold">No history logs found</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="max-w-4xl mx-auto space-y-6 pb-20">
                                        {historyData.map((log) => {
                                            const actionColors = {
                                                created: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                                                updated: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
                                                cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
                                                deleted: 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                            };
                                            const ActionIcon = log.action === 'created' ? Plus : log.action === 'updated' ? Edit3 : log.action === 'cancelled' ? X : Trash2;

                                            // Diff Formatting Logic
                                            const renderDiffValue = (label: string, field: any) => {
                                                if (!field) return null;

                                                let oldVal = field.old;
                                                let newVal = field.new;

                                                // Format times
                                                if (label === 'Time') {
                                                    const format = (v: string) => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---';
                                                    oldVal = format(field.old);
                                                    newVal = format(field.new);
                                                }
                                                // Format zones
                                                if (label === 'Zone') {
                                                    const getZoneName = (id: string) => hotelZones.find(z => z.id === id)?.name || 'None';
                                                    oldVal = field.old ? getZoneName(field.old) : 'None';
                                                    newVal = field.new ? getZoneName(field.new) : 'None';
                                                }

                                                return (
                                                    <div key={label} className="flex items-center gap-4 text-xs font-bold">
                                                        <span className="w-20 text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
                                                        {field.old !== undefined && (
                                                            <>
                                                                <span className="text-slate-400 line-through bg-black/20 px-2 py-1 rounded">{oldVal}</span>
                                                                <div className="text-indigo-500/50">→</div>
                                                            </>
                                                        )}
                                                        <span className="text-white bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded">{newVal}</span>
                                                    </div>
                                                );
                                            };

                                            return (
                                                <div key={log.id} className="relative pl-8">
                                                    <div className="absolute left-[15px] top-8 bottom-[-24px] w-px bg-white/5" />
                                                    <div className="absolute left-0 top-3 w-8 h-8 rounded-full bg-[#111118] border-4 border-[#0a0a0c] flex items-center justify-center z-10 shadow-lg">
                                                        <div className={`w-2.5 h-2.5 rounded-full ${log.action === 'created' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : log.action === 'updated' ? 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`} />
                                                    </div>

                                                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 hover:bg-white/[0.03] transition-colors">
                                                        <div className="flex items-start justify-between mb-4">
                                                            <div>
                                                                <div className="flex items-center gap-3 mb-1">
                                                                    <span className={`px-2.5 py-1 rounded-md border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${actionColors[log.action as keyof typeof actionColors]}`}>
                                                                        <ActionIcon size={12} strokeWidth={3} /> {log.action}
                                                                    </span>
                                                                    <span className="text-white font-bold text-sm">{log.staff_name}</span>
                                                                </div>
                                                                <div className="text-xs font-bold text-slate-500">
                                                                    {new Date(log.changed_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                                    <span className="mx-2 opacity-30">•</span>
                                                                    by {log.changed_by_name || 'System'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Diff Rendering */}
                                                        <div className="mt-4 pt-4 border-t border-white/5 grid gap-3">
                                                            {log.action === 'deleted' ? (
                                                                <div className="flex flex-col gap-3">
                                                                    {renderDiffValue('Time', { old: `${new Date(log.diff.shift_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(log.diff.shift_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` })}
                                                                    {renderDiffValue('Status', { old: log.diff.status })}
                                                                    <div className="text-[10px] font-black text-red-500/50 uppercase tracking-widest mt-1">Record Purged</div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    {log.diff?.shift_start && renderDiffValue('Time', {
                                                                        old: log.diff.shift_start.old ? `${new Date(log.diff.shift_start.old).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(log.diff.shift_end.old).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : undefined,
                                                                        new: `${new Date(log.diff.shift_start.new).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(log.diff.shift_end.new).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                                                    })}
                                                                    {log.diff?.shift_type && renderDiffValue('Type', log.diff.shift_type)}
                                                                    {log.diff?.zone_id && renderDiffValue('Zone', log.diff.zone_id)}
                                                                    {log.diff?.status && renderDiffValue('Status', log.diff.status)}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {hasMoreHistory && (
                                            <div className="flex justify-center pt-4">
                                                <button
                                                    onClick={() => fetchHistory(true)}
                                                    disabled={historyLoading}
                                                    className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
                                                >
                                                    {historyLoading ? 'Loading...' : 'Load More History'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Operational Commands Bar (Global Controls) */}
                            <div className="flex items-center justify-between px-8 py-3.5 bg-white/[0.02] border-b border-white/5 relative">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                                        <Layout size={16} strokeWidth={3} />
                                    </div>
                                    <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Operational Commands</h2>
                                </div>

                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => { fetchRoleModalData(); setIsRoleModalOpen(true); }}
                                        className="action-button-secondary flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all"
                                    >
                                        <Shield size={14} strokeWidth={2.5} className="text-slate-400" />
                                        Assign Role
                                    </button>

                                    {/* Dropdown: Assign Shift */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setGlobalAssignOpen(!globalAssignOpen)}
                                            className="action-button-primary flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-black transition-all"
                                        >
                                            <Plus size={14} strokeWidth={3} />
                                            Assign Shift
                                            <ChevronDown size={14} strokeWidth={3} className={`transition-transform ${globalAssignOpen ? 'rotate-180' : ''}`} />
                                        </button>

                                        {globalAssignOpen && (
                                            <>
                                                <div className="popover-overlay" onClick={() => setGlobalAssignOpen(false)} />
                                                <div className="dropdown-menu">
                                                    <button className="dropdown-item" onClick={() => { setGlobalAssignOpen(false); setShiftModalData({ ...shiftModalData, staffId: "" }); setIsShiftModalOpen(true); }}>
                                                        <User size={14} /> Single Shift
                                                    </button>
                                                    <button className="dropdown-item" onClick={() => { setGlobalAssignOpen(false); setIsBulkModalOpen(true); }}>
                                                        <Users size={14} /> Multiple Staff (Batch)
                                                    </button>
                                                    <button className="dropdown-item" onClick={() => { setGlobalAssignOpen(false); setWeeklyPreview(null); setIsWeeklyModalOpen(true); }}>
                                                        <CalendarDays size={14} /> Weekly Schedule
                                                    </button>
                                                    <button className="dropdown-item" onClick={() => { setGlobalAssignOpen(false); setSmartState(prev => ({ ...prev, plan: null, error: null, showConflicts: false })); setIsSmartModalOpen(true); }}>
                                                        <Sparkles size={14} /> Smart Schedule (Auto)
                                                    </button>
                                                    <button className="dropdown-item" onClick={() => { setGlobalAssignOpen(false); }}>
                                                        <Clock size={14} /> Templates
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Dropdown: Bulk Actions */}
                                    <div className="relative">
                                        <button
                                            onClick={() => setGlobalBulkOpen(!globalBulkOpen)}
                                            className="action-button-secondary flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all"
                                        >
                                            Bulk Actions
                                            <ChevronDown size={14} />
                                        </button>

                                        {globalBulkOpen && (
                                            <>
                                                <div className="popover-overlay" onClick={() => setGlobalBulkOpen(false)} />
                                                <div className="dropdown-menu">
                                                    <button className="dropdown-item" onClick={() => setGlobalBulkOpen(false)}>
                                                        <Repeat size={14} /> Bulk Reassign
                                                    </button>
                                                    <button className="dropdown-item danger" onClick={() => setGlobalBulkOpen(false)}>
                                                        <Trash2 size={14} /> Bulk Cancel Shifts
                                                    </button>
                                                    <div className="h-px bg-white/5 my-1" />
                                                    <button className="dropdown-item text-indigo-400" onClick={() => setGlobalBulkOpen(false)}>
                                                        <Shield size={14} /> Auto-Assign (AI)
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Timeline Filter Row */}
                            <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.01] px-8 py-4">
                                <div className="flex items-center gap-6">
                                    <h1 className="text-xl font-black tracking-tight text-white">Shift Schedule</h1>

                                    {success && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg animate-in fade-in slide-in-from-left-2 duration-300">
                                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                                                <Check size={12} strokeWidth={4} />
                                            </div>
                                            <span className="text-xs font-black text-emerald-500 uppercase tracking-tight">Assignment Saved</span>
                                        </div>
                                    )}

                                    {/* Date Navigation */}
                                    <div className="flex items-center border border-white/10 rounded-lg overflow-hidden bg-white/5 shadow-inner">
                                        <button
                                            onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); }}
                                            className="p-2.5 hover:bg-white/5 text-slate-400 hover:text-white border-r border-white/10 transition-colors"
                                        >
                                            <ChevronLeft size={18} strokeWidth={2.5} />
                                        </button>
                                        <span className="px-6 py-2 text-sm font-bold text-slate-200 min-w-[180px] text-center">
                                            {currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                        </span>
                                        <button
                                            onClick={() => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); }}
                                            className="p-2.5 hover:bg-white/5 text-slate-400 hover:text-white border-l border-white/10 transition-colors"
                                        >
                                            <ChevronRight size={18} strokeWidth={2.5} />
                                        </button>
                                    </div>

                                    {/* Dropdowns */}
                                    <div className="flex items-center gap-3">
                                        {/* Department Filter */}
                                        <div className="relative">
                                            <button
                                                onClick={() => setIsDeptFilterOpen(!isDeptFilterOpen)}
                                                className={`filter-button flex items-center gap-6 px-4 py-2 text-sm font-bold transition-all rounded-lg select-none ${isDeptFilterOpen ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                                            >
                                                {activeDepartment}
                                                <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-300 ${isDeptFilterOpen ? 'rotate-180 opacity-100' : 'opacity-40'}`} />
                                            </button>

                                            {isDeptFilterOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-[60]" onClick={() => setIsDeptFilterOpen(false)} />
                                                    <div className="absolute top-[calc(100%+8px)] left-0 min-w-[220px] p-2 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-[70] animate-in fade-in slide-in-from-top-2">
                                                        <div className="px-3 py-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 mb-1">Departments</div>
                                                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                            <button
                                                                onClick={() => { setActiveDepartment("All Departments"); setIsDeptFilterOpen(false); }}
                                                                className={`w-full text-left px-3 py-2 text-sm font-bold rounded-lg transition-colors mb-1 ${activeDepartment === "All Departments" ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                                                            >
                                                                All Departments
                                                            </button>
                                                            {hotelDepartments.map(dept => (
                                                                <button
                                                                    key={dept.id}
                                                                    onClick={() => { setActiveDepartment(dept.name); setIsDeptFilterOpen(false); }}
                                                                    className={`w-full text-left px-3 py-2 text-sm font-bold rounded-lg transition-colors mb-1 ${activeDepartment === dept.name ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                                                                >
                                                                    {dept.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* Zone Filter */}
                                        <div className="relative">
                                            <button
                                                onClick={() => setIsZoneFilterOpen(!isZoneFilterOpen)}
                                                className={`filter-button flex items-center gap-6 px-4 py-2 text-sm font-bold transition-all rounded-lg select-none ${isZoneFilterOpen ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                                            >
                                                {activeZone}
                                                <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-300 ${isZoneFilterOpen ? 'rotate-180 opacity-100' : 'opacity-40'}`} />
                                            </button>

                                            {isZoneFilterOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-[60]" onClick={() => setIsZoneFilterOpen(false)} />
                                                    <div className="absolute top-[calc(100%+8px)] left-0 min-w-[220px] p-2 bg-[#1a1a24] border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-[70] animate-in fade-in slide-in-from-top-2">
                                                        <div className="px-3 py-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 mb-1">Zones</div>
                                                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                            <button
                                                                onClick={() => { setActiveZone("All Zones"); setIsZoneFilterOpen(false); }}
                                                                className={`w-full text-left px-3 py-2 text-sm font-bold rounded-lg transition-colors mb-1 ${activeZone === "All Zones" ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                                                            >
                                                                All Zones
                                                            </button>
                                                            {hotelZones.map(zone => (
                                                                <button
                                                                    key={zone.id}
                                                                    onClick={() => { setActiveZone(zone.name); setIsZoneFilterOpen(false); }}
                                                                    className={`w-full text-left px-3 py-2 text-sm font-bold rounded-lg transition-colors mb-1 ${activeZone === zone.name ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
                                                                >
                                                                    {zone.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Stats Row */}
                            <div className="px-8 py-3 bg-white/[0.01] border-b border-white/5">
                                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
                                    <div className="flex items-center gap-8 px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/5 shadow-inner">
                                        <div className="flex items-center gap-2 border-r border-white/5 pr-6">
                                            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                                                <Users size={16} strokeWidth={3} />
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">Total Staff</span>
                                                <span className="text-sm font-black text-white/90">{summary?.total_staff || 0}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 border-r border-white/5 pr-6">
                                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                                                <User size={16} strokeWidth={3} />
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">On Shift</span>
                                                <span className="text-sm font-black text-emerald-400">{summary?.on_shift || 0}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 border-r border-white/5 pr-6">
                                            <div className="p-2 rounded-lg bg-slate-500/10 text-slate-400">
                                                <div className="w-4 h-4 rounded-full border-[3px] border-slate-500 flex items-center justify-center">
                                                    <div className="w-1 h-1 rounded-full bg-slate-500" />
                                                </div>
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">Off Shift</span>
                                                <span className="text-sm font-black text-slate-500">{summary?.off_shift || 0}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 border-r border-white/5 pr-6">
                                            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                                                <Sun size={16} strokeWidth={3} />
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">Morning Shift</span>
                                                <span className="text-sm font-black text-amber-400">{summary?.morning || 0}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 border-r border-white/5 pr-6">
                                            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400">
                                                <Sun size={16} strokeWidth={3} className="rotate-45" />
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">Evening Shift</span>
                                                <span className="text-sm font-black text-orange-400">{summary?.evening || 0}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                                                <Moon size={16} strokeWidth={3} />
                                            </div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-[11px] font-black uppercase tracking-tight text-slate-500">Night Shift</span>
                                                <span className="text-sm font-black text-indigo-400">{summary?.night || 0}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar bg-[#0a0a0c]">
                                <div className="min-w-[1200px]" ref={timelineRef}>
                                    {/* Time Scale Header */}
                                    <div className="sticky top-0 z-20 flex border-b border-white/10 bg-[#0a0a0c]/90 backdrop-blur-md">
                                        <div className="w-64 shrink-0 px-8 py-4"></div>
                                        <div className="flex flex-1">
                                            {[6, 8, 10, 12, 14, 16, 18, 20, 22, 0, 2, 4].map(hour => (
                                                <div key={hour} className="flex-1 border-l border-white/[0.03] py-4 relative h-[48px]">
                                                    <div className="absolute top-1/2 -translate-y-1/2 -left-8 w-16 text-center text-[10px] font-black uppercase tracking-widest text-slate-500 pointer-events-none">
                                                        {hour === 0 ? '12 AM' : hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Staff Rows */}
                                    <div className="divide-y divide-white/[0.03]">
                                        {filteredTimeline.map(staff => {
                                            const startOfTimeline = new Date(currentDate);
                                            startOfTimeline.setHours(6, 0, 0, 0);
                                            const endOfTimeline = new Date(startOfTimeline);
                                            endOfTimeline.setDate(endOfTimeline.getDate() + 1);
                                            const timelineDuration = endOfTimeline.getTime() - startOfTimeline.getTime();

                                            return (
                                                <div key={staff.staff_id} className="group flex h-24 hover:bg-white/[0.02] transition-colors border-b border-white/[0.03]">
                                                    {/* Staff Info Column */}
                                                    <div className="flex w-64 shrink-0 items-center justify-between px-8 border-r border-white/5 relative group/staff">
                                                        <div className="flex items-center gap-4 min-w-0">
                                                            <div className="relative">
                                                                <img
                                                                    src={staff.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(staff.full_name)}&background=random`}
                                                                    className="h-10 w-10 rounded-xl object-cover ring-1 ring-white/10"
                                                                    alt=""
                                                                />
                                                                {staff.is_verified && (
                                                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#0a0a0c] flex items-center justify-center shadow-lg">
                                                                        <Check size={8} className="text-white" strokeWidth={4} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-black text-white truncate group-hover/staff:text-indigo-400 transition-colors uppercase tracking-tight">{staff.full_name}</div>
                                                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter truncate max-w-[150px]">
                                                                    {staff.departments && staff.departments.length > 0 
                                                                        ? staff.departments.map(d => d.name).join(', ') 
                                                                        : staff.department_name || 'General Staff'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Staff Context Actions */}
                                                        <div className="flex items-center gap-1 opacity-0 group-hover/staff:opacity-100 transition-opacity">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditStaffModal({
                                                                        staff_id: staff.staff_id,
                                                                        full_name: staff.full_name,
                                                                        email: staff.email,
                                                                        is_active: staff.is_active,
                                                                        is_verified: staff.is_verified,
                                                                        avatar_url: staff.avatar_url
                                                                    });
                                                                }}
                                                                className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                                                            >
                                                                <Settings size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Timeline Content */}
                                                    <div
                                                        className={`relative flex-1 group transition-all duration-300 ${dragOverStaffId === staff.staff_id ? 'bg-indigo-500/10' : ''}`}
                                                        onDragOver={(e) => {
                                                            e.preventDefault();
                                                            setDragOverStaffId(staff.staff_id);
                                                        }}
                                                        onDragLeave={() => setDragOverStaffId(null)}
                                                        onDrop={(e) => {
                                                            const rect = timelineRef.current.getBoundingClientRect();
                                                            const staffColumnWidth = 256; // 64 * 4 = 256px
                                                            const timelineWidth = rect.width - staffColumnWidth;
                                                            const x = e.clientX - rect.left - staffColumnWidth;

                                                            if (x < 0 || !draggedShift) return;

                                                            const totalMinutes = 24 * 60;
                                                            const dropMinutes = (x / timelineWidth) * totalMinutes;

                                                            const newStart = new Date(startOfTimeline.getTime() + dropMinutes * 60000);
                                                            const duration = new Date(draggedShift.shift_end).getTime() - new Date(draggedShift.shift_start).getTime();
                                                            const newEnd = new Date(newStart.getTime() + duration);

                                                            // 🛡️ Safety log — exposes broken time calculations instantly
                                                            console.log('[Drop]', {
                                                                originalStart: draggedShift.shift_start,
                                                                originalEnd: draggedShift.shift_end,
                                                                durationHrs: (duration / 3600000).toFixed(2),
                                                                newStart: newStart.toISOString(),
                                                                newEnd: newEnd.toISOString(),
                                                                version: draggedShift.version,
                                                                sameStaff: draggedShift.staff_id === staff.staff_id
                                                            });

                                                            // 🛡️ Duration guard — reject shifts > 24h
                                                            const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;
                                                            if (duration > MAX_SHIFT_MS || duration <= 0) {
                                                                showToast(`Invalid shift duration (${(duration / 3600000).toFixed(1)}h) — max 24h`, 'error');
                                                                setDragOverStaffId(null);
                                                                return;
                                                            }

                                                            if (draggedShift.staff_id === staff.staff_id) {
                                                                handleMoveShift(draggedShift, newStart, newEnd);
                                                            } else {
                                                                handleReassignShift(draggedShift, staff.staff_id, newStart, newEnd);
                                                            }
                                                            setDragOverStaffId(null);
                                                        }}
                                                    >
                                                        {/* Vertical Guides */}
                                                        <div className="absolute inset-0 flex pointer-events-none">
                                                            {[...Array(12)].map((_, i) => (
                                                                <div key={i} className="flex-1 border-l border-white/[0.03] border-dotted" />
                                                            ))}
                                                        </div>

                                                        {/* Shift Bars Area */}
                                                        <div className="absolute inset-0 flex flex-col justify-center gap-2 px-1">
                                                            <div className="relative h-10 w-full">
                                                                {staff.shifts.map(s => {
                                                                    const sStart = Math.max(startOfTimeline.getTime(), new Date(s.shift_start).getTime());
                                                                    const sEnd = Math.min(endOfTimeline.getTime(), new Date(s.shift_end).getTime());

                                                                    if (sStart >= sEnd) return null;

                                                                    const left = ((sStart - startOfTimeline.getTime()) / timelineDuration) * 100;
                                                                    const width = ((sEnd - sStart) / timelineDuration) * 100;

                                                                    return (
                                                                        <div
                                                                            key={s.shift_id}
                                                                            className={`shift-box absolute top-0 flex flex-col justify-center rounded-xl px-4 shadow-xl transition-all border ${s.is_locked ? 'is-locked ring-2 ring-red-500/50' : ''
                                                                                } ${s.shift_type === 'morning' ? 'bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border-emerald-500/30' :
                                                                                    s.shift_type === 'evening' ? 'bg-gradient-to-br from-orange-400/20 to-amber-600/20 border-orange-500/30' :
                                                                                        'bg-gradient-to-br from-indigo-500/20 to-blue-700/20 border-indigo-500/30'
                                                                                }`}
                                                                            style={{ left: `${left}%`, width: `${width}%` }}
                                                                            draggable
                                                                            onDragStart={(e) => {
                                                                                setIsDragging(true);
                                                                                isEditingRef.current = true; // block polling race
                                                                                // CRITICAL: freeze a deep copy so optimistic updates can't corrupt drag state
                                                                                setDraggedShift({ ...s });
                                                                                e.dataTransfer.setData('shiftId', s.shift_id);
                                                                                // Create a transparent drag ghost
                                                                                const img = new Image();
                                                                                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                                                                                e.dataTransfer.setDragImage(img, 0, 0);
                                                                            }}
                                                                            onDragEnd={() => {
                                                                                setIsDragging(false);
                                                                                isEditingRef.current = false;
                                                                                setDraggedShift(null);
                                                                                setDragOverStaffId(null);
                                                                            }}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setActiveShiftPopoverId(activeShiftPopoverId === s.shift_id ? null : s.shift_id);
                                                                            }}
                                                                        >
                                                                            <div className="flex items-center justify-between gap-2 overflow-hidden">
                                                                                <div className="flex flex-col justify-center overflow-hidden">
                                                                                    <div className="truncate text-[9px] font-black uppercase tracking-tighter text-white">
                                                                                        {new Date(s.shift_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} - {new Date(s.shift_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                                                    </div>
                                                                                    <div className="truncate text-[8px] font-bold text-white/50 uppercase tracking-widest leading-tight">
                                                                                        {s.department_name || 'Front Office'} • {s.zone_name || 'No Zone'}
                                                                                    </div>
                                                                                </div>
                                                                                {s.is_locked ? (
                                                                                    <Lock size={10} className="text-red-400 shrink-0" />
                                                                                ) : (
                                                                                    <div className={`w-1.5 h-1.5 rounded-full ${s.shift_type === 'morning' ? 'bg-emerald-400' : s.shift_type === 'evening' ? 'bg-orange-400' : 'bg-indigo-400'}`} />
                                                                                )}
                                                                            </div>

                                                                            {/* Resize Handles */}
                                                                            {!s.is_locked && (
                                                                                <>
                                                                                    <div
                                                                                        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/20 z-10"
                                                                                        onMouseDown={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setResizingShift({ shift: s, direction: 'left' });
                                                                                        }}
                                                                                    />
                                                                                    <div
                                                                                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/20 z-10"
                                                                                        onMouseDown={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setResizingShift({ shift: s, direction: 'right' });
                                                                                        }}
                                                                                    />
                                                                                </>
                                                                            )}

                                                                            {/* Shift Popover Container */}
                                                                            {activeShiftPopoverId === s.shift_id && (
                                                                                <>
                                                                                    <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setActiveShiftPopoverId(null); }} />
                                                                                    <div className="absolute left-0 top-full mt-4 w-[400px] bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] rounded-[32px] overflow-hidden z-[110] animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                                                                                        {/* Popover Content */}
                                                                                        <div className="relative p-7 pb-6 flex items-start gap-5">
                                                                                            <div className="relative">
                                                                                                <img
                                                                                                    src={staff.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(staff.full_name)}&background=6366f1&color=fff`}
                                                                                                    alt={staff.full_name}
                                                                                                    className="w-20 h-20 rounded-[24px] object-cover ring-1 ring-white/10"
                                                                                                />
                                                                                                {staff.is_verified && (
                                                                                                    <div className="absolute -top-1 -right-1 bg-indigo-500 rounded-full p-1 border-2 border-[#0f172a] shadow-lg z-10">
                                                                                                        <Check size={10} strokeWidth={4} className="text-white" />
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                            <div className="flex-1 pt-1">
                                                                                                <h3 className="text-2xl font-black text-white leading-tight mb-1">{staff.full_name}</h3>
                                                                                                <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.1em] mb-4">
                                                                                                    {s.department_name || staff.department_name || 'STAFF'} {s.zone_name ? `· ${s.zone_name.toUpperCase()}` : ''}
                                                                                                </p>
                                                                                                <div className="flex items-center gap-2.5 text-sm font-bold text-emerald-400">
                                                                                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                                                                                    {new Date(s.shift_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(s.shift_end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                                                                </div>
                                                                                            </div>
                                                                                            <button
                                                                                                onClick={(e) => { e.stopPropagation(); setActiveShiftPopoverId(null); }}
                                                                                                className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-2xl"
                                                                                            >
                                                                                                <X size={24} strokeWidth={2.5} />
                                                                                            </button>
                                                                                        </div>

                                                                                        <div className="h-px bg-white/5 mx-7" />

                                                                                        {/* Actions Section */}
                                                                                        <div className="p-7 space-y-5">
                                                                                            <div className="flex items-center gap-3">
                                                                                                <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Actions</span>
                                                                                                <div className="flex-1 h-[1px] bg-white/5" />
                                                                                            </div>

                                                                                            <div className="space-y-2.5">
                                                                                                <button
                                                                                                    disabled={s.is_locked}
                                                                                                    className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-white text-sm font-bold transition-all disabled:opacity-30 group"
                                                                                                    onClick={async () => {
                                                                                                        setActiveShiftPopoverId(null);
                                                                                                        isEditingRef.current = true;
                                                                                                        await handleShiftOperation('lock_shift', { p_id: s.shift_id, p_user: userId });
                                                                                                        setSelectedShift(s);
                                                                                                    }}
                                                                                                >
                                                                                                    <Edit3 size={18} className="text-slate-500 group-hover:text-white transition-colors" />
                                                                                                    Edit Shift
                                                                                                </button>
                                                                                                <button
                                                                                                    className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-indigo-400 text-sm font-bold transition-all group"
                                                                                                    onClick={() => {
                                                                                                        setEditStaffModal({
                                                                                                            staff_id: staff.staff_id,
                                                                                                            full_name: staff.full_name,
                                                                                                            email: staff.email,
                                                                                                            is_active: staff.is_active,
                                                                                                            is_verified: staff.is_verified,
                                                                                                            avatar_url: staff.avatar_url
                                                                                                        });
                                                                                                        setActiveShiftPopoverId(null);
                                                                                                    }}
                                                                                                >
                                                                                                    <Settings size={18} className="text-indigo-500/70 group-hover:text-indigo-400 transition-colors" />
                                                                                                    Edit Staff Settings
                                                                                                </button>
                                                                                                <button disabled={s.is_locked} className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-white text-sm font-bold transition-all disabled:opacity-30 group" onClick={() => setActiveShiftPopoverId(null)}>
                                                                                                    <RefreshCw size={18} className="text-emerald-500/70 group-hover:text-emerald-400 transition-colors" />
                                                                                                    Reassign / Move
                                                                                                </button>
                                                                                                <button disabled={s.is_locked} className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-white text-sm font-bold transition-all disabled:opacity-30 group" onClick={() => { setActiveShiftPopoverId(null); handleSplitShiftPrompt(s); }}>
                                                                                                    <Scissors size={18} className="text-slate-500 group-hover:text-white transition-colors" />
                                                                                                    Split Shift
                                                                                                </button>
                                                                                                <button className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 text-white text-sm font-bold transition-all group" onClick={() => { setActiveShiftPopoverId(null); handleLockToggle(s); }}>
                                                                                                    <Lock size={18} className={s.is_locked ? "text-indigo-400" : "text-slate-500"} />
                                                                                                    Lock Shift <span className="text-[10px] text-slate-500 font-bold ml-1 tracking-tight">({s.is_locked ? 'currently locked' : 'unlocked'})</span>
                                                                                                </button>
                                                                                                <button className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-sm font-bold transition-all group" onClick={() => { setActiveShiftPopoverId(null); handleRequestOverridePrompt(s); }}>
                                                                                                    <AlertTriangle size={18} />
                                                                                                    Request Override
                                                                                                </button>
                                                                                                <div className="h-px bg-white/5 w-full my-1" />
                                                                                                <button className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:border-red-500/20 text-red-400 text-sm font-bold transition-all group" onClick={() => { setActiveShiftPopoverId(null); setDeactivateUserModal(staff); }}>
                                                                                                    <UserX size={18} className="text-red-500/50 group-hover:text-red-400 transition-colors" />
                                                                                                    Activate / Deactivate User
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>

                                                                                        {/* AI Insights Section */}
                                                                                        <div className="p-7 pt-6 bg-white/[0.01]">
                                                                                            <div className="flex items-center gap-3 mb-6">
                                                                                                <Brain size={22} className="text-indigo-500" />
                                                                                                <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">AI Insight</span>
                                                                                                <div className="flex-1 h-[1px] bg-white/5" />
                                                                                            </div>

                                                                                            <div className="p-6 rounded-[28px] bg-white/5 border border-white/5 space-y-4">
                                                                                                <p className="text-sm font-bold text-slate-200 leading-snug">
                                                                                                    Assigned due to <span className="text-white">primary department match</span> & balanced workload.
                                                                                                </p>

                                                                                                <ul className="space-y-2.5">
                                                                                                    <li className="flex items-center gap-3 text-[13px] font-bold text-slate-400">
                                                                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                                                                                        Primary department match
                                                                                                    </li>
                                                                                                    <li className="flex items-center gap-3 text-[13px] font-bold text-slate-400">
                                                                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                                                                                        Balanced workload
                                                                                                    </li>
                                                                                                    <li className="flex items-center gap-3 text-[13px] font-bold text-slate-400">
                                                                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                                                                                        High priority staff
                                                                                                    </li>
                                                                                                </ul>

                                                                                                <button
                                                                                                    onClick={() => setShowFullExplanation(!showFullExplanation)}
                                                                                                    className="mt-2 px-6 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-600 text-white text-xs font-black flex items-center gap-2.5 transition-all shadow-lg shadow-blue-500/20"
                                                                                                >
                                                                                                    <Search size={14} strokeWidth={3} /> View Full Insight
                                                                                                </button>

                                                                                                {showFullExplanation && shiftExplanation?.explanation && (
                                                                                                    <div className="mt-4 p-5 rounded-2xl bg-black/40 border border-white/5 text-xs text-slate-400 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                                                                        {Object.entries(shiftExplanation.explanation).map(([k, v]: any) => (
                                                                                                            <div key={k} className="flex justify-between items-center group">
                                                                                                                <span className="capitalize text-slate-500 group-hover:text-slate-300 transition-colors">{k.replace(/_/g, ' ')}</span>
                                                                                                                <span className={`font-black p-1 px-2 rounded-lg bg-white/5 ${String(v).includes('-') ? 'text-amber-500' : 'text-emerald-500'}`}>{v}</span>
                                                                                                            </div>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>

                                                                                        {/* OVERLAP WARNING */}
                                                                                        {staff.shifts.some(other =>
                                                                                            other.shift_id !== s.shift_id &&
                                                                                            new Date(other.shift_start) < new Date(s.shift_end) &&
                                                                                            new Date(other.shift_end) > new Date(s.shift_start)
                                                                                        ) && (
                                                                                                <div className="mt-2 mx-7 mb-7 p-5 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-4">
                                                                                                    <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500">
                                                                                                        <AlertTriangle size={20} strokeWidth={2.5} />
                                                                                                    </div>
                                                                                                    <div>
                                                                                                        <h4 className="text-sm font-black text-amber-500 mb-0.5">Shift Overlap Detected</h4>
                                                                                                        <p className="text-xs font-bold text-amber-500/70 italic">Conflicts with another assignment.</p>
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}
                                                                                    </div>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {/* Assign Shift Button */}
                                                            <div className="mt-1 flex pl-2 relative z-10">
                                                                {activeAssignMenuId === staff.staff_id && (
                                                                    <>
                                                                        <div className="fixed inset-0 z-[90]" onClick={() => setActiveAssignMenuId(null)} />
                                                                        <div className="absolute left-0 top-full mt-2 w-56 bg-[#1e293b]/95 backdrop-blur-xl border border-white/10 ring-1 ring-white/10 shadow-2xl rounded-2xl overflow-hidden z-[100] font-sans animate-in fade-in slide-in-from-top-2 duration-200">
                                                                            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                                                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Quick Assign</div>
                                                                            </div>
                                                                            <div className="p-2 space-y-1">
                                                                                <button className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/5 rounded-xl flex items-center gap-3 transition-all group" onClick={() => handleQuickAssign(staff.staff_id, 'morning')}>
                                                                                    <div className="p-1 rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20 transition-colors">
                                                                                        <Sun size={14} strokeWidth={3} />
                                                                                    </div>
                                                                                    <span>Morning</span>
                                                                                    <span className="text-[10px] text-slate-600 font-black ml-auto">07:00</span>
                                                                                </button>
                                                                                <button className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/5 rounded-xl flex items-center gap-3 transition-all group" onClick={() => handleQuickAssign(staff.staff_id, 'evening')}>
                                                                                    <div className="p-1 rounded-lg bg-orange-500/10 text-orange-500 group-hover:bg-orange-500/20 transition-colors">
                                                                                        <Sunset size={14} strokeWidth={3} />
                                                                                    </div>
                                                                                    <span>Evening</span>
                                                                                    <span className="text-[10px] text-slate-600 font-black ml-auto">15:00</span>
                                                                                </button>
                                                                                <button className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/5 rounded-xl flex items-center gap-3 transition-all group" onClick={() => handleQuickAssign(staff.staff_id, 'night')}>
                                                                                    <div className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                                                                                        <Moon size={14} strokeWidth={3} />
                                                                                    </div>
                                                                                    <span>Night</span>
                                                                                    <span className="text-[10px] text-slate-600 font-black ml-auto">23:00</span>
                                                                                </button>

                                                                                <div className="h-px bg-white/5 my-2 mx-2" />

                                                                                <button className="w-full text-left px-4 py-2.5 text-xs font-black text-indigo-400 hover:bg-indigo-500/10 rounded-xl flex items-center gap-3 transition-all" onClick={() => {
                                                                                    setActiveAssignMenuId(null);
                                                                                    setShiftModalData({ ...shiftModalData, staffId: staff.staff_id });
                                                                                    setIsShiftModalOpen(true);
                                                                                }}>
                                                                                    <div className="p-1 rounded-lg bg-indigo-500/5">
                                                                                        <Settings size={14} strokeWidth={3} />
                                                                                    </div>
                                                                                    CUSTOM SHIFT...
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                )}
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setActiveAssignMenuId(activeAssignMenuId === staff.staff_id ? null : staff.staff_id);
                                                                    }}
                                                                    className={`flex items-center gap-1.5 rounded-lg border ${activeAssignMenuId === staff.staff_id ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300' : 'bg-white/5 border-white/10 text-indigo-400 hover:bg-white/10'} px-3 py-1 text-[10px] font-bold shadow-sm transition-all`}
                                                                >
                                                                    <span className="text-sm">+</span> Assign Shift
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Details List */}
                                <div className="border-t border-white/5 p-8 bg-black/20">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Staff Details</h3>
                                        {selectedStaffId && (
                                            <button
                                                onClick={() => setSelectedStaffId(null)}
                                                className="text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:text-white transition-colors"
                                            >
                                                Back to Roster
                                            </button>
                                        )}
                                    </div>
                                    {selectedStaffId ? (
                                        (() => {
                                            const staff = timeline.find(s => s.staff_id === selectedStaffId);
                                            if (!staff) return null;
                                            const now = pulseTime;
                                            const hasActiveShift = staff.shifts.some(s => new Date(s.shift_start) <= now && new Date(s.shift_end) > now);

                                            return (
                                                <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl relative overflow-hidden group/detail">
                                                    <div className="flex items-center gap-8 relative z-10">
                                                        <div className="relative">
                                                            <img
                                                                src={staff.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(staff.full_name)}&background=random`}
                                                                className="h-24 w-24 rounded-3xl object-cover ring-2 ring-white/10 shadow-2xl"
                                                                alt=""
                                                            />
                                                            {hasActiveShift && <div className="absolute -bottom-2 -right-2 h-6 w-6 rounded-full border-4 border-[#0a0a0c] bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" />}
                                                        </div>
                                                        <div>
                                                            <h2 className="text-2xl font-black text-white mb-1">{staff.full_name}</h2>
                                                            {staff.email && (
                                                                <div className="text-sm text-slate-400 font-medium mb-2 flex items-center gap-2">
                                                                    <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                                                    {staff.email}
                                                                </div>
                                                            )}
                                                            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                                                                {staff.department_name} • <span className="text-indigo-400">{staff.assigned_zone_name || 'No Zone'}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-6">
                                                                <button onClick={() => setEditStaffModal(staff)} className="flex items-center gap-2 rounded-xl bg-white/5 px-5 py-2.5 text-xs font-black text-white border border-white/10 hover:bg-white/10 transition-all">
                                                                    <Edit3 size={14} /> Edit Staff
                                                                </button>
                                                                <button
                                                                    onClick={() => setIsDepartmentModalOpen(true)}
                                                                    className="flex items-center gap-2 rounded-xl bg-orange-500/10 px-5 py-2.5 text-xs font-black text-orange-500 border border-orange-500/20 hover:bg-orange-500/20 transition-all shadow-lg shadow-orange-500/5 ring-1 ring-orange-500/50"
                                                                >
                                                                    <Layout size={14} strokeWidth={3} /> Departments • {staff.department_name ? 1 : 0}
                                                                </button>
                                                                <button className="flex items-center gap-2 rounded-xl bg-white/5 px-5 py-2.5 text-xs font-black text-slate-400 border border-white/10 hover:bg-white/10 transition-all">
                                                                    <Clock size={14} /> Availability
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="text-right z-10">
                                                        {staff.shifts.length > 0 ? (
                                                            <div className="space-y-3">
                                                                {staff.shifts.map(s => (
                                                                    <div key={s.shift_id} className="flex flex-col items-end">
                                                                        <div className={`rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest mb-1 ${s.shift_type === 'morning' ? 'bg-emerald-500/10 text-emerald-400' : s.shift_type === 'evening' ? 'bg-orange-500/10 text-orange-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                                                                            {s.shift_type}
                                                                        </div>
                                                                        <div className="text-lg font-black text-white">
                                                                            {new Date(s.shift_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()} - {new Date(s.shift_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-sm font-bold italic text-slate-600 uppercase tracking-widest">Not scheduled</div>
                                                        )}
                                                    </div>

                                                    {/* Decor */}
                                                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -mr-32 -mt-32" />
                                                </div>
                                            );
                                        })()
                                    ) : (
                                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                            {filteredTimeline.map(staff => {
                                                const now = pulseTime;
                                                const hasActiveShift = staff.shifts.some(s => new Date(s.shift_start) <= now && new Date(s.shift_end) > now);

                                                return (
                                                    <div
                                                        key={staff.staff_id}
                                                        onClick={() => setSelectedStaffId(staff.staff_id)}
                                                        className="group/staff-card flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-indigo-500/30 hover:bg-indigo-500/[0.03] cursor-pointer"
                                                    >
                                                        <div className="flex items-center gap-4">
                                                            <div className="relative">
                                                                <img
                                                                    src={staff.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(staff.full_name)}&background=random`}
                                                                    className="h-12 w-12 rounded-xl object-cover ring-1 ring-white/10"
                                                                    alt=""
                                                                />
                                                                {hasActiveShift && <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#0a0a0c] bg-green-500 animate-pulse" />}
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-black text-white group-hover/staff-card:text-indigo-300 transition-colors">{staff.full_name}</div>
                                                                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                                                                    {staff.department_name} • <span className="text-indigo-400 opacity-60">{staff.assigned_zone_name || 'No Zone'}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="opacity-0 group-hover/staff-card:opacity-100 transition-opacity">
                                                            <ChevronRight size={16} className="text-indigo-500" />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── ASSIGN SHIFT MODAL ── */}
            {isShiftModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ colorScheme: 'dark' }}>
                    <div className="modal-content rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="px-8 pt-8 pb-5 border-b border-white/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                        <Plus size={22} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white">Assign New Shift</h3>
                                        <p className="text-sm font-bold text-slate-500">Create a new schedule entry for your team.</p>
                                    </div>
                                </div>
                                <button onClick={() => setIsShiftModalOpen(false)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Staff Member</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={shiftModalData.staffId}
                                        onChange={e => setShiftModalData({ ...shiftModalData, staffId: e.target.value })}
                                    >
                                        <option value="">Select Staff</option>
                                        {data?.timeline.map(s => (
                                            <option key={s.staff_id} value={s.staff_id}>{s.full_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shift Type</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={shiftModalData.type}
                                        onChange={e => setShiftModalData({ ...shiftModalData, type: e.target.value })}
                                    >
                                        <option value="morning">Morning</option>
                                        <option value="evening">Evening</option>
                                        <option value="night">Night</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Start Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={shiftModalData.startTime}
                                        onChange={e => setShiftModalData({ ...shiftModalData, startTime: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">End Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={shiftModalData.endTime}
                                        onChange={e => setShiftModalData({ ...shiftModalData, endTime: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Assignment Zone</label>
                                <select
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                    value={shiftModalData.zoneId}
                                    onChange={e => setShiftModalData({ ...shiftModalData, zoneId: e.target.value })}
                                >
                                    <option value="">No Specific Zone</option>
                                    {hotelZones.map(z => (
                                        <option key={z.id} value={z.id}>{z.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="p-8 bg-white/[0.02] border-t border-white/5 flex gap-3">
                            <button
                                onClick={() => setIsShiftModalOpen(false)}
                                className="flex-1 px-6 py-3 rounded-xl border border-white/10 text-sm font-black text-slate-400 hover:bg-white/5 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAssignShift}
                                disabled={!shiftModalData.staffId}
                                className="flex-1 px-6 py-3 rounded-xl bg-indigo-500 text-sm font-black text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Confirm Assignment
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── BULK ASSIGN MODAL ── */}
            {isBulkModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ colorScheme: 'dark' }}>
                    <div className="modal-content rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="px-8 pt-8 pb-5 border-b border-white/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                        <Users size={22} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white">Bulk Assign Shifts</h3>
                                        <p className="text-sm font-bold text-slate-500">Batch create shifts for multiple staff at once.</p>
                                    </div>
                                </div>
                                <button onClick={() => setIsBulkModalOpen(false)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Select Staff Members</label>
                                <div className="max-h-48 overflow-y-auto no-scrollbar grid grid-cols-2 gap-2 p-2 bg-white/5 border border-white/10 rounded-xl">
                                    {data?.timeline.map(s => (
                                        <label key={s.staff_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-all">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-white/10 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                                                checked={bulkModalData.staffIds.includes(s.staff_id)}
                                                onChange={e => {
                                                    const ids = e.target.checked
                                                        ? [...bulkModalData.staffIds, s.staff_id]
                                                        : bulkModalData.staffIds.filter(id => id !== s.staff_id);
                                                    setBulkModalData({ ...bulkModalData, staffIds: ids });
                                                }}
                                            />
                                            <span className="text-sm font-bold text-slate-200 truncate">{s.full_name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Start Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={bulkModalData.startTime}
                                        onChange={e => setBulkModalData({ ...bulkModalData, startTime: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">End Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={bulkModalData.endTime}
                                        onChange={e => setBulkModalData({ ...bulkModalData, endTime: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shift Type</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={bulkModalData.type}
                                        onChange={e => setBulkModalData({ ...bulkModalData, type: e.target.value })}
                                    >
                                        <option value="morning">Morning</option>
                                        <option value="evening">Evening</option>
                                        <option value="night">Night</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Zone (Optional)</label>
                                    <select
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        value={bulkModalData.zoneId}
                                        onChange={e => setBulkModalData({ ...bulkModalData, zoneId: e.target.value })}
                                    >
                                        <option value="">No Zone</option>
                                        {hotelZones.map(z => (
                                            <option key={z.id} value={z.id}>{z.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="p-8 bg-white/[0.02] border-t border-white/5 flex gap-3">
                            <button
                                onClick={() => setIsBulkModalOpen(false)}
                                className="flex-1 px-6 py-3 rounded-xl border border-white/10 text-sm font-black text-slate-400 hover:bg-white/5 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleBulkAssign}
                                disabled={bulkModalData.staffIds.length === 0}
                                className="flex-1 px-6 py-3 rounded-xl bg-indigo-500 text-sm font-black text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Create {bulkModalData.staffIds.length} Shifts
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ── EDIT SHIFT MODAL ── */}
            {selectedShift && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ colorScheme: 'dark' }}>
                    <div className="modal-content rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="px-8 pt-8 pb-5 border-b border-white/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                        <Edit3 size={22} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white">Edit Shift</h3>
                                        <p className="text-sm font-bold text-slate-500">Update shift timings or reassignment details.</p>
                                    </div>
                                </div>
                                <div className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors" onClick={() => setSelectedShift(null)}>
                                    <X size={24} />
                                </div>
                            </div>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Start Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        defaultValue={selectedShift ? new Date(selectedShift.shift_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ""}
                                        id="edit-start-time"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">End Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                        defaultValue={selectedShift ? new Date(selectedShift.shift_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ""}
                                        id="edit-end-time"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shift Type</label>
                                <select
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                    defaultValue={selectedShift?.shift_type}
                                    id="edit-shift-type"
                                >
                                    <option value="morning">Morning</option>
                                    <option value="evening">Evening</option>
                                    <option value="night">Night</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Zone</label>
                                <select
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-indigo-500 transition-all"
                                    defaultValue={selectedShift?.zone_id || ""}
                                    id="edit-zone-id"
                                >
                                    <option value="">No Specific Zone</option>
                                    {hotelZones.map(z => (
                                        <option key={z.id} value={z.id}>{z.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="p-8 bg-white/[0.02] border-t border-white/5 flex gap-3">
                            <button
                                onClick={() => setSelectedShift(null)}
                                className="flex-1 px-6 py-3 rounded-xl border border-white/10 text-sm font-black text-slate-400 hover:bg-white/5 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => {
                                    if (!selectedShift) return;
                                    const currentShift = selectedShift; // Capture for async scope
                                    const sT = (document.getElementById('edit-start-time') as HTMLInputElement).value;
                                    const eT = (document.getElementById('edit-end-time') as HTMLInputElement).value;
                                    const sTy = (document.getElementById('edit-shift-type') as HTMLSelectElement).value;
                                    const zId = (document.getElementById('edit-zone-id') as HTMLSelectElement).value;

                                    const start = new Date(currentShift.shift_start);
                                    const [sH, sM] = sT.split(':').map(Number);
                                    start.setHours(sH, sM, 0, 0);

                                    const end = new Date(currentShift.shift_end);
                                    const [eH, eM] = eT.split(':').map(Number);
                                    end.setHours(eH, eM, 0, 0);
                                    if (end <= start) end.setDate(end.getDate() + 1);

                                    await handleShiftOperation('update_shift', {
                                        p_shift_id: currentShift.shift_id,
                                        p_start: start.toISOString(),
                                        p_end: end.toISOString(),
                                        p_type: sTy,
                                        p_zone: zId || null,
                                        p_version: currentShift.version,
                                        p_user: userId
                                    });
                                    // Unlock after edit
                                    await supabase.rpc('unlock_shift', { p_id: currentShift.shift_id, p_user: userId });
                                    isEditingRef.current = false;
                                    setSelectedShift(null);
                                }}
                                className="flex-1 px-6 py-3 rounded-xl bg-indigo-500 text-sm font-black text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {isRoleModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md" style={{ colorScheme: 'dark' }}>
                    <div className="modal-content rounded-[28px] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                        {/* Header */}
                        <div className="px-8 pt-8 pb-5 border-b border-white/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                                        <Shield size={22} strokeWidth={2.5} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white">Assign Member Roles</h3>
                                        <p className="text-sm font-bold text-slate-500">Map a team member to one or multiple roles.</p>
                                    </div>
                                </div>
                                <button onClick={() => setIsRoleModalOpen(false)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="px-8 py-6 space-y-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                            {roleModalLoading ? (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 size={32} className="text-indigo-500 animate-spin mb-4" />
                                    <p className="text-sm font-bold text-slate-500">Loading Members & Roles...</p>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Select Team Member</label>
                                        <div className="relative group">
                                            <select
                                                value={selectedMemberId}
                                                onChange={(e) => handleMemberSelection(e.target.value)}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm font-bold text-white focus:bg-white/[0.08] focus:border-indigo-500 transition-all outline-none appearance-none cursor-pointer"
                                                style={{ colorScheme: 'dark' }}
                                            >
                                                <option value="" disabled className="bg-[#0a0a0c] text-slate-400">-- Select a Member --</option>
                                                {modalMembersList.map(m => (
                                                    <option key={m.id} value={m.id} className="bg-[#0a0a0c] text-white">{m.name}</option>
                                                ))}
                                            </select>
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                                <ChevronDown size={18} strokeWidth={3} />
                                            </div>
                                        </div>
                                    </div>

                                    {selectedMemberId && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Manage Member Roles</label>
                                            <div className="grid gap-2">
                                                {modalRolesList.length === 0 ? (
                                                    <div className="p-10 text-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
                                                        <div className="flex justify-center mb-3">
                                                            <div className="p-3 bg-white/5 rounded-xl text-slate-600">
                                                                <Check size={24} />
                                                            </div>
                                                        </div>
                                                        <p className="text-sm font-black text-white">No Roles Defined</p>
                                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter mt-1">Please set up hotel roles first.</p>
                                                    </div>
                                                ) : (
                                                    modalRolesList.map(role => {
                                                        const isChecked = selectedRoleIds.includes(role.id);
                                                        return (
                                                            <div
                                                                key={role.id}
                                                                onClick={() => {
                                                                    setSelectedRoleIds(prev =>
                                                                        prev.includes(role.id) ? prev.filter(r => r !== role.id) : [...prev, role.id]
                                                                    );
                                                                }}
                                                                className={`group flex items-center gap-4 p-4 rounded-2xl cursor-pointer border transition-all ${isChecked
                                                                        ? 'bg-indigo-500/10 border-indigo-500/30'
                                                                        : 'bg-white/[0.02] border-white/5 hover:border-white/20 hover:bg-white/[0.04]'
                                                                    }`}
                                                            >
                                                                <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all border-2 ${isChecked
                                                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                                                        : 'bg-white/5 border-white/10 text-transparent'
                                                                    }`}>
                                                                    <Check size={14} strokeWidth={4} />
                                                                </div>
                                                                <div className="flex-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className={`text-sm font-black tracking-tight ${isChecked ? 'text-indigo-400' : 'text-slate-200'}`}>
                                                                            {role.name}
                                                                        </span>
                                                                        {role.isTemplate && (
                                                                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-white/5 text-slate-600">
                                                                                Template
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-[10px] font-bold text-slate-600 font-mono mt-0.5">{role.code}</div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-6 mt-auto bg-white/[0.02] border-t border-white/5 flex justify-end gap-3">
                            <button
                                onClick={() => setIsRoleModalOpen(false)}
                                className="px-6 py-3 text-sm font-black text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveRoleAssignments}
                                disabled={roleModalSaving || roleModalLoading || !selectedMemberId || selectedRoleIds.length === 0}
                                className="action-button-primary flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-black transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                                {roleModalSaving ? (
                                    <><Loader2 size={16} className="animate-spin" /> Saving Mapping…</>
                                ) : (
                                    <><Save size={16} /> Save New Assignments</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── WEEKLY SCHEDULER MODAL ── */}
            {isWeeklyModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setIsWeeklyModalOpen(false)} />
                    <div className="relative w-full max-w-2xl bg-gradient-to-br from-[#111118] to-[#0d0d14] rounded-3xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="px-8 py-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                                    <CalendarDays size={20} className="text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white tracking-tight">Weekly Scheduling</h2>
                                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">Create recurring shift patterns</p>
                                </div>
                            </div>
                            <button onClick={() => setIsWeeklyModalOpen(false)} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all">
                                <X size={16} className="text-slate-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

                            {/* Staff Selector */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Staff</label>
                                <div className="relative">
                                    <select
                                        value={weeklyData.staffId}
                                        onChange={e => setWeeklyData({ ...weeklyData, staffId: e.target.value })}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 pr-10 py-3.5 text-sm font-bold text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all cursor-pointer"
                                    >
                                        <option value="">Select staff member...</option>
                                        {data?.timeline.map(staff => (
                                            <option key={staff.staff_id} value={staff.staff_id}>
                                                {staff.full_name} {staff.department_name ? `| ${staff.department_name.toUpperCase()}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                            </div>

                            {/* Day Toggles */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Days</label>
                                <div className="flex gap-2">
                                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => {
                                        const isSelected = weeklyData.days.includes(i);
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    setWeeklyData({
                                                        ...weeklyData,
                                                        days: isSelected
                                                            ? weeklyData.days.filter(d => d !== i)
                                                            : [...weeklyData.days, i].sort()
                                                    });
                                                    setWeeklyPreview(null);
                                                }}
                                                className={`w-10 h-10 rounded-xl text-xs font-black transition-all border ${isSelected
                                                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                                        : 'bg-white/[0.03] border-white/10 text-slate-500 hover:border-white/20 hover:text-white'
                                                    }`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Time & Type Row */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Type</label>
                                    <div className="relative">
                                        <select
                                            value={weeklyData.type}
                                            onChange={e => setWeeklyData({ ...weeklyData, type: e.target.value })}
                                            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 pr-10 py-3 text-sm font-bold text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all cursor-pointer"
                                        >
                                            <option value="morning">Morning</option>
                                            <option value="evening">Evening</option>
                                            <option value="night">Night</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Start</label>
                                    <input
                                        type="time"
                                        value={weeklyData.startTime}
                                        onChange={e => { setWeeklyData({ ...weeklyData, startTime: e.target.value }); setWeeklyPreview(null); }}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">End</label>
                                    <input
                                        type="time"
                                        value={weeklyData.endTime}
                                        onChange={e => { setWeeklyData({ ...weeklyData, endTime: e.target.value }); setWeeklyPreview(null); }}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    />
                                </div>
                            </div>

                            {/* Zone */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Zone</label>
                                <div className="relative">
                                    <select
                                        value={weeklyData.zoneId}
                                        onChange={e => setWeeklyData({ ...weeklyData, zoneId: e.target.value })}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 pr-10 py-3 text-sm font-bold text-white appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all cursor-pointer"
                                    >
                                        <option value="">All Zones</option>
                                        {hotelZones.map(z => (
                                            <option key={z.id} value={z.id}>{z.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                            </div>

                            {/* Date Range */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">From</label>
                                    <input
                                        type="date"
                                        value={weeklyData.rangeStart}
                                        onChange={e => { setWeeklyData({ ...weeklyData, rangeStart: e.target.value }); setWeeklyPreview(null); }}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">To</label>
                                    <input
                                        type="date"
                                        value={weeklyData.rangeEnd}
                                        onChange={e => { setWeeklyData({ ...weeklyData, rangeEnd: e.target.value }); setWeeklyPreview(null); }}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                    />
                                </div>
                            </div>

                            {/* Preview Button */}
                            <div className="flex justify-end">
                                <button
                                    onClick={handleWeeklyPreview}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-black hover:bg-indigo-500/20 transition-all"
                                >
                                    <BarChart2 size={14} /> Preview Schedule
                                </button>
                            </div>

                            {/* Preview Grid */}
                            {weeklyPreview && weeklyPreview.length > 0 && (
                                <div className="space-y-4">
                                    {/* Staff Badge */}
                                    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                            <User size={16} className="text-indigo-400" />
                                        </div>
                                        <div>
                                            <span className="text-sm font-black text-white">
                                                {data?.timeline.find(s => s.staff_id === weeklyData.staffId)?.full_name || 'Staff'}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-500 ml-2">
                                                {weeklyData.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} · {weeklyData.startTime} → {weeklyData.endTime}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Grid Table */}
                                    <div className="rounded-xl border border-white/5 overflow-hidden">
                                        <div className="bg-white/[0.02] px-4 py-2 border-b border-white/5 grid grid-cols-[1fr_100px_80px] gap-2">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Date</span>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Time</span>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Status</span>
                                        </div>
                                        <div className="max-h-[200px] overflow-y-auto">
                                            {weeklyPreview.map((p, i) => (
                                                <div
                                                    key={i}
                                                    className={`px-4 py-3 grid grid-cols-[minmax(100px,1fr)_80px_1fr] gap-4 items-center border-b border-white/[0.03] last:border-0 ${p.conflict ? 'bg-red-500/[0.03]' : 'bg-white/[0.01]'
                                                        }`}
                                                >
                                                    <div>
                                                        <span className="text-xs font-bold text-white">
                                                            {p.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                        </span>
                                                    </div>
                                                    <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">{weeklyData.startTime}–{weeklyData.endTime}</span>
                                                    <div className="flex justify-start">
                                                        {p.conflict ? (
                                                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-400 truncate">
                                                                <span className="text-xs">❌</span> {p.conflictReason || 'Conflict'}
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 truncate">
                                                                <span className="text-xs">✅</span> Clear
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Conflict Summary */}
                                    {(() => {
                                        const conflicts = weeklyPreview.filter(p => p.conflict).length;
                                        const clear = weeklyPreview.filter(p => !p.conflict).length;
                                        return (
                                            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${conflicts > 0 ? 'bg-amber-500/[0.05] border-amber-500/20' : 'bg-emerald-500/[0.05] border-emerald-500/20'
                                                }`}>
                                                {conflicts > 0 ? (
                                                    <AlertCircle size={16} className="text-amber-400" />
                                                ) : (
                                                    <Check size={16} className="text-emerald-400" />
                                                )}
                                                <div className="text-xs font-bold">
                                                    {conflicts > 0 ? (
                                                        <span className="text-amber-400">
                                                            Conflicts: {conflicts} · Will create {clear} shifts
                                                        </span>
                                                    ) : (
                                                        <span className="text-emerald-400">
                                                            All {clear} shifts are clear — ready to apply
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-5 border-t border-white/5 bg-white/[0.02] flex justify-end gap-3">
                            <button
                                onClick={() => setIsWeeklyModalOpen(false)}
                                className="px-6 py-3 text-sm font-black text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleWeeklyApply}
                                disabled={!weeklyPreview || weeklyPreview.filter(p => !p.conflict).length === 0 || weeklyApplying}
                                className="action-button-primary flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-black transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                                {weeklyApplying ? (
                                    <><Loader2 size={16} className="animate-spin" /> Applying…</>
                                ) : (
                                    <><CalendarDays size={16} /> Apply Schedule</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SMART SCHEDULER MODAL ── */}
            {isSmartModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setIsSmartModalOpen(false)} />
                    <div className="relative w-full max-w-3xl bg-gradient-to-br from-[#111118] to-[#0d0d14] rounded-3xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="px-8 py-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                                    <Sparkles size={20} className="text-amber-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-white tracking-tight">Smart Scheduler</h2>
                                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">Automatically generate an optimized schedule for the week</p>
                                </div>
                            </div>
                            <button onClick={() => setIsSmartModalOpen(false)} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all">
                                <X size={16} className="text-slate-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

                            {/* Config Row: Week, Zone, Demand */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Week</label>
                                    <input
                                        type="date"
                                        value={smartState.weekStart}
                                        onChange={e => setSmartState(prev => ({ ...prev, weekStart: e.target.value, plan: null }))}
                                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Zone</label>
                                    <div className="relative">
                                        <select
                                            value={smartState.zoneId}
                                            onChange={e => setSmartState(prev => ({ ...prev, zoneId: e.target.value, plan: null }))}
                                            className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 pr-10 py-3 text-sm font-bold text-white appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-all cursor-pointer"
                                        >
                                            <option value="">All Zones</option>
                                            {hotelZones.map(z => (
                                                <option key={z.id} value={z.id}>{z.name}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Week Range</label>
                                    <div className="bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-slate-400">
                                        {(() => {
                                            const ws = new Date(smartState.weekStart + 'T00:00:00');
                                            const we = new Date(ws.getTime() + 6 * 86400000);
                                            return `${ws.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${we.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
                                        })()}
                                    </div>
                                </div>
                            </div>

                            {/* Demand Config */}
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 block">Demand per Day</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {smartState.demand.map((d, i) => (
                                        <div key={d.shift_type} className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {d.shift_type === 'morning' && <Sun size={14} className="text-amber-400" />}
                                                {d.shift_type === 'evening' && <Moon size={14} className="text-purple-400" />}
                                                {d.shift_type === 'night' && <Moon size={14} className="text-indigo-400" />}
                                                <span className="text-xs font-black text-white capitalize">{d.shift_type}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => {
                                                        const newDemand = [...smartState.demand];
                                                        newDemand[i] = { ...d, required: Math.max(0, d.required - 1) };
                                                        setSmartState(prev => ({ ...prev, demand: newDemand, plan: null }));
                                                    }}
                                                    className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all text-xs font-black"
                                                >−</button>
                                                <span className="text-sm font-black text-white w-4 text-center">{d.required}</span>
                                                <button
                                                    onClick={() => {
                                                        const newDemand = [...smartState.demand];
                                                        newDemand[i] = { ...d, required: d.required + 1 };
                                                        setSmartState(prev => ({ ...prev, demand: newDemand, plan: null }));
                                                    }}
                                                    className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all text-xs font-black"
                                                >+</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Loading Shimmer */}
                            {smartState.loading && (
                                <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-6 py-4">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/10 to-transparent animate-pulse" style={{ animationDuration: '1.5s' }} />
                                    <div className="relative flex items-center gap-3">
                                        <Loader2 size={18} className="text-amber-400 animate-spin" />
                                        <span className="text-sm font-black text-amber-400">Generating optimal schedule...</span>
                                    </div>
                                </div>
                            )}

                            {/* Generate Button */}
                            {!smartState.plan && !smartState.loading && (
                                <div className="flex justify-center">
                                    <button
                                        onClick={handleGeneratePlan}
                                        className="flex items-center gap-2 px-8 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-black hover:bg-amber-500/20 transition-all"
                                    >
                                        <Sparkles size={16} /> Generate Schedule
                                    </button>
                                </div>
                            )}

                            {/* Error */}
                            {smartState.error && (
                                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.05] border border-red-500/20">
                                    <AlertCircle size={16} className="text-red-400" />
                                    <span className="text-xs font-bold text-red-400">{smartState.error}</span>
                                </div>
                            )}

                            {/* Plan Preview */}
                            {smartState.plan && (
                                <div className="space-y-4">
                                    {/* Summary */}
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/20">
                                            <Check size={14} className="text-emerald-400" />
                                            <span className="text-xs font-black text-emerald-400">{smartState.plan.assignments.length} shifts assigned</span>
                                        </div>
                                        {smartState.plan.conflicts.length > 0 && (
                                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/[0.08] border border-amber-500/20">
                                                <AlertCircle size={14} className="text-amber-400" />
                                                <span className="text-xs font-black text-amber-400">{smartState.plan.conflicts.length} conflicts</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* AI Optimizer Banner */}
                                    {smartOptimized.improving && (
                                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-500/[0.05] border border-indigo-500/20">
                                            <Loader2 size={16} className="text-indigo-400 animate-spin" />
                                            <span className="text-xs font-bold text-indigo-400">AI is searching for global optimizations in background...</span>
                                        </div>
                                    )}
                                    {smartOptimized.showBanner && smartOptimized.improvedPlan && (
                                        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 shadow-lg shadow-indigo-500/5">
                                            <div className="flex items-center gap-3">
                                                <Sparkles size={16} className="text-indigo-400" />
                                                <div>
                                                    <span className="text-xs font-black text-indigo-300 block">Better schedule available!</span>
                                                    <span className="text-[10px] font-bold text-indigo-400/70">Score improved: {smartOptimized.baseScore} → {smartOptimized.improvedScore}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleApplyPlan(true)}
                                                disabled={smartApplying}
                                                className="px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-black shadow-[0_0_15px_rgba(99,102,241,0.3)] transition-all flex items-center gap-2"
                                            >
                                                {smartApplying ? <Loader2 size={14} className="animate-spin" /> : "Apply Improved"}
                                            </button>
                                        </div>
                                    )}

                                    {/* Staff × Day Grid */}
                                    {(() => {
                                        const assignments = smartState.plan!.assignments;
                                        const weekStart = new Date(smartState.weekStart + 'T00:00:00');
                                        const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));
                                        const staffMap = new Map<string, { name: string; shifts: Map<string, any[]> }>();

                                        assignments.forEach((a: any) => {
                                            const staffId = a.staff_id;
                                            if (!staffMap.has(staffId)) {
                                                const staffInfo = data?.timeline.find(s => s.staff_id === staffId);
                                                staffMap.set(staffId, {
                                                    name: staffInfo?.full_name || staffId.substring(0, 8),
                                                    shifts: new Map()
                                                });
                                            }
                                            const dayKey = new Date(a.shift_start).toISOString().split('T')[0];
                                            const entry = staffMap.get(staffId)!;
                                            if (!entry.shifts.has(dayKey)) entry.shifts.set(dayKey, []);
                                            entry.shifts.get(dayKey)!.push(a);
                                        });

                                        const typeColors: Record<string, string> = {
                                            morning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                                            evening: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
                                            night: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                        };

                                        return (
                                            <div className="rounded-xl border border-white/5 overflow-hidden">
                                                {/* Header Row */}
                                                <div className="bg-white/[0.02] border-b border-white/5 grid" style={{ gridTemplateColumns: '120px repeat(7, 1fr)' }}>
                                                    <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">Staff</div>
                                                    {days.map((d, i) => (
                                                        <div key={i} className="px-2 py-2 text-center">
                                                            <div className="text-[10px] font-black uppercase text-slate-500">{d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                                                            <div className="text-[10px] font-bold text-slate-600">{d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {/* Staff Rows */}
                                                <div className="max-h-[220px] overflow-y-auto">
                                                    {Array.from(staffMap.entries()).map(([staffId, staff]) => (
                                                        <div key={staffId} className="grid border-b border-white/[0.03] last:border-0" style={{ gridTemplateColumns: '120px repeat(7, 1fr)' }}>
                                                            <div className="px-3 py-2 flex items-center">
                                                                <span className="text-[11px] font-bold text-white truncate">{staff.name}</span>
                                                            </div>
                                                            {days.map((d, i) => {
                                                                const dayKey = d.toISOString().split('T')[0];
                                                                const dayShifts = staff.shifts.get(dayKey) || [];
                                                                return (
                                                                    <div key={i} className="px-1 py-1.5 flex flex-col gap-1">
                                                                        {dayShifts.map((s: any, si: number) => {
                                                                            const start = new Date(s.shift_start);
                                                                            const end = new Date(s.shift_end);
                                                                            const colorClass = typeColors[s.shift_type] || 'bg-white/10 text-white';
                                                                            return (
                                                                                <div key={si} className={`px-1.5 py-1 rounded-md border text-[9px] font-bold text-center ${colorClass}`}>
                                                                                    {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}–{end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Conflicts Detail */}
                                    {smartState.showConflicts && smartState.plan.conflicts.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-400">Conflicts</h4>
                                            {smartState.plan.conflicts.map((c: any, i: number) => (
                                                <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-500/[0.03] border border-amber-500/10">
                                                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                                                    <span className="text-xs font-bold text-slate-300">
                                                        {new Date(c.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                    </span>
                                                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-white/5 text-slate-400">{c.shift_type}</span>
                                                    <span className="text-xs font-bold text-amber-400/80">{c.reason === 'no_available_staff' ? 'No available staff' : c.reason}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Re-generate */}
                                    <div className="flex justify-center">
                                        <button
                                            onClick={handleGeneratePlan}
                                            disabled={smartState.loading}
                                            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:text-white hover:bg-white/10 transition-all"
                                        >
                                            <Repeat size={12} /> Re-generate
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-5 border-t border-white/5 bg-white/[0.02] flex justify-end gap-3">
                            {smartState.plan && smartState.plan.conflicts.length > 0 && (
                                <button
                                    onClick={() => setSmartState(prev => ({ ...prev, showConflicts: !prev.showConflicts }))}
                                    className="px-6 py-3 text-sm font-black text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/5 rounded-xl transition-all border border-amber-500/20"
                                >
                                    {smartState.showConflicts ? 'Hide Conflicts' : 'See Conflicts'}
                                </button>
                            )}
                            <button
                                onClick={() => setIsSmartModalOpen(false)}
                                className="px-6 py-3 text-sm font-black text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApplyPlan}
                                disabled={!smartState.plan || smartState.plan.assignments.length === 0 || smartApplying}
                                className="action-button-primary flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-black transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                                {smartApplying ? (
                                    <><Loader2 size={16} className="animate-spin" /> Applying…</>
                                ) : (
                                    <><Sparkles size={16} /> Apply Schedule</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── TOAST NOTIFICATIONS ── */}
            <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div
                        key={t.id}
                        className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border text-sm font-bold animate-in fade-in slide-in-from-bottom-2 duration-300 ${t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                t.type === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                    'bg-red-500/10 border-red-500/20 text-red-400'
                            }`}
                    >
                        {t.type === 'success' && <Check size={16} strokeWidth={3} />}
                        {t.type === 'warning' && <AlertCircle size={16} strokeWidth={3} />}
                        {t.type === 'error' && <X size={16} strokeWidth={3} />}
                        {t.message}
                    </div>
                ))}
            </div>
            {/* ── DEPARTMENT ASSIGNMENT MODAL ── */}
            {isDepartmentModalOpen && selectedStaffId && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0a0a0c]/80 backdrop-blur-xl" onClick={() => setIsDepartmentModalOpen(false)} />
                    {/* Removed overflow-hidden to prevent absolute dropdown clipping */}
                    <div className="relative w-full max-w-2xl rounded-[32px] border border-white/10 bg-[#121216] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Manage Departments</h2>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight mt-1">Configure workspace access & primary roles</p>
                            </div>
                            <button onClick={() => setIsDepartmentModalOpen(false)} className="rounded-full bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Removed max-h-[400px] overflow-y-auto to prevent absolute dropdown clipping */}
                        <div className="space-y-4 pr-2">
                            {/* In production, this section would map over the staff's actual department memberships */}
                            {staffDepartments.map((sd) => (
                                <div key={sd.department_id} className={`flex items-center justify-between p-5 rounded-2xl border ${sd.is_primary ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50 shadow-lg shadow-indigo-500/5' : 'bg-white/[0.02] border-white/5'}`}>
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xl ${sd.is_primary ? 'bg-indigo-500 text-white' : 'bg-white/5 border border-white/10 text-slate-400'}`}>
                                            <Layout size={22} strokeWidth={2.5} />
                                        </div>
                                        <div>
                                            <div className="text-base font-black text-white">{sd.departments?.name || 'Unknown Department'}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {sd.is_primary ? (
                                                    <>
                                                        <span className="text-[10px] font-black uppercase text-indigo-400">Primary Department</span>
                                                        <div className="w-1 h-1 rounded-full bg-slate-700" />
                                                    </>
                                                ) : null}
                                                <span className="text-[10px] font-bold text-slate-500 uppercase">Priority {sd.priority || 2}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <button 
                                            onClick={async () => {
                                                if (sd.is_primary) {
                                                    return showToast('Cannot disable the primary department. Please make another department primary first.', 'warning');
                                                }
                                                if (!confirm(`Are you sure you want to remove ${sd.departments?.name}?`)) return;
                                                
                                                try {
                                                    const { error } = await supabase
                                                        .from('staff_departments')
                                                        .delete()
                                                        .eq('staff_id', selectedStaffId)
                                                        .eq('department_id', sd.department_id);
                                                    
                                                    if (error) throw error;
                                                    showToast(`${sd.departments?.name} removed successfully`, 'success');
                                                    await fetchStaffDepts();
                                                    refetchDashboard();
                                                } catch (err: any) {
                                                    console.error('Disable dept error:', err);
                                                    showToast(err.message || 'Failed to remove department', 'error');
                                                }
                                            }}
                                            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-red-400 transition-colors"
                                        >
                                            Disable
                                        </button>
                                        <div className="w-px h-4 bg-white/10" />
                                        <button 
                                            disabled={sd.is_primary}
                                            onClick={async () => {
                                                try {
                                                    // 1. Remove primary status from all departments for this staff
                                                    const { error: err1 } = await supabase
                                                        .from('staff_departments')
                                                        .update({ is_primary: false })
                                                        .eq('staff_id', selectedStaffId);
                                                    if (err1) throw err1;

                                                    // 2. Set the selected department as primary and priority 1
                                                    const { error: err2 } = await supabase
                                                        .from('staff_departments')
                                                        .update({ is_primary: true, priority: 1 })
                                                        .eq('staff_id', selectedStaffId)
                                                        .eq('department_id', sd.department_id);
                                                    if (err2) throw err2;

                                                    showToast(`${sd.departments?.name} is now the primary department`, 'success');
                                                    await fetchStaffDepts();
                                                    refetchDashboard();
                                                } catch (err: any) {
                                                    console.error('Make primary error:', err);
                                                    showToast(err.message || 'Failed to update primary department', 'error');
                                                }
                                            }}
                                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors ${sd.is_primary ? 'bg-white/5 text-slate-400 cursor-not-allowed' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                        >
                                            {sd.is_primary ? 'Is Primary' : 'Make Primary'}
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {/* Assign Additional Department - CUSTOM PREMIUM DROPDOWN */}
                            <div className="relative mt-4">
                                <div
                                    onClick={() => !isAddDeptDropdownOpen && setIsAddDeptDropdownOpen(true)}
                                    className={`flex items-center justify-between p-5 rounded-2xl border border-dashed transition-all cursor-pointer group ${isAddDeptDropdownOpen ? 'bg-white/[0.04] border-white/20 ring-1 ring-white/10' : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'}`}
                                >
                                    <div className="flex items-center gap-4 text-slate-500 group-hover:text-white transition-colors flex-1">
                                        <div className="w-12 h-12 rounded-2xl border border-dashed border-white/10 group-hover:border-white/20 flex items-center justify-center shrink-0">
                                            <Plus size={20} className={isAddDeptDropdownOpen ? 'rotate-45 transition-transform' : 'transition-transform'} />
                                        </div>
                                        <div className="flex-1 mr-4">
                                            <span className={`text-sm font-bold transition-colors ${isAddDeptDropdownOpen ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>
                                                Assign to additional department...
                                            </span>
                                        </div>
                                    </div>
                                    <div className="pointer-events-none px-5 py-2.5 rounded-xl bg-white/5 text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white transition-colors">Select</div>
                                </div>

                                {isAddDeptDropdownOpen && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-10"
                                            onClick={(e) => { e.stopPropagation(); setIsAddDeptDropdownOpen(false); }}
                                        />
                                        <div className="absolute top-[calc(100%+8px)] left-0 right-0 p-3 bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 z-50 animate-in fade-in slide-in-from-top-2">
                                            <div className="px-4 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 border-b border-white/5 pb-3">
                                                Select a Department
                                            </div>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
                                                {(() => {
                                                    const assignedDeptIds = new Set(staffDepartments.map(sd => sd.department_id));
                                                    const availableDepartments = hotelDepartments.filter((d: any) => !assignedDeptIds.has(d.id));

                                                    if (availableDepartments.length === 0) {
                                                        return (
                                                            <div className="px-4 py-4 text-sm font-medium text-slate-500 text-center bg-white/[0.02] rounded-xl border border-dashed border-white/5">
                                                                No other departments available
                                                            </div>
                                                        );
                                                    }

                                                    return availableDepartments.map((d: any) => (
                                                        <button
                                                            key={d.id}
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                setIsAddDeptDropdownOpen(false);
                                                                try {
                                                                    const { error } = await supabase.from('staff_departments').insert({
                                                                        staff_id: selectedStaffId,
                                                                        department_id: d.id,
                                                                        is_primary: false,
                                                                        priority: staffDepartments.length + 1
                                                                    });
                                                                    if (error) {
                                                                        if (error.code === '23505') {
                                                                            showToast('Staff is already assigned to this department', 'warning');
                                                                        } else {
                                                                            throw error;
                                                                        }
                                                                    } else {
                                                                        showToast('Department assigned successfully', 'success');
                                                                        await fetchStaffDepts(); // immediately refresh the inline list
                                                                        refetchDashboard();
                                                                    }
                                                                } catch (err: any) {
                                                                    console.error('Add dept error:', err);
                                                                    showToast(err.message || 'Failed to assign department', 'error');
                                                                }
                                                            }}
                                                            className="w-full text-left px-5 py-3.5 text-sm font-bold text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-all flex items-center justify-between group"
                                                        >
                                                            <span>{d.name}</span>
                                                            <Plus size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </button>
                                                    ));
                                                })()}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="mt-10 flex gap-4">
                            <button
                                onClick={() => setIsDepartmentModalOpen(false)}
                                className="flex-1 bg-white/[0.05] py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-white hover:bg-white/[0.08] transition-all border border-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    showToast('Department configuration updated', 'success');
                                    setIsDepartmentModalOpen(false);
                                }}
                                className="flex-1 bg-gradient-to-r from-indigo-500 to-blue-600 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                            >
                                Save Changes
                            </button>
                        </div>

                        {/* High-End Decor */}
                        <div className="absolute -top-24 -left-24 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
                        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
                    </div>
                </div>
            )}

            {/* ── ROSTER DETAILS MODAL ── */}
            {rosterDetailType && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-[#0a0a0c]/80 backdrop-blur-xl" onClick={() => setRosterDetailType(null)} />
                    <div className="relative w-full max-w-lg rounded-[32px] border border-white/10 bg-[#121216] p-8 shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between mb-6 shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">
                                    {rosterDetailType === 'on_shift' ? 'Staff On Shift' : 'Staff Off Duty'}
                                </h2>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight mt-1">Live Status Overview</p>
                            </div>
                            <button onClick={() => setRosterDetailType(null)} className="rounded-full bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
                            {(() => {
                                const relevantStaff = data?.timeline.filter(staff => {
                                    if (rosterDetailType === 'on_shift') return staff.has_shift;
                                    return !staff.has_shift;
                                }) || [];

                                if (relevantStaff.length === 0) {
                                    return (
                                        <div className="p-8 text-center text-slate-500 text-sm font-medium italic border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
                                            No staff members match this criteria right now.
                                        </div>
                                    );
                                }

                                return relevantStaff.map(staff => {
                                    // Find the "most relevant" shift to show: either the current one, or the first scheduled one of the day
                                    const now = pulseTime;
                                    const currentShift = staff.shifts.find(s => new Date(s.shift_start) <= now && new Date(s.shift_end) > now) 
                                                      || staff.shifts.find(s => s.status === 'scheduled');

                                    return (
                                        <div key={staff.staff_id} className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 group hover:bg-white/[0.04] transition-all">
                                            <div className="w-12 h-12 shrink-0 relative">
                                                <div className="w-full h-full rounded-xl bg-white/10 overflow-hidden flex items-center justify-center border border-white/5">
                                                    {staff.avatar_url ? (
                                                        <img src={staff.avatar_url} alt={staff.full_name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <User size={20} className="text-slate-400" />
                                                    )}
                                                </div>
                                                {staff.is_verified && (
                                                    <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 rounded-full p-1 border-2 border-[#121216] shadow-xl z-20">
                                                        <Check size={9} strokeWidth={4} className="text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-bold text-slate-100 truncate">{staff.full_name}</div>
                                                </div>
                                                <div className="text-[10px] font-medium text-slate-500 truncate mb-1">{staff.email || 'No email provided'}</div>
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[120px]">
                                                        {staff.departments && staff.departments.length > 0 
                                                            ? staff.departments.map(d => d.name).join(', ') 
                                                            : staff.department_name || 'No Dept'}
                                                    </div>
                                                    <div className="h-1 w-1 rounded-full bg-white/10" />
                                                    <div className="text-[9px] font-black text-indigo-400 uppercase tracking-widest truncate">{staff.assigned_zone_name || 'No Zone'}</div>
                                                </div>
                                            </div>
                                            
                                            {currentShift && (
                                                <div className="text-right shrink-0 pl-4 border-l border-white/5">
                                                    <div className={`text-[9px] font-black uppercase tracking-widest mb-1 px-2 py-0.5 rounded-full border inline-block ${new Date(currentShift.shift_start) <= now && new Date(currentShift.shift_end) > now ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-slate-400 border-white/10'}`}>
                                                        {currentShift.shift_type}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-slate-400 flex items-center justify-end gap-1">
                                                        <Clock size={10} className="text-slate-600" />
                                                        {new Date(currentShift.shift_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {new Date(currentShift.shift_end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            )}
                                            <button 
                                                className="ml-auto shrink-0 p-2 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:border-red-500/20 text-red-400 transition-all"
                                                onClick={(e) => { e.stopPropagation(); setDeactivateUserModal(staff); }}
                                            >
                                                <UserX size={18} className="text-red-500/50 group-hover:text-red-400 transition-colors" />
                                            </button>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                </div>
            )}


            {/* ── DEACTIVATE USER SUB-MODAL ── */}
            {deactivateUserModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setDeactivateUserModal(null)} />
                    <div className="relative w-full max-w-[400px] bg-white rounded-3xl overflow-hidden shadow-2xl font-sans animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center border-b border-slate-100 flex items-center justify-center relative">
                            <h3 className="text-lg font-black text-slate-800">Deactivate User?</h3>
                            <button onClick={() => setDeactivateUserModal(null)} className="absolute right-6 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <p className="text-sm font-medium text-slate-600 text-center">
                                Are you sure you want to deactivate <span className="font-bold text-slate-900">{deactivateUserModal.full_name}</span>?
                            </p>
                            <div className="p-4 bg-emerald-50 rounded-2xl flex items-start gap-3 border border-emerald-100">
                                <div className="mt-0.5 rounded text-emerald-600"><Check size={18} strokeWidth={3} /></div>
                                <p className="text-sm font-bold text-emerald-800 leading-snug">This will prevent the user from being scheduled.</p>
                            </div>
                            <div className="space-y-2">
                                <div className="relative">
                                    <div className="absolute top-3.5 left-4 text-amber-500"><AlertTriangle size={18} /></div>
                                    <textarea 
                                        placeholder="Reason (required)" 
                                        value={deactivateReason}
                                        onChange={(e) => setDeactivateReason(e.target.value)}
                                        className="w-full bg-white border border-amber-200 focus:border-amber-400 rounded-2xl py-3 pl-12 pr-4 text-sm font-medium text-slate-800 placeholder:text-amber-500/50 min-h-[100px] outline-none transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button onClick={() => setDeactivateUserModal(null)} className="flex-1 py-3.5 rounded-2xl bg-slate-200/50 hover:bg-slate-200 text-slate-600 text-sm font-bold transition-colors">Cancel</button>
                            <button onClick={handleDeactivateUser} disabled={isDeactivatingUser || !deactivateReason.trim()} className="flex-1 py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                                {isDeactivatingUser ? <Loader2 size={18} className="animate-spin" /> : null}
                                Deactivate User
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* ── CENTRALIZED ASSIGN SHIFT MODAL ── */}
            {activeAssignStaffData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-[3px]" onClick={() => setActiveAssignMenuId(null)} />
                    <div className="relative w-full max-w-[400px] bg-[#0f172a] border border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] rounded-[32px] overflow-hidden font-sans animate-in fade-in zoom-in-95 duration-200 flex flex-col" style={{ maxHeight: '90vh' }}>
                        
                        <div className="relative p-7 pb-6 flex items-start gap-5 shrink-0 bg-white/[0.02]">
                            <img
                                src={activeAssignStaffData.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(activeAssignStaffData.full_name)}&background=6366f1&color=fff`}
                                alt={activeAssignStaffData.full_name}
                                className="w-20 h-20 rounded-[24px] object-cover ring-1 ring-white/10"
                            />
                            <div className="flex-1 pt-1">
                                <h3 className="text-2xl font-black text-white leading-tight mb-1">{activeAssignStaffData.full_name}</h3>
                                <p className="text-[11px] font-black text-slate-500 uppercase tracking-[0.1em] mb-4">
                                    {activeAssignStaffData.departments && activeAssignStaffData.departments.length > 0 
                                        ? activeAssignStaffData.departments.map(d => d.name).join(', ') 
                                        : activeAssignStaffData.department_name || 'STAFF'} {activeZone !== 'All Zones' ? `· ${activeZone.toUpperCase()}` : ''}
                                </p>
                                <div className="flex items-center gap-2.5 text-sm font-bold text-indigo-400">
                                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                                    Assigning New Shift
                                </div>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); setActiveAssignMenuId(null); }}
                                className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-2xl"
                            >
                                <X size={24} strokeWidth={2.5} />
                            </button>
                        </div>

                        <div className="h-px bg-white/5 mx-7 shrink-0" />

                        <div className="flex-1 overflow-y-auto no-scrollbar pb-7">
                            <div className="p-7 space-y-5">
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Quick Assign Templates</span>
                                    <div className="flex-1 h-[1px] bg-white/5" />
                                </div>
                                <div className="space-y-2.5">
                                    <button className="w-full text-left px-5 py-4 text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded-2xl flex items-center gap-4 transition-all group" onClick={() => { setActiveAssignMenuId(null); handleQuickAssign(activeAssignStaffData.staff_id, 'morning'); }}>
                                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20 group-hover:scale-110 transition-all">
                                            <Sun size={18} strokeWidth={3} />
                                        </div>
                                        <span>Morning Shift</span>
                                        <span className="text-[10px] text-slate-500 font-black ml-auto bg-black/20 px-2 py-1 rounded-lg">07:00 - 15:00</span>
                                    </button>
                                    
                                    <button className="w-full text-left px-5 py-4 text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded-2xl flex items-center gap-4 transition-all group" onClick={() => { setActiveAssignMenuId(null); handleQuickAssign(activeAssignStaffData.staff_id, 'evening'); }}>
                                        <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-500 group-hover:bg-orange-500/20 group-hover:scale-110 transition-all">
                                            <Sunset size={18} strokeWidth={3} />
                                        </div>
                                        <span>Evening Shift</span>
                                        <span className="text-[10px] text-slate-500 font-black ml-auto bg-black/20 px-2 py-1 rounded-lg">15:00 - 23:00</span>
                                    </button>
                                    
                                    <button className="w-full text-left px-5 py-4 text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded-2xl flex items-center gap-4 transition-all group" onClick={() => { setActiveAssignMenuId(null); handleQuickAssign(activeAssignStaffData.staff_id, 'night'); }}>
                                        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20 group-hover:scale-110 transition-all">
                                            <Moon size={18} strokeWidth={3} />
                                        </div>
                                        <span>Night Shift</span>
                                        <span className="text-[10px] text-slate-500 font-black ml-auto bg-black/20 px-2 py-1 rounded-lg">23:00 - 07:00</span>
                                    </button>
                                </div>
                                
                                <div className="py-2">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-[1px] bg-white/5" />
                                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">or</span>
                                        <div className="flex-1 h-[1px] bg-white/5" />
                                    </div>
                                </div>

                                <button className="w-full text-center px-5 py-4 text-sm font-black text-indigo-400 hover:bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center gap-3 transition-all group" onClick={() => {
                                    setActiveAssignMenuId(null);
                                    setShiftModalData({ ...shiftModalData, staffId: activeAssignStaffData.staff_id });
                                    setIsShiftModalOpen(true);
                                }}>
                                    <Settings size={16} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-500" />
                                    CREATE CUSTOM SHIFT
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── EDIT STAFF MODAL ── */}
            {editStaffModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditStaffModal(null)} />
                    <div className="relative w-full max-w-[450px] bg-white rounded-3xl overflow-hidden shadow-2xl font-sans animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center border-b border-slate-100 flex items-center justify-center relative">
                            <h3 className="text-lg font-black text-slate-800">Edit Staff Settings</h3>
                            <button onClick={() => setEditStaffModal(null)} className="absolute right-6 text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="flex items-center gap-4">
                                <img
                                    src={editStaffModal.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(editStaffModal.full_name)}&background=random`}
                                    className="w-16 h-16 rounded-2xl border border-slate-200"
                                    alt=""
                                />
                                <div>
                                    <h4 className="text-lg font-bold text-slate-900 leading-tight">{editStaffModal.full_name}</h4>
                                    <p className="text-sm font-medium text-slate-500">{editStaffModal.email || 'No email provided'}</p>
                                </div>
                            </div>

                            {/* Departments & Roles Badges */}
                            <div className="space-y-3">
                                {editStaffDepts.length > 0 && (
                                    <div>
                                        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Departments</h5>
                                        <div className="flex flex-wrap gap-1.5">
                                            {editStaffDepts.map(d => (
                                                <span key={d.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${d.is_primary ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' : 'bg-slate-100 text-slate-600'}`}>
                                                    {d.name}
                                                    {d.is_primary && <span className="text-[9px] font-black text-indigo-400">PRIMARY</span>}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {editStaffRoles.length > 0 && (
                                    <div>
                                        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Roles</h5>
                                        <div className="flex flex-wrap gap-1.5">
                                            {editStaffRoles.map(r => (
                                                <span key={r.id} className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                                                    {r.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {editStaffDepts.length === 0 && editStaffRoles.length === 0 && (
                                    <p className="text-xs text-slate-400 italic">No departments or roles assigned yet.</p>
                                )}
                            </div>

                            <div className="space-y-4">
                                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between mb-4">
                                    <div>
                                        <h5 className="text-sm font-bold text-slate-900">Active Status</h5>
                                        <p className="text-xs font-medium text-slate-500 mt-0.5">Allow scheduling and login access</p>
                                    </div>
                                    <button
                                        disabled={isUpdatingStaff}
                                        onClick={async () => {
                                            setIsUpdatingStaff(true);
                                            try {
                                                const { error } = await supabase
                                                    .rpc('update_hotel_member', {
                                                        p_member_id: editStaffModal.staff_id,
                                                        p_is_active: !editStaffModal.is_active
                                                    });
                                                
                                                if (error) throw error;
                                                
                                                setEditStaffModal({ ...editStaffModal, is_active: !editStaffModal.is_active });
                                                showToast('Active status updated successfully', 'success');
                                                refetchDashboard();
                                            } catch (err: any) {
                                                showToast(err.message || 'Failed to update active status', 'error');
                                            } finally {
                                                setIsUpdatingStaff(false);
                                            }
                                        }}
                                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${editStaffModal.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${editStaffModal.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                                <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                                    <div>
                                        <h5 className="text-sm font-bold text-slate-900">Verification Status</h5>
                                        <p className="text-xs font-medium text-slate-500 mt-0.5">Allow SLA ticket assignments</p>
                                    </div>
                                    <button
                                        disabled={isUpdatingStaff}
                                        onClick={async () => {
                                            setIsUpdatingStaff(true);
                                            try {
                                                const { error } = await supabase
                                                    .rpc('update_hotel_member', {
                                                        p_member_id: editStaffModal.staff_id,
                                                        p_is_verified: !editStaffModal.is_verified
                                                    });
                                                
                                                if (error) throw error;
                                                
                                                setEditStaffModal({ ...editStaffModal, is_verified: !editStaffModal.is_verified });
                                                showToast('Verification status updated successfully', 'success');
                                                refetchDashboard();
                                            } catch (err: any) {
                                                showToast(err.message || 'Failed to update verification', 'error');
                                            } finally {
                                                setIsUpdatingStaff(false);
                                            }
                                        }}
                                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${editStaffModal.is_verified ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                    >
                                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${editStaffModal.is_verified ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                            <button onClick={() => setEditStaffModal(null)} className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold transition-colors">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
