import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { ticketService } from "../services/ticketService";
import type { Ticket, StaffRunnerTicket, BlockReason, BlockReasonCode, UnblockReason } from "../types/ticket";
import { getSLAStatus, formatTimeRemaining, getSLAColor } from "../utils/sla";
import TicketDetailsDrawer from "../components/TicketDetailsDrawer";


export default function StaffTaskManager() {
    const [hotelId, setHotelId] = useState<string | null>(null);

    const [newTasks, setNewTasks] = useState<StaffRunnerTicket[]>([]);
    const [inProgressTasks, setInProgressTasks] = useState<StaffRunnerTicket[]>([]);
    const [blockedTasks, setBlockedTasks] = useState<StaffRunnerTicket[]>([]);
    const [selectedTask, setSelectedTask] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fetchedAt, setFetchedAt] = useState<number>(Date.now());

    // Dynamic Reasons
    const [blockReasons, setBlockReasons] = useState<BlockReason[]>([]);

    const [showBlockModal, setShowBlockModal] = useState(false);
    const [showStartModal, setShowStartModal] = useState(false);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);
    const [showResumeModal, setShowResumeModal] = useState(false);
    const [showRequestSupervisorModal, setShowRequestSupervisorModal] = useState(false);

    const [tick, setTick] = useState(0);

    // Drawer state
    const [drawerTicket, setDrawerTicket] = useState<StaffRunnerTicket | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Derive hotel_id from authenticated staff member
    useEffect(() => {
        async function fetchHotelContext() {
            try {
                console.log('[StaffTaskManager] Fetching hotel context...');
                const { data: { user } } = await supabase.auth.getUser();
                console.log('[StaffTaskManager] User:', user?.id);

                if (!user) {
                    setError('Not authenticated');
                    setLoading(false);
                    return;
                }

                // Get hotel_id from hotel_members via role tables
                // Join: hotel_members -> hotel_member_roles -> hotel_roles
                const { data: members, error: memberError } = await supabase
                    .from('hotel_members')
                    .select(`
                        hotel_id,
                        hotel_member_roles!inner (
                            hotel_roles!inner (
                                code
                            )
                        )
                    `)
                    .eq('user_id', user.id)
                    .eq('is_active', true)
                    .eq('hotel_member_roles.hotel_roles.code', 'STAFF')
                    .eq('hotel_member_roles.hotel_roles.is_active', true);

                console.log('[StaffTaskManager] Member query result:', { members, memberError });

                if (memberError || !members || members.length === 0) {
                    setError('Staff member not found or not active');
                    setLoading(false);
                    return;
                }

                // Take the first hotel (staff should only have one)
                const hotelId = members[0].hotel_id;
                console.log('[StaffTaskManager] Setting hotel_id:', hotelId);
                setHotelId(hotelId);
            } catch (err: any) {
                console.error('[StaffTaskManager] Error fetching hotel context:', err);
                setError(err.message);
                setLoading(false);
            }
        }

        fetchHotelContext();
    }, []);

    const fetchTasks = useCallback(async () => {
        if (!hotelId) {
            return; // Wait for hotel context to load
        }

        try {
            const data = await ticketService.getStaffTasks(hotelId);
            setFetchedAt(data.fetchedAt);
            setNewTasks(data.newTasks);
            setInProgressTasks(data.inProgress);
            setBlockedTasks(data.blocked);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [hotelId]);

    const fetchReasons = useCallback(async () => {
        const reasons = await ticketService.getBlockReasons();
        setBlockReasons(reasons);
    }, []);

    useEffect(() => {
        // Wait for hotel context to load
        if (!hotelId) return;

        fetchTasks();
        fetchReasons();

        // 1. Periodic re-sync slightly faster (every 15s) as backup
        const interval = setInterval(() => fetchTasks(), 15 * 1000);

        // 2. REALTIME SUBSCRIPTION
        // Listen for ANY change to tickets in this hotel
        // This makes the board update instantly when Auto-Assign job runs
        const channel = supabase
            .channel('staff-board-realtime')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tickets',
                    filter: `hotel_id=eq.${hotelId}`
                },
                (payload) => {
                    console.log('Realtime update received:', payload);
                    fetchTasks();
                }
            )
            .subscribe();

        return () => {
            clearInterval(interval);
            supabase.removeChannel(channel);
        };
    }, [fetchTasks, fetchReasons, hotelId]);

    const openModal = async (ticketView: StaffRunnerTicket, setModal: (val: boolean) => void) => {
        try {
            const fullTicket = await ticketService.getTicket(ticketView.ticket_id);
            if (fullTicket) {
                setSelectedTask(fullTicket);
                setModal(true);
            }
        } catch (e) {
            console.error("Failed to load task details", e);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white px-4 py-6">
            <div className="max-w-7xl mx-auto mb-8">
                <h1 className="text-xl font-medium text-gray-500 uppercase tracking-widest px-2">WORK QUEUE</h1>
            </div>
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
                <section>
                    <h2 className="text-sm font-medium text-blue-500 uppercase tracking-wider mb-4 flex items-center gap-2 px-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        NEW
                    </h2>
                    <div className="space-y-4">
                        {newTasks.length > 0 ? (
                            newTasks.map((task) => (
                                <TaskCard
                                    key={task.ticket_id}
                                    task={task}
                                    fetchedAt={fetchedAt}
                                    variant="active"
                                    onClick={() => {
                                        setDrawerTicket(task);
                                        setDrawerOpen(true);
                                    }}
                                    actions={
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openModal(task, setShowStartModal);
                                            }}
                                            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-sm tracking-wider hover:bg-blue-700 transition-colors"
                                        >
                                            START
                                        </button>
                                    }
                                />
                            ))
                        ) : (
                            <div className="bg-[#1a1a1a] rounded-3xl p-8 text-center text-gray-500">No active tasks
                                available</div>
                        )}
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-medium text-green-500 uppercase tracking-wider mb-4 flex items-center gap-2 px-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        IN PROGRESS
                    </h2>
                    <div className="space-y-4">
                        {inProgressTasks.map((task) => (
                            <TaskCard
                                key={task.ticket_id}
                                task={task}
                                fetchedAt={fetchedAt}
                                variant="inProgress"
                                onClick={() => {
                                    setDrawerTicket(task);
                                    setDrawerOpen(true);
                                }}
                                actions={
                                    <div className="flex gap-2">
                                        <button onClick={(e) => {
                                            e.stopPropagation();
                                            openModal(task, setShowCompleteModal);
                                        }}
                                            className="flex-1 bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 transition-colors">
                                            Complete
                                        </button>
                                        <button onClick={(e) => {
                                            e.stopPropagation();
                                            openModal(task, setShowBlockModal);
                                        }}
                                            className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-medium hover:bg-gray-600 transition-colors">
                                            Block
                                        </button>
                                    </div>
                                }
                            />
                        ))}
                    </div>
                </section>

                <section>
                    <h2 className="text-sm font-medium text-red-500 uppercase tracking-wider mb-4 flex items-center gap-2 px-2">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        BLOCKED
                    </h2>
                    <div className="space-y-4">
                        {blockedTasks.map((task) => (
                            <TaskCard
                                key={task.ticket_id}
                                task={task}
                                fetchedAt={fetchedAt}
                                variant="blocked"
                                onClick={() => {
                                    setDrawerTicket(task);
                                    setDrawerOpen(true);
                                }}
                                actions={
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openModal(task, setShowResumeModal);
                                            }}
                                            className="flex-1 bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 transition-colors"
                                        >
                                            Resume
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openModal(task, setShowUpdateStatusModal);
                                            }}
                                            className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-medium hover:bg-gray-600 transition-colors"
                                        >
                                            Update
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openModal(task, setShowRequestSupervisorModal);
                                            }}
                                            className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-medium hover:bg-gray-600 transition-colors"
                                        >
                                            Supervisor
                                        </button>
                                    </div>
                                }
                            />
                        ))}
                    </div>
                </section>
            </div>

            {showStartModal && selectedTask &&
                <StartTaskModal task={selectedTask} onClose={() => setShowStartModal(false)} onSuccess={fetchTasks} />}
            {showCompleteModal && selectedTask &&
                <CompleteTaskModal task={selectedTask} onClose={() => setShowCompleteModal(false)}
                    onSuccess={fetchTasks} />}
            {showBlockModal && selectedTask &&
                <BlockTaskModal task={selectedTask} reasons={blockReasons} onClose={() => setShowBlockModal(false)}
                    onSuccess={fetchTasks} />}
            {showUpdateStatusModal && selectedTask && <UpdateStatusModal task={selectedTask} reasons={blockReasons}
                onClose={() => setShowUpdateStatusModal(false)} />}
            {showResumeModal && selectedTask && <ResumeTaskModal task={selectedTask} onClose={() => setShowResumeModal(false)} onSuccess={fetchTasks} />}
            {showRequestSupervisorModal && selectedTask && <RequestSupervisorModal task={selectedTask} onClose={() => setShowRequestSupervisorModal(false)} />}

            {/* Ticket Details Drawer */}
            <TicketDetailsDrawer
                ticket={drawerTicket}
                isOpen={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false);
                    setDrawerTicket(null);
                }}
                onStart={() => {
                    if (drawerTicket) {
                        openModal(drawerTicket, setShowStartModal);
                    }
                }}
                onComplete={() => {
                    if (drawerTicket) {
                        openModal(drawerTicket, setShowCompleteModal);
                    }
                }}
                onResume={() => {
                    if (drawerTicket) {
                        openModal(drawerTicket, setShowResumeModal);
                    }
                }}
                onBlock={() => {
                    if (drawerTicket) {
                        openModal(drawerTicket, setShowBlockModal);
                    }
                }}
                onRequestSupervisor={() => {
                    if (drawerTicket) {
                        openModal(drawerTicket, setShowRequestSupervisorModal);
                    }
                }}
            />
        </div>
    );
}

interface TaskCardProps {
    task: StaffRunnerTicket;
    fetchedAt: number;
    variant: "active" | "inProgress" | "blocked";
    actions: React.ReactNode;
    onClick?: () => void;
}

function formatContextTime(seconds: number): string {
    if (seconds < 60) return "1 min";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

function TaskCard({ task, fetchedAt, variant, actions, onClick }: TaskCardProps) {
    // Premium shadowing effect with radial gradients
    const styles = {
        active: {
            bgGlow: "radial-gradient(circle at right, rgba(59, 130, 246, 0.10), transparent 60%), #141414",
            border: "border-l-4 border-blue-500",
            text: "text-blue-500",
            dot: "bg-blue-500"
        },
        inProgress: {
            bgGlow: "radial-gradient(circle at right, rgba(47, 163, 107, 0.10), transparent 60%), #141414",
            border: "border-l-4 border-green-500",
            text: "text-green-500",
            dot: "bg-green-500"
        },
        blocked: {
            bgGlow: "radial-gradient(circle at right, rgba(214, 69, 69, 0.10), transparent 60%), #141414",
            border: "border-l-4 border-red-500",
            text: "text-red-500",
            dot: "bg-red-500"
        }
    };

    const currentStyle = styles[variant];
    const [showInfo, setShowInfo] = useState(false);



    return (
        <div
            className={`relative group ${currentStyle.border} rounded-r-3xl rounded-l-md p-6 shadow-2xl transition-all duration-200 hover:scale-[1.01] overflow-visible cursor-pointer`}
            style={{ background: currentStyle.bgGlow }}
            onClick={onClick}
        >
            {/* INFO ICON TRIGGER (Top Right) */}
            <div
                className="absolute top-2 right-2 z-40 cursor-pointer text-white/40 hover:text-white transition-colors p-[0.1rem]"
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 01-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
                </svg>
            </div>

            {/* 1. LAYER: SUMMARY (Default Visible) */}
            {/* MAIN CONTENT (Always Visible) */}
            <div className="flex items-start justify-between mb-6">
                <div className="flex-1 pr-4">
                    {task.location_label && (
                        <h2 className="text-2xl font-bold text-white mb-1 leading-tight">{task.location_label}</h2>
                    )}
                    <h3 className="text-xl font-medium mb-3 text-white/90 leading-snug">{task.title}</h3>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${currentStyle.dot}`}></div>
                        <p className={`text-sm ${currentStyle.text} font-medium tracking-wide`}>
                            {task.status === 'BLOCKED' ? (
                                task.reason_code === 'supervisor_approval' ? (
                                    <span className="flex items-center gap-2">
                                        WAITING FOR SUPERVISOR
                                        <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                    </span>
                                ) : 'Blocked'
                            ) : (task.status === 'NEW' ? 'New task' : 'In progress')}
                        </p>
                    </div>

                    {/* Time Context Badge */}
                    <div className="mt-3 flex items-center gap-2 text-xs font-medium opacity-80">
                        {(() => {
                            if (task.status === 'NEW') {
                                const waitingSeconds = Math.floor((Date.now() - new Date(task.created_at).getTime()) / 1000);
                                return (
                                    <>
                                        <span>⏳</span>
                                        <span className="text-blue-200">Waiting for {formatContextTime(waitingSeconds)}</span>
                                    </>
                                );
                            }
                            if (task.status === 'IN_PROGRESS') {
                                return (
                                    <>
                                        <span>⏱</span>
                                        <span className="text-green-300">Working for {formatContextTime(task.active_work_seconds || 0)}</span>
                                    </>
                                );
                            }
                            if (task.status === 'BLOCKED') {
                                return (
                                    <>
                                        <span>⏸</span>
                                        <span className="text-red-300">Blocked for {formatContextTime(task.blocked_seconds || 0)}</span>
                                    </>
                                );
                            }
                        })()}
                    </div>

                    <p className="text-xs text-white/50 mt-2 font-medium">{task.department_name}</p>
                </div>
                <CircularTimerView task={task} fetchedAt={fetchedAt} />
            </div>

            {/* DETAILS OVERLAY (Triggered by Icon) */}
            <div
                className={`
                    absolute bottom-4 right-4 z-50 w-72 p-5 flex flex-col gap-3 rounded-2xl shadow-2xl border border-white/10
                    bg-[#1a1a1a]/95 backdrop-blur-md transition-all duration-200 pointer-events-none transform origin-bottom-right
                    ${showInfo ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 translate-y-2'}
                `}
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
            >
                <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Description</span>
                    <p className="text-sm text-white/95 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                        {task.description || "No specific details provided."}
                    </p>
                </div>

                <div className="h-px bg-white/10 w-full my-1"></div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Created</span>
                        <div className="text-xs text-gray-300">
                            {new Date(task.created_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                            })}
                        </div>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Requestor</span>
                        <div className="text-xs text-gray-300">
                            {task.requested_by}
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions always on top/bottom */}
            <div className="relative z-30">
                {actions}
            </div>
        </div>
    );
}


interface CircularTimerViewProps {
    task: StaffRunnerTicket;
    fetchedAt: number;
}

function CircularTimerView({ task, fetchedAt }: CircularTimerViewProps) {
    // Initialize local remaining seconds from server snapshot
    const [remaining, setRemaining] = useState<number>(() => {
        if (task.sla_remaining_seconds == null) return 0;
        const elapsed = Math.floor((Date.now() - fetchedAt) / 1000);
        return Math.max(task.sla_remaining_seconds - elapsed, 0);
    });

    // Tick every second (local countdown) - runs for all RUNNING tasks (including NEW)
    useEffect(() => {
        const interval = setInterval(() => {
            setRemaining(prev => Math.max(prev - 1, 0));
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    // Re-sync when server snapshot changes
    useEffect(() => {
        if (task.sla_remaining_seconds == null) return;
        const elapsed = Math.floor((Date.now() - fetchedAt) / 1000);
        setRemaining(Math.max(task.sla_remaining_seconds - elapsed, 0));
    }, [task.sla_remaining_seconds, fetchedAt]);

    const targetSecs = (task.sla_target_minutes ?? 60) * 60;
    const percentLeft = Math.max(0, Math.min(100, (remaining / targetSecs) * 100));
    const circumference = 2 * Math.PI * 45;

    let ringColor = "#4b5563";
    let strokeDasharray: string | number = circumference;
    let strokeDashoffset = circumference - (percentLeft / 100) * circumference;

    if (task.sla_state === 'BREACHED') {
        ringColor = "#ef4444";
        strokeDashoffset = 0;
    } else if (task.sla_state === 'NOT_STARTED') {
        strokeDasharray = "8, 4";
        strokeDashoffset = 0;
    } else if (task.sla_state === 'PAUSED') {
        ringColor = "#eab308"; // Yellow-500
    } else {
        ringColor = "#22c55e";
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    return (
        <div className="relative w-24 h-24 flex-shrink-0">
            <svg className="transform -rotate-90 w-24 h-24">
                <circle cx="48" cy="48" r="45" stroke="rgba(255,255,255,0.05)" strokeWidth="6" fill="none" />
                <circle
                    cx="48"
                    cy="48"
                    r="45"
                    stroke={ringColor}
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className={task.sla_state === 'BREACHED' ? 'animate-pulse' : ''}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                {task.sla_state === 'NOT_STARTED' && (
                    <>
                        <div className="text-xs font-bold text-gray-500">Not</div>
                        <div className="text-[9px] text-gray-500 uppercase">started</div>
                    </>
                )}

                {(task.sla_state === 'BREACHED' || task.sla_state === 'UNKNOWN') && (
                    <>
                        <div className="text-xs font-bold text-red-500">SLA</div>
                        <div className="text-[9px] text-red-500 uppercase">breached</div>
                    </>
                )}

                {task.sla_state === 'RUNNING' && (
                    <>
                        <div className="text-sm font-bold">
                            {minutes}:{String(seconds).padStart(2, '0')}
                        </div>
                        <div className="text-[9px] text-gray-500 uppercase">
                            remaining
                        </div>
                    </>
                )}

                {task.sla_state === 'PAUSED' && (
                    <>
                        <div className="text-xs font-bold text-yellow-500">SLA</div>
                        <div className="text-[9px] text-yellow-500 uppercase">paused</div>
                    </>
                )}
            </div>
        </div>
    );
}

// --------------------------------------------------------
// MODALS
// --------------------------------------------------------

function StartTaskModal({ task, onClose, onSuccess }: { task: Ticket, onClose: () => void, onSuccess?: () => void }) {
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    return (
        <ModalLayout
            title="Start Cleaning?"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex gap-3">
                    <Button onClick={onClose} variant="secondary">Cancel</Button>
                    <Button onClick={async () => {
                        setIsSubmitting(true);
                        try {
                            await ticketService.startTask({ ticketId: task.id, note });
                            onSuccess?.();
                            onClose();
                        } catch (e: any) {
                            alert(e.message);
                            setIsSubmitting(false);
                        }
                    }} disabled={isSubmitting}
                        variant="primary">{isSubmitting ? 'Starting...' : '▶ Start Task'}</Button>
                </div>
            }
        >
            <input type="text" placeholder="Add note (optional)" value={note} onChange={e => setNote(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 mb-6 focus:outline-none focus:border-white/20" />
        </ModalLayout>
    );
}

function CompleteTaskModal({ task, onClose, onSuccess }: { task: Ticket, onClose: () => void, onSuccess?: () => void }) {
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    return (
        <ModalLayout
            title="Mark task as complete?"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex gap-3">
                    <Button onClick={onClose} variant="secondary">Cancel</Button>
                    <Button onClick={async () => {
                        setIsSubmitting(true);
                        try {
                            await ticketService.completeTask({ ticketId: task.id, note });
                            onSuccess?.();
                            onClose();
                        } catch (e: any) {
                            alert(e.message);
                            setIsSubmitting(false);
                        }
                    }} disabled={isSubmitting}
                        variant="primary">{isSubmitting ? 'Completing...' : '✓ Mark Complete'}</Button>
                </div>
            }
        >
            <textarea placeholder="Add completion note (optional)" value={note} onChange={e => setNote(e.target.value)}
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 mb-6 resize-none focus:outline-none focus:border-white/20" />
        </ModalLayout>
    );
}

// --------------------------------------------------------
// REDESIGNED BLOCK & UPDATE STATUS MODALS
// --------------------------------------------------------

function ResumeTimePicker({ onUpdate }: { onUpdate: (date: Date) => void }) {
    const [value, setValue] = useState(30);
    const [unit, setUnit] = useState<'minutes' | 'hours'>('minutes');
    const [calculatedTimeStr, setCalculatedTimeStr] = useState("");

    // Generate number options based on unit
    // Minutes: 5, 10, 15... 60. Hours: 1...12
    const numberOptions = unit === 'minutes'
        ? Array.from({ length: 12 }, (_, i) => (i + 1) * 5)
        : Array.from({ length: 12 }, (_, i) => i + 1);

    // Reset value if it's not in the new options when unit changes
    useEffect(() => {
        if (unit === 'minutes' && !numberOptions.includes(value)) {
            setValue(30); // Default to 30 mins
        } else if (unit === 'hours' && !numberOptions.includes(value)) {
            setValue(1); // Default to 1 hour
        }
    }, [unit]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const d = new Date();
        const multiplier = unit === 'minutes' ? 1 : 60;
        d.setMinutes(d.getMinutes() + (value * multiplier));

        onUpdate(d);

        // Format for display: at 12:45 PM (IST)
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata'
        });
        setCalculatedTimeStr(timeFormatter.format(d));
    }, [value, unit, onUpdate]);

    return (
        <div className="mt-3 ml-4 animate-slide-down">
            <div className="flex items-center gap-3 mb-2">
                <span className="text-sm text-gray-400">Resume after:</span>
                <div className="flex bg-[#2a2a2a] rounded-lg border border-white/10 overflow-hidden">
                    <select
                        value={value}
                        onChange={(e) => setValue(Number(e.target.value))}
                        className="bg-transparent text-white text-sm font-semibold px-3 py-2 border-r border-white/10 focus:outline-none focus:bg-white/5 max-h-40"
                    >
                        {numberOptions.map(num => (
                            <option key={num} value={num} className="bg-[#1a1a1a] text-white">{num}</option>
                        ))}
                    </select>
                    <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours')}
                        className="bg-transparent text-white text-sm font-semibold px-3 py-2 focus:outline-none focus:bg-white/5"
                    >
                        <option value="minutes" className="bg-[#1a1a1a] text-white">minutes</option>
                        <option value="hours" className="bg-[#1a1a1a] text-white">hours</option>
                    </select>
                </div>
            </div>
            <div className="text-center text-xs text-gray-400">
                at {calculatedTimeStr}
            </div>
        </div>
    );
}

function BlockTaskModal({ task, reasons, onClose, onSuccess }: {
    task: Ticket,
    reasons: BlockReason[],
    onClose: () => void,
    onSuccess?: () => void
}) {
    const [selectedReason, setSelectedReason] = useState<string>("");
    const [note, setNote] = useState("");
    const [resumeAfter, setResumeAfter] = useState<Date | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const noteInputRef = useRef<HTMLInputElement>(null);

    const isSomethingElse = selectedReason === 'something_else';
    const isValid = selectedReason && (!isSomethingElse || note.trim().length > 0);

    const handleConfirm = async () => {
        if (!isValid) return;
        setIsSubmitting(true);
        try {
            await ticketService.blockTask({
                ticketId: task.id,
                reasonCode: selectedReason as BlockReasonCode,
                note,
                resumeAfter: resumeAfter?.toISOString()
            });
            onSuccess?.();
            onClose();
        } catch (e: any) {
            alert(e.message);
            setIsSubmitting(false);
        }
    };

    return (
        <ModalLayout
            title="Why is this task blocked?"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex flex-col gap-4">
                    {/* Optional Note - Show unless we have embedded box */}
                    {selectedReason && selectedReason !== 'something_else' && (
                        <input
                            ref={noteInputRef}
                            type="text"
                            placeholder="Add note (optional)"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm animate-fade-in"
                        />
                    )}
                    <div className="flex gap-3">
                        <Button onClick={onClose} variant="secondary">Cancel</Button>
                        <Button onClick={handleConfirm} disabled={!isValid || isSubmitting} variant="primary">
                            {isSubmitting ? 'Blocking...' : 'Confirm & Block'}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-3 pb-2">
                {reasons.map((reason) => {
                    const isSelected = selectedReason === reason.code;
                    // Logic: 
                    // 1. Explicitly check for GUEST_REQUESTED_LATER to ensure UI shows regardless of DB flag.
                    // 2. Also check requires_resume_time for future dynamic support.
                    const showTimeSelect = reason.code === 'GUEST_REQUESTED_LATER' || reason.requires_resume_time;
                    const showBox = reason.code === 'something_else';

                    return (
                        <div key={reason.code}>
                            <button
                                onClick={() => setSelectedReason(reason.code)}
                                className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${isSelected
                                    ? "bg-[#4a5fc1]/30 border-2 border-[#4a7cff]"
                                    : "bg-transparent border-2 border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                <span className="text-2xl">{reason.icon}</span>
                                <span className="text-base font-medium text-left">{reason.label}</span>
                            </button>

                            {/* New Resume Time Picker */}
                            {isSelected && showTimeSelect && (
                                <ResumeTimePicker onUpdate={setResumeAfter} />
                            )}

                            {isSelected && showBox && (
                                <div className="mt-2 pl-2 border-l-2 border-[#4a7cff]/50 ml-12 animate-slide-down">
                                    <textarea
                                        placeholder="briefly explain what's blocking you"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm"
                                        autoFocus
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </ModalLayout>
    );
}


function RequestSupervisorModal({ task, onClose }: { task: Ticket, onClose: () => void }) {
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleRequest = async () => {
        setIsSubmitting(true);
        try {
            await ticketService.requestSupervisor({
                ticketId: task.id,
                note
            });
            onClose();
        } catch (e: any) {
            alert(e.message);
            setIsSubmitting(false);
        }
    };

    return (
        <ModalLayout
            title="Request Supervisor"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex flex-col gap-4">
                    <div className="flex gap-3">
                        <Button onClick={onClose} variant="secondary">Cancel</Button>
                        <Button onClick={handleRequest} disabled={isSubmitting} variant="primary">
                            {isSubmitting ? 'Requesting...' : 'Confirm Request'}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-gray-400 text-sm">Please describe why you need supervisor assistance:</p>
                <textarea
                    placeholder="E.g. I cannot access the room..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm"
                    autoFocus
                />
            </div>
        </ModalLayout>
    );
}

function UpdateStatusModal({ task, reasons, onClose }: { task: Ticket, reasons: BlockReason[], onClose: () => void }) {
    const [selectedStatus, setSelectedStatus] = useState<string>(task.reason_code || "");
    const [note, setNote] = useState("");
    const [resumeAfter, setResumeAfter] = useState<Date | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const noteInputRef = useRef<HTMLInputElement>(null);

    const isSomethingElse = selectedStatus === 'something_else';

    // Validation:
    const canUpdateStatus = selectedStatus && (!isSomethingElse || note.trim().length > 0);

    const handleUpdate = async () => {
        if (!canUpdateStatus) return;

        setIsSubmitting(true);
        try {
            await ticketService.updateBlockTask({
                ticketId: task.id,
                reasonCode: selectedStatus as BlockReasonCode,
                note,
                resumeAfter: resumeAfter?.toISOString()
            });
            onClose();
        } catch (e: any) {
            alert(e.message);
            setIsSubmitting(false);
        }
    };

    return (
        <ModalLayout
            title="Update Status"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex flex-col gap-4">
                    {/* Optional Note for regular reasons - Show by default unless custom embedded input is active */}
                    {!isSomethingElse && (
                        <input
                            ref={noteInputRef}
                            type="text"
                            placeholder="Add note (optional)"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm animate-fade-in"
                        />
                    )}
                    <div className="flex gap-3">
                        <Button onClick={onClose} variant="secondary">
                            Cancel
                        </Button>
                        <Button onClick={handleUpdate} disabled={!canUpdateStatus || isSubmitting}
                            variant="primary">
                            {isSubmitting ? 'Updating...' : 'Update status'}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-3 pb-2">
                {reasons.map((option) => {
                    const isSelected = selectedStatus === option.code;
                    // Force show for GUEST_REQUESTED_LATER to guarantee UI presence
                    const showTimeSelect = option.code === 'GUEST_REQUESTED_LATER' || option.requires_resume_time;
                    const showBox = option.code === 'something_else';

                    return (
                        <div key={option.code}>
                            <button
                                onClick={() => setSelectedStatus(option.code)}
                                className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${isSelected
                                    ? "bg-[#4a5fc1]/30 border-2 border-[#4a7cff]"
                                    : "bg-transparent border-2 border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                <span className="text-2xl">{option.icon}</span>
                                <span className="text-base font-medium text-left">{option.label}</span>
                            </button>

                            {isSelected && showTimeSelect && (
                                <ResumeTimePicker onUpdate={setResumeAfter} />
                            )}

                            {isSelected && showBox && (
                                <div className="mt-2 pl-2 border-l-2 border-[#4a7cff]/50 ml-12 animate-slide-down">
                                    <textarea
                                        placeholder="briefly explain what's blocking you"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        rows={2}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm"
                                        autoFocus
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </ModalLayout>
    );
}

// --------------------------------------------------------
// RESUME MODAL
// --------------------------------------------------------

function ResumeTaskModal({ task, onClose, onSuccess }: { task: Ticket, onClose: () => void, onSuccess?: () => void }) {
    const [reasons, setReasons] = useState<UnblockReason[]>([]);
    const [selectedReason, setSelectedReason] = useState<string>("");
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingReasons, setLoadingReasons] = useState(true);

    useEffect(() => {
        if (task.reason_code) {
            ticketService.getCompatibleUnblockReasons(task.reason_code)
                .then(r => {
                    setReasons(r);
                    setLoadingReasons(false);
                })
                .catch(() => {
                    setLoadingReasons(false);
                });
        } else {
            setLoadingReasons(false);
        }
    }, [task.reason_code]);

    const handleResume = async () => {
        if (!selectedReason && reasons.length > 0) return; // Must select if reasons exist
        setIsSubmitting(true);
        try {
            await ticketService.unblockTask({
                ticketId: task.id,
                unblockReasonCode: selectedReason,
                note
            });
            onSuccess?.();
            onClose();
        } catch (e: any) {
            alert(e.message);
            setIsSubmitting(false);
        }
    };

    const isValid = reasons.length === 0 || selectedReason !== "";

    return (
        <ModalLayout
            title="Resume Task"
            taskTitle={task.title}
            onClose={onClose}
            footer={
                <div className="flex flex-col gap-4">
                    <input
                        type="text"
                        placeholder="Add note (optional)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white/20 text-sm"
                    />
                    <div className="flex gap-3">
                        <Button onClick={onClose} variant="secondary">Cancel</Button>
                        <Button onClick={handleResume} disabled={!isValid || isSubmitting} variant="primary">
                            {isSubmitting ? 'Resuming...' : 'Confirm Resume'}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-gray-400 text-sm">Select a reason for resuming this task:</p>
                {loadingReasons ? (
                    <div className="text-center py-4 text-gray-500">Loading reasons...</div>
                ) : reasons.length > 0 ? (
                    <div className="space-y-3">
                        {reasons.map((reason) => (
                            <button
                                key={reason.code}
                                onClick={() => setSelectedReason(reason.code)}
                                className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${selectedReason === reason.code
                                    ? "bg-[#2f855a]/30 border-2 border-[#48bb78]"
                                    : "bg-transparent border-2 border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                <span className="text-xl">{reason.icon || '✅'}</span>
                                <div className="text-left">
                                    <div className="text-base font-medium text-white">{reason.label}</div>
                                    {reason.description && <div className="text-xs text-gray-400">{reason.description}</div>}
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-4 bg-white/5 rounded-xl border border-white/10">
                        <span className="text-gray-400">No specific unblock reasons required.</span>
                    </div>
                )}
            </div>
        </ModalLayout>
    );
}

// Reuseable Components
function ModalLayout({ title, taskTitle, children, onClose, footer }: {
    title: string,
    taskTitle: string,
    children: React.ReactNode,
    onClose: () => void,
    footer?: React.ReactNode
}) {
    return (
        <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
            <div
                className="bg-[#1a1a1a] rounded-3xl w-full max-w-lg overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-start justify-between mb-2">
                        <h2 className="text-2xl font-bold">{title}</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕
                        </button>
                    </div>
                    <p className="text-sm text-gray-400">{taskTitle}</p>
                </div>

                {/* Scrollable Content */}
                <div className="p-6 overflow-y-auto flex-1 min-h-0">
                    {children}
                </div>

                {/* Footer (Fixed) */}
                {footer && (
                    <div className="p-6 border-t border-white/10 flex-shrink-0 bg-[#1a1a1a]">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

function Button({ children, onClick, disabled, variant }: {
    children: React.ReactNode,
    onClick: () => void,
    disabled?: boolean,
    variant: "primary" | "secondary"
}) {
    const base = "flex-1 py-4 rounded-xl font-semibold text-sm tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
    const styles = variant === "primary" ? "bg-[#4a7cff] text-white hover:bg-[#3d6ae6]" : "bg-transparent text-white border border-white/10 hover:bg-white/5";
    return <button onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>{children}</button>;
}

