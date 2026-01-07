import { useState, useEffect } from "react";

export interface AddServiceModalProps {
    isOpen: boolean;
    departments: {
        id: string;
        name: string;
        code: string;
        sla_policy?: { target_minutes: number };
    }[];
    initialDepartmentId?: string;
    onSave: (serviceData: { name: string; sla: number; departmentId: string; active: boolean; isCustom?: boolean; templateId?: string | null }) => void;
    onClose: () => void;
}

export default function AddServiceModal({
    isOpen,
    departments,
    initialDepartmentId,
    onSave,
    onClose,
}: AddServiceModalProps) {
    const [name, setName] = useState("");
    const [nameError, setNameError] = useState("");
    const [sla, setSla] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [selectedDeptId, setSelectedDeptId] = useState(initialDepartmentId || "");

    useEffect(() => {
        if (isOpen) {
            setName("");
            setNameError("");
            setSla("");
            setIsActive(true);
            setSelectedDeptId(initialDepartmentId || (departments.length > 0 ? departments[0].id : ""));
        }
    }, [isOpen, initialDepartmentId, departments]);

    const selectedDept = departments.find(d => d.id === selectedDeptId);
    const effectiveSLA = sla ? parseInt(sla) : (selectedDept?.sla_policy?.target_minutes || 30);

    const handleSaveCustom = () => {
        if (!name.trim()) {
            setNameError("Service name is required.");
            return;
        }
        if (!selectedDeptId) {
            alert("Please select a department");
            return;
        }

        const slaValue = sla ? parseInt(sla) : 0;

        onSave({
            name: name.trim(),
            sla: slaValue,
            departmentId: selectedDeptId,
            active: isActive,
            isCustom: true,
            templateId: null
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-[#1a1a1a] border border-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 z-10 transition-all duration-300">

                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-semibold text-white">
                            Add New Service
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Create a custom service for a specific department
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

                {/* Custom Service Form */}
                <div className="space-y-5">
                    {/* Department Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Department
                        </label>
                        <select
                            value={selectedDeptId}
                            onChange={(e) => setSelectedDeptId(e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="" disabled>Select Department</option>
                            {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                    {dept.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Service Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Service Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (e.target.value.trim()) setNameError("");
                            }}
                            placeholder="e.g. Extra Pillow"
                            className={`w-full px-4 py-2.5 bg-[#2a2a2a] border ${nameError ? 'border-red-500' : 'border-gray-700'} rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors`}
                            autoFocus
                        />
                        {nameError && (
                            <p className="text-xs text-red-500 mt-1.5">{nameError}</p>
                        )}
                    </div>

                    {/* SLA Override */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            SLA Override (Optional)
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                value={sla}
                                onChange={(e) => setSla(e.target.value)}
                                placeholder="Default department SLA"
                                className="flex-1 px-4 py-2.5 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-400">minutes</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">
                            Typically {selectedDept?.sla_policy?.target_minutes || 30} minutes for this department
                        </p>
                        <p className="text-xs text-blue-400 mt-1">
                            Effective SLA: {effectiveSLA} minutes
                        </p>
                    </div>

                    {/* Active Toggle */}
                    <div className="pt-2 border-t border-gray-800">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-300">
                                Service Availability
                            </label>
                            <button
                                onClick={() => setIsActive(!isActive)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#1a1a1a] ${isActive ? 'bg-blue-600' : 'bg-gray-700'
                                    }`}
                            >
                                <span
                                    className={`${isActive ? 'translate-x-6' : 'translate-x-1'
                                        } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                                />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            {isActive
                                ? "Service will be immediately available for requests."
                                : "Inactive services are hidden from guest requests."}
                        </p>
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
                        onClick={handleSaveCustom}
                        disabled={!name.trim()}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium transition-colors ${!name.trim()
                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                    >
                        Create Custom Service &gt;
                    </button>
                </div>
            </div>
        </div>
    );
}
