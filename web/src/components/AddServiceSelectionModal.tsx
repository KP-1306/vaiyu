import { useRef, useEffect } from "react";

interface AddServiceSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTemplate: () => void;
    onSelectCustom: () => void;
}

export default function AddServiceSelectionModal({
    isOpen,
    onClose,
    onSelectTemplate,
    onSelectCustom,
}: AddServiceSelectionModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);

    // Close on Escape or Click Outside
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        const handleClickOutside = (e: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleKeyDown);
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, onClose]);

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
                zIndex: 1000,
                backdropFilter: "blur(4px)",
            }}
        >
            <div
                ref={modalRef}
                style={{
                    width: "700px",
                    backgroundColor: "#1F2937", // Gray-800
                    borderRadius: "16px",
                    overflow: "hidden",
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                    border: "1px solid #374151", // Gray-700
                    padding: "32px",
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h2 style={{ fontSize: "24px", fontWeight: 600, color: "white", margin: 0 }}>
                        Add Service
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border: "none",
                            color: "#9CA3AF",
                            cursor: "pointer",
                            padding: "4px",
                        }}
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <p style={{ color: "#9CA3AF", fontSize: "14px", marginBottom: "32px" }}>
                    Choose how you want to add services to this department
                </p>


                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: '24px' }}>
                    {/* Option 1: Add from Templates */}
                    <div
                        onClick={onSelectTemplate}
                        style={{
                            border: "2px solid #3B82F6", // Blue-500
                            borderRadius: "12px",
                            padding: "24px",
                            cursor: "pointer",
                            backgroundColor: "rgba(59, 130, 246, 0.05)", // Very faint blue bg
                            transition: "transform 0.2s, background-color 0.2s",
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                            justifyContent: 'space-between'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.backgroundColor = "rgba(59, 130, 246, 0.1)";
                            e.currentTarget.style.transform = "translateY(-2px)";
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.backgroundColor = "rgba(59, 130, 246, 0.05)";
                            e.currentTarget.style.transform = "translateY(0)";
                        }}
                    >
                        <div>
                            <div style={{ color: "#3B82F6", marginBottom: "16px" }}>
                                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    {/* Stack icon equivalent */}
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                            </div>
                            <h3 style={{ fontSize: "18px", fontWeight: 600, color: "white", marginBottom: "8px" }}>
                                Add from Templates
                            </h3>
                            <p style={{ color: "#9CA3AF", fontSize: "14px", lineHeight: "1.5" }}>
                                Quickly add predefined services with standard SLAs.
                                <br /><br />
                                Only templates not already added will appear.
                            </p>
                        </div>
                        <button
                            style={{
                                marginTop: "24px",
                                width: "100%",
                                padding: "10px 0",
                                backgroundColor: "rgba(59, 130, 246, 0.1)",
                                border: "1px solid #3B82F6",
                                borderRadius: "6px",
                                color: "#60A5FA", // Blue-400
                                fontWeight: 500,
                                cursor: "pointer"
                            }}
                        >
                            Add from Templates
                        </button>
                    </div>

                    {/* Option 2: Create Custom Service */}
                    <div
                        onClick={onSelectCustom}
                        style={{
                            border: "1px solid #374151", // Gray-700
                            borderRadius: "12px",
                            padding: "24px",
                            cursor: "pointer",
                            backgroundColor: "#111827", // Gray-900
                            transition: "transform 0.2s, border-color 0.2s",
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                            justifyContent: 'space-between'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = "#4B5563"; // Gray-600
                            e.currentTarget.style.transform = "translateY(-2px)";
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = "#374151";
                            e.currentTarget.style.transform = "translateY(0)";
                        }}
                    >
                        <div>
                            <div style={{ color: "#9CA3AF", marginBottom: "16px" }}>
                                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    {/* Pencil/Plus custom icon */}
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                            </div>
                            <h3 style={{ fontSize: "18px", fontWeight: 600, color: "white", marginBottom: "8px" }}>
                                Create Custom Service
                            </h3>
                            <p style={{ color: "#9CA3AF", fontSize: "14px", lineHeight: "1.5" }}>
                                Create a department-specific service with optional SLA override.
                            </p>
                        </div>
                        <button
                            style={{
                                marginTop: "24px",
                                width: "100%",
                                padding: "10px 0",
                                backgroundColor: "#1F2937", // Gray-800
                                border: "1px solid #4B5563", // Gray-600
                                borderRadius: "6px",
                                color: "#E5E7EB", // Gray-200
                                fontWeight: 500,
                                cursor: "pointer"
                            }}
                        >
                            Create Custom Service
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: "#374151", // Gray-700
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            padding: "8px 24px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
