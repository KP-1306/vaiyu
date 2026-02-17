import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    ArrowLeft,
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
    status: string;
    room_type_id: string;
    room_type_name?: string;
};

type BookingRoom = {
    id: string;           // booking_room PK
    room_type_id: string;
    room_id: string | null;
    room_seq: number;
    room_type_name: string;
};

// Map of booking_room_id → selected room_id
type RoomAssignments = Record<string, string>;

export default function RoomAssignment() {
    const navigate = useNavigate();
    const location = useLocation();
    const { booking, guestDetails } = location.state || {};

    const [allHotelRooms, setAllHotelRooms] = useState<Room[]>([]);
    const [bookingRooms, setBookingRooms] = useState<BookingRoom[]>([]);
    const [currentStep, setCurrentStep] = useState(0); // Which booking_room we're assigning
    const [assignments, setAssignments] = useState<RoomAssignments>({});
    const [loading, setLoading] = useState(true);
    const [assigning, setAssigning] = useState(false);

    const isMultiRoom = bookingRooms.length > 1;
    const currentBookingRoom = bookingRooms[currentStep];
    const isLastStep = currentStep === bookingRooms.length - 1;

    // Redirect if missing flow data
    useEffect(() => {
        if (!booking || !guestDetails) {
            navigate("../booking");
        }
    }, [booking, guestDetails, navigate]);

    // Fetch booking_rooms + hotel rooms
    useEffect(() => {
        if (!booking) return;

        async function fetchData() {
            try {
                setLoading(true);
                const bookingId = booking.id || booking.booking_id;

                // 1. Get all booking_rooms for this booking (with room type names)
                const { data: brData, error: brError } = await supabase
                    .from('booking_rooms')
                    .select('id, room_type_id, room_id, room_seq, room_types(name)')
                    .eq('booking_id', bookingId)
                    .order('room_seq');

                if (brError) {
                    console.error("[RoomAssignment] Error fetching booking_rooms:", brError);
                }

                const brs: BookingRoom[] = (brData || []).map((br: any) => ({
                    id: br.id,
                    room_type_id: br.room_type_id,
                    room_id: br.room_id,
                    room_seq: br.room_seq || 1,
                    room_type_name: br.room_types?.name || 'Standard',
                }));

                // Fallback: if no booking_rooms, create a synthetic one from booking data
                if (brs.length === 0) {
                    brs.push({
                        id: '__legacy__',
                        room_type_id: booking.room_type_id || '',
                        room_id: booking.room_id || null,
                        room_seq: 1,
                        room_type_name: booking.room_type || 'Standard',
                    });
                }

                setBookingRooms(brs);

                // Pre-populate assignments from already assigned rooms
                const initialAssignments: RoomAssignments = {};
                brs.forEach(br => {
                    if (br.room_id) {
                        initialAssignments[br.id] = br.room_id;
                    }
                });
                setAssignments(initialAssignments);

                // 2. Fetch ALL rooms for this hotel with type names
                const { data: allRooms, error: roomsError } = await supabase
                    .from('rooms')
                    .select('*, room_types(name)')
                    .eq('hotel_id', booking.hotel_id)
                    .order('number');

                if (roomsError) throw roomsError;

                const roomsWithTypeName: Room[] = (allRooms || []).map((r: any) => ({
                    ...r,
                    room_type_name: r.room_types?.name || r.type || 'Standard',
                }));

                // 3. Get occupied rooms (exclude from available)
                const { data: activeStays } = await supabase
                    .from('stays')
                    .select('room_id')
                    .in('status', ['inhouse', 'arriving']);

                const occupiedRoomIds = new Set(activeStays?.map(s => s.room_id) || []);

                // Keep rooms that are available OR already assigned to this booking
                const assignedRoomIds = new Set(brs.map(br => br.room_id).filter(Boolean));
                const available = roomsWithTypeName.filter(
                    r => !occupiedRoomIds.has(r.id) || assignedRoomIds.has(r.id)
                );

                setAllHotelRooms(available);

                console.log("[RoomAssignment] booking_rooms:", brs.length, brs);
                console.log("[RoomAssignment] available rooms:", available.length);

            } catch (err) {
                console.error("Error fetching rooms:", err);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [booking]);

    // Get available rooms for the CURRENT booking_room step
    // Filters by room_type_id and excludes rooms already assigned in other steps
    const getAvailableForStep = (): Room[] => {
        if (!currentBookingRoom) return allHotelRooms;

        // Rooms already assigned to OTHER booking_rooms in this session
        const otherAssigned = new Set(
            Object.entries(assignments)
                .filter(([brId]) => brId !== currentBookingRoom.id)
                .map(([, roomId]) => roomId)
        );

        const available = allHotelRooms.filter(r => !otherAssigned.has(r.id));

        // Try filtering by room_type_id
        if (currentBookingRoom.room_type_id) {
            const typeMatch = available.filter(r => r.room_type_id === currentBookingRoom.room_type_id);
            if (typeMatch.length > 0) return typeMatch;
        }

        // Fallback: try name match
        if (currentBookingRoom.room_type_name) {
            const nameMatch = available.filter(r =>
                r.room_type_name?.toLowerCase() === currentBookingRoom.room_type_name?.toLowerCase()
            );
            if (nameMatch.length > 0) return nameMatch;
        }

        // Ultimate fallback: show all
        return available;
    };

    const availableRooms = getAvailableForStep();
    const selectedRoomId = currentBookingRoom ? assignments[currentBookingRoom.id] || null : null;

    const handleRoomSelect = (roomId: string) => {
        if (!currentBookingRoom) return;
        setAssignments(prev => ({ ...prev, [currentBookingRoom.id]: roomId }));
    };

    const handleNext = () => {
        if (!selectedRoomId) return;
        if (isLastStep) {
            handleConfirm();
        } else {
            setCurrentStep(prev => prev + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
        } else {
            navigate("../kyc", { state: { booking } });
        }
    };

    const handleConfirm = async () => {
        setAssigning(true);
        try {
            const bookingId = booking.id || booking.booking_id;

            // Build room assignments array for v2
            const roomAssignments = bookingRooms
                .filter(br => assignments[br.id]) // Only assigned rooms
                .map(br => ({
                    booking_room_id: br.id,
                    room_id: assignments[br.id],
                }));

            // Always use v2 (multi-room aware)
            const { data, error } = await supabase.rpc("process_checkin_v2", {
                p_booking_id: bookingId,
                p_guest_details: guestDetails,
                p_room_assignments: roomAssignments,
                p_actor_id: null
            });

            if (error) throw error;

            if (data.status === 'SUCCESS' || data.status === 'ALREADY_CHECKED_IN') {
                // Build room numbers string for success screen
                const roomNumbers = bookingRooms
                    .map(br => {
                        const room = allHotelRooms.find(r => r.id === assignments[br.id]);
                        return room?.number;
                    })
                    .filter(Boolean)
                    .join(', ');

                navigate("../success", {
                    state: {
                        booking,
                        roomNumber: roomNumbers || "Assigned",
                        roomsCount: bookingRooms.length,
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
            {/* ── Check-in Stepper ── */}
            <CheckInStepper steps={BOOKING_STEPS} currentStep={2} />

            {/* ── Header ── */}
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-light text-slate-900">
                    {isMultiRoom ? `Assign Room ${currentStep + 1} of ${bookingRooms.length}` : 'Choose Your Room'}
                </h2>
                <p className="text-slate-500">
                    {isMultiRoom
                        ? `Select a ${currentBookingRoom?.room_type_name || ''} room`
                        : 'Select a room for your stay.'
                    }
                </p>
                {/* Multi-room progress dots */}
                {isMultiRoom && (
                    <div className="flex justify-center gap-2 pt-2">
                        {bookingRooms.map((br, i) => (
                            <div
                                key={br.id}
                                className={`flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold transition-all ${i === currentStep
                                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 ring-offset-2'
                                    : assignments[br.id]
                                        ? 'bg-green-500 text-white'
                                        : 'bg-slate-200 text-slate-500'
                                    }`}
                            >
                                {assignments[br.id] && i !== currentStep ? '✓' : i + 1}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Room Type Badge ── */}
            {currentBookingRoom && (
                <div className="flex justify-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                        <BedDouble className="h-4 w-4" />
                        {currentBookingRoom.room_type_name}
                    </span>
                </div>
            )}

            {/* ── Room Grid ── */}
            {loading ? (
                <div className="py-20 text-center">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" />
                    <p className="mt-4 text-slate-500">Finding best available rooms...</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {availableRooms.map((room) => {
                        const isSelected = selectedRoomId === room.id;
                        // Check if already assigned to another booking_room
                        const assignedToOther = Object.entries(assignments).some(
                            ([brId, rId]) => brId !== currentBookingRoom?.id && rId === room.id
                        );
                        return (
                            <button
                                key={room.id}
                                onClick={() => handleRoomSelect(room.id)}
                                disabled={assignedToOther}
                                className={`group relative flex flex-col items-start gap-2 rounded-2xl p-4 text-left transition-all ${isSelected
                                    ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-600 ring-offset-2"
                                    : assignedToOther
                                        ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-50"
                                        : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5 hover:bg-slate-50"
                                    }`}
                            >
                                <div className={`rounded-xl p-2 ${isSelected ? "bg-white/20" : "bg-slate-100"}`}>
                                    <BedDouble className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="font-semibold text-lg">{room.number}</div>
                                    <div className={`text-xs ${isSelected ? "text-indigo-100" : "text-slate-500"}`}>
                                        {room.room_type_name || room.type || "Standard"} • Floor {room.floor}
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

            {!loading && availableRooms.length === 0 && (
                <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-800">
                    No rooms available at the moment. Please contact front desk.
                </div>
            )}

            {/* ── Navigation Buttons ── */}
            <div className="flex justify-center pt-8 gap-4">
                <button
                    onClick={handleBack}
                    className="flex items-center gap-2 rounded-2xl bg-white px-10 py-4 text-xl font-semibold text-slate-700 shadow-lg ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-all hover:scale-105 active:scale-[0.99]"
                >
                    <ArrowLeft className="h-5 w-5" />
                    {currentStep > 0 ? 'Previous Room' : 'Back'}
                </button>
                <button
                    onClick={handleNext}
                    disabled={!selectedRoomId || assigning}
                    className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-10 py-4 text-xl font-bold text-white shadow-lg transition-all hover:bg-indigo-500 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                >
                    {assigning ? (
                        <>Processing <Loader2 className="h-5 w-5 animate-spin" /></>
                    ) : isLastStep ? (
                        <>Confirm & Get Keys <ArrowRight className="h-6 w-6" /></>
                    ) : (
                        <>Next Room <ArrowRight className="h-6 w-6" /></>
                    )}
                </button>
            </div>
        </div>
    );
}
