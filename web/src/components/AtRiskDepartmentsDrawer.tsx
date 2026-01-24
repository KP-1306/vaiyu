import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Clock, AlertTriangle } from 'lucide-react';

interface AtRiskDetail {
    ticket_id: string;
    display_id: string;
    title: string;
    department_name: string;
    assignee_name: string;
    assignee_avatar: string | null;
    remaining_seconds: number;
    target_seconds: number;
    status: string;
}

export function AtRiskDepartmentsDrawer({ departmentName, hotelId, onClose }: { departmentName: string | null, hotelId: string, onClose: () => void }) {
    const [tickets, setTickets] = useState<AtRiskDetail[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (departmentName && hotelId) {
            fetchTickets();
        }
    }, [departmentName, hotelId]);

    async function fetchTickets() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_ops_at_risk_details')
                .select('*')
                .eq('hotel_id', hotelId)
                .eq('department_name', departmentName)
                .order('remaining_seconds', { ascending: true }); // Worst first (lowest remaining)

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

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="relative w-full max-w-md bg-[#0f172a] h-full shadow-2xl border-l border-slate-800 flex flex-col transform transition-transform duration-300 ease-in-out">
                {/* Header */}
                <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#1e293b]">
                    <div>
                        <h2 className="text-lg font-bold text-white mb-1">At-Risk: {departmentName}</h2>
                        <p className="text-sm text-slate-400 font-medium">Tickets nearing SLA breach</p>
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
                            No tickets at risk found.
                        </div>
                    ) : (
                        tickets.map((t) => {
                            const mins = Math.max(0, Math.floor(t.remaining_seconds / 60));
                            const percent = Math.min(100, Math.max(0, (t.remaining_seconds / t.target_seconds) * 100));

                            // Color logic
                            let timeColor = "text-yellow-500 bg-yellow-500/10";
                            if (mins <= 15) timeColor = "text-rose-500 bg-rose-500/10";
                            else if (mins <= 30) timeColor = "text-orange-500 bg-orange-500/10";

                            return (
                                <div key={t.ticket_id} className="bg-[#1e293b] p-4 rounded-lg border border-slate-700/50 hover:border-slate-600 transition group">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="text-xs font-mono text-slate-500">#{t.display_id}</span>
                                        <span className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded ${timeColor}`}>
                                            <Clock size={12} />
                                            {mins}m left
                                        </span>
                                    </div>

                                    <h3 className="text-sm font-medium text-slate-200 mb-3 line-clamp-2 leading-snug">
                                        {t.title}
                                    </h3>

                                    {/* Progress Bar */}
                                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mb-3">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${mins <= 15 ? 'bg-rose-500' : mins <= 30 ? 'bg-orange-500' : 'bg-yellow-500'}`}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-700/50">
                                        <div className="flex items-center gap-2">
                                            {t.assignee_avatar ? (
                                                <img src={t.assignee_avatar} alt="" className="w-4 h-4 rounded-full" />
                                            ) : (
                                                <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[8px] text-slate-400">?</div>
                                            )}
                                            <span className="truncate max-w-[120px] text-slate-400">{t.assignee_name}</span>
                                        </div>
                                        <span className="uppercase font-medium text-slate-600 text-[10px]">{t.status.replace('_', ' ')}</span>
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
