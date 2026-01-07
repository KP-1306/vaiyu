import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface DepartmentTemplate {
    id: string;
    code: string;
    name: string;
    description: string;
    default_target_minutes: number;
}

interface AddDepartmentTemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (templates: DepartmentTemplate[]) => void;
    existingDepartmentNames: string[];
}

export default function AddDepartmentTemplateModal({
    isOpen,
    onClose,
    onAdd,
    existingDepartmentNames,
}: AddDepartmentTemplateModalProps) {
    const [templates, setTemplates] = useState<DepartmentTemplate[]>([]);
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState("");
    const [sortBy, setSortBy] = useState<'name' | 'sla'>('name');

    useEffect(() => {
        if (isOpen) {
            loadTemplates();
            setSelectedTemplateIds(new Set());
            setSearchTerm("");
        }
    }, [isOpen]);

    const loadTemplates = async () => {
        try {
            setLoading(true);
            setError(null);
            const { data, error } = await supabase
                .from("department_templates")
                .select("*")
                .order("name", { ascending: true });

            if (error) throw error;
            setTemplates(data || []);
        } catch (err: any) {
            console.error("Error loading department templates:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleTemplate = (id: string) => {
        const newSelected = new Set(selectedTemplateIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedTemplateIds(newSelected);
    };

    const handleAdd = () => {
        const selectedTemplates = templates.filter(t => selectedTemplateIds.has(t.id));
        onAdd(selectedTemplates);
        onClose();
    };

    // Filter and Sort templates
    const filteredTemplates = templates
        .filter(t => !existingDepartmentNames.some(existingName => existingName.toLowerCase() === t.name.toLowerCase()))
        .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'sla') return a.default_target_minutes - b.default_target_minutes;
            return 0;
        });

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2000,
                backdropFilter: "blur(4px)",
            }}
        >
            <div
                style={{
                    width: "700px",
                    backgroundColor: "#1F2937", // Gray-800
                    borderRadius: "16px",
                    overflow: "hidden",
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                    border: "1px solid #374151", // Gray-700
                    display: "flex",
                    flexDirection: "column",
                    height: "600px",
                    maxHeight: "85vh",
                }}
            >
                {/* Header */}
                <div style={{ padding: "24px", display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: "20px", fontWeight: 600, color: "white", margin: 0 }}>
                            Add Departments from Templates
                        </h2>
                        <p style={{ color: "#9CA3AF", fontSize: "14px", marginTop: "4px", margin: 0 }}>
                            Select departments to add from the available templates. Only departments that haven't been added yet are shown.
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer' }}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Filters */}
                <div style={{ padding: "0 24px 16px 24px", display: "flex", gap: "16px" }}>
                    <div style={{ flex: 1, position: "relative" }}>
                        <svg style={{ width: "20px", height: "20px", position: "absolute", left: "12px", top: "10px", color: "#6B7280" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search department templates..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "8px 16px 8px 40px",
                                backgroundColor: "#111827", // Gray-900
                                border: "1px solid #374151", // Gray-700
                                borderRadius: "8px",
                                color: "white",
                                fontSize: "14px",
                                outline: "none",
                            }}
                        />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "14px", color: "#9CA3AF" }}>Sort by:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as 'name' | 'sla')}
                            style={{
                                backgroundColor: "#111827",
                                border: "1px solid #374151",
                                borderRadius: "8px",
                                color: "white",
                                padding: "8px 12px",
                                fontSize: "14px",
                                outline: "none",
                            }}
                        >
                            <option value="name">DEPARTMENT NAME</option>
                            <option value="sla">SLA DURATION</option>
                        </select>
                    </div>
                </div>

                {/* Table Header */}
                <div style={{
                    padding: "12px 24px",
                    backgroundColor: "#111827",
                    borderBottom: "1px solid #374151",
                    display: "grid",
                    gridTemplateColumns: "40px 1fr 120px",
                    gap: "16px",
                    alignItems: "center",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#9CA3AF",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em"
                }}>
                    <div></div> {/* Checkbox placeholder */}
                    <div>Department Name</div>
                    <div>Default SLA</div>
                </div>

                {/* List */}
                <div style={{ overflowY: "auto", flex: 1, backgroundColor: "#111827" }}>
                    {loading ? (
                        <div style={{ textAlign: "center", color: "#9CA3AF", padding: "40px" }}>Loading templates...</div>
                    ) : error ? (
                        <div style={{ color: "#F87171", padding: "20px", textAlign: "center" }}>{error}</div>
                    ) : filteredTemplates.length === 0 ? (
                        <div style={{ textAlign: "center", color: "#9CA3AF", padding: "40px" }}>
                            No new template departments available. All templates are already added.
                        </div>
                    ) : (
                        <div>
                            {filteredTemplates.map((template) => {
                                const isSelected = selectedTemplateIds.has(template.id);
                                return (
                                    <div
                                        key={template.id}
                                        onClick={() => toggleTemplate(template.id)}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "40px 1fr 120px",
                                            gap: "16px",
                                            padding: "12px 24px",
                                            borderBottom: "1px solid #1F2937",
                                            backgroundColor: isSelected ? "#1F2937" : "transparent",
                                            cursor: "pointer",
                                            alignItems: "center",
                                            transition: "background-color 0.2s",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = "#1F2937";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: "20px",
                                                height: "20px",
                                                borderRadius: "4px",
                                                border: isSelected ? "none" : "1px solid #6B7280",
                                                backgroundColor: isSelected ? "#3B82F6" : "transparent",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            {isSelected && (
                                                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: "14px", fontWeight: 500, color: "white" }}>
                                                {template.name}
                                            </div>
                                            {template.description && (
                                                <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
                                                    {template.description}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: "14px", color: "#9CA3AF" }}>
                                            {template.default_target_minutes} min
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer Info & Actions */}
                <div style={{ padding: "16px 24px", borderTop: "1px solid #374151", backgroundColor: "#1F2937" }}>
                    <div style={{ fontSize: "13px", color: "#6B7280", marginBottom: "16px" }}>
                        Viewing {filteredTemplates.length} templates
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: "8px 16px",
                                backgroundColor: "transparent",
                                color: "#9CA3AF",
                                border: "none",
                                fontSize: "14px",
                                fontWeight: 500,
                                cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAdd}
                            disabled={selectedTemplateIds.size === 0}
                            style={{
                                padding: "8px 24px",
                                backgroundColor: selectedTemplateIds.size === 0 ? "#374151" : "#3B82F6",
                                color: selectedTemplateIds.size === 0 ? "#9CA3AF" : "white",
                                border: "none",
                                borderRadius: "8px",
                                fontWeight: 600,
                                fontSize: "14px",
                                cursor: selectedTemplateIds.size === 0 ? "not-allowed" : "pointer",
                                transition: "background-color 0.2s",
                            }}
                        >
                            Add Selected {selectedTemplateIds.size > 0 && `(${selectedTemplateIds.size})`} &gt;
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
