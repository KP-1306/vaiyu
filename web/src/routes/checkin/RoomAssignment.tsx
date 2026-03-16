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

            } catch (err) {
                // Handle error
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

            const mappedGuestDetails = {
                ...guestDetails,
                id_type: (guestDetails.id_type === 'aadhaar' || guestDetails.id_type === 'passport' || guestDetails.id_type === 'driving_license' || guestDetails.id_type === 'other') 
                    ? guestDetails.id_type 
                    : (guestDetails.id_type === 'aadhar' ? 'aadhaar' : 'other'),
            };

            // Always use v2 (multi-room aware)
            const { data, error } = await supabase.rpc("process_checkin_v2", {
                p_booking_id: bookingId,
                p_guest_details: mappedGuestDetails,
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
                        hotelId: booking.hotel_id,
                        roomNumber: roomNumbers || "Assigned",
                        roomsCount: bookingRooms.length,
                    }
                });
            } else {
                alert("Check-in failed: " + data.status);
            }
        } catch (err: any) {
            // Handle error
            alert("Check-in failed: " + err.message);
        } finally {
            setAssigning(false);
        }
    };

    if (!booking) return null;

    const BOOKING_STEPS = ["Find Booking", "Confirm Details", "Assign Room"];

    return (
        <div className="mx-auto max-w-4xl space-y-10 pb-20">
            {/* ── Header Area ── */}
            <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold-400/5 border border-gold-400/20 mb-2">
                    <div className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-400">Inventory Sync Active</span>
                </div>
                
                <h2 className="text-4xl font-light text-white tracking-tight">
                    {isMultiRoom ? `Unit Assignment ${currentStep + 1}/${bookingRooms.length}` : 'Residence Selection'}
                </h2>
                <p className="text-gold-100/40 font-light text-lg">
                    {isMultiRoom 
                        ? `Provisioning ${currentBookingRoom?.room_type_name || ''} allocation`
                        : 'Curate your preferred living space.'
                    }
                </p>

                {/* Multi-room progress indicators */}
                {isMultiRoom && (
                    <div className="flex justify-center gap-4 pt-6">
                        {bookingRooms.map((br, i) => (
                            <div key={br.id} className="relative group">
                                <div className={`flex items-center justify-center h-10 w-10 rounded-xl font-mono text-xs transition-all duration-500 ${
                                    i === currentStep 
                                        ? 'bg-gold-400 text-black shadow-[0_0_20px_rgba(212,175,55,0.4)] scale-110 z-10' 
                                        : assignments[br.id]
                                            ? 'bg-gold-400/20 text-gold-400 ring-1 ring-gold-400/30'
                                            : 'bg-white/5 text-white/20 ring-1 ring-white/10'
                                }`}>
                                    {assignments[br.id] && i !== currentStep ? <CheckCircle2 className="w-5 h-5" /> : `0${i + 1}`}
                                </div>
                                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full transition-all duration-500 ${i === currentStep ? 'bg-gold-400 scale-100' : 'bg-transparent scale-0'}`} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Suite Type Identification ── */}
            {currentBookingRoom && (
                <div className="flex justify-center">
                    <div className="px-6 py-2 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md flex items-center gap-3">
                        <BedDouble className="h-4 w-4 text-gold-400/60" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/80">
                            {currentBookingRoom.room_type_name}
                        </span>
                    </div>
                </div>
            )}

            {/* ── Selection Grid ── */}
            {loading ? (
                <div className="py-24 text-center space-y-4">
                    <div className="relative mx-auto w-16 h-16">
                        <Loader2 className="h-16 w-16 animate-spin text-gold-400/20" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-gold-400 animate-ping" />
                        </div>
                    </div>
                    <p className="text-gold-100/40 text-sm font-light tracking-widest uppercase">Fetching real-time availability...</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 px-4">
                    {availableRooms.map((room) => {
                        const isSelected = selectedRoomId === room.id;
                        const assignedToOther = Object.entries(assignments).some(
                            ([brId, rId]) => brId !== currentBookingRoom?.id && rId === room.id
                        );
                        
                        return (
                            <button
                                key={room.id}
                                onClick={() => handleRoomSelect(room.id)}
                                disabled={assignedToOther}
                                className={`group relative flex flex-col items-start gap-4 p-6 rounded-3xl border transition-all duration-500 text-left overflow-hidden ${
                                    isSelected
                                        ? "bg-gold-400 border-gold-400 shadow-[0_0_40px_rgba(212,175,55,0.15)] scale-[1.02]"
                                        : assignedToOther
                                            ? "bg-white/5 border-transparent opacity-30 grayscale cursor-not-allowed"
                                            : "bg-white/[0.03] border-white/5 hover:border-gold-400/40 hover:bg-gold-400/[0.03]"
                                }`}
                            >
                                {/* Selection Glow */}
                                {isSelected && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                                )}

                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors duration-500 ${
                                    isSelected ? "bg-black text-gold-400" : "bg-white/5 text-white/40 group-hover:text-gold-400"
                                }`}>
                                    <BedDouble className="h-5 w-5" />
                                </div>

                                <div className="space-y-1 relative z-10">
                                    <div className={`text-2xl font-light tracking-tight transition-colors ${isSelected ? "text-black" : "text-white"}`}>
                                        {room.number}
                                    </div>
                                    <div className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                        isSelected ? "text-black/60" : "text-gold-400/40 group-hover:text-gold-400/60"
                                    }`}>
                                        Floor {room.floor} • {room.room_type_name || room.type || "Unit"}
                                    </div>
                                </div>

                                {isSelected && (
                                    <div className="absolute top-6 right-6">
                                        <div className="w-2 h-2 rounded-full bg-black animate-pulse" />
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {!loading && availableRooms.length === 0 && (
                <div className="mx-auto max-w-sm rounded-3xl bg-red-400/5 border border-red-400/20 p-8 text-center space-y-4 backdrop-blur-md">
                    <div className="w-12 h-12 rounded-full bg-red-400/10 flex items-center justify-center mx-auto">
                        <BedDouble className="h-6 w-6 text-red-400/60" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-white text-sm font-medium">Inventory Unavailable</p>
                        <p className="text-red-400/60 text-xs font-light tracking-wider uppercase">Contact establishment support</p>
                    </div>
                </div>
            )}

            {/* ── Interaction Layer ── */}
            <div className="flex flex-col items-center space-y-6 pt-10">
                <div className="flex gap-6 w-full max-w-2xl px-4">
                    <button
                        onClick={handleBack}
                        className="flex-1 gn-btn gn-btn--secondary py-5 text-lg group"
                    >
                        <div className="flex items-center justify-center gap-3">
                            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                            <span className="uppercase tracking-[0.15em] font-bold">
                                {currentStep > 0 ? 'Back' : 'Profile'}
                            </span>
                        </div>
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={!selectedRoomId || assigning}
                        className="flex-[2] gn-btn gn-btn--primary py-5 text-lg group overflow-hidden"
                    >
                        {assigning ? (
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-6 w-6 animate-spin text-black" />
                                <span className="uppercase tracking-widest font-bold">Executing Sync...</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <span className="uppercase tracking-[0.15em] font-bold">
                                    {isLastStep ? 'Finalize Check-in' : 'Next Allocation'}
                                </span>
                                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                            </div>
                        )}
                    </button>
                </div>
                
                {!selectedRoomId && !loading && (
                    <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-white/20">
                        Selection required to advance
                    </p>
                )}
            </div>
        </div>
    );
}
