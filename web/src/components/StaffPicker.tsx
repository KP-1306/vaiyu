// web/src/components/StaffPicker.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface StaffMember {
    id: string;
    user_id: string;
    full_name: string;
    role: string;
}

interface StaffPickerProps {
    hotelId: string;
    currentAssigneeId?: string;
    onSelect: (staffId: string) => void;
    onCancel: () => void;
}

export function StaffPicker({ hotelId, currentAssigneeId, onSelect, onCancel }: StaffPickerProps) {
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStaff() {
            try {
                // Fetch active hotel members
                const { data: members, error: mError } = await supabase
                    .from('hotel_members')
                    .select('*')
                    .eq('hotel_id', hotelId)
                    .eq('is_active', true);

                if (mError) throw mError;

                // Fetch profiles for these members
                const userIds = (members || []).map(m => m.user_id).filter(Boolean);

                if (userIds.length === 0) {
                    setStaff([]);
                    setLoading(false);
                    return;
                }

                const { data: profiles, error: pError } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', userIds);

                if (pError) throw pError;

                // Combine members with profiles
                const combined = (members || [])
                    .map(m => {
                        const profile = (profiles || []).find(p => p.id === m.user_id);
                        return {
                            id: m.id,
                            user_id: m.user_id,
                            full_name: profile?.full_name || 'Unknown',
                            role: m.role || 'staff'
                        };
                    })
                    // Filter out current assignee
                    .filter(s => s.id !== currentAssigneeId);

                setStaff(combined);
            } catch (error) {
                console.error('Failed to fetch staff:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchStaff();
    }, [hotelId, currentAssigneeId]);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1A1C25] border border-white/10 rounded-2xl max-w-md w-full shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-xl font-bold text-white">Reassign Task</h3>
                    <p className="text-sm text-gray-400 mt-1">Select a staff member to reassign this task to:</p>
                </div>

                {/* Staff List */}
                <div className="p-4 max-h-96 overflow-y-auto">
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">Loading staff...</div>
                    ) : staff.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">No available staff members</div>
                    ) : (
                        <div className="space-y-2">
                            {staff.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => onSelect(s.id)}
                                    className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-lg text-left transition-all group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-white font-medium group-hover:text-blue-400 transition-colors">
                                                {s.full_name}
                                            </div>
                                            <div className="text-xs text-gray-500 capitalize mt-0.5">
                                                {s.role}
                                            </div>
                                        </div>
                                        <svg
                                            className="w-5 h-5 text-gray-600 group-hover:text-blue-400 transition-colors"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={onCancel}
                        className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
