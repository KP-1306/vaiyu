import { useState, useEffect } from 'react';
import { X, Clock, User, AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight, Briefcase, Activity } from 'lucide-react';
import { getTicketEvents, grantSlaException, rejectSlaException, unblockTask, rejectSupervisorApproval } from '../lib/api';

// ============================================================
// Types
// ============================================================

interface SupervisorDecisionDrawerProps {
    ticket: {
        id: string;
        service_key: string;
        room: string | number;
        status: string;
        sla_state?: string;
        mins_remaining?: number | null;
        supervisor_request_type?: string;
        supervisor_reason_code?: string;
        supervisor_requested_at?: string;
        reason_code?: string;
        assignee_name?: string;
        assignee_id?: string;
        created_at: string;
    } | null;
    isOpen: boolean;
    onClose: () => void;
    onDecision: () => void; // Called after any decision to refresh
}

interface TicketEvent {
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    comment: string | null;
    created_at: string;
    new_status: string | null;
    previous_status: string | null;
    reason_code: string | null;
}

interface StaffLoad {
    active_tasks: number;
    blocked_tasks: number;
    at_risk_tasks: number;
}

// ============================================================
// Component
// ============================================================

export default function SupervisorDecisionDrawer({
    ticket,
    isOpen,
    onClose,
    onDecision
}: SupervisorDecisionDrawerProps) {
    const [events, setEvents] = useState<TicketEvent[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [eventsExpanded, setEventsExpanded] = useState(true);
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [staffLoad, setStaffLoad] = useState<StaffLoad>({ active_tasks: 0, blocked_tasks: 0, at_risk_tasks: 0 });

    // Fetch events when ticket changes
    useEffect(() => {
        if (!ticket || !isOpen) return;

        const fetchEvents = async () => {
            setEventsLoading(true);
            try {
                const eventsData = await getTicketEvents(ticket.id);
                setEvents(eventsData || []);
            } catch (err) {
                console.error('Failed to fetch events', err);
            } finally {
                setEventsLoading(false);
            }
        };

        fetchEvents();
        setComment('');
        setError(null);
    }, [ticket?.id, isOpen]);

    // Fetch staff load separately (non-blocking)
    useEffect(() => {
        if (!ticket?.assignee_id || !isOpen) {
            setStaffLoad({ active_tasks: 0, blocked_tasks: 0, at_risk_tasks: 0 });
            return;
        }

        const fetchStaffLoad = async () => {
            try {
                const { getStaffLoad } = await import('../lib/api');
                const load = await getStaffLoad(ticket.assignee_id!);
                setStaffLoad(load);
            } catch (err) {
                console.error('Failed to fetch staff load', err);
            }
        };

        fetchStaffLoad();
    }, [ticket?.assignee_id, isOpen]);

    // Find the SLA exception request event
    const slaRequestEvent = events.find(e => e.event_type === 'SLA_EXCEPTION_REQUESTED');

    // Handle decision
    const handleGrant = async () => {
        if (!ticket) return;
        if (!comment.trim()) {
            setError('Comment is required to grant SLA exception');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        try {
            await grantSlaException(ticket.id, comment);
            onDecision();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to grant SLA exception');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReject = async () => {
        if (!ticket) return;
        if (!comment.trim()) {
            setError('Comment is required to reject SLA exception');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        try {
            await rejectSlaException(ticket.id, comment);
            onDecision();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to reject SLA exception');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Format timestamp
    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Get event icon
    const getEventIcon = (eventType: string) => {
        switch (eventType) {
            case 'CREATED': return '🆕';
            case 'STARTED': return '▶️';
            case 'BLOCKED': return '🔴';
            case 'UNBLOCKED': return '🟢';
            case 'SLA_EXCEPTION_REQUESTED': return '⏱️';
            case 'SLA_EXCEPTION_GRANTED': return '✅';
            case 'SLA_EXCEPTION_REJECTED': return '❌';
            case 'SUPERVISOR_APPROVED': return '✓';
            case 'SUPERVISOR_REJECTED': return '✗';
            default: return '•';
        }
    };

    // Get human-readable event description
    const getEventDescription = (event: TicketEvent) => {
        const desc: Record<string, string> = {
            'CREATED': 'Ticket created',
            'ASSIGNED': 'Assigned to staff',
            'STARTED': 'Work started',
            'BLOCKED': `Blocked: ${event.reason_code?.replace(/_/g, ' ') || 'Unknown reason'}`,
            'UNBLOCKED': `Unblocked: ${event.reason_code?.replace(/_/g, ' ') || 'Resumed'}`,
            'SLA_EXCEPTION_REQUESTED': `SLA Exception Requested: ${event.reason_code?.replace(/_/g, ' ') || 'No reason'}`,
            'SLA_EXCEPTION_GRANTED': 'SLA Exception Granted',
            'SLA_EXCEPTION_REJECTED': 'SLA Exception Rejected',
            'COMPLETED': 'Completed',
            'CANCELLED': 'Cancelled',
        };
        return desc[event.event_type] || event.event_type.replace(/_/g, ' ');
    };

    // Get SLA state styling
    const getSlaStateStyle = () => {
        switch (ticket?.sla_state) {
            case 'BREACHED': return 'bg-red-500/20 text-red-400 border-red-500/30';
            case 'PAUSED': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'RUNNING': return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'EXEMPTED': return 'bg-green-500/20 text-green-400 border-green-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    if (!isOpen || !ticket) return null;

    const isSlaException = ticket.supervisor_request_type === 'SLA_EXCEPTION_REQUESTED';
    const isSupervisorApproval = ticket.supervisor_request_type === 'BLOCKED' ||
        ticket.supervisor_reason_code === 'supervisor_approval' ||
        (ticket.status === 'Paused' && ticket.reason_code === 'supervisor_approval');

    // Handlers for Supervisor Approval
    const handleApprove = async () => {
        if (!ticket) return;
        setIsSubmitting(true);
        setError(null);
        try {
            await unblockTask(ticket.id, 'SUPERVISOR_APPROVED', comment || 'Approved by supervisor');
            onDecision();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to approve');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRejectApproval = async () => {
        if (!ticket) return;
        if (!comment.trim()) {
            setError('Comment is required to reject');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            await rejectSupervisorApproval(ticket.id, comment);
            onDecision();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to reject');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="relative w-full max-w-lg bg-[#0d0d0d] border-l border-gray-800 overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-[#0d0d0d] border-b border-gray-800 p-4 z-10">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-white">
                                {ticket.service_key.replace(/_/g, ' ')}
                            </h2>
                            <p className="text-sm text-gray-400 mt-1">
                                Room {ticket.room} • Supervisor Review
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Status badges */}
                    <div className="flex flex-wrap gap-2 mt-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${ticket.status === 'IN_PROGRESS' || ticket.status === 'InProgress'
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                            }`}>
                            {ticket.status}
                        </span>
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${getSlaStateStyle()}`}>
                            SLA: {ticket.sla_state || 'Unknown'}{' '}
                            {ticket.mins_remaining != null && ticket.sla_state !== 'EXEMPTED' && `(${ticket.mins_remaining}m)`}
                        </span>
                        {isSlaException && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                ⏱️ SLA Exception Requested
                            </span>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-6">

                    {/* SLA Exception Request Context */}
                    {isSlaException && (
                        <div className="bg-blue-900/20 border border-blue-900/30 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="text-blue-400" size={18} />
                                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                                    SLA Exception Request
                                </h3>
                            </div>

                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Reason:</span>
                                    <span className="text-white font-medium">
                                        {(ticket.supervisor_reason_code || slaRequestEvent?.reason_code || 'Not specified').replace(/_/g, ' ')}
                                    </span>
                                </div>
                                {slaRequestEvent?.comment && (
                                    <div>
                                        <span className="text-gray-400">Staff Comment:</span>
                                        <p className="text-white mt-1 bg-gray-800/50 rounded p-2 italic">
                                            "{slaRequestEvent.comment}"
                                        </p>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Requested at:</span>
                                    <span className="text-white">
                                        {ticket.supervisor_requested_at ? formatTime(ticket.supervisor_requested_at) : 'Unknown'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Staff Context */}
                    <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <User className="text-gray-400" size={18} />
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                                Assigned Staff
                            </h3>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 font-medium">
                                    {ticket.assignee_name?.charAt(0) || '?'}
                                </div>
                                <div>
                                    <p className="text-white font-medium">{ticket.assignee_name || 'Unassigned'}</p>
                                    <p className="text-xs text-gray-400">Staff Member</p>
                                </div>
                            </div>

                            {/* Staff Load */}
                            <div className="grid grid-cols-3 gap-2 mt-3">
                                <div className="bg-gray-800/50 rounded p-2 text-center">
                                    <p className="text-lg font-bold text-green-400">{staffLoad.active_tasks}</p>
                                    <p className="text-[10px] text-gray-400 uppercase">Active</p>
                                </div>
                                <div className="bg-gray-800/50 rounded p-2 text-center">
                                    <p className="text-lg font-bold text-red-400">{staffLoad.blocked_tasks}</p>
                                    <p className="text-[10px] text-gray-400 uppercase">Blocked</p>
                                </div>
                                <div className="bg-gray-800/50 rounded p-2 text-center">
                                    <p className="text-lg font-bold text-amber-400">{staffLoad.at_risk_tasks}</p>
                                    <p className="text-[10px] text-gray-400 uppercase">At Risk</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Event Timeline */}
                    <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setEventsExpanded(!eventsExpanded)}
                            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Activity className="text-gray-400" size={18} />
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                                    Activity Timeline
                                </h3>
                            </div>
                            {eventsExpanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                        </button>

                        {eventsExpanded && (
                            <div className="px-4 pb-4 max-h-60 overflow-y-auto">
                                {eventsLoading ? (
                                    <p className="text-gray-400 text-sm">Loading events...</p>
                                ) : events.length === 0 ? (
                                    <p className="text-gray-400 text-sm">No events found</p>
                                ) : (
                                    <div className="space-y-2">
                                        {events.slice().reverse().map((event, idx) => (
                                            <div
                                                key={event.id || idx}
                                                className={`flex gap-3 text-sm p-2 rounded ${event.event_type === 'SLA_EXCEPTION_REQUESTED'
                                                    ? 'bg-blue-900/20 border border-blue-900/30'
                                                    : ''
                                                    }`}
                                            >
                                                <span className="flex-shrink-0">{getEventIcon(event.event_type)}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-gray-200">{getEventDescription(event)}</p>
                                                    {event.comment && (
                                                        <p className="text-gray-400 text-xs mt-0.5 truncate">"{event.comment}"</p>
                                                    )}
                                                    <p className="text-gray-500 text-xs mt-0.5">{formatTime(event.created_at)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Decision Controls - SLA Exception */}
                    {isSlaException && (
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-3">
                                Your Decision - SLA Exception
                            </h3>

                            {/* Comment input */}
                            <div className="mb-4">
                                <label className="block text-sm text-gray-400 mb-2">
                                    Comment <span className="text-red-400">*</span>
                                </label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="Explain your decision..."
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                    rows={3}
                                />
                            </div>

                            {/* Error message */}
                            {error && (
                                <div className="mb-4 p-3 bg-red-900/20 border border-red-900/30 rounded-lg">
                                    <p className="text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            {/* Decision buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleReject}
                                    disabled={isSubmitting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-900/20 border border-red-900/50 text-red-400 font-bold uppercase text-sm rounded-lg hover:bg-red-900/30 transition-colors disabled:opacity-50"
                                >
                                    <XCircle size={16} />
                                    Reject Exception
                                </button>
                                <button
                                    onClick={handleGrant}
                                    disabled={isSubmitting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 text-black font-bold uppercase text-sm rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-50"
                                >
                                    <CheckCircle size={16} />
                                    Grant Exception
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Decision Controls - Supervisor Approval */}
                    {isSupervisorApproval && !isSlaException && (
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-3">
                                Your Decision - Supervisor Approval
                            </h3>

                            {/* Comment input */}
                            <div className="mb-4">
                                <label className="block text-sm text-gray-400 mb-2">
                                    Comment <span className="text-gray-500">(optional for approve, required for reject)</span>
                                </label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder="Optional comment..."
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                    rows={3}
                                />
                            </div>

                            {/* Error message */}
                            {error && (
                                <div className="mb-4 p-3 bg-red-900/20 border border-red-900/30 rounded-lg">
                                    <p className="text-red-400 text-sm">{error}</p>
                                </div>
                            )}

                            {/* Decision buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleRejectApproval}
                                    disabled={isSubmitting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-900/20 border border-red-900/50 text-red-400 font-bold uppercase text-sm rounded-lg hover:bg-red-900/30 transition-colors disabled:opacity-50"
                                >
                                    <XCircle size={16} />
                                    Reject
                                </button>
                                <button
                                    onClick={handleApprove}
                                    disabled={isSubmitting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-black font-bold uppercase text-sm rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50"
                                >
                                    <CheckCircle size={16} />
                                    Approve
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Unknown request type */}
                    {!isSlaException && !isSupervisorApproval && (
                        <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
                            <p className="text-gray-400 text-sm text-center">
                                This ticket requires supervisor attention.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
