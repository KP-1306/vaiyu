// web/src/components/EditServiceModal.tsx
import { useState, useEffect } from "react";
import BilingualNameField from "./BilingualNameField";
import { useOwnerT, useOwnerCommonT } from "../i18n/useOwnerT";

interface EditServiceModalProps {
    isOpen: boolean;
    serviceName: string;
    serviceNameHi?: string;
    slaMinutes: number;
    departmentName: string;
    onSave: (name: string, sla: number, nameHi: string) => void;
    onClose: () => void;
}

export default function EditServiceModal({
    isOpen,
    serviceName,
    serviceNameHi = "",
    slaMinutes,
    departmentName,
    onSave,
    onClose,
}: EditServiceModalProps) {
    const t = useOwnerT("owner-services");
    const tc = useOwnerCommonT();
    const [name, setName] = useState(serviceName);
    const [nameHi, setNameHi] = useState(serviceNameHi);
    const [sla, setSla] = useState(slaMinutes);

    useEffect(() => {
        setName(serviceName);
        setNameHi(serviceNameHi);
        setSla(slaMinutes);
    }, [serviceName, serviceNameHi, slaMinutes, isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!name.trim()) {
            alert(t("modals.nameRequired", "Service name is required"));
            return;
        }
        onSave(name, sla, nameHi);
        onClose();
    };

    return (
        <div className="vaiyu-owner fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-[#1e2433] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
                {/* Header */}
                <div className="mb-6">
                    <h2 className="text-xl font-semibold text-white">{t("modals.editTitle", "Edit {{dept}} Service", { dept: departmentName })}</h2>
                </div>

                {/* Form */}
                <div className="space-y-5">
                    {/* Service Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t("modals.serviceName", "Service Name")}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-[#2a3142] border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Hindi name (optional) */}
                    <BilingualNameField
                        kind="service"
                        englishValue={name}
                        value={nameHi}
                        onChange={setNameHi}
                        placeholder="अतिथि को हिंदी में दिखेगा"
                    />

                    {/* SLA */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            {t("modals.slaMin", "SLA (min)")}
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={sla}
                            onChange={(e) => setSla(parseInt(e.target.value) || 30)}
                            className="w-full px-4 py-2.5 bg-[#2a3142] border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-xs text-blue-400 mt-2">
                            {t("modals.slaOverride", "Overrides default 30 min SLA for {{dept}}", { dept: departmentName })}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 bg-[#2a3142] border border-gray-700 rounded-lg text-gray-300 font-medium hover:bg-[#323a4f] transition-colors"
                    >
                        {tc("actions.cancel", "Cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 px-4 py-2.5 bg-blue-600 rounded-lg text-white font-medium hover:bg-blue-700 transition-colors"
                    >
                        {tc("actions.save", "Save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
