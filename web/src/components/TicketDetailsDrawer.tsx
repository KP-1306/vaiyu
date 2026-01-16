import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import type { StaffRunnerTicket } from '../types/ticket';
import { getTicketEvents, addStaffComment } from '../lib/api';
import { formatTimeRemaining, getSLAStatus, getSLAColor } from '../utils/sla';

interface TicketDetailsDrawerProps {
    ticket: StaffRunnerTicket | null;
    isOpen: boolean;
    onClose: () => void;
    onStart?: () => void;
    onComplete?: () => void;
    onResume?: () => void;
    onBlock?: () => void;
    onRequestSupervisor?: () => void;
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

export default function TicketDetailsDrawer({
    ticket,
    isOpen,
    onClose,
    onStart,
    onComplete,
    onResume,
    onBlock,
    onRequestSupervisor
}: TicketDetailsDrawerProps) {
    const [events, setEvents] = useState<TicketEvent[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(false);
    const [timelineExpanded, setTimelineExpanded] = useState(false);
    const [commentsExpanded, setCommentsExpanded] = useState(false);
    const [newComment, setNewComment] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (ticket && isOpen) {
            fetchEvents();
        }
    }, [ticket?.ticket_id, isOpen]);

    const fetchEvents = async () => {
        if (!ticket) return;

        try {
            setLoadingEvents(true);
            const data = await getTicketEvents(ticket.ticket_id);
            setEvents(data);
        } catch (error) {
            console.error('Failed to fetch ticket events:', error);
        } finally {
            setLoadingEvents(false);
        }
    };

    const handleAddComment = async () => {
        if (!ticket || !newComment.trim() || submitting) return;

        try {
            setSubmitting(true);
            await addStaffComment(ticket.ticket_id, newComment.trim());
            setNewComment('');
            await fetchEvents(); // Refresh to show new comment
        } catch (error) {
            console.error('Failed to add comment:', error);
            alert('Failed to add comment. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen || !ticket) return null;

    // Get latest block event
    const latestBlock = events
        .filter(e => e.event_type === 'BLOCKED')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    const blockedDuration = latestBlock
        ? Math.floor((Date.now() - new Date(latestBlock.created_at).getTime()) / 1000)
        : 0;

    const formatDuration = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    };

    const getEventMessage = (event: TicketEvent): string => {
        switch (event.event_type) {
            case 'CREATED': return 'Ticket Created';
            case 'ASSIGNED': return 'Assigned to You';
            case 'STARTED': return 'Marked In Progress';
            case 'BLOCKED': return event.comment || 'Blocked';
            case 'UNBLOCKED': return 'Resumed';
            case 'COMPLETED': return 'Completed';
            case 'SUPERVISOR_REQUESTED': return 'Supervisor Requested';
            default: return event.event_type;
        }
    };

    const getActorName = (event: TicketEvent): string => {
        if (event.actor_type === 'SYSTEM') return 'SYSTEM';
        if (event.actor_type === 'GUEST') return 'Guest';
        // TODO: Fetch staff name from actor_id
        return 'You';
    };

    const statusColors: Record<string, string> = {
        'NEW': 'bg-blue-500',
        'IN_PROGRESS': 'bg-green-500',
        'BLOCKED': 'bg-red-500',
        'COMPLETED': 'bg-gray-500',
    };

    const slaStatus = ticket.sla_state.toLowerCase();
    const slaColorClass = ticket.sla_breached ? 'text-red-500' : ticket.sla_state === 'PAUSED' ? 'text-yellow-500' : 'text-green-500';

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="fixed right-0 top-0 h-full w-full md:w-[480px] bg-gray-900 text-white z-50 shadow-2xl overflow-y-auto">
                {/* Header - Sticky */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 z-10">
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                            <h2 className="text-xl font-semibold">
                                {ticket.title}
                            </h2>
                            <p className="text-sm text-gray-400">{ticket.department_name}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">STATUS:</span>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[ticket.status] || 'bg-gray-600'}`}>
                                {ticket.status}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">SLA:</span>
                            <span className={slaColorClass}>
                                {ticket.sla_label || 'N/A'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">ASSIGNED TO:</span>
                            <span>You</span>
                        </div>
                    </div>
                </div>

                {/* Current Block Section */}
                {ticket.status === 'BLOCKED' && latestBlock && (
                    <div className="p-6 bg-red-900 bg-opacity-20 border-b border-gray-700">
                        <h3 className="text-sm font-semibold text-red-400 mb-3">🔴 CURRENT BLOCK</h3>
                        <div className="space-y-2 text-sm">
                            <div>
                                <span className="text-gray-400">Reason: </span>
                                <span>{latestBlock.comment || 'No reason provided'}</span>
                            </div>
                            <div>
                                <span className="text-gray-400">Blocked by: </span>
                                <span>{getActorName(latestBlock)}</span>
                            </div>
                            <div>
                                <span className="text-gray-400">Blocked since: </span>
                                <span>{formatDuration(blockedDuration)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions Section - Standardized across all states */}
                <div className="p-6 border-b border-gray-700">
                    <div className="flex gap-3">
                        {/* Primary action (state-dependent) */}
                        {ticket.status === 'NEW' && onStart && (
                            <button
                                onClick={onStart}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium"
                            >
                                Start
                            </button>
                        )}
                        {ticket.status === 'IN_PROGRESS' && onComplete && (
                            <button
                                onClick={onComplete}
                                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium"
                            >
                                Complete
                            </button>
                        )}
                        {ticket.status === 'BLOCKED' && onResume && (
                            <button
                                onClick={onResume}
                                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium"
                            >
                                Resume
                            </button>
                        )}

                        {/* Block button: IN_PROGRESS and BLOCKED only */}
                        {ticket.status === 'IN_PROGRESS' && onBlock && (
                            <button
                                onClick={onBlock}
                                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
                            >
                                Block
                            </button>
                        )}
                        {ticket.status === 'BLOCKED' && onBlock && (
                            <button
                                onClick={onBlock}
                                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
                            >
                                Update
                            </button>
                        )}

                        {/* Supervisor button: BLOCKED only */}
                        {ticket.status === 'BLOCKED' && onRequestSupervisor && (
                            <button
                                onClick={onRequestSupervisor}
                                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium"
                            >
                                Supervisor
                            </button>
                        )}
                    </div>
                </div>

                {/* Activity Timeline - Collapsible */}
                <div className="border-b border-gray-700">
                    <button
                        onClick={() => setTimelineExpanded(!timelineExpanded)}
                        className="w-full p-6 flex items-center justify-between hover:bg-gray-800"
                    >
                        <span className="font-medium">Activity Timeline</span>
                        {timelineExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>

                    {timelineExpanded && (
                        <div className="px-6 pb-6 space-y-4">
                            {loadingEvents ? (
                                <p className="text-sm text-gray-400">Loading...</p>
                            ) : events.length === 0 ? (
                                <p className="text-sm text-gray-400">No activity yet</p>
                            ) : (
                                events
                                    .filter(e => e.event_type !== 'COMMENT_ADDED')
                                    .map(event => (
                                        <div key={event.id} className="flex gap-3">
                                            <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-green-500" />
                                            <div className="flex-1">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium">
                                                            {getEventMessage(event)}
                                                            {event.event_type === 'BLOCKED' && event.comment && (
                                                                <span className="text-red-400"> - {event.comment}</span>
                                                            )}
                                                        </p>
                                                        <p className="text-xs text-gray-400">
                                                            {getActorName(event)}
                                                        </p>
                                                    </div>
                                                    <span className="text-xs text-gray-500">
                                                        {new Date(event.created_at).toLocaleDateString('en-US', {
                                                            day: 'numeric',
                                                            month: 'short',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    )}
                </div>

                {/* Comments Section - Collapsible */}
                <div className="border-b border-gray-700">
                    <button
                        onClick={() => setCommentsExpanded(!commentsExpanded)}
                        className="w-full p-6 flex items-center justify-between hover:bg-gray-800"
                    >
                        <span className="font-medium">
                            Comments ({events.filter(e => e.event_type === 'COMMENT_ADDED').length})
                        </span>
                        {commentsExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>

                    {commentsExpanded && (
                        <div className="px-6 pb-6 space-y-3">
                            {/* Existing comments */}
                            {events
                                .filter(e => e.event_type === 'COMMENT_ADDED')
                                .map(event => (
                                    <div key={event.id} className="bg-gray-800 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm font-medium">{getActorName(event)}</span>
                                            <span className="text-xs text-gray-500">
                                                {new Date(event.created_at).toLocaleDateString('en-US', {
                                                    day: 'numeric',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-300">{event.comment}</p>
                                    </div>
                                ))}

                            {/* Add comment input */}
                            <div className="mt-4 pt-4 border-t border-gray-700">
                                <textarea
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    placeholder="Add a comment..."
                                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                    rows={3}
                                    maxLength={1000}
                                />
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-xs text-gray-500">
                                        {newComment.length}/1000
                                    </span>
                                    <button
                                        onClick={handleAddComment}
                                        disabled={!newComment.trim() || submitting}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? 'Adding...' : 'Add Comment'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 text-xs text-gray-500 space-y-1">
                    <div>Created: {new Date(ticket.created_at).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}</div>
                    <div>Requestor: {ticket.requested_by}</div>
                    <div>Ticket ID: #{ticket.ticket_id.slice(0, 8)}</div>
                </div>
            </div>
        </>
    );
}
