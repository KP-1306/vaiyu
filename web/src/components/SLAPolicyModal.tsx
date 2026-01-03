// web/src/components/SLAPolicyModal.tsx
import { useState, useEffect } from "react";

export interface SLAPolicyData {
    target_minutes: number;
    warn_minutes: number;
    sla_start_trigger: string;
    escalate_minutes: number;
}

interface SLAPolicyModalProps {
    isOpen: boolean;
    departmentName: string;
    initialPolicy: SLAPolicyData;
    onSave: (policy: SLAPolicyData) => void;
    onClose: () => void;
}

export default function SLAPolicyModal({
    isOpen,
    departmentName,
    initialPolicy,
    onSave,
    onClose,
}: SLAPolicyModalProps) {
    const [policy, setPolicy] = useState<SLAPolicyData>(initialPolicy);

    useEffect(() => {
        setPolicy(initialPolicy);
    }, [initialPolicy, isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(policy);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[#1a1a1a] border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-white">Edit SLA Policy</h2>
                        <p className="text-sm text-gray-400 mt-1">{departmentName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-5">
                    {/* Target Time */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Target Response Time
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                value={policy.target_minutes}
                                onChange={(e) =>
                                    setPolicy({ ...policy, target_minutes: parseInt(e.target.value) || 0 })
                                }
                                className="flex-1 px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-400">minutes</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                            Time staff has to complete the task
                        </p>
                    </div>

                    {/* Warning Time */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Warning Threshold
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                value={policy.warn_minutes}
                                onChange={(e) =>
                                    setPolicy({ ...policy, warn_minutes: parseInt(e.target.value) || 0 })
                                }
                                className="flex-1 px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-400">minutes</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                            When to show warning before SLA breach
                        </p>
                    </div>

                    {/* Start Trigger */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            SLA Starts When
                        </label>
                        <select
                            value={policy.sla_start_trigger}
                            onChange={(e) =>
                                setPolicy({ ...policy, sla_start_trigger: e.target.value })
                            }
                            className="w-full px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="ON_CREATE">Ticket is Created</option>
                            <option value="ON_ASSIGN">Staff is Assigned</option>
                            <option value="ON_SHIFT_START">Shift Starts</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1.5">
                            When the SLA countdown begins
                        </p>
                    </div>

                    {/* Escalation Time */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Escalation Buffer
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="0"
                                value={policy.escalate_minutes}
                                onChange={(e) =>
                                    setPolicy({ ...policy, escalate_minutes: parseInt(e.target.value) || 0 })
                                }
                                className="flex-1 px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-400">minutes</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                            Additional time before escalating to supervisor
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-gray-300 font-medium hover:bg-[#333333] hover:border-gray-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 px-4 py-2.5 bg-blue-600 rounded-lg text-white font-medium hover:bg-blue-700 transition-colors"
                    >
                        Save Policy
                    </button>
                </div>
            </div>
        </div>
    );
}
