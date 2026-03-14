import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
    const [searchParams] = useSearchParams();
    const slug = searchParams.get('slug');
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

            let hotelQuery = supabase.from("hotels").select("id, default_checkin_time, default_checkout_time").limit(1);
            if (slug) {
                hotelQuery = hotelQuery.eq("slug", slug);
            }

            const { data: hotelData } = await hotelQuery.single();
            const hid = hotelData?.id;
            const hCheckin = hotelData?.default_checkin_time || "14:00";
            const hCheckout = hotelData?.default_checkout_time || "11:00";

            setHotelId(hid || null);
            if (!hid) return;

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
                query = query.eq('room_type_id', stayDetails.room_type_preference);
            }

            const { data: allRooms, error: roomsError } = await query;
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

            // Filter out occupied rooms for the specific dates
            const checkInStart = `${stayDetails.checkin_date}T${hCheckin}:00`;
            const checkOutEnd = `${stayDetails.checkout_date}T${hCheckout}:00`;

            const { data: activeStays, error: staysError } = await supabase
                .from('stays')
                .select('room_id, scheduled_checkin_at, scheduled_checkout_at')
                .in('status', ['inhouse', 'arriving'])
                .lt('scheduled_checkin_at', checkOutEnd)   // Stay starts before we leave
                .gt('scheduled_checkout_at', checkInStart); // Stay ends after we arrive

            if (staysError) {
                console.error("[Availability] Error fetching stays:", staysError);
            }

            const occupiedRoomIds = new Set((activeStays || []).map(s => s.room_id));
            const available = ((allRooms as any[])?.filter(r => !occupiedRoomIds.has(r.id)) || []).map(r => ({
                ...r,
                base_price: priceMap[r.room_type_id] || 0,
            }));
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
            alert(err.message);
            setLoading(false);
        }
    };

    if (!stayDetails) return null;

    const WALKIN_STEPS = ["Guest Details", "Select Room", "Payment"];
    const { roomTotal, taxes, totalPayable } = getTotalPricing();

    return (
        <div className="mx-auto max-w-6xl space-y-10 py-4">
            <CheckInStepper steps={WALKIN_STEPS} currentStep={1} />

            <div className="flex flex-col md:flex-row gap-8 items-start px-2">

                {/* LEFT: Room Selection */}
                <div className="flex-1 space-y-8">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-[var(--text-gold)]/5 border border-[var(--border-gold)]/10 text-[var(--text-gold)] text-[10px] font-black uppercase tracking-[0.2em]">
                            Room Selection
                        </div>
                        <h2 className="text-4xl font-light tracking-tight text-[var(--text-primary)]">
                            {isMultiRoom ? `Select Room ${currentStep + 1} of ${roomsCount}` : 'Select Room'}
                        </h2>
                        <p className="text-[var(--text-muted)] italic">
                            Available • {stayDetails.checkin_date} to {stayDetails.checkout_date} ({nights} Nights)
                        </p>
                    </div>

                    {/* Progress dots for multi-room */}
                    {isMultiRoom && (
                        <div className="flex items-center gap-3">
                            {Array.from({ length: roomsCount }, (_, i) => (
                                <div
                                    key={i}
                                    className={`h-2 rounded-full transition-all duration-500 ${i < currentStep ? 'w-2 bg-emerald-500/60' :
                                        i === currentStep ? 'w-12 bg-[var(--text-gold)] shadow-[var(--shadow-glow)]' :
                                            'w-2 bg-white/10'
                                        }`}
                                />
                            ))}
                            <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                                {Object.keys(roomSelections).length}/{roomsCount} assigned
                            </span>
                        </div>
                    )}

                    {loading ? (
                        <div className="py-24 text-center">
                            <Loader2 className="mx-auto h-12 w-12 animate-spin text-[var(--text-gold)]" />
                            <p className="mt-6 text-[var(--text-muted)] italic font-light">Checking real-time availability...</p>
                        </div>
                    ) : availableRooms.length === 0 ? (
                        <div className="gn-card border-amber-500/20 bg-amber-500/5 p-12 text-center text-amber-500 space-y-4">
                            <p className="font-black uppercase tracking-widest text-sm">No Rooms Available</p>
                            <p className="text-sm italic opacity-80">No rooms available matching your criteria. Please refine your search.</p>
                            <button onClick={() => navigate("../walkin-details", { state: { guestDetails, stayDetails } })} className="mt-4 text-[var(--text-gold)] font-black uppercase tracking-widest text-[10px] hover:underline">
                                Modify Search
                            </button>
                        </div>
                    ) : (
                        <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                            <div className="grid grid-cols-2 gap-6 lg:grid-cols-3 pb-6">
                                {availableRooms.map((room) => {
                                    const isSelected = selectedRoomId === room.id;
                                    const price = room.base_price || 0;

                                    return (
                                        <button
                                            key={room.id}
                                            onClick={() => handleRoomSelect(room)}
                                            className={`gn-card group relative flex flex-col items-start gap-4 p-6 text-left transition-all ${isSelected
                                                ? "bg-[var(--bg-secondary)] border-[var(--border-gold)] shadow-[var(--shadow-glow)] ring-1 ring-[var(--border-gold)]/40"
                                                : "hover:scale-[1.02] hover:bg-white/[0.02]"
                                                }`}
                                        >
                                            <div className="flex w-full justify-between items-start">
                                                <div className={`rounded-xl p-3 border transition-colors ${isSelected ? "bg-[var(--text-gold)]/10 border-[var(--border-gold)]/40" : "bg-[var(--bg-secondary)] border-[var(--border-subtle)]"}`}>
                                                    <BedDouble className={`h-6 w-6 ${isSelected ? "text-[var(--text-gold)]" : "text-[var(--text-gold)]/40"}`} />
                                                </div>
                                                {isSelected && (
                                                    <div className="h-6 w-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                                                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="w-full space-y-1">
                                                <div className="font-black text-2xl text-[var(--text-primary)] tracking-tight">{room.number}</div>
                                                <div className={`text-[10px] font-black uppercase tracking-widest ${isSelected ? "text-[var(--text-gold)]" : "text-[var(--text-muted)]"}`}>
                                                    {room.room_types?.name || "Standard"}
                                                </div>
                                            </div>

                                            <div className={`mt-2 pt-4 border-t w-full flex justify-between items-center ${isSelected ? "border-[var(--border-gold)]/20" : "border-[var(--border-subtle)]"}`}>
                                                <span className="text-lg font-black text-[var(--text-primary)]">₹{price}</span>
                                                <span className={`text-[10px] font-black uppercase tracking-widest ${isSelected ? "text-[var(--text-gold)]/60" : "text-[var(--text-muted)]"}`}>/ night</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Navigation Buttons (multi-room) */}
                    {isMultiRoom && (
                        <div className="flex flex-col sm:flex-row justify-center pt-8 gap-6">
                            <button
                                onClick={handleBack}
                                className="gn-btn gn-btn--secondary py-4 px-10 text-base"
                            >
                                <ArrowLeft className="h-5 w-5 mr-2 opacity-50" />
                                Back
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!selectedRoomId}
                                className="gn-btn gn-btn--primary py-4 px-12 text-lg group"
                            >
                                <span className="flex items-center gap-3">
                                    {isLastStep ? 'Proceed to Payment' : 'Next Room'}
                                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                                </span>
                            </button>
                        </div>
                    )}
                </div>

                {/* RIGHT: Booking Summary (Sticky) */}
                <div className="w-full md:w-96 shrink-0">
                    <div className="sticky top-8">
                        <div className="gn-card p-8 space-y-8 border-[var(--border-gold)]/10">
                            <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-6">
                                <div className="rounded-xl bg-[var(--text-gold)]/10 p-3 text-[var(--text-gold)] border border-[var(--border-gold)]/20 shadow-[var(--shadow-glow)]">
                                    <Receipt className="h-6 w-6" />
                                </div>
                                <h3 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Booking Summary</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center group">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Guest</span>
                                    <span className="text-sm font-medium text-[var(--text-primary)]">{guestDetails.full_name}</span>
                                </div>
                                <div className="flex justify-between items-start group">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mt-1">Dates</span>
                                    <div className="text-right">
                                        <div className="text-sm font-medium text-[var(--text-primary)]">{stayDetails.checkin_date}</div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-gold)] opacity-60">to {stayDetails.checkout_date}</div>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center group">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Occupancy</span>
                                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                                        <Users className="h-4 w-4 text-[var(--text-gold)]/40" />
                                        {stayDetails.adults} Ad, {stayDetails.children} Ch
                                    </div>
                                </div>
                                {isMultiRoom && (
                                    <div className="flex justify-between items-center group">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Rooms</span>
                                        <span className="text-sm font-medium text-[var(--text-primary)]">{roomsCount} Units</span>
                                    </div>
                                )}

                                {/* Selected rooms list (multi-room) */}
                                {isMultiRoom && Object.keys(roomSelections).length > 0 && (
                                    <div className="mt-6 space-y-2">
                                        {Object.entries(roomSelections)
                                            .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                            .map(([stepIdx, sel]) => (
                                                <div key={stepIdx} className="flex justify-between items-center rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] px-4 py-3">
                                                    <div className="space-y-0.5">
                                                        <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-gold)]">Room {parseInt(stepIdx) + 1}</div>
                                                        <div className="text-xs font-medium text-[var(--text-primary)]">{sel.room_number}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">{sel.room_type_name}</div>
                                                        <div className="text-[10px] font-bold text-[var(--text-primary)]">₹{sel.base_price}/n</div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                )}

                                {/* Dynamic Pricing */}
                                {Object.keys(roomSelections).length > 0 ? (
                                    <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                                                <span>Subtotal</span>
                                                <span className="text-[var(--text-primary)]">₹{roomTotal.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                                                <span>Taxes (12%)</span>
                                                <span className="text-[var(--text-primary)]">₹{taxes.toFixed(2)}</span>
                                            </div>
                                        </div>
                                        <div className="pt-4 border-t border-[var(--border-gold)]/20 flex justify-between items-center">
                                            <span className="text-xs font-black uppercase tracking-[0.2em] text-[var(--text-gold)]">Total</span>
                                            <span className="text-2xl font-black text-[var(--text-primary)] tracking-tight">₹{totalPayable.toFixed(2)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-8 rounded-2xl bg-white/[0.02] border border-dashed border-[var(--border-subtle)] p-6 text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] italic">Select a room to see pricing</p>
                                    </div>
                                )}
                            </div>

                            {/* Single-room: proceed button in sidebar */}
                            {!isMultiRoom && (
                                <div className="mt-10">
                                    <button
                                        onClick={handleContinue}
                                        disabled={!selectedRoomId || loading}
                                        className="gn-btn gn-btn--primary w-full py-5 text-xl group"
                                    >
                                        <span className="flex items-center gap-3">
                                            Proceed to Payment
                                            <ArrowRight className="h-6 w-6 group-hover:translate-x-1 transition-transform" />
                                        </span>
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
