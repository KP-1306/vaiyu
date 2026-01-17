import { useState, useEffect } from 'react';
import { X, AlertTriangle, AlertCircle, PlayCircle, Lock, Ban, PenTool, Users, Copy, Slash, Wrench } from 'lucide-react';
import { ticketService } from '../services/ticketService';
import type { CancelReason } from '../types/ticket';
import * as LucideIcons from 'lucide-react';

interface StaffCancelTicketModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void; // Called after successful cancellation to refresh data
    ticketId: string;
}

// Helper to resolve icon from string
const getIcon = (name: string) => {
    // 1. Normalize name (kebab-case to PascalCase if needed, or mapping)
    // Simple mapping for known icons used in DB
    const lower = name.toLowerCase();
    if (lower.includes('copy')) return <Copy size={24} />;
    if (lower.includes('alert-circle')) return <AlertCircle size={24} />;
    if (lower.includes('slash')) return <Slash size={24} />;
    if (lower.includes('users')) return <Users size={24} />;
    if (lower.includes('tool')) return <Wrench size={24} />;
    if (lower.includes('lock')) return <Lock size={24} />;

    // Fallback: Dynamic lookup if exact match
    const pascalName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    // @ts-ignore
    const Icon = LucideIcons[pascalName] || LucideIcons[name];
    if (Icon) return <Icon size={24} />;

    return <AlertTriangle size={24} />;
};

export default function StaffCancelTicketModal({
    isOpen,
    onClose,
    onConfirm,
    ticketId
}: StaffCancelTicketModalProps) {
    const [reasons, setReasons] = useState<CancelReason[]>([]);
    const [loadingReasons, setLoadingReasons] = useState(false);
    const [selectedReasonCode, setSelectedReasonCode] = useState<string>('');
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            fetchReasons();
            setSelectedReasonCode('');
            setComment('');
            setError(null);
        }
    }, [isOpen]);

    const fetchReasons = async () => {
        setLoadingReasons(true);
        try {
            const data = await ticketService.getCancelReasons();
            setReasons(data);
        } catch (err) {
            console.error('Failed to fetch cancel reasons:', err);
            setError('Failed to load cancellation reasons.');
        } finally {
            setLoadingReasons(false);
        }
    };

    const handleConfirm = async () => {
        if (!ticketId || !selectedReasonCode) return;

        const reason = reasons.find(r => r.code === selectedReasonCode);
        if (!reason) return;

        if (reason.requires_comment && !comment.trim()) {
            setError('Comment is required for this reason.');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            await ticketService.cancelStaffTask({
                ticketId,
                reasonCode: selectedReasonCode,
                comment: comment.trim() || undefined
            });
            onConfirm();
            onClose();
        } catch (err: any) {
            console.error('Failed to cancel ticket:', err);
            setError(err.message || 'Failed to cancel ticket.');
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const selectedReason = reasons.find(r => r.code === selectedReasonCode);
    const isCommentRequired = selectedReason?.requires_comment;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-md bg-[#1a1a1a] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-700/50 flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1">Cancel Ticket?</h3>
                        <p className="text-xs text-gray-400">Why is this request invalid?</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {error && (
                        <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-200 mb-4">
                            {error}
                        </div>
                    )}

                    <div className="space-y-3">
                        {loadingReasons ? (
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        ) : (
                            reasons.map(reason => {
                                const isSelected = selectedReasonCode === reason.code;
                                return (
                                    <button
                                        key={reason.code}
                                        onClick={() => {
                                            setSelectedReasonCode(reason.code);
                                            setError(null);
                                        }}
                                        className={`w-full text-left p-4 rounded-xl border transition-all duration-200 flex items-center gap-4 group ${isSelected
                                            ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                                            : 'bg-[#252525] border-transparent hover:bg-[#2a2a2a] hover:border-gray-600'
                                            }`}
                                    >
                                        <div className={`p-2 rounded-lg transition-colors ${isSelected ? 'bg-blue-500 text-white' : 'bg-white/5 text-gray-400 group-hover:text-white'
                                            }`}>
                                            {reason.icon ? getIcon(reason.icon) : <AlertTriangle size={24} />}
                                        </div>
                                        <span className={`font-medium ${isSelected ? 'text-blue-400' : 'text-gray-200'}`}>
                                            {reason.label}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="mt-6 space-y-2 animate-fadeIn">
                        <label className="text-xs font-medium text-gray-400 uppercase flex items-center justify-between">
                            Note {isCommentRequired && <span className="text-red-400">*Required</span>}
                            {!isCommentRequired && <span className="text-gray-600 lowercase font-normal">(optional)</span>}
                        </label>
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder={isCommentRequired ? "Please explain why..." : "Add additional context..."}
                            rows={3}
                            className="w-full bg-[#0a0a0a] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-[#1a1a1a] border-t border-gray-700 shrink-0 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 bg-[#2a2a2a] hover:bg-[#333] text-white rounded-xl font-medium transition-colors border border-gray-700"
                        disabled={submitting}
                    >
                        Keep Ticket
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={submitting || !selectedReasonCode || (isCommentRequired && !comment.trim())}
                        className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                        {submitting ? 'Cancelling...' : 'Confirm Cancel'}
                    </button>
                </div>
            </div>
        </div>
    );
}
