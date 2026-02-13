import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    BedDouble,
    CheckCircle2,
    Loader2
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

type Room = {
    id: string;
    number: string;
    floor: number;
    type: string;
    status: string; // clean, dirty, inspected
};

export default function RoomAssignment() {
    const navigate = useNavigate();
    const location = useLocation();
    const { booking, guestDetails } = location.state || {};

    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [assigning, setAssigning] = useState(false);

    // Redirect if missing flow data
    useEffect(() => {
        if (!booking || !guestDetails) {
            navigate("../booking");
        }
    }, [booking, guestDetails, navigate]);

    // Fetch Available Rooms
    useEffect(() => {
        if (!booking) return;

        async function fetchRooms() {
            try {
                setLoading(true);
                // 1. Get all rooms for this hotel
                // 2. Filter out rooms that have an active stay (arriving, inhouse)
                // Note: In a real app, we'd have a specific RPC for "get_available_rooms(start, end)"
                // For this demo, we'll fetch rooms and doing a client-side filter or simple join if possible.
                // Let's try to find rooms that are NOT in the 'stays' table with active status.

                // Simpler approach for MVP: Get all rooms, and client-side filter? 
                // Or better: Let's write a quick query.

                // fetch all rooms
                const { data: allRooms, error: roomsError } = await supabase
                    .from('rooms')
                    .select('*')
                    .eq('hotel_id', booking.hotel_id)
                    .order('number');

                if (roomsError) throw roomsError;

                // fetch active stays to exclude
                const { data: activeStays, error: staysError } = await supabase
                    .from('stays')
                    .select('room_id')
                    .in('status', ['inhouse', 'arriving']); // arriving might block too?

                if (staysError) throw staysError;

                const occupiedRoomIds = new Set(activeStays?.map(s => s.room_id));

                // Filter by occupancy AND Room Type
                let available = allRooms?.filter(r => !occupiedRoomIds.has(r.id)) || [];

                // Strict Filter: Only show rooms matching the booked type
                if (booking.room_type_id) {
                    available = available.filter(r => r.room_type_id === booking.room_type_id);
                } else if (booking.room_type) {
                    // Fallback to name match if ID missing (legacy behavior)
                    available = available.filter(r => r.type === booking.room_type);
                }

                setRooms(available);

            } catch (err) {
                console.error("Error fetching rooms:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchRooms();
    }, [booking]);

    const handleContinue = async () => {
        if (!selectedRoomId) return;

        // Skip Payment Screen - Direct Check-in
        setAssigning(true);
        try {
            const { data, error } = await supabase.rpc("process_checkin", {
                p_booking_id: booking.id || booking.booking_id, // Fallback if old search result
                p_guest_details: guestDetails,
                p_room_id: selectedRoomId,
                p_actor_id: null // System/Kiosk
            });

            if (error) throw error;

            if (data.status === 'SUCCESS' || data.status === 'ALREADY_CHECKED_IN') {
                // Get selected room number for success screen
                const selectedRoom = rooms.find(r => r.id === selectedRoomId);
                navigate("../success", {
                    state: {
                        booking,
                        roomNumber: selectedRoom?.number || "Assignments"
                    }
                });
            } else {
                alert("Check-in failed: " + data.status);
            }
        } catch (err: any) {
            console.error(err);
            alert("Check-in failed: " + err.message);
        } finally {
            setAssigning(false);
        }
    };

    if (!booking) return null;

    const BOOKING_STEPS = ["Find Booking", "Confirm Details", "Assign Room"];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            {/* ── Stepper ── */}
            <CheckInStepper steps={BOOKING_STEPS} currentStep={2} />

            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">Choose Your Room</h2>
                <p className="text-slate-500">Select a room for your stay.</p>
            </div>

            {loading ? (
                <div className="py-20 text-center">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" />
                    <p className="mt-4 text-slate-500">Finding best available rooms...</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {rooms.map((room) => {
                        const isSelected = selectedRoomId === room.id;
                        return (
                            <button
                                key={room.id}
                                onClick={() => setSelectedRoomId(room.id)}
                                className={`group relative flex flex-col items-start gap-2 rounded-2xl p-4 text-left transition-all ${isSelected
                                    ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-600 ring-offset-2"
                                    : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5 hover:bg-slate-50"
                                    }`}
                            >
                                <div className={`rounded-xl p-2 ${isSelected ? "bg-white/20" : "bg-slate-100"}`}>
                                    <BedDouble className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="font-semibold text-lg">{room.number}</div>
                                    <div className={`text-xs ${isSelected ? "text-indigo-100" : "text-slate-500"}`}>
                                        {room.type || "Standard"} • Floor {room.floor}
                                    </div>
                                </div>
                                {isSelected && (
                                    <div className="absolute top-4 right-4">
                                        <CheckCircle2 className="h-5 w-5 text-white" />
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {!loading && rooms.length === 0 && (
                <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-800">
                    No rooms available at the moment. Please contact front desk.
                </div>
            )}

            <div className="flex justify-center pt-8 gap-4">
                <button
                    onClick={() => navigate("../kyc", { state: { booking } })}
                    className="rounded-2xl bg-white px-10 py-4 text-xl font-semibold text-slate-700 shadow-lg ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all hover:scale-105 active:scale-[0.99]"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    disabled={!selectedRoomId || assigning}
                    className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-10 py-4 text-xl font-bold text-white shadow-lg transition-all hover:bg-indigo-500 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                >
                    {assigning ? (
                        <>Processing <Loader2 className="h-5 w-5 animate-spin" /></>
                    ) : (
                        <>Confirm & Get Keys <ArrowRight className="h-6 w-6" /></>
                    )}
                </button>
            </div>
        </div>
    );
}
