import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Clock, AlertCircle } from 'lucide-react';

interface BlockedTicketsDrawerProps {
    departmentName: string | null;
    onClose: () => void;
}

interface BlockedTicketDetail {
    ticket_id: string;
    display_id: string;
    title: string;
    assignee_name: string | null;
    assignee_avatar: string | null;
    blocked_seconds: number;
    block_reason: string | null;
    status: string;
    exception_occurred_at?: string;
}

export function BlockedTicketsDrawer({ departmentName, category, onClose }: { departmentName: string | null, category?: string | null, onClose: () => void }) {
    const [tickets, setTickets] = useState<BlockedTicketDetail[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (departmentName) {
            fetchTickets();
        }
    }, [departmentName, category]);

    async function fetchTickets() {
        setLoading(true);
        try {
            let query;

            if (category) {
                // History Mode: Exceptions by Category (Last 30 Days)
                // Uses the NEW view that matches the summary data
                query = supabase
                    .from('v_ops_sla_exception_details')
                    .select('*')
                    .eq('department_name', departmentName)
                    .eq('exception_category', category)
                    .order('exception_occurred_at', { ascending: false });
            } else {
                // Current Mode: Currently Blocked Tickets
                query = supabase
                    .from('v_ops_blocked_tickets_detail')
                    .select('*')
                    .eq('department_name', departmentName)
                    .order('blocked_seconds', { ascending: false });
            }

            const { data, error } = await query;
            if (!error && data) {
                setTickets(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    if (!departmentName) return null;

    const isHistory = !!category;
    const title = isHistory ? 'SLA Exceptions (30d)' : 'Blocked Tickets';
    const subTitle = isHistory
        ? `${departmentName} • ${category?.charAt(0).toUpperCase()}${category?.slice(1)}`
        : `Department: ${departmentName}`;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="relative w-full max-w-md bg-[#0f172a] h-full shadow-2xl border-l border-slate-800 flex flex-col transform transition-transform duration-300 ease-in-out">
                {/* Header */}
                <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#1e293b]">
                    <div>
                        <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
                        <p className="text-sm text-slate-400 font-medium">
                            {isHistory ? (
                                <span className="capitalize">{departmentName} <span className="text-slate-600">/</span> {category?.replace('_', ' ')}</span>
                            ) : (
                                <span>Department: <span className="text-white">{departmentName}</span></span>
                            )}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center h-40 text-slate-500">Loading...</div>
                    ) : tickets.length === 0 ? (
                        <div className="text-center text-slate-500 py-8">
                            No tickets found.
                        </div>
                    ) : (
                        tickets.map((t) => {
                            // Display logic: 
                            // If history (exception), show date.
                            // If blocked_seconds > 0, show time.

                            const hrs = Math.floor(t.blocked_seconds / 3600);
                            const mins = Math.floor((t.blocked_seconds % 3600) / 60);
                            const timeString = hrs > 0 || mins > 0 ? `${hrs}h ${mins}m` : 'Resolved';

                            // For exceptions, we show the date
                            const dateString = t.exception_occurred_at
                                ? new Date(t.exception_occurred_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                : '';

                            // Status Badge
                            const isResolved = t.status === 'COMPLETED';
                            const isBlocked = t.status === 'BLOCKED';

                            return (
                                <div key={t.ticket_id} className="bg-[#1e293b] p-4 rounded-lg border border-slate-700/50 hover:border-slate-600 transition group">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="text-xs font-mono text-slate-500">#{t.display_id}</span>
                                        <div className="flex gap-2">
                                            {isHistory && (
                                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300`}>
                                                    {t.status}
                                                </span>
                                            )}
                                            {isHistory ? (
                                                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-400 bg-slate-700/50 px-2 py-1 rounded">
                                                    <Clock size={12} />
                                                    {dateString}
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5 text-xs font-bold text-rose-400 bg-rose-500/10 px-2 py-1 rounded">
                                                    <Clock size={12} />
                                                    {timeString}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <h3 className="text-sm font-medium text-slate-200 mb-3 line-clamp-2 leading-snug">
                                        {t.title}
                                    </h3>

                                    <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
                                        <div className="flex items-center gap-2">
                                            {t.assignee_avatar ? (
                                                <img src={t.assignee_avatar} alt="" className="w-5 h-5 rounded-full" />
                                            ) : (
                                                <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[9px] text-slate-400">?</div>
                                            )}
                                            <span className="text-xs text-slate-400 max-w-[120px] truncate">
                                                {t.assignee_name || 'Unassigned'}
                                            </span>
                                        </div>
                                        {/* Reason */}
                                        <div className="flex items-center gap-1 text-xs text-amber-500/80" title="Block Reason">
                                            <AlertCircle size={12} />
                                            <span>{t.block_reason || (isHistory ? category : 'Blocked')}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
