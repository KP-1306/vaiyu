// web/src/routes/MyRequests.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getGuestTickets, reopenTicket, addGuestComment, getTicketComments, supa, getCancelReasons, cancelTicketByGuest } from "../lib/api";

type GuestTicket = {
    id: string;
    service_key: string;
    service_name: string;
    service_icon: string;
    status: string;
    reason_code: string | null;
    created_at: string;
    done_at: string | null;
    completed_at: string | null;
    description: string | null;
    priority: string | null;
    room_number: string | null;
    zone_name: string | null;
    location_label: string | null;
};

// Build menu link with stay context - Menu will derive hotel_id from stay code
function buildMenuLink(stayCode: string) {
    const params = new URLSearchParams({
        tab: 'services',
        code: stayCode,
        bookingCode: stayCode,
        from: 'stay'
    });

    return `/stay/${stayCode}/menu?${params.toString()}`;
}

// Guest-friendly reason code mapping
const guestFriendlyReasons: Record<string, string> = {
    'guest_inside_room': 'Waiting for access',
    'supervisor_approval': 'Waiting for approval',
    'parts_unavailable': 'Waiting for supplies',
    'guest_unavailable': 'Waiting for you',
    'staff_unavailable': 'Waiting for staff',
    'equipment_unavailable': 'Waiting for equipment',
    'external_dependency': 'Waiting for external service',
};

export default function MyRequests() {
    const { code } = useParams<{ code: string }>();
    const [tickets, setTickets] = useState<GuestTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [reopening, setReopening] = useState<string | null>(null);
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelTicketId, setCancelTicketId] = useState<string | null>(null);
    const [cancelReasons, setCancelReasons] = useState<Array<{ code: string; label: string; description: string; icon: string }>>([]);
    const [selectedCancelReason, setSelectedCancelReason] = useState('');
    const [cancelComment, setCancelComment] = useState('');
    const [cancelling, setCancelling] = useState<string | null>(null);
    const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
    const [commentText, setCommentText] = useState<Record<string, string>>({});
    const [submittingComment, setSubmittingComment] = useState<string | null>(null);
    const [ticketComments, setTicketComments] = useState<Record<string, any[]>>({});
    const [loadingComments, setLoadingComments] = useState<string | null>(null);
    const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
    const [reopenTicketId, setReopenTicketId] = useState<string | null>(null);
    const [reopenReason, setReopenReason] = useState('');

    // Fetch comments when ticket is expanded
    const fetchTicketComments = async (ticketId: string) => {
        if (ticketComments[ticketId]) return; // Already loaded

        try {
            setLoadingComments(ticketId);
            const comments = await getTicketComments(ticketId);
            setTicketComments(prev => ({ ...prev, [ticketId]: comments }));
        } catch (error) {
            console.error('Failed to fetch comments:', error);
        } finally {
            setLoadingComments(null);
        }
    };

    const handleToggleExpand = (ticketId: string) => {
        const newExpanded = expandedTicket === ticketId ? null : ticketId;
        setExpandedTicket(newExpanded);

        // Fetch comments when expanding
        if (newExpanded) {
            fetchTicketComments(newExpanded);
        }
    };

    // Fetch cancel reasons on mount
    useEffect(() => {
        async function fetchCancelReasons() {
            try {
                const reasons = await getCancelReasons();
                setCancelReasons(reasons);
            } catch (error) {
                console.error('Failed to fetch cancel reasons:', error);
            }
        }
        fetchCancelReasons();
    }, []);

    const handleCancelClick = (ticketId: string) => {
        setCancelTicketId(ticketId);
        setSelectedCancelReason('');
        setCancelComment('');
        setCancelDialogOpen(true);
    };

    const confirmCancel = async () => {
        if (!cancelTicketId || !selectedCancelReason) return;

        try {
            setCancelling(cancelTicketId);
            await cancelTicketByGuest(cancelTicketId, selectedCancelReason, cancelComment || undefined);

            // Refresh tickets
            const data = await getGuestTickets(code!);
            setTickets(data as GuestTicket[]);

            // Close dialog
            setCancelDialogOpen(false);
            setSelectedCancelReason('');
            setCancelComment('');
            setCancelTicketId(null);
        } catch (error: any) {
            console.error('Failed to cancel ticket:', error);
            alert(error.message || 'Failed to cancel request');
        } finally {
            setCancelling(null);
        }
    };


    useEffect(() => {
        if (!code) return;

        async function fetchTickets() {
            if (!code) return;
            try {
                setLoading(true);
                const data = await getGuestTickets(code);
                setTickets(data as GuestTicket[]);
            } catch (error) {
                console.error('Failed to fetch tickets:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchTickets();

        // Set up realtime subscription for ticket updates
        const s = supa();
        if (!s) return;

        const channel = s
            .channel('guest-tickets-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tickets',
                    filter: `stay_id=eq.${code}`
                },
                () => {
                    // Refetch tickets when any change occurs
                    fetchTickets();
                }
            )
            .subscribe();

        return () => {
            channel.unsubscribe();
        };
    }, [code]);

    const handleReopen = async (ticketId: string) => {
        setReopenTicketId(ticketId);
        setReopenDialogOpen(true);
    };

    const confirmReopen = async () => {
        if (!code || !reopenTicketId) return;

        try {
            setReopening(reopenTicketId);
            setReopenDialogOpen(false);

            // Get stay_id from stay code
            const { supabase } = await import("../lib/supabase");
            const { data: stay } = await supabase
                .from('stays')
                .select('id')
                .eq('booking_code', code)
                .maybeSingle();

            if (!stay?.id) {
                throw new Error('Stay not found');
            }

            const reason = reopenReason.trim() || 'Guest reopened completed request';
            await reopenTicket(reopenTicketId, stay.id, reason);

            // Refresh tickets
            const data = await getGuestTickets(code);
            setTickets(data as GuestTicket[]);

            // Reset dialog state
            setReopenReason('');
            setReopenTicketId(null);
        } catch (error: any) {
            console.error('Failed to reopen ticket:', error);
            alert(`Failed to reopen request: ${error.message || 'Please try again'}`);
        } finally {
            setReopening(null);
        }
    };

    const handleAddComment = async (ticketId: string) => {
        const comment = commentText[ticketId]?.trim();
        if (!comment) {
            alert('Please enter a comment');
            return;
        }

        if (comment.length > 500) {
            alert('Comment is too long (max 500 characters)');
            return;
        }

        try {
            setSubmittingComment(ticketId);
            await addGuestComment(ticketId, comment);

            // Clear comment input
            setCommentText(prev => ({ ...prev, [ticketId]: '' }));

            // Refresh comments to show new one
            const comments = await getTicketComments(ticketId);
            setTicketComments(prev => ({ ...prev, [ticketId]: comments }));
        } catch (error: any) {
            console.error('Failed to add comment:', error);
            alert(`Failed to add comment: ${error.message || 'Please try again'}`);
        } finally {
            setSubmittingComment(null);
        }
    };

    const activeTickets = tickets.filter(t => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
    const completedTickets = tickets.filter(t => t.status === 'COMPLETED');

    return (
        <main className="max-w-3xl mx-auto p-6">
            {/* Reopen Dialog */}
            {reopenDialogOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                        <h3 className="text-lg font-semibold mb-2">Reopen Request</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            This will create a new service request for staff. You can optionally add a reason below.
                        </p>

                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Reason (optional)
                        </label>
                        <textarea
                            value={reopenReason}
                            onChange={(e) => setReopenReason(e.target.value)}
                            placeholder="e.g., Issue not fully resolved, problem came back..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            rows={3}
                            maxLength={200}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {reopenReason.length}/200 characters
                        </p>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => {
                                    setReopenDialogOpen(false);
                                    setReopenReason('');
                                    setReopenTicketId(null);
                                }}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                                disabled={reopening !== null}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmReopen}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                                disabled={reopening !== null}
                            >
                                {reopening ? 'Reopening...' : 'Reopen Request'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Dialog */}
            {cancelDialogOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
                        <h3 className="text-lg font-semibold mb-2">Cancel Request</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Please select a reason for cancelling this request.
                        </p>

                        <div className="space-y-2 mb-4">
                            {cancelReasons.map((reason) => (
                                <button
                                    key={reason.code}
                                    onClick={() => setSelectedCancelReason(reason.code)}
                                    className={`w-full p-4 rounded-lg border-2 text-left transition-all ${selectedCancelReason === reason.code
                                        ? 'border-red-500 bg-red-50'
                                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`text-2xl ${selectedCancelReason === reason.code ? 'opacity-100' : 'opacity-60'
                                            }`}>
                                            {reason.icon === 'x-circle' && '⊗'}
                                            {reason.icon === 'undo' && '↶'}
                                            {(reason.icon === 'check-circle' || reason.icon === 'user-check') && '✓'}
                                            {!['x-circle', 'undo', 'check-circle', 'user-check'].includes(reason.icon) && '•'}
                                        </div>
                                        <div className="flex-1">
                                            <div className="font-medium text-gray-900">{reason.label}</div>
                                            <div className="text-sm text-gray-600 mt-1">{reason.description}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Additional notes (optional)
                        </label>
                        <textarea
                            value={cancelComment}
                            onChange={(e) => setCancelComment(e.target.value)}
                            placeholder="Any additional information..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            rows={3}
                            maxLength={200}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            {cancelComment.length}/200 characters
                        </p>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => {
                                    setCancelDialogOpen(false);
                                    setSelectedCancelReason('');
                                    setCancelComment('');
                                    setCancelTicketId(null);
                                }}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                                disabled={cancelling !== null}
                            >
                                Back
                            </button>
                            <button
                                onClick={confirmCancel}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                                disabled={!selectedCancelReason || cancelling !== null}
                            >
                                {cancelling ? 'Cancelling...' : 'Cancel Request'}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold">My Service Requests</h1>
                <Link
                    to={`/stay/${code}`}
                    className="text-sm text-blue-600 hover:text-blue-700"
                >
                    ← Back to stay
                </Link>
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-500">
                    Loading your requests...
                </div>
            ) : tickets.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-600 mb-4">You haven't made any service requests yet.</p>
                    <Link
                        to={code ? buildMenuLink(code) : '/menu'}
                        className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                    >
                        Request a service
                    </Link>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Active Requests */}
                    {activeTickets.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold mb-3">
                                Active ({activeTickets.length})
                            </h2>
                            <div className="space-y-3">
                                {activeTickets.map(ticket => (
                                    <TicketCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        expanded={expandedTicket === ticket.id}
                                        onToggleExpand={() => handleToggleExpand(ticket.id)}
                                        comments={ticketComments[ticket.id] || []}
                                        loadingComments={loadingComments === ticket.id}
                                        commentText={commentText[ticket.id] || ''}
                                        onCommentChange={(text) => setCommentText(prev => ({
                                            ...prev,
                                            [ticket.id]: text
                                        }))}
                                        onSubmitComment={() => handleAddComment(ticket.id)}
                                        submittingComment={submittingComment === ticket.id}
                                        onReopen={null}
                                        reopening={false}
                                        onCancel={handleCancelClick}
                                        cancelling={cancelling === ticket.id}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Completed Requests */}
                    {completedTickets.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold mb-3">
                                Completed ({completedTickets.length})
                            </h2>
                            <div className="space-y-3">
                                {completedTickets.map(ticket => (
                                    <TicketCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        expanded={expandedTicket === ticket.id}
                                        onToggleExpand={() => handleToggleExpand(ticket.id)}
                                        comments={ticketComments[ticket.id] || []}
                                        loadingComments={loadingComments === ticket.id}
                                        commentText=""
                                        onCommentChange={() => { }}
                                        onSubmitComment={() => { }}
                                        submittingComment={false}
                                        onReopen={handleReopen}
                                        reopening={reopening === ticket.id}
                                        onCancel={null}
                                        cancelling={false}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </main>
    );
}

// Guest-friendly system message mapping
const getGuestFriendlyMessage = (event: any, ticket: GuestTicket): string | null => {
    switch (event.event_type) {
        case 'CREATED':
            return 'Request received';
        case 'STARTED':
            return "We've started working on it";
        case 'BLOCKED':
            if (ticket.reason_code) {
                const friendlyReason = guestFriendlyReasons[ticket.reason_code] || 'On hold';
                return `On hold: ${friendlyReason}`;
            }
            return 'Request paused';
        case 'UNBLOCKED':
            return 'Work resumed';
        case 'COMPLETED':
            return 'Request completed';
        case 'CANCELLED':
            return 'Request cancelled';
        case 'REOPENED':
            return 'Request reopened';
        default:
            return null; // Hide internal events
    }
};

function TicketCard({
    ticket,
    expanded,
    onToggleExpand,
    comments,
    loadingComments,
    commentText,
    onCommentChange,
    onSubmitComment,
    submittingComment,
    onReopen,
    reopening,
    onCancel,
    cancelling
}: {
    ticket: GuestTicket;
    expanded: boolean;
    onToggleExpand: () => void;
    comments: any[];
    loadingComments: boolean;
    commentText: string;
    onCommentChange: (text: string) => void;
    onSubmitComment: () => void;
    submittingComment: boolean;
    onReopen: ((id: string) => void) | null;
    reopening: boolean;
    onCancel: ((id: string) => void) | null;
    cancelling: boolean;
}) {
    const statusColors = {
        NEW: 'bg-blue-100 text-blue-800',
        REQUESTED: 'bg-blue-100 text-blue-800',
        ACCEPTED: 'bg-yellow-100 text-yellow-800',
        IN_PROGRESS: 'bg-purple-100 text-purple-800',
        COMPLETED: 'bg-green-100 text-green-800',
        BLOCKED: 'bg-red-100 text-red-800',
        CANCELLED: 'bg-gray-100 text-gray-800',
    };

    const statusLabels = {
        NEW: 'Requested',
        REQUESTED: 'Requested',
        ACCEPTED: 'Accepted',
        IN_PROGRESS: 'In Progress',
        COMPLETED: 'Completed',
        BLOCKED: 'On Hold',
        CANCELLED: 'Cancelled',
    };

    const timeAgo = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    };

    // Get guest-friendly reason for BLOCKED status
    const getStatusLabel = () => {
        if (ticket.status === 'BLOCKED' && ticket.reason_code) {
            const friendlyReason = guestFriendlyReasons[ticket.reason_code] || 'Waiting';
            return `On Hold · ${friendlyReason}`;
        }
        return statusLabels[ticket.status as keyof typeof statusLabels] || ticket.status;
    };

    const canComment = ['NEW', 'IN_PROGRESS', 'BLOCKED'].includes(ticket.status);
    const isOnHold = ticket.status === 'BLOCKED';

    return (
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            {/* Collapsed view - always visible */}
            <div
                className="p-4 cursor-pointer hover:bg-gray-50"
                onClick={onToggleExpand}
            >
                <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                        <span className="text-2xl">{ticket.service_icon || '🔧'}</span>
                        <div className="flex-1">
                            <h3 className="font-semibold">{ticket.service_name || ticket.service_key}</h3>
                            {ticket.description && !expanded && (
                                <p className="text-sm text-gray-600 mt-1 line-clamp-1">{ticket.description}</p>
                            )}
                            {ticket.location_label && (
                                <p className="text-xs text-gray-500 mt-1">📍 {ticket.location_label}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[ticket.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}`}>
                                    {getStatusLabel()}
                                </span>
                                <span className="text-xs text-gray-500">
                                    {ticket.completed_at ? timeAgo(ticket.completed_at) : timeAgo(ticket.created_at)}
                                </span>
                            </div>
                            {isOnHold && (
                                <p className="text-xs text-gray-500 mt-1 italic">
                                    We'll notify you as soon as this resumes
                                </p>
                            )}
                        </div>
                    </div>
                    <button className="text-gray-400 hover:text-gray-600">
                        {expanded ? '▲' : '▼'}
                    </button>
                </div>
            </div>

            {/* Expanded view - details and actions */}
            {expanded && (
                <div className="px-4 pb-4 border-t bg-gray-50">
                    {ticket.description && (
                        <div className="mt-3">
                            <p className="text-sm font-medium text-gray-700">Request Details</p>
                            <p className="text-sm text-gray-600 mt-1">{ticket.description}</p>
                        </div>
                    )}

                    {/* Activity Timeline - Curated system messages */}
                    {!loadingComments && comments.length > 0 && (() => {
                        // System events (excluding comments)
                        const systemEvents = comments.filter(event => event.event_type !== 'COMMENT_ADDED');
                        const dedupedEvents = systemEvents.filter((event, index) => {
                            if (index === 0) return true;

                            // Always keep events with staff comments
                            if (event.comment && event.comment.trim()) return true;

                            // For events without comments, deduplicate consecutive same messages
                            const prevMessage = getGuestFriendlyMessage(systemEvents[index - 1], ticket);
                            const currMessage = getGuestFriendlyMessage(event, ticket);
                            return prevMessage !== currMessage;
                        });

                        if (dedupedEvents.length === 0) return null;

                        return (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-gray-700 mb-2">Activity</p>
                                <div className="space-y-2">
                                    {dedupedEvents.map((event, index) => {
                                        const message = getGuestFriendlyMessage(event, ticket);
                                        if (!message) return null;

                                        // Check if this is a duplicate status with only a comment
                                        const prevEvent = index > 0 ? dedupedEvents[index - 1] : null;
                                        const prevMessage = prevEvent ? getGuestFriendlyMessage(prevEvent, ticket) : null;
                                        const isDuplicateStatus = message === prevMessage;
                                        const hasComment = event.comment && event.comment.trim();

                                        return (
                                            <div key={event.id}>
                                                {/* Only show system message if status changed OR no comment */}
                                                {(!isDuplicateStatus || !hasComment) && (
                                                    <div className="flex items-start gap-2 text-sm text-gray-600">
                                                        <span className="text-gray-400">•</span>
                                                        <span className="text-xs text-gray-500 min-w-[80px]">
                                                            {new Date(event.created_at).toLocaleDateString('en-US', {
                                                                month: 'short',
                                                                day: 'numeric'
                                                            })}
                                                        </span>
                                                        <span className="flex-1">{message}</span>
                                                    </div>
                                                )}
                                                {/* Show staff comment */}
                                                {hasComment && (
                                                    <div className={`text-xs text-gray-600 italic ${isDuplicateStatus ? 'flex items-start gap-2 ml-0' : 'ml-6 mt-1 pl-4 border-l-2 border-gray-300'}`}>
                                                        {isDuplicateStatus && (
                                                            <>
                                                                <span className="text-gray-400">•</span>
                                                                <span className="text-gray-500 min-w-[80px]">
                                                                    {new Date(event.created_at).toLocaleDateString('en-US', {
                                                                        month: 'short',
                                                                        day: 'numeric'
                                                                    })}
                                                                </span>
                                                            </>
                                                        )}
                                                        <span className="flex-1">"{event.comment}"</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }).filter(Boolean)}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Conversation Timeline */}
                    {(() => {
                        // Show all comments (guest and staff)
                        const conversationComments = comments.filter(c =>
                            c.event_type === 'COMMENT_ADDED'
                        );

                        if (conversationComments.length === 0) return null;

                        return (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-gray-700 mb-2">Conversation</p>
                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {conversationComments.map((comment) => (
                                        <div
                                            key={comment.id}
                                            className={`p-3 rounded-lg text-sm ${comment.actor_type === 'GUEST'
                                                ? 'bg-blue-50 border-l-2 border-blue-500'
                                                : 'bg-gray-100 border-l-2 border-gray-400'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-gray-600">
                                                    {comment.actor_type === 'GUEST' ? 'You' : 'Staff'}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {new Date(comment.created_at).toLocaleString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: 'numeric',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                            <p className="text-gray-700">{comment.comment}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {loadingComments && (
                        <div className="mt-4 text-center text-sm text-gray-500">
                            Loading conversation...
                        </div>
                    )}

                    {/* Comment input for active tickets */}
                    {canComment && (
                        <div className="mt-4">
                            <label className="text-sm font-medium text-gray-700 block mb-2">
                                Add a note
                            </label>
                            <textarea
                                value={commentText}
                                onChange={(e) => onCommentChange(e.target.value)}
                                placeholder="e.g., 'I'm back in the room now' or 'Please come after 3 PM'"
                                className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                rows={2}
                                maxLength={500}
                                disabled={submittingComment}
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-gray-500">
                                    {commentText.length}/500 characters
                                </span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSubmitComment();
                                    }}
                                    disabled={!commentText.trim() || submittingComment}
                                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submittingComment ? 'Adding...' : 'Add Comment'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Cancel button for NEW/IN_PROGRESS tickets */}
                    {onCancel && (ticket.status === 'NEW' || ticket.status === 'IN_PROGRESS') && (
                        <div className="mt-4 pt-3 border-t">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCancel(ticket.id);
                                }}
                                disabled={cancelling}
                                className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {cancelling ? 'Cancelling...' : '✕ Cancel Request'}
                            </button>
                        </div>
                    )}


                    {/* Reopen button for completed tickets */}
                    {onReopen && (
                        <div className="mt-4 pt-3 border-t">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onReopen(ticket.id);
                                }}
                                disabled={reopening}
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {reopening ? 'Reopening...' : '🔄 Reopen Request'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
