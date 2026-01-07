import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export interface ServiceTemplate {
    id: string;
    code: string;
    label: string;
    default_department_code: string;
    default_sla_minutes: number;
}

export interface AddServiceTemplateModalProps {
    isOpen: boolean;
    departments: {
        id: string;
        name: string;
        code: string;
        sla_policy?: { target_minutes: number };
    }[];
    initialDepartmentId?: string;
    existingServiceKeys?: string[];
    onSave: (serviceData: { services: { name: string; sla: number; departmentId: string; active: boolean; isTemplate?: boolean; templateCode?: string; templateId?: string; isCustom?: boolean }[] }) => void;
    onClose: () => void;
}

export default function AddServiceTemplateModal({
    isOpen,
    departments,
    initialDepartmentId,
    existingServiceKeys = [],
    onSave,
    onClose,
}: AddServiceTemplateModalProps) {
    const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");
    const [sortBy, setSortBy] = useState<'name' | 'sla'>('name');
    const [selectedDeptId, setSelectedDeptId] = useState(initialDepartmentId || "");

    useEffect(() => {
        if (isOpen) {
            setSelectedDeptId(initialDepartmentId || (departments.length > 0 ? departments[0].id : ""));
            setSelectedTemplateIds(new Set());
            setSearchTerm("");
        }
    }, [isOpen, initialDepartmentId, departments]);

    // Fetch templates when department changes
    useEffect(() => {
        if (isOpen && selectedDeptId) {
            const fetchTemplates = async () => {
                setLoadingTemplates(true);
                const dept = departments.find(d => d.id === selectedDeptId);
                let deptCode = dept?.code;

                // Fallback mapping if code is missing
                if (!deptCode && dept) {
                    if (dept.name.toLowerCase().includes('housekeeping')) deptCode = 'HOUSEKEEPING';
                    else if (dept.name.toLowerCase().includes('maintenance')) deptCode = 'MAINTENANCE';
                    else if (dept.name.toLowerCase().includes('kitchen') || dept.name.toLowerCase().includes('food')) deptCode = 'KITCHEN';
                    else if (dept.name.toLowerCase().includes('front desk')) deptCode = 'FRONT_DESK';
                }

                if (!deptCode) {
                    setTemplates([]);
                    setLoadingTemplates(false);
                    return;
                }

                const { data, error } = await supabase
                    .from('service_templates')
                    .select('*')
                    .eq('default_department_code', deptCode)
                    .eq('is_active', true);

                if (error) {
                    console.error('Error fetching templates:', error);
                } else {
                    setTemplates(data || []);
                }
                setLoadingTemplates(false);
            };

            fetchTemplates();
        }
    }, [isOpen, selectedDeptId, departments]);

    const handleSaveTemplates = () => {
        const servicesToAdd = templates
            .filter(t => selectedTemplateIds.has(t.id))
            .map(t => ({
                name: t.label,
                sla: 0,
                departmentId: selectedDeptId,
                active: true,
                isTemplate: true,
                templateCode: t.code,
                templateId: t.id,
                isCustom: false
            }));

        onSave({ services: servicesToAdd });
        onClose();
    };

    const toggleTemplateSelection = (id: string) => {
        const newSet = new Set(selectedTemplateIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedTemplateIds(newSet);
    };

    const filteredTemplates = templates
        .filter(t => !existingServiceKeys.includes(t.code))
        .filter(t => t.label.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            if (sortBy === 'name') return a.label.localeCompare(b.label);
            return 0;
        });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[#1a1a1a] border border-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl p-6 z-10 transition-all duration-300">

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-white">
                            Add Services from Templates
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Select services to add from the available templates. Only services that haven't been added yet are shown.
                        </p>
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

                {/* Content */}
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="flex gap-4 mb-4">
                        <div className="flex-1 relative">
                            <svg className="w-5 h-5 absolute left-3 top-2.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search service templates..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-[#121212] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">Sort by:</span>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as 'name' | 'sla')}
                                className="bg-[#121212] border border-gray-700 rounded-lg text-white px-3 py-2 text-sm focus:outline-none"
                            >
                                <option value="name">SERVICE NAME</option>
                                <option value="sla">SLA DURATION</option>
                            </select>
                        </div>
                    </div>

                    {/* Department Selector */}
                    {!initialDepartmentId && (
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-300 mb-2">Department</label>
                            <select
                                value={selectedDeptId}
                                onChange={(e) => setSelectedDeptId(e.target.value)}
                                className="w-full px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {departments.map((dept) => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* List */}
                    <div className="border border-gray-800 rounded-lg overflow-hidden bg-[#121212] h-[300px] overflow-y-auto">
                        <div className="grid grid-cols-[auto_1fr_150px] gap-4 p-3 bg-[#1e1e1e] border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            <div className="w-5"></div>
                            <div>Service Name</div>
                            <div>Default SLA</div>
                        </div>

                        {loadingTemplates ? (
                            <div className="flex items-center justify-center h-full text-gray-500">Loading templates...</div>
                        ) : filteredTemplates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                                <p>No new templates available for this department.</p>
                            </div>
                        ) : (
                            filteredTemplates.map(template => (
                                <div
                                    key={template.id}
                                    className={`grid grid-cols-[auto_1fr_150px] gap-4 p-3 border-b border-gray-800 hover:bg-[#1e1e1e] cursor-pointer transition-colors ${selectedTemplateIds.has(template.id) ? 'bg-[#1e1e1e]' : ''}`}
                                    onClick={() => toggleTemplateSelection(template.id)}
                                >
                                    <div className="flex items-center justify-center">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${selectedTemplateIds.has(template.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-600'}`}>
                                            {selectedTemplateIds.has(template.id) && (
                                                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-white font-medium">{template.label}</div>
                                    <div className="text-gray-400 text-sm">{template.default_sla_minutes} min</div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer Info */}
                    <div className="flex justify-between items-center text-sm text-gray-500 mt-2">
                        <div>Viewing {filteredTemplates.length} templates</div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-8 pt-4 border-t border-gray-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 bg-transparent text-gray-400 hover:text-white font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSaveTemplates}
                        disabled={selectedTemplateIds.size === 0}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium transition-colors ${selectedTemplateIds.size === 0
                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                    >
                        Add Selected Services {selectedTemplateIds.size > 0 && `(${selectedTemplateIds.size})`} &gt;
                    </button>
                </div>
            </div>
        </div>
    );
}
