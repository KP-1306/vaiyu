import { ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";

// Add this component to the end of Menu.tsx
export function CustomZoneSelect({
    value,
    onChange,
    groupedZones
}: {
    value: string;
    onChange: (val: string) => void;
    groupedZones: Record<string, any[]>
}) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Find selected name
    let selectedName = "-- Select location --";
    if (value) {
        for (const group of Object.values(groupedZones)) {
            const found = group.find((z: any) => z.id === value);
            if (found) {
                selectedName = found.name;
                break;
            }
        }
    }

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-[#27272a] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 flex items-center justify-between"
            >
                <span className={value ? "text-white" : "text-gray-400"}>{selectedName}</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-[#18181b] border border-white/10 rounded-xl shadow-2xl max-h-60 overflow-y-auto overflow-x-hidden">
                    {Object.entries(groupedZones).map(([type, items]) => (
                        <div key={type}>
                            <div className="bg-[#27272a]/50 text-xs font-bold text-gray-500 uppercase px-3 py-2 sticky top-0 backdrop-blur-sm">
                                {type}
                            </div>
                            {items.map((z: any) => (
                                <button
                                    key={z.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(z.id);
                                        setIsOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center justify-between group"
                                >
                                    <span>{z.name}</span>
                                    {value === z.id && <Check size={14} className="text-blue-500 group-hover:text-white" />}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
