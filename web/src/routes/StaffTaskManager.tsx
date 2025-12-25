import { useState, useEffect, useCallback, useRef } from "react";
import { ticketService } from "../services/ticketService";
import type { Ticket, StaffRunnerTicket, BlockReason, BlockReasonCode } from "../types/ticket";
import { getSLAStatus, formatTimeRemaining, getSLAColor } from "../utils/sla";

export default function StaffTaskManager() {
    const [newTasks, setNewTasks] = useState<StaffRunnerTicket[]>([]);
    const [inProgressTasks, setInProgressTasks] = useState<StaffRunnerTicket[]>([]);
    const [blockedTasks, setBlockedTasks] = useState<StaffRunnerTicket[]>([]);
    const [selectedTask, setSelectedTask] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Dynamic Reasons
    const [blockReasons, setBlockReasons] = useState<BlockReason[]>([]);

    const [showBlockModal, setShowBlockModal] = useState(false);
    const [showStartModal, setShowStartModal] = useState(false);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [showUpdateStatusModal, setShowUpdateStatusModal] = useState(false);

    const [tick, setTick] = useState(0);

    const fetchTasks = useCallback(async () => {
        try {
            const data = await ticketService.getStaffTasks();
            setNewTasks(data.newTasks);
            setInProgressTasks(data.inProgress);
            setBlockedTasks(data.blocked);
            setError(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchReasons = useCallback(async () => {
        const reasons = await ticketService.getBlockReasons();
        setBlockReasons(reasons);
    }, []);

    useEffect(() => {
        fetchTasks();
        fetchReasons();
        const subscription = ticketService.subscribeToTasks(() => fetchTasks());
        const interval = setInterval(() => setTick(t => t + 1), 1000 * 10);
        return () => {
            subscription.unsubscribe();
            clearInterval(interval);
        };
    }, [fetchTasks, fetchReasons]);

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
                                    variant="active"
                                    actions={
                                        <button
                                            onClick={() => openModal(task, setShowStartModal)}
                                            className="w-full bg-[#1e293b] text-blue-400 py-4 rounded-2xl font-bold text-sm tracking-wider hover:bg-[#334155] transition-colors border border-blue-500/30"
                                        >
                                            START TASK
                                        </button>
                                    }
                                />
                            ))
                        ) : (
                            <div className="bg-[#1a1a1a] rounded-3xl p-8 text-center text-gray-500">No active tasks available</div>
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
                            <TaskCard key={task.ticket_id} task={task} variant="inProgress" actions={
                                <div className="grid grid-cols-2 gap-3">
                                    <button onClick={() => openModal(task, setShowCompleteModal)} className="bg-[#dcfce7] text-[#166534] py-3 rounded-xl font-bold text-xs tracking-wider hover:bg-[#bbf7d0] transition-colors">MARK COMPLETE</button>
                                    <button onClick={() => openModal(task, setShowBlockModal)} className="bg-white/5 text-gray-300 py-3 rounded-xl font-semibold text-xs tracking-wider hover:bg-white/10 transition-colors">BLOCK TASK</button>
                                </div>
                            } />
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
                            <TaskCard key={task.ticket_id} task={task} variant="blocked" actions={
                                <div className="grid grid-cols-2 gap-3">
                                    <button onClick={() => openModal(task, setShowUpdateStatusModal)} className="bg-red-600 text-white py-3 rounded-xl font-bold text-xs tracking-wider hover:bg-red-700 transition-colors">RESOLVE</button>
                                    <button onClick={async () => { await ticketService.pingSupervisor({ ticketId: task.ticket_id, note: 'Staff requested assistance' }); alert('Supervisor pinged successfully'); }} className="bg-white/5 text-gray-300 py-3 rounded-xl font-semibold text-xs tracking-wider hover:bg-white/10 transition-colors">PING SUPERVISOR</button>
                                </div>
                            } />
                        ))}
                    </div>
                </section>
            </div>

            {showStartModal && selectedTask && <StartTaskModal task={selectedTask} onClose={() => setShowStartModal(false)} />}
            {showCompleteModal && selectedTask && <CompleteTaskModal task={selectedTask} onClose={() => setShowCompleteModal(false)} />}
            {showBlockModal && selectedTask && <BlockTaskModal task={selectedTask} reasons={blockReasons} onClose={() => setShowBlockModal(false)} />}
            {showUpdateStatusModal && selectedTask && <UpdateStatusModal task={selectedTask} reasons={blockReasons} onClose={() => setShowUpdateStatusModal(false)} />}
        </div>
    );
}

interface TaskCardProps { task: StaffRunnerTicket; variant: "active" | "inProgress" | "blocked"; actions: React.ReactNode; }
function TaskCard({ task, variant, actions }: TaskCardProps) {
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

    return (
        <div
            className={`${currentStyle.border} rounded-r-3xl rounded-l-md p-6 shadow-2xl transition-all hover:scale-[1.01]`}
            style={{ background: currentStyle.bgGlow }}
        >
            <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                    {task.location_label && (
                        <h2 className="text-2xl font-bold text-white mb-1">{task.location_label}</h2>
                    )}
                    <h3 className="text-xl font-medium mb-3 text-white/90">{task.title}</h3>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${currentStyle.dot}`}></div>
                        <p className={`text-sm ${currentStyle.text}`}>
                            {task.status === 'BLOCKED' ? 'Blocked' : (task.status === 'NEW' ? 'New task' : 'In progress')}
                        </p>
                    </div>
                    <p className="text-xs text-white/50 mt-1">{task.department_name}</p>
                </div>
                <CircularTimerView task={task} variant={variant} />
            </div>
            {actions}
        </div>
    );
}

interface CircularTimerViewProps { task: StaffRunnerTicket; variant: "active" | "inProgress" | "blocked"; }
function CircularTimerView({ task }: CircularTimerViewProps) {
    const remainingSecs = task.sla_remaining_seconds ?? 0;
    const targetSecs = (task.sla_target_minutes ?? 60) * 60;
    const percentLeft = Math.max(0, Math.min(100, (remainingSecs / targetSecs) * 100));
    const circumference = 2 * Math.PI * 45;

    let ringColor = "#4b5563"; // grey
    let strokeDasharray: string | number = circumference;
    let strokeDashoffset = 0;
    let animationClass = "";

    switch (task.sla_state) {
        case 'NOT_STARTED':
            ringColor = "#4b5563";
            strokeDasharray = "8, 4"; // grey-dashed
            strokeDashoffset = 0;
            break;
        case 'RUNNING':
            ringColor = "#22c55e"; // green-solid
            strokeDasharray = circumference;
            strokeDashoffset = circumference - (percentLeft / 100) * circumference;
            break;
        case 'BREACHED':
            ringColor = "#ef4444"; // red-pulsing
            strokeDasharray = circumference;
            strokeDashoffset = 0;
            animationClass = "animate-pulse";
            break;
        default:
            ringColor = "#1f2937"; // dark
    }

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
                    className={`transition-all duration-300 ${animationClass}`}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                <div className={`text-base font-bold leading-tight ${task.sla_state === 'BREACHED' ? 'text-red-500' : ''}`}>
                    {task.sla_label?.split(' ')[0] || '0'}
                    <span className="text-[10px] ml-0.5 uppercase tracking-tighter">
                        {task.sla_label?.split(' ')[1] || 'min'}
                    </span>
                </div>
                <div className="text-[9px] text-gray-500 uppercase tracking-tighter">
                    {task.sla_label?.split(' ').slice(2).join(' ')}
                </div>
            </div>
        </div>
    );
}

// --------------------------------------------------------
// MODALS
// --------------------------------------------------------

function StartTaskModal({ task, onClose }: { task: Ticket, onClose: () => void }) {
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
                    <Button onClick={async () => { setIsSubmitting(true); await ticketService.startTask({ ticketId: task.id, note }); onClose(); }} disabled={isSubmitting} variant="primary">{isSubmitting ? 'Starting...' : '▶ Start Task'}</Button>
                </div>
            }
        >
            <input type="text" placeholder="Add note (optional)" value={note} onChange={e => setNote(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 mb-6 focus:outline-none focus:border-white/20" />
        </ModalLayout>
    );
}

function CompleteTaskModal({ task, onClose }: { task: Ticket, onClose: () => void }) {
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
                    <Button onClick={async () => { setIsSubmitting(true); await ticketService.completeTask({ ticketId: task.id, note }); onClose(); }} disabled={isSubmitting} variant="primary">{isSubmitting ? 'Completing...' : '✓ Mark Complete'}</Button>
                </div>
            }
        >
            <textarea placeholder="Add completion note (optional)" value={note} onChange={e => setNote(e.target.value)} rows={4} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 mb-6 resize-none focus:outline-none focus:border-white/20" />
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

function BlockTaskModal({ task, reasons, onClose }: { task: Ticket, reasons: BlockReason[], onClose: () => void }) {
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
            onClose();
        } catch (e: any) { alert(e.message); setIsSubmitting(false); }
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
                        <div key={reason.code} >
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

function UpdateStatusModal({ task, reasons, onClose }: { task: Ticket, reasons: BlockReason[], onClose: () => void }) {
    const [selectedStatus, setSelectedStatus] = useState<string>(task.block_reason_code || "");
    const [note, setNote] = useState("");
    const [resumeAfter, setResumeAfter] = useState<Date | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isResuming, setIsResuming] = useState(false);
    const noteInputRef = useRef<HTMLInputElement>(null);

    const isSomethingElse = selectedStatus === 'something_else';

    // Validation:
    const canUpdateStatus = selectedStatus && (!isSomethingElse || note.trim().length > 0);
    const canResume = !isSubmitting;

    const handleUpdate = async (resume: boolean = false) => {
        if (!resume && !canUpdateStatus) return;

        setIsSubmitting(true);
        if (resume) setIsResuming(true);

        try {
            await ticketService.updateBlockedStatus({
                ticketId: task.id,
                reasonCode: selectedStatus as BlockReasonCode,
                note,
                resume,
                resumeAfter: resumeAfter?.toISOString()
            });
            onClose();
        } catch (e: any) { alert(e.message); setIsSubmitting(false); setIsResuming(false); }
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
                        <Button onClick={() => handleUpdate(false)} disabled={!canUpdateStatus || isSubmitting} variant="secondary">
                            {isSubmitting && !isResuming ? 'Updating...' : 'Update status'}
                        </Button>
                        <Button onClick={() => handleUpdate(true)} disabled={!canResume} variant="primary">
                            {isResuming ? 'Resuming...' : 'Ready to resume'}
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

// Reuseable Components
function ModalLayout({ title, taskTitle, children, onClose, footer }: { title: string, taskTitle: string, children: React.ReactNode, onClose: () => void, footer?: React.ReactNode }) {
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-[#1a1a1a] rounded-3xl w-full max-w-lg overflow-hidden animate-slide-up flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-start justify-between mb-2">
                        <h2 className="text-2xl font-bold">{title}</h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
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

function Button({ children, onClick, disabled, variant }: { children: React.ReactNode, onClick: () => void, disabled?: boolean, variant: "primary" | "secondary" }) {
    const base = "flex-1 py-4 rounded-xl font-semibold text-sm tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
    const styles = variant === "primary" ? "bg-[#4a7cff] text-white hover:bg-[#3d6ae6]" : "bg-transparent text-white border border-white/10 hover:bg-white/5";
    return <button onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>{children}</button>;
}
