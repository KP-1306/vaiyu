import { X, Info } from "lucide-react";
import { useEffect } from "react";
import { SimpleTooltip } from "./SimpleTooltip";

type OpenBreachRow = {
    ticket_id: string;
    display_id: string;
    department_name: string;
    assignee_name: string;
    assignee_avatar: string | null;
    breach_context: string;
    hours_overdue: number;
};

interface OpenBreachesDrawerProps {
    open: boolean;
    breaches: OpenBreachRow[];
    onClose: () => void;
}

export function OpenBreachesDrawer({ open, breaches, onClose }: OpenBreachesDrawerProps) {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            {/* Drawer Panel */}
            <div className="relative w-full max-w-2xl bg-[#0f172a] h-full shadow-2xl border-l border-slate-800 flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-[#1e293b]">
                    <div>
                        <h2 className="text-xl font-bold text-white">Open Breaches (Actionable)</h2>
                        <p className="text-slate-400 text-sm mt-1">Full list of SLA breaches requiring immediate attention</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-700/50 rounded-lg text-slate-400 hover:text-white transition"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="bg-[#1e293b] rounded-xl border border-slate-700 overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-[#0f172a] sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 border-b border-slate-800">Ticket</th>
                                    <th className="px-4 py-3 border-b border-slate-800">Dept</th>
                                    <th className="px-4 py-3 border-b border-slate-800">Assignee</th>
                                    <th className="px-4 py-3 border-b border-slate-800">
                                        <div className="flex items-center gap-1.5">
                                            Reason
                                            <SimpleTooltip content={`Direct SLA Breach: Time expired naturally without a blocker.\n[Reason]: Violation caused by a specific blocker (e.g. Inventory).`}>
                                                <Info size={14} className="text-slate-500 cursor-help" />
                                            </SimpleTooltip>
                                        </div>
                                    </th>
                                    <th className="px-4 py-3 border-b border-slate-800 text-right">Overdue</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {breaches.map((row) => (
                                    <tr key={row.ticket_id} className="hover:bg-slate-800/50 transition bg-[#1e293b]">
                                        <td className="px-4 py-3 font-medium text-white">#{row.display_id}</td>
                                        <td className="px-4 py-3 text-slate-300">{row.department_name}</td>
                                        <td className="px-4 py-3 flex items-center gap-2">
                                            {row.assignee_avatar ? (
                                                <img src={row.assignee_avatar} alt="" className="w-6 h-6 rounded-full" />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-slate-700 grid place-items-center text-xs">?</div>
                                            )}
                                            <span className="text-slate-300 truncate max-w-[120px]">{row.assignee_name || 'Unassigned'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400">{row.breach_context}</td>
                                        <td className="px-4 py-3 text-right font-mono text-rose-500 font-bold">
                                            {Math.round(row.hours_overdue)}h
                                        </td>
                                    </tr>
                                ))}
                                {breaches.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                            No open breaches found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
