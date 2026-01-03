// web/src/components/DepartmentSection.tsx
import { useState } from "react";

export interface Service {
    id?: string;
    key: string;
    label: string;
    department_id: string;
    active: boolean;
}

export interface SLAPolicy {
    target_minutes: number;
    warn_minutes: number;
    sla_start_trigger: string;
    escalate_minutes: number;
}

export interface Department {
    id: string;
    code: string;
    name: string;
    sla_policy?: SLAPolicy;
}

interface DepartmentSectionProps {
    department: Department;
    services: Service[];
    onUpdateService: (index: number, patch: Partial<Service>) => void;
    onAddService: () => void;
    onEditSLAPolicy: () => void;
}

export default function DepartmentSection({
    department,
    services,
    onUpdateService,
    onAddService,
    onEditSLAPolicy,
}: DepartmentSectionProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const formatSLATime = (minutes: number) => {
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
        }
        return `${minutes} min`;
    };

    const formatStartTrigger = (trigger: string) => {
        return trigger.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    };

    const sla = department.sla_policy;

    return (
        <div className="mb-6">
            {/* Department Header */}
            <div className="flex items-center justify-between mb-3">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 text-left group"
                >
                    <div className="w-1 h-6 bg-blue-500 rounded-full" />
                    <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
                        {department.name}
                    </h2>
                    <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"
                            }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {sla && (
                    <div className="flex items-center gap-4">
                        <div className="text-xs text-gray-400">
                            <span className="font-medium">SLA:</span> {formatSLATime(sla.target_minutes)} |{" "}
                            <span className="font-medium">Starts:</span> {formatStartTrigger(sla.sla_start_trigger)} |{" "}
                            <span className="font-medium">Escalates:</span> +{sla.escalate_minutes} min
                        </div>
                        <button
                            onClick={onEditSLAPolicy}
                            className="px-3 py-1.5 text-xs font-medium text-gray-300 bg-[#1a1a1a] border border-gray-700 rounded-lg hover:bg-[#2a2a2a] hover:border-gray-600 transition-colors"
                        >
                            Edit SLA Policy
                        </button>
                    </div>
                )}
            </div>

            {/* Services Table */}
            {isExpanded && (
                <div className="bg-[#1a1a1a] rounded-lg border border-gray-800 overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 bg-[#141414]">
                        <div className="col-span-3 text-xs font-medium text-gray-400 uppercase tracking-wider">
                            Key
                        </div>
                        <div className="col-span-7 text-xs font-medium text-gray-400 uppercase tracking-wider">
                            Label
                        </div>
                        <div className="col-span-2 text-xs font-medium text-gray-400 uppercase tracking-wider text-right">
                            Active
                        </div>
                    </div>

                    {/* Service Rows */}
                    {services.length > 0 ? (
                        services.map((service, index) => (
                            <div
                                key={service.id || `${service.key}-${index}`}
                                className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 last:border-b-0 hover:bg-[#1e1e1e] transition-colors"
                            >
                                <div className="col-span-3">
                                    <input
                                        type="text"
                                        value={service.key}
                                        onChange={(e) => onUpdateService(index, { key: e.target.value })}
                                        className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="service_key"
                                    />
                                </div>
                                <div className="col-span-7">
                                    <input
                                        type="text"
                                        value={service.label}
                                        onChange={(e) => onUpdateService(index, { label: e.target.value })}
                                        className="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="Service Label"
                                    />
                                </div>
                                <div className="col-span-2 flex justify-end items-center">
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={service.active}
                                            onChange={(e) => onUpdateService(index, { active: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                            No services in this department yet
                        </div>
                    )}

                    {/* Add Service Button */}
                    <div className="px-4 py-3 border-t border-gray-800">
                        <button
                            onClick={onAddService}
                            className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Service
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
