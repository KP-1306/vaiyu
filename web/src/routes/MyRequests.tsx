// web/src/routes/MyRequests.tsx
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { getGuestTickets, reopenTicket, addGuestComment, getTicketComments, supa, getCancelReasons, cancelTicketByGuest, getGuestFoodOrders } from "../lib/api";

type GuestTicket = {
    id: string;
    display_id: string; // Added for RPC
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
    sla_minutes?: number;
    sla_started_at?: string;
};

type GuestFoodOrder = {
    order_id: string;
    display_id: string;
    status: string;
    created_at: string;
    updated_at: string;
    total_amount: number;
    currency: string;
    room_number?: string;
    items: { name: string; quantity: number; price: number }[];
    total_items: number;
    sla_target_at?: string;
    sla_minutes_remaining?: number;
    sla_breached?: boolean;
    special_instructions?: string;
};

// Build menu menu link with stay context - Menu will derive hotel_id from stay code
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
    const [trackId, setTrackId] = useState('');
    const [searchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
    const [mainTab, setMainTab] = useState<'services' | 'food'>(
        (searchParams.get('tab') as 'services' | 'food') || 'services'
    );
    const [foodOrders, setFoodOrders] = useState<GuestFoodOrder[]>([]);
    const [loadingFood, setLoadingFood] = useState(false);
    const navigate = useNavigate();

    const handleTrack = (e: React.FormEvent) => {
        e.preventDefault();
        const id = trackId.trim().toUpperCase();
        if (!id) return;

        // Route based on prefix
        if (id.startsWith('ORD-')) {
            // Food order - navigate to food order tracking
            navigate(`/track-order/${id}`);
        } else {
            // Default to ticket tracking (works for REQ- or raw IDs)
            navigate(`/track/${id}`);
        }
    };

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
        // Save stay code to session for tracking pages
        try { sessionStorage.setItem('vaiyu:stay_code', code); } catch { }

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

    // Fetch food orders when on food tab
    useEffect(() => {
        if (!code || mainTab !== 'food') return;

        async function fetchFoodOrders() {
            if (!code) return;
            try {
                setLoadingFood(true);
                const data = await getGuestFoodOrders(code);
                setFoodOrders(data as GuestFoodOrder[]);
            } catch (error) {
                console.error('Failed to fetch food orders:', error);
            } finally {
                setLoadingFood(false);
            }
        }

        fetchFoodOrders();

        // Set up realtime subscription for food order updates
        const s = supa();
        if (!s) return;

        const channel = s
            .channel('guest-food-orders-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'food_orders'
                },
                () => {
                    fetchFoodOrders();
                }
            )
            .subscribe();

        return () => {
            channel.unsubscribe();
        };
    }, [code, mainTab]);

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
    const completedTickets = tickets.filter(t => t.status === 'COMPLETED' || t.status === 'CANCELLED');

    return (
        <main className="min-h-screen bg-[#0b1120] text-zinc-200 font-sans relative overflow-hidden pb-12">
            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-900/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 max-w-2xl mx-auto p-6">

                {/* Reopen Dialog */}
                {reopenDialogOpen && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                            <h3 className="text-lg font-semibold text-white mb-2">Reopen Request</h3>
                            <p className="text-sm text-zinc-400 mb-4">
                                This will reopen the request for the staff.
                            </p>

                            <textarea
                                value={reopenReason}
                                onChange={(e) => setReopenReason(e.target.value)}
                                placeholder="Reason (optional)..."
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none transition-all"
                                rows={3}
                                maxLength={200}
                            />

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => {
                                        setReopenDialogOpen(false);
                                        setReopenReason('');
                                        setReopenTicketId(null);
                                    }}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-zinc-400 hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmReopen}
                                    disabled={reopening !== null}
                                    className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]"
                                >
                                    {reopening ? 'Reopening...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Cancel Dialog */}
                {cancelDialogOpen && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                            <h3 className="text-lg font-semibold text-white mb-2">Cancel Request</h3>
                            <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
                                {cancelReasons.map((reason) => (
                                    <button
                                        key={reason.code}
                                        onClick={() => setSelectedCancelReason(reason.code)}
                                        className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${selectedCancelReason === reason.code
                                            ? 'bg-red-500/10 border-red-500/50 text-red-200'
                                            : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'
                                            }`}
                                    >
                                        <div className="flex-1">
                                            <div className="font-medium text-sm">{reason.label}</div>
                                            <div className="text-xs opacity-70 mt-0.5">{reason.description}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <textarea
                                value={cancelComment}
                                onChange={(e) => setCancelComment(e.target.value)}
                                placeholder="Additional notes..."
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none transition-all"
                                rows={2}
                            />

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => {
                                        setCancelDialogOpen(false);
                                        setSelectedCancelReason('');
                                        setCancelComment('');
                                        setCancelTicketId(null);
                                    }}
                                    className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-zinc-400 hover:bg-white/5 transition-all"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={confirmCancel}
                                    disabled={!selectedCancelReason || cancelling !== null}
                                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-red-900/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {cancelling ? 'Cancelling...' : 'Cancel Request'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                <header className="mb-8 pt-4">
                    {/* Breadcrumbs */}
                    <nav className="flex items-center text-sm text-zinc-500 mb-4 animate-in fade-in slide-in-from-left-4 duration-500">
                        <Link
                            to="/guest"
                            className="hover:text-emerald-400 transition-colors flex items-center gap-1"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            Guest
                        </Link>
                        <span className="mx-2 opacity-50">/</span>
                        <span className="text-zinc-200 font-medium">Requests</span>
                    </nav>

                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Your Requests</h1>
                            <p className="text-sm text-zinc-500 mt-1">Track and manage your service requests</p>
                        </div>
                        <Link
                            to="/guest"
                            className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:bg-white/10 hover:text-white transition-all"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </Link>
                    </div>
                </header>

                {/* Track Request Form */}
                <div className="mb-8">
                    <form onSubmit={handleTrack} className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        <div className="relative flex items-center">
                            <div className="absolute left-4 text-zinc-500">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Search by Request / Order ID (REQ-1047, ORD-3321)"
                                value={trackId}
                                onChange={(e) => setTrackId(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-2xl pl-12 pr-32 py-4 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-xl"
                            />
                            <button
                                type="submit"
                                disabled={!trackId.trim()}
                                className="absolute right-2 top-2 bottom-2 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                <span>Track</span>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </button>
                        </div>
                    </form>
                </div>

                {/* Main Tab Switcher: Services | Food & Beverages */}
                <div className="relative mb-6">
                    {/* Gradient border effect */}
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-emerald-500/30 via-blue-500/20 to-amber-500/30 blur-sm" />
                    <div className="relative flex p-1.5 bg-slate-900/95 rounded-2xl border border-white/10">
                        <button
                            onClick={() => setMainTab('services')}
                            className={`flex-1 py-4 px-6 rounded-xl text-base font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${mainTab === 'services'
                                ? 'text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-lg shadow-emerald-900/40 border-t border-white/20'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                                }`}
                        >
                            <span className="text-lg">🛎️</span>
                            <span>Services</span>
                            {tickets.length > 0 && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${mainTab === 'services' ? 'bg-white/20 text-white' : 'bg-white/10 text-zinc-400'}`}>
                                    {tickets.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setMainTab('food')}
                            className={`flex-1 py-4 px-6 rounded-xl text-base font-semibold transition-all duration-300 flex items-center justify-center gap-3 ${mainTab === 'food'
                                ? 'text-white bg-gradient-to-r from-orange-500 to-rose-600 shadow-lg shadow-orange-900/40 border-t border-white/20'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                                }`}
                        >
                            <span className="text-lg">🍽️</span>
                            <span>Food & Beverages</span>
                            {foodOrders.length > 0 && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${mainTab === 'food' ? 'bg-white/20 text-white' : 'bg-white/10 text-zinc-400'}`}>
                                    {foodOrders.length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Services Tab Content */}
                {mainTab === 'services' && (
                    <>
                        {/* Active/History Sub-tabs */}
                        {tickets.length > 0 && (
                            <div className="flex p-1 bg-white/[0.03] rounded-2xl mb-6 border border-white/5 max-w-sm mx-auto">
                                <button
                                    onClick={() => setActiveTab('active')}
                                    className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all duration-300 relative flex items-center justify-center gap-2 ${activeTab === 'active'
                                        ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20'
                                        : 'text-zinc-500 hover:text-zinc-400 hover:bg-white/5'
                                        }`}
                                >
                                    <span className="relative z-10 uppercase tracking-wider">Active</span>
                                    {activeTickets.length > 0 && (
                                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === 'active' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/5 text-zinc-600'}`}>
                                            {activeTickets.length}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('history')}
                                    className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold transition-all duration-300 relative flex items-center justify-center gap-2 ${activeTab === 'history'
                                        ? 'text-slate-200 bg-white/10 border border-white/10'
                                        : 'text-zinc-500 hover:text-zinc-400 hover:bg-white/5'
                                        }`}
                                >
                                    <span className="relative z-10 uppercase tracking-wider">History</span>
                                    {completedTickets.length > 0 && (
                                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === 'history' ? 'bg-white/10 text-slate-300' : 'bg-white/5 text-zinc-600'}`}>
                                            {completedTickets.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}

                        {loading ? (
                            <div className="space-y-4">
                                {[1, 2].map(i => <div key={i} className="h-40 bg-white/5 rounded-3xl animate-pulse" />)}
                            </div>
                        ) : tickets.length === 0 ? (
                            <div className="text-center py-20 rounded-3xl border border-dashed border-white/10 bg-white/5">
                                <div className="text-4xl mb-4 opacity-50">🛎️</div>
                                <p className="text-zinc-400 mb-6">No requests yet.</p>
                                <Link
                                    to={code ? buildMenuLink(code) : '/menu'}
                                    className="inline-flex px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-medium transition-all shadow-lg shadow-emerald-900/40"
                                >
                                    New Request
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Active Requests Tab */}
                                {activeTab === 'active' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {activeTickets.length > 0 ? (
                                            activeTickets.map(ticket => (
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
                                            ))
                                        ) : (
                                            <div className="text-center py-12 text-zinc-500">
                                                <div className="text-2xl mb-2 opacity-50">✨</div>
                                                <p>No active requests</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* History Requests Tab */}
                                {activeTab === 'history' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {completedTickets.length > 0 ? (
                                            <div className="space-y-4 opacity-100">
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
                                        ) : (
                                            <div className="text-center py-12 text-zinc-500">
                                                <div className="text-2xl mb-2 opacity-50">📜</div>
                                                <p>No history yet</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* Food & Beverages Tab Content */}
                {mainTab === 'food' && (
                    <>
                        {loadingFood ? (
                            <div className="space-y-4">
                                {[1, 2].map(i => <div key={i} className="h-32 bg-white/5 rounded-3xl animate-pulse" />)}
                            </div>
                        ) : foodOrders.length === 0 ? (
                            <div className="text-center py-20 rounded-3xl border border-dashed border-white/10 bg-white/5">
                                <div className="text-4xl mb-4 opacity-50">🍽️</div>
                                <p className="text-zinc-400 mb-6">No food orders yet.</p>
                                <Link
                                    to={code ? `/stay/${code}/menu?tab=food` : '/menu?tab=food'}
                                    className="inline-flex px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-full font-medium transition-all shadow-lg shadow-amber-900/40"
                                >
                                    Order Food
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {foodOrders.map(order => (
                                    <FoodOrderCard key={order.order_id} order={order} />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

// Guest-friendly system message mapping
const getGuestFriendlyMessage = (event: any, ticket: GuestTicket): string | null => {
    switch (event.event_type) {
        case 'CREATED':
            return 'Request submitted'; // Matching image tone
        case 'STARTED':
            return "Staff is taking care of it";
        case 'BLOCKED':
            if (ticket.reason_code) {
                const friendlyReason = guestFriendlyReasons[ticket.reason_code] || 'Waiting';
                return `Paused: ${friendlyReason}`;
            }
            return 'Request paused';
        case 'UNBLOCKED':
            return 'Resumed';
        case 'COMPLETED':
            return 'Completed';
        case 'CANCELLED':
            return 'Cancelled';
        case 'REOPENED':
            return 'Reopened';
        default:
            return null;
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
    // --- Timer Logic Ported from RequestTracker ---
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const getSlaState = () => {
        if (!ticket.sla_minutes || !ticket.sla_started_at) return null;
        if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') return null;

        const start = new Date(ticket.sla_started_at).getTime();
        const end = start + ticket.sla_minutes * 60000;
        const current = now.getTime();

        // If blocked, we might want to pause (but for MVP we just show time passed)
        // Ideally backend provides 'current_remaining_seconds' but for view we approximate

        const diffMs = end - current;
        const totalMs = end - start;
        const percentLeft = Math.max(0, Math.min(100, (diffMs / totalMs) * 100));

        return { diffMs, percentLeft, isBreached: diffMs < 0 };
    };

    const slaState = getSlaState();

    const getProgressColor = () => {
        if (ticket.status === 'COMPLETED') return 'text-zinc-500';
        if (!slaState) return 'text-zinc-600'; // No SLA
        if (slaState.isBreached) return 'text-red-500';
        if (slaState.percentLeft < 20) return 'text-amber-500';
        return 'text-emerald-500';
    };

    const formatTime = (ms: number) => {
        const absMs = Math.abs(ms);
        const mins = Math.floor(absMs / 60000);
        const secs = Math.floor((absMs % 60000) / 1000);
        return `${mins}m ${secs}s`;
    };

    // --- Status Config ---
    const statusConfig = {
        NEW: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'stroke-zinc-700' },
        IN_PROGRESS: { bg: 'bg-blue-500/10', text: 'text-blue-400', ring: 'stroke-emerald-500' },
        COMPLETED: { bg: 'bg-white/5', text: 'text-zinc-400', ring: 'stroke-zinc-600' },
        BLOCKED: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'stroke-amber-500' },
        CANCELLED: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'stroke-red-900' },
    };

    // Fallback
    const config = statusConfig[ticket.status as keyof typeof statusConfig] || statusConfig.NEW;

    // Radius for circle
    const r = 18;
    const c = 2 * Math.PI * r;

    // Styles matching the dark/premium aesthetic
    // const statusConfig: Record<string, { bg: string, text: string, dot: string }> = {
    //     NEW: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
    //     REQUESTED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
    //     ACCEPTED: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
    //     IN_PROGRESS: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' },
    //     COMPLETED: { bg: 'bg-white/5', text: 'text-zinc-400', dot: 'bg-zinc-500' },
    //     BLOCKED: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-500' },
    //     CANCELLED: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-500' },
    // };

    const statusLabels: Record<string, string> = {
        NEW: 'Submitted',
        REQUESTED: 'Submitted',
        ACCEPTED: 'Assigned',
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
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    };

    // const config = statusConfig[ticket.status] || statusConfig.NEW;
    const label = ticket.status === 'BLOCKED' && ticket.reason_code
        ? (guestFriendlyReasons[ticket.reason_code] || 'On Hold')
        : (statusLabels[ticket.status] || ticket.status);

    const canComment = ['NEW', 'IN_PROGRESS', 'BLOCKED'].includes(ticket.status);

    return (
        <div className={`
            relative overflow-hidden rounded-3xl border transition-all duration-300
            ${expanded
                ? 'bg-zinc-900/90 border-emerald-500/30 ring-1 ring-emerald-500/20 shadow-2xl'
                : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
            }
        `}>
            {expanded && (
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />
            )}

            {/* Main Row */}
            <div
                className="p-5 cursor-pointer relative z-10"
                onClick={onToggleExpand}
            >
                <div className="flex items-center gap-4">
                    {/* ICON / PROGRESS RING */}
                    <div className="relative w-14 h-14 flex-shrink-0 flex items-center justify-center">
                        {/* SVG Ring */}
                        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 44 44">
                            {/* Track */}
                            <circle cx="22" cy="22" r={r} fill="none" strokeWidth="3" className="stroke-white/5" />
                            {/* Progress */}
                            {slaState && (
                                <circle
                                    cx="22" cy="22" r={r}
                                    fill="none"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    className={`${getProgressColor()} transition-all duration-1000 ease-linear`}
                                    strokeDasharray={c}
                                    strokeDashoffset={c - (slaState.percentLeft / 100) * c}
                                />
                            )}
                        </svg>

                        {/* Center Icon */}
                        <div className="text-xl relative z-10">
                            {ticket.service_icon || '✨'}
                        </div>

                        {/* Status Dot (Absolute) */}
                        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[#0b1120] flex items-center justify-center ${ticket.status === 'COMPLETED' ? 'bg-emerald-500' :
                            slaState?.isBreached ? 'bg-red-500' :
                                ticket.status === 'IN_PROGRESS' || ticket.status === 'NEW' ? 'bg-emerald-500' :
                                    'bg-amber-500'
                            }`}>
                            {ticket.status === 'COMPLETED' && (
                                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                            <h3 className="font-semibold text-zinc-100 truncate text-[15px]">
                                {ticket.service_name || ticket.service_key}
                            </h3>

                            {/* Timer / ETA Badge */}
                            {ticket.status === 'COMPLETED' ? (
                                <div className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide border bg-teal-500/10 text-teal-400 border-teal-500/20">
                                    Completed
                                </div>
                            ) : slaState ? (
                                <div className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide border ${slaState.isBreached
                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    }`}>
                                    {slaState.isBreached ? `+${Math.floor(Math.abs(slaState.diffMs) / 60000)}m LATE` : `${Math.ceil(slaState.diffMs / 60000)}m LEFT`}
                                </div>
                            ) : (
                                <div className="text-[11px] font-medium text-zinc-500">
                                    {ticket.status === 'NEW' ? 'Assigning...' : (statusLabels[ticket.status] || ticket.status)}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-3 text-xs text-zinc-500">
                                <span>#{ticket.display_id || ticket.id.slice(0, 4)}</span>
                                {ticket.location_label && (
                                    <span className="flex items-center gap-1">
                                        <span className="opacity-30">•</span> {ticket.location_label}
                                    </span>
                                )}
                            </div>

                            {slaState?.isBreached && ticket.status !== 'COMPLETED' && (
                                <div className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                    Delayed
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tracking Action Bar (Always visible, distinct from expansion) */}
                <div className="mt-2 px-5 pb-4">
                    <Link
                        to={`/track/${ticket.display_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.08] hover:border-emerald-500/30 transition-all group/track"
                    >
                        <span className="text-xs font-medium text-zinc-400 group-hover/track:text-emerald-400 transition-colors">
                            Track detailed progress & conversation
                        </span>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                            Track <span className="text-lg leading-none transform group-hover/track:translate-x-1 transition-transform">→</span>
                        </div>
                    </Link>
                </div>

                {/* Structural Expansion Handle */}
                <div className={`
                    mt-auto border-t transition-all duration-300 cursor-pointer
                    ${expanded
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-white/10 bg-gradient-to-r from-white/[0.02] to-white/[0.04] hover:from-white/[0.04] hover:to-white/[0.06]'}
                `}>
                    <div className="flex items-center justify-between px-5 py-4">
                        <span className={`
                            text-[11px] font-black uppercase tracking-[0.2em] transition-colors duration-300
                            ${expanded ? 'text-emerald-400' : 'text-zinc-400'}
                        `}>
                            {expanded ? 'Close Details' : '↓  Quick Details & Chat  ↓'}
                        </span>
                        <div className={`
                            flex items-center justify-center w-7 h-7 rounded-full transition-all duration-300
                            ${expanded
                                ? 'bg-emerald-500/30 rotate-180 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                                : 'bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]'}
                        `}>
                            <svg
                                className={`w-4 h-4 ${expanded ? 'text-emerald-400' : 'text-emerald-500/70'}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Expanded Content */}
            {expanded && (
                <div className="px-5 pb-5 relative z-10 animate-in slide-in-from-top-2 duration-200">
                    <div className="h-px w-full bg-white/5 mb-5" />

                    {/* Details Block */}
                    {ticket.description && (
                        <div className="mb-6 bg-black/20 rounded-xl p-4 border border-white/5">
                            <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">My Note</h4>
                            <p className="text-sm text-zinc-300 leading-relaxed">
                                {ticket.description}
                            </p>
                        </div>
                    )}

                    {/* Timeline */}
                    <div className="space-y-6">
                        {/* Auto-generated Activity */}
                        {!loadingComments && comments.length > 0 && (
                            <div>
                                <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3 pl-1">Updates</h4>
                                <div className="space-y-4 relative pl-4 opacity-100 transition-opacity">
                                    {/* Vertical line */}
                                    <div className="absolute left-0 top-1 bottom-1 w-px bg-white/10" />

                                    {comments
                                        .filter(e => e.event_type !== 'COMMENT_ADDED' && getGuestFriendlyMessage(e, ticket))
                                        .map((event, idx) => {
                                            const isLatest = idx === comments.filter(e => e.event_type !== 'COMMENT_ADDED').length - 1;
                                            return (
                                                <div key={event.id} className="relative pl-4 group">
                                                    <div className={`absolute left-[-4px] top-1.5 w-2 h-2 rounded-full border border-zinc-900 ${isLatest ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-700'}`} />
                                                    <div className={`text-sm ${isLatest ? 'text-white font-medium' : 'text-zinc-500'}`}>
                                                        {getGuestFriendlyMessage(event, ticket)}
                                                    </div>
                                                    <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">
                                                        {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        {/* Chat / Comments */}
                        <div>
                            <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-3 pl-1">Conversation</h4>
                            <div className="space-y-3 mb-4">
                                {comments.filter(c => c.event_type === 'COMMENT_ADDED').map((c, index, arr) => {
                                    const date = new Date(c.created_at);
                                    const prevDate = index > 0 ? new Date(arr[index - 1].created_at) : null;
                                    const showDate = !prevDate || date.toDateString() !== prevDate.toDateString();

                                    // Helper for grouping labels
                                    const getDayLabel = (d: Date) => {
                                        const now = new Date();
                                        if (d.toDateString() === now.toDateString()) return 'Today';
                                        const yesterday = new Date(now);
                                        yesterday.setDate(now.getDate() - 1);
                                        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                                        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                    };

                                    return (
                                        <div key={c.id}>
                                            {showDate && (
                                                <div className="flex justify-center my-4 sticky top-0 z-10">
                                                    <span className="text-[10px] bg-zinc-800/80 backdrop-blur-sm text-zinc-400 px-3 py-1 rounded-full border border-white/5 shadow-sm">
                                                        {getDayLabel(date)}
                                                    </span>
                                                </div>
                                            )}
                                            <div className={`flex ${c.actor_type === 'GUEST' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed relative group ${c.actor_type === 'GUEST'
                                                    ? 'bg-emerald-600/20 text-emerald-100 rounded-tr-sm border border-emerald-500/20'
                                                    : 'bg-white/10 text-zinc-200 rounded-tl-sm border border-white/5'
                                                    }`}>
                                                    {c.comment}
                                                    <div className={`text-[10px] mt-1 text-right opacity-70 ${c.actor_type === 'GUEST' ? 'text-emerald-200' : 'text-zinc-500'}`}>
                                                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {comments.filter(c => c.event_type === 'COMMENT_ADDED').length === 0 && (
                                    <div className="text-center py-4 text-xs text-zinc-600 italic">
                                        No messages yet.
                                    </div>
                                )}
                            </div>

                            {/* Input Area */}
                            {canComment && (
                                <div className="relative">
                                    <textarea
                                        value={commentText}
                                        onChange={(e) => onCommentChange(e.target.value)}
                                        placeholder="Type a message..."
                                        className="w-full bg-black/40 border border-white/10 rounded-2xl pl-4 pr-12 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 resize-none transition-all"
                                        rows={1}
                                        disabled={submittingComment}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                onSubmitComment();
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onSubmitComment(); }}
                                        disabled={!commentText.trim() || submittingComment}
                                        className="absolute right-2 top-2 p-1.5 bg-emerald-600 text-white rounded-xl disabled:opacity-0 transition-all hover:bg-emerald-500 shadow-lg"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions Footer */}
                    {(onCancel && (ticket.status === 'NEW' || ticket.status === 'IN_PROGRESS')) || (onReopen && ticket.status === 'COMPLETED') ? (
                        <div className="mt-6 pt-4 border-t border-white/5 flex justify-end">
                            {onCancel && (ticket.status === 'NEW' || ticket.status === 'IN_PROGRESS') && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCancel(ticket.id); }}
                                    disabled={cancelling}
                                    className="px-4 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 border border-red-500/20 transition-all"
                                >
                                    Cancel Request
                                </button>
                            )}
                            {onReopen && ticket.status === 'COMPLETED' && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onReopen(ticket.id); }}
                                    disabled={reopening}
                                    className="px-4 py-2 rounded-lg bg-white/5 text-zinc-300 text-xs font-medium hover:bg-white/10 border border-white/5 transition-all"
                                >
                                    Reopen
                                </button>
                            )}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

// Food Order Card Component
function FoodOrderCard({ order }: { order: GuestFoodOrder }) {
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
        CREATED: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Pending' },
        ACCEPTED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Accepted' },
        PREPARING: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Preparing' },
        READY: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Ready' },
        DELIVERED: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', label: 'Delivered' },
        CANCELLED: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Cancelled' },
    };

    const config = statusConfig[order.status] || statusConfig.CREATED;

    const timeAgo = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    };

    // Format items summary
    const itemsSummary = order.items?.slice(0, 2).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'No items';
    const moreItems = order.total_items > 2 ? ` +${order.total_items - 2} more` : '';

    return (
        <Link
            to={`/track-order/${order.display_id}`}
            className="block rounded-3xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300 overflow-hidden group"
        >
            {/* Main Content */}
            <div className="p-5">
                <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center text-2xl flex-shrink-0 border border-amber-500/10">
                        🍽️
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <h3 className="font-semibold text-zinc-100 text-[15px]">
                                Order {order.display_id}
                            </h3>
                            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide border ${config.bg} ${config.text} border-current/20`}>
                                {config.label}
                            </span>
                        </div>

                        <p className="text-sm text-zinc-400 truncate">
                            {itemsSummary}{moreItems}
                        </p>

                        <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                            <span>₹{order.total_amount?.toFixed(0) || '0'}</span>
                            <span>•</span>
                            <span>{order.room_number ? `Room ${order.room_number}` : 'No room'}</span>
                            <span>•</span>
                            <span>{timeAgo(order.created_at)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Handle */}
            <div className="border-t border-white/10 bg-gradient-to-r from-white/[0.02] to-white/[0.04] group-hover:from-white/[0.04] group-hover:to-white/[0.06] transition-all duration-300">
                <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400 group-hover:text-amber-400 transition-colors">
                        →  Track Order Details  →
                    </span>
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.15)] group-hover:shadow-[0_0_12px_rgba(245,158,11,0.3)] transition-all duration-300">
                        <svg
                            className="w-4 h-4 text-amber-500/70 group-hover:text-amber-400 transition-colors"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>
        </Link>
    );
}
