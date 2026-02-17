import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    ArrowLeft,
    BedDouble,
    CheckCircle2,
    Loader2,
    Receipt,
    Users
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { CheckInStepper } from "../../components/CheckInStepper";

interface Room {
    id: string;
    number: string;
    floor: number;
    room_type_id: string;
    room_types: {
        id: string;
        name: string;
    } | null;
    base_price: number; // resolved from rate_plan_prices
}

export default function Availability() {
    const navigate = useNavigate();
    const location = useLocation();
    const { guestDetails, stayDetails } = (location.state || {}) as any;

    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);
    const [hotelId, setHotelId] = useState<string | null>(null);

    // Multi-room state
    const roomsCount = stayDetails?.rooms_count || 1;
    const isMultiRoom = roomsCount > 1;
    const [currentStep, setCurrentStep] = useState(0);
    // Map: step index -> { room_id, room_type_id, room_number, room_type_name, base_price }
    const [roomSelections, setRoomSelections] = useState<Record<number, any>>({});

    const selectedRoomId = roomSelections[currentStep]?.room_id || null;
    const isLastStep = currentStep === roomsCount - 1;
    const allAssigned = Object.keys(roomSelections).length === roomsCount;

    useEffect(() => {
        fetchRooms();
    }, [stayDetails]);

    async function fetchRooms() {
        if (!stayDetails) return;
        try {
            setLoading(true);
            const { data: hotelData } = await supabase.from("hotels").select("id").limit(1).single();
            const hid = hotelData?.id;
            setHotelId(hid || null);
            if (!hid) return;

            console.log("[Availability] Fetching for Hotel ID:", hid);
            console.log("[Availability] Stay Details:", stayDetails);

            let query = supabase
                .from('rooms')
                .select(`
                    id, 
                    number, 
                    floor,
                    room_type_id,
                    room_types (
                        id,
                        name
                    )
                `)
                .eq('hotel_id', hid)
                .order('number');

            // Filter by preference if set
            if (stayDetails.room_type_preference) {
                console.log("[Availability] Filtering by preference:", stayDetails.room_type_preference);
                query = query.eq('room_type_id', stayDetails.room_type_preference);
            }

            const { data: allRooms, error: roomsError } = await query;
            console.log("[Availability] All Rooms Found:", allRooms?.length, allRooms);
            if (roomsError) throw roomsError;

            // Fetch pricing from rate_plan_prices
            const roomTypeIds = [...new Set((allRooms as any[])?.map(r => r.room_type_id) || [])];
            const { data: prices } = await supabase
                .from('rate_plan_prices')
                .select('room_type_id, price')
                .in('room_type_id', roomTypeIds);

            // Build price map (use lowest price per room type)
            const priceMap: Record<string, number> = {};
            (prices || []).forEach((p: any) => {
                if (!priceMap[p.room_type_id] || p.price < priceMap[p.room_type_id]) {
                    priceMap[p.room_type_id] = Number(p.price);
                }
            });
            console.log("[Availability] Price Map:", priceMap);

            // Filter out occupied rooms for the specific dates
            const checkInStart = `${stayDetails.checkin_date}T14:00:00`;
            const checkOutEnd = `${stayDetails.checkout_date}T11:00:00`;

            console.log("[Availability] Checking overlap:", { checkInStart, checkOutEnd });

            const { data: activeStays, error: staysError } = await supabase
                .from('stays')
                .select('room_id, scheduled_checkin_at, scheduled_checkout_at')
                .in('status', ['inhouse', 'arriving'])
                .lt('scheduled_checkin_at', checkOutEnd)   // Stay starts before we leave
                .gt('scheduled_checkout_at', checkInStart); // Stay ends after we arrive

            if (staysError) console.error("[Availability] Stays Error:", staysError);
            console.log("[Availability] Conflicting Stays:", activeStays);

            const occupiedRoomIds = new Set((activeStays || []).map(s => s.room_id));
            const available = ((allRooms as any[])?.filter(r => !occupiedRoomIds.has(r.id)) || []).map(r => ({
                ...r,
                base_price: priceMap[r.room_type_id] || 0,
            }));
            console.log("[Availability] Final Available Rooms:", available.length);
            setRooms(available);
        } catch (err) {
            console.error("[Availability] Error:", err);
        } finally {
            setLoading(false);
        }
    }

    // Get rooms available for current step (exclude already-selected in other steps)
    function getAvailableForStep(): Room[] {
        const selectedIds = new Set(
            Object.entries(roomSelections)
                .filter(([stepIdx]) => parseInt(stepIdx) !== currentStep)
                .map(([, sel]) => sel.room_id)
        );
        return rooms.filter(r => !selectedIds.has(r.id));
    }

    const availableRooms = getAvailableForStep();

    // Pricing — aggregate across all selected rooms
    const nights = stayDetails?.nights || 1;

    function getStepPricing() {
        const sel = roomSelections[currentStep];
        return sel?.base_price || 0;
    }

    function getTotalPricing() {
        let total = 0;
        for (const sel of Object.values(roomSelections)) {
            total += (sel.base_price || 0) * nights;
        }
        const taxes = total * 0.12;
        return { roomTotal: total, taxes, totalPayable: total + taxes };
    }

    const handleRoomSelect = (room: Room) => {
        setRoomSelections(prev => ({
            ...prev,
            [currentStep]: {
                room_id: room.id,
                room_type_id: room.room_type_id,
                room_number: room.number,
                room_type_name: room.room_types?.name || 'Standard',
                base_price: room.base_price || 0,
            }
        }));
    };

    const handleNext = () => {
        if (!selectedRoomId) return;
        if (isLastStep) {
            handleContinue();
        } else {
            setCurrentStep(prev => prev + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
        } else {
            navigate("../walkin-details", { state: { guestDetails, stayDetails } });
        }
    };

    const handleContinue = async () => {
        if (!allAssigned) return;
        setLoading(true);
        try {
            // Build room selections array for v2
            const selections = Object.values(roomSelections).map(sel => ({
                room_id: sel.room_id,
                room_type_id: sel.room_type_id,
            }));

            const { roomTotal, taxes, totalPayable } = getTotalPricing();

            // Build room numbers string
            const roomNumbers = Object.values(roomSelections)
                .map(sel => sel.room_number)
                .join(', ');

            const roomTypeDisplay = Object.values(roomSelections)
                .map(sel => sel.room_type_name)
                .join(', ');

            navigate("../walkin-payment", {
                state: {
                    guestDetails,
                    stayDetails,
                    roomSelections: selections,
                    pricing: {
                        basePrice: 0,
                        roomTotal,
                        taxes,
                        totalPayable
                    },
                    roomNumber: roomNumbers,
                    roomType: roomTypeDisplay,
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
    const { roomTotal, taxes, totalPayable } = getTotalPricing();

    return (
        <div className="mx-auto max-w-6xl space-y-6 pb-20">
            <CheckInStepper steps={WALKIN_STEPS} currentStep={1} />

            <div className="flex flex-col md:flex-row gap-8 items-start">

                {/* LEFT: Room Selection */}
                <div className="flex-1 space-y-6">
                    <div>
                        <h2 className="text-3xl font-light text-slate-900">
                            {isMultiRoom ? `Select Room ${currentStep + 1} of ${roomsCount}` : 'Select Room'}
                        </h2>
                        <p className="text-slate-500 mt-1">
                            Available • {stayDetails.checkin_date} to {stayDetails.checkout_date} ({nights} Nights)
                        </p>
                    </div>

                    {/* Progress dots for multi-room */}
                    {isMultiRoom && (
                        <div className="flex items-center gap-2">
                            {Array.from({ length: roomsCount }, (_, i) => (
                                <div
                                    key={i}
                                    className={`h-2.5 rounded-full transition-all ${i < currentStep ? 'w-2.5 bg-emerald-500' :
                                        i === currentStep ? 'w-8 bg-indigo-600' :
                                            'w-2.5 bg-slate-200'
                                        }`}
                                />
                            ))}
                            <span className="ml-2 text-xs text-slate-400">
                                {Object.keys(roomSelections).length}/{roomsCount} assigned
                            </span>
                        </div>
                    )}

                    {loading ? (
                        <div className="py-20 text-center">
                            <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" />
                            <p className="mt-4 text-slate-500">Checking real-time availability...</p>
                        </div>
                    ) : availableRooms.length === 0 ? (
                        <div className="rounded-2xl bg-slate-50 p-8 text-center">
                            <p className="text-slate-500">No rooms available matching your criteria.</p>
                            <button onClick={() => navigate("../walkin-details", { state: { guestDetails, stayDetails } })} className="mt-4 text-indigo-600 font-medium hover:underline">
                                Modify Search
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                            {availableRooms.map((room) => {
                                const isSelected = selectedRoomId === room.id;
                                const price = room.base_price || 0;

                                return (
                                    <button
                                        key={room.id}
                                        onClick={() => handleRoomSelect(room)}
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

                    {/* Navigation Buttons (multi-room) */}
                    {isMultiRoom && (
                        <div className="flex justify-between pt-4">
                            <button
                                onClick={handleBack}
                                className="flex items-center gap-2 rounded-xl px-6 py-3 text-slate-600 font-medium hover:bg-slate-100 transition-all"
                            >
                                <ArrowLeft className="h-5 w-5" /> Back
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!selectedRoomId}
                                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3 text-white font-bold shadow-lg hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {isLastStep ? 'Proceed to Payment' : 'Next Room'} <ArrowRight className="h-5 w-5" />
                            </button>
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
                                {isMultiRoom && (
                                    <div className="flex justify-between py-2 border-b border-slate-50">
                                        <span className="text-slate-500">Rooms</span>
                                        <span className="font-medium text-slate-900">{roomsCount}</span>
                                    </div>
                                )}

                                {/* Selected rooms list (multi-room) */}
                                {isMultiRoom && Object.keys(roomSelections).length > 0 && (
                                    <div className="mt-2 space-y-1.5">
                                        {Object.entries(roomSelections)
                                            .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                            .map(([stepIdx, sel]) => (
                                                <div key={stepIdx} className="flex justify-between items-center rounded-lg bg-emerald-50 px-3 py-2">
                                                    <span className="text-xs text-emerald-700 font-medium">
                                                        Room {parseInt(stepIdx) + 1}: {sel.room_number}
                                                    </span>
                                                    <span className="text-xs text-emerald-600">
                                                        {sel.room_type_name} • ₹{sel.base_price}/n
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}

                                {/* Dynamic Pricing */}
                                {Object.keys(roomSelections).length > 0 ? (
                                    <div className="mt-6 rounded-2xl bg-slate-50 p-4 space-y-3">
                                        {isMultiRoom ? (
                                            <>
                                                {Object.entries(roomSelections)
                                                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                                    .map(([stepIdx, sel]) => (
                                                        <div key={stepIdx} className="flex justify-between text-slate-600 text-xs">
                                                            <span>Room {parseInt(stepIdx) + 1} ({sel.room_number}) x{nights}n</span>
                                                            <span>₹{(sel.base_price * nights).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-2">
                                                    <span>Subtotal</span>
                                                    <span>₹{roomTotal.toFixed(2)}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between text-slate-600">
                                                <span>Room Rate (x{nights})</span>
                                                <span>₹{roomTotal.toFixed(2)}</span>
                                            </div>
                                        )}
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

                            {/* Single-room: proceed button in sidebar */}
                            {!isMultiRoom && (
                                <div className="mt-6 pt-2">
                                    <button
                                        onClick={handleContinue}
                                        disabled={!selectedRoomId || loading}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    >
                                        Proceed to Payment <ArrowRight className="h-5 w-5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
