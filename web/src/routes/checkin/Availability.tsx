import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    BedDouble,
    CheckCircle2,
    Loader2,
    Receipt,
    Users
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

type Room = {
    id: string;
    number: string;
    floor: number;
    room_types: {
        id: string;
        name: string;
        base_price: number;
    } | null;
};

export default function Availability() {
    const navigate = useNavigate();
    const location = useLocation();

    // Destructure payload from Step 1
    const { guestDetails, stayDetails } = location.state || {};

    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

    // Redirect if missing data
    useEffect(() => {
        if (!guestDetails || !stayDetails) navigate("../walkin");
    }, [guestDetails, stayDetails, navigate]);

    // Fetch Available Rooms
    useEffect(() => {
        async function fetchRooms() {
            if (!stayDetails) return;
            try {
                setLoading(true);
                // Get first hotel (Demo)
                const { data: hotelData } = await supabase.from("hotels").select("id").limit(1).single();
                const hotelId = hotelData?.id;
                console.log("[Availability] hotelId:", hotelId);

                if (!hotelId) { console.warn("[Availability] No hotel found"); return; }

                // 1. Get all rooms with Price Info
                let query = supabase
                    .from('rooms')
                    .select(`
                        id, 
                        number, 
                        floor,
                        room_type_id,
                        room_types (
                            id,
                            name,
                            base_price
                        )
                    `)
                    .eq('hotel_id', hotelId)
                    .order('number');

                // Filter by preference if set
                if (stayDetails.room_type_preference) {
                    query = query.eq('room_type_id', stayDetails.room_type_preference);
                }

                const { data: allRooms, error: roomsError } = await query;
                console.log("[Availability] rooms query result:", allRooms?.length, "rooms, error:", roomsError);

                if (roomsError) throw roomsError;

                // 2. Get active stays to filter out occupied rooms
                // Note: stays has RLS, so this may return empty for anon users — that's OK
                const { data: activeStays, error: staysError } = await supabase
                    .from('stays')
                    .select('room_id')
                    .in('status', ['inhouse', 'arriving']);

                if (staysError) {
                    console.warn("[Availability] stays query blocked (RLS?):", staysError.message);
                }

                const occupiedRoomIds = new Set((activeStays || []).map(s => s.room_id));
                console.log("[Availability] occupied rooms:", occupiedRoomIds.size);

                // Filter available
                const available = (allRooms as any[])?.filter(r => !occupiedRoomIds.has(r.id)) || [];
                console.log("[Availability] available rooms:", available.length);
                setRooms(available);

            } catch (err) {
                console.error("[Availability] Error:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchRooms();
    }, [stayDetails]);

    // Pricing Logic
    const selectedRoom = rooms.find(r => r.id === selectedRoomId);
    const basePrice = selectedRoom?.room_types?.base_price || 0;
    const nights = stayDetails?.nights || 1;
    const roomTotal = basePrice * nights;
    const taxes = roomTotal * 0.12; // 12% GST assumption
    const totalPayable = roomTotal + taxes;

    const handleContinue = async () => {
        if (!selectedRoomId) return;

        setLoading(true);
        try {
            const { data: hotelData } = await supabase.from("hotels").select("id").limit(1).single();
            const hotelId = hotelData?.id;

            // Call create_walkin RPC or navigate to Payment
            // For Premium flow: "Pricing Preview" -> "Payment" -> "Create Stay"
            // We'll navigate to payment with full breakdown
            navigate("../walkin-payment", {
                state: {
                    guestDetails,
                    stayDetails,
                    selectedRoomId,
                    pricing: {
                        basePrice,
                        roomTotal,
                        taxes,
                        totalPayable
                    },
                    roomNumber: selectedRoom?.number,
                    roomType: selectedRoom?.room_types?.name,
                    hotelId
                }
            });

        } catch (err: any) {
            console.error(err);
            alert(err.message);
            setLoading(false);
        }
    };

    if (!stayDetails) return null;

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];

    return (
        <div className="mx-auto max-w-6xl space-y-6 pb-20">
            {/* ── Stepper ── */}
            <CheckInStepper steps={WALKIN_STEPS} currentStep={1} />

            <div className="flex flex-col md:flex-row gap-8 items-start">

                {/* LEFT: Room Selection */}
                <div className="flex-1 space-y-6">
                    <div>
                        <h2 className="text-3xl font-light text-slate-900">Select Room</h2>
                        <p className="text-slate-500 mt-1">
                            Available • {stayDetails.checkin_date} to {stayDetails.checkout_date} ({nights} Nights)
                        </p>
                    </div>

                    {loading ? (
                        <div className="py-20 text-center">
                            <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" />
                            <p className="mt-4 text-slate-500">Checking real-time availability...</p>
                        </div>
                    ) : rooms.length === 0 ? (
                        <div className="rounded-2xl bg-slate-50 p-8 text-center">
                            <p className="text-slate-500">No rooms available matching your criteria.</p>
                            <button onClick={() => navigate(-1)} className="mt-4 text-indigo-600 font-medium hover:underline">
                                Modify Search
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                            {rooms.map((room) => {
                                const isSelected = selectedRoomId === room.id;
                                const price = room.room_types?.base_price || 0;

                                return (
                                    <button
                                        key={room.id}
                                        onClick={() => setSelectedRoomId(room.id)}
                                        className={`group relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all ${isSelected
                                            ? "bg-indigo-600 text-white shadow-xl ring-2 ring-indigo-600 ring-offset-2 scale-[1.02]"
                                            : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5 hover:bg-slate-50 hover:shadow-md"
                                            }`}
                                    >
                                        <div className="flex w-full justify-between items-start">
                                            <div className={`rounded-xl p-2.5 ${isSelected ? "bg-white/20" : "bg-indigo-50 text-indigo-600"}`}>
                                                <BedDouble className="h-6 w-6" />
                                            </div>
                                            {isSelected && <CheckCircle2 className="h-6 w-6 text-white" />}
                                        </div>

                                        <div className="w-full">
                                            <div className="font-bold text-2xl tracking-tight">{room.number}</div>
                                            <div className={`text-sm font-medium ${isSelected ? "text-indigo-100" : "text-slate-500"}`}>
                                                {room.room_types?.name || "Standard"}
                                            </div>
                                        </div>

                                        <div className={`mt-2 pt-3 border-t w-full flex justify-between items-center ${isSelected ? "border-white/20" : "border-slate-100"}`}>
                                            <span className="text-lg font-bold">₹{price}</span>
                                            <span className={`text-xs ${isSelected ? "text-indigo-200" : "text-slate-400"}`}>/ night</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* RIGHT: Booking Summary (Sticky) */}
                <div className="w-full md:w-96 shrink-0">
                    <div className="sticky top-8 space-y-6">
                        <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-900/5">
                            <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-4">
                                <div className="rounded-full bg-slate-100 p-2 text-slate-600">
                                    <Receipt className="h-5 w-5" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900">Booking Summary</h3>
                            </div>

                            <div className="space-y-4 text-sm">
                                <div className="flex justify-between py-2 border-b border-slate-50">
                                    <span className="text-slate-500">Guest</span>
                                    <span className="font-medium text-slate-900 text-right">{guestDetails.full_name}</span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-slate-50">
                                    <span className="text-slate-500">Dates</span>
                                    <span className="font-medium text-slate-900 text-right">
                                        {stayDetails.checkin_date} <br />
                                        <span className="text-xs text-slate-400">to {stayDetails.checkout_date}</span>
                                    </span>
                                </div>
                                <div className="flex justify-between py-2 border-b border-slate-50">
                                    <span className="text-slate-500">Occupancy</span>
                                    <div className="flex items-center gap-1 font-medium text-slate-900">
                                        <Users className="h-4 w-4 text-slate-400" />
                                        {stayDetails.adults} Ad, {stayDetails.children} Ch
                                    </div>
                                </div>

                                {/* Dynamic Pricing */}
                                {selectedRoomId ? (
                                    <div className="mt-6 rounded-2xl bg-slate-50 p-4 space-y-3">
                                        <div className="flex justify-between text-slate-600">
                                            <span>Room Rate (x{nights})</span>
                                            <span>₹{roomTotal.toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-600">
                                            <span>Taxes (12%)</span>
                                            <span>₹{taxes.toFixed(2)}</span>
                                        </div>
                                        <div className="border-t border-slate-200 pt-3 flex justify-between font-bold text-lg text-slate-900">
                                            <span>Total</span>
                                            <span>₹{totalPayable.toFixed(2)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-center text-slate-400 italic">
                                        Select a room to see pricing
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 pt-2">
                                <button
                                    onClick={handleContinue}
                                    disabled={!selectedRoomId || loading}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    Proceed to Payment <ArrowRight className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
