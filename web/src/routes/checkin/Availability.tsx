import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    ArrowRight,
    ArrowLeft,
    Bed,
    Check,
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
            // Filter out occupied rooms for the specific dates
            // Ensure checkin/checkout times from DB are clean (HH:mm)
            const cleanCheckIn = hCheckin.substring(0, 5);
            const cleanCheckOut = hCheckout.substring(0, 5);
            
            const checkInStart = `${stayDetails.checkin_date}T${cleanCheckIn}:00`;
            const checkOutEnd = `${stayDetails.checkout_date}T${cleanCheckOut}:00`;

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
    const { roomTotal, taxes, totalPayable } = getTotalPricing();    return (
        <div className="mx-auto max-w-6xl space-y-12 pb-24">
            {/* ── Progress Identification ── */}
            <div className="px-4">
                <CheckInStepper steps={WALKIN_STEPS} currentStep={1} />
            </div>

            <div className="flex flex-col lg:flex-row gap-10 items-start px-4">

                {/* LEFT: Room Selection Area */}
                <div className="flex-1 space-y-10 w-full">
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/80 text-[10px] font-bold uppercase tracking-[0.3em] relative overflow-hidden group">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                            </span>
                            Inventory Selection
                        </div>
                        {isMultiRoom && (
                            <h2 className="text-4xl font-bold tracking-tight text-white leading-tight">
                                Allocation {currentStep + 1}/{roomsCount}
                            </h2>
                        )}
                    </div>

                    {/* Progress dots for multi-room */}
                    {isMultiRoom && (
                        <div className="flex items-center gap-4">
                            {Array.from({ length: roomsCount }, (_, i) => (
                                <div
                                    key={i}
                                    className={`h-1.5 rounded-full transition-all duration-700 ${i < currentStep ? 'w-4 bg-gold-400/40' :
                                        i === currentStep ? 'w-16 bg-gold-400 shadow-[0_0_20px_rgba(212,175,55,0.4)]' :
                                            'w-4 bg-white/5'
                                        }`}
                                />
                            ))}
                            <div className="ml-2 text-[10px] font-black uppercase tracking-[0.2em] text-gold-400/60">
                                Step {currentStep + 1} of {roomsCount}
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="py-32 text-center space-y-6">
                            <div className="relative mx-auto w-20 h-20">
                                <Loader2 className="h-20 w-20 animate-spin text-gold-400/10" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-3 h-3 rounded-full bg-gold-400 animate-ping" />
                                </div>
                            </div>
                            <p className="text-gold-100/40 text-sm font-light tracking-[0.3em] uppercase">Synchronizing availability...</p>
                        </div>
                    ) : availableRooms.length === 0 ? (
                        <div className="gn-card border-red-500/20 bg-red-500/5 p-16 text-center space-y-6">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                                <Bed className="h-8 w-8 text-red-500/60" />
                            </div>
                            <div className="space-y-2">
                                <p className="font-light text-xl text-white">No Capacity Found</p>
                                <p className="text-red-500/60 text-xs font-bold uppercase tracking-widest">Adjust search criteria</p>
                            </div>
                            <button 
                                onClick={() => navigate("../walkin-details", { state: { guestDetails, stayDetails } })} 
                                className="gn-btn gn-btn--secondary px-8 py-3 text-[10px]"
                            >
                                Refine Parameters
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 pb-10">
                            {availableRooms.map((room) => {
                                const isSelected = selectedRoomId === room.id;
                                return (
                                    <button
                                        key={room.id}
                                        onClick={() => handleRoomSelect(room)}
                                        className={`group relative flex flex-col gap-5 p-5 rounded-xl transition-all duration-300 border ${isSelected
                                            ? "border-blue-500 bg-blue-600 text-white shadow-[0_0_30px_rgba(37,99,235,0.2)]"
                                            : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
                                            }`}
                                    >
                                        <div className="flex items-center justify-between w-full">
                                            <div className="flex items-center gap-4">
                                                <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                                                    isSelected ? "bg-white/20 text-white" : "bg-white/5 text-white/20 group-hover:text-white/40"
                                                }`}>
                                                    <Bed className="h-5 w-5" />
                                                </div>
                                                <div className="text-2xl font-bold tracking-tight leading-none">
                                                    {room.number}
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="shrink-0 w-5 h-5 rounded-full bg-white flex items-center justify-center animate-in zoom-in duration-300">
                                                    <Check className="h-3 w-3 text-blue-600 stroke-[4]" />
                                                </div>
                                            )}
                                        </div>

                                        <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap pl-2 transition-colors duration-300 ${
                                            isSelected ? "text-white/60" : "text-white/20 group-hover:text-white/40"
                                        }`}>
                                            <span>{room.room_types?.name || "Standard"}</span>
                                            <span className="w-0.5 h-0.5 rounded-full bg-current opacity-40" />
                                            <span>Floor {room.floor || '1'}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Navigation for Multi-room */}
                    {isMultiRoom && (
                        <div className="flex flex-col sm:flex-row justify-center gap-6 pt-10 border-t border-white/5">
                            <button
                                onClick={handleBack}
                                className="gn-btn gn-btn--secondary py-5 px-12 text-lg group"
                            >
                                <div className="flex items-center gap-3">
                                    <ArrowLeft className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                                    <span className="uppercase tracking-[0.15em] font-bold">Back</span>
                                </div>
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!selectedRoomId}
                                className="gn-btn gn-btn--primary py-5 px-16 text-xl group overflow-hidden"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="uppercase tracking-[0.15em] font-bold">
                                        {isLastStep ? 'Proceed to Billing' : 'Selection Complete'}
                                    </span>
                                    <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {/* RIGHT: Booking Narrative Summary */}
                <div className="w-full lg:w-[400px] shrink-0">
                    <div className="sticky top-10">
                        <div className="gn-card p-8 space-y-8 relative overflow-hidden group">
                            {/* Decorative Radial Shine */}
                            <div className="absolute top-0 right-0 w-48 h-48 bg-gold-400/5 blur-[100px] -mr-24 -mt-24" />
                            
                            <div className="flex items-center gap-5 border-b border-white/5 pb-6">
                                <div className="w-12 h-12 rounded-2xl bg-gold-400/10 flex items-center justify-center text-gold-400 ring-1 ring-gold-400/20 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
                                    <Receipt className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-xl font-light text-white tracking-tight">Folio Summary</h3>
                                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold-400/40">Real-time valuation</p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Primary Guest</span>
                                    <span className="text-sm font-medium text-white/90 tracking-wide">{guestDetails.full_name}</span>
                                </div>
                                
                                <div className="flex justify-between items-start">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/30 mt-1">Duration</span>
                                    <div className="text-right space-y-1">
                                        <div className="text-sm font-medium text-white/90 tracking-wide">{stayDetails.checkin_date}</div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-blue-500">thru {stayDetails.checkout_date}</div>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Occupants</span>
                                    <div className="flex items-center gap-3 text-sm font-medium text-white/90">
                                        <Users className="h-4 w-4 text-white/20" />
                                        <span>{stayDetails.adults} Adults • {stayDetails.children} Minors</span>
                                    </div>
                                </div>

                                {isMultiRoom && (
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Provisioning</span>
                                        <span className="text-sm font-medium text-white/90">{roomsCount} Distinct Units</span>
                                    </div>
                                )}

                                {/* Selected Rooms Narrative */}
                                {Object.keys(roomSelections).length > 0 && (
                                    <div className="pt-6 space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gold-400/60 ml-1 mb-4">Unit Allocations</p>
                                        <div className="space-y-4">
                                            {Object.entries(roomSelections)
                                                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                                .map(([stepIdx, sel]) => (
                                                    <div key={stepIdx} className="relative p-5 rounded-2xl bg-white/[0.03] border border-white/5 group-hover:bg-white/[0.05] transition-colors overflow-hidden">
                                                        <div className="absolute top-0 right-0 w-24 h-full bg-gradient-to-l from-gold-400/[0.02] to-transparent" />
                                                        <div className="flex justify-between items-center relative z-10">
                                                            <div className="space-y-1">
                                                                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-gold-400/40">Residence 0{parseInt(stepIdx) + 1}</div>
                                                                <div className="text-xl font-light text-white">{sel.room_number}</div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-[9px] font-bold uppercase tracking-widest text-gold-100/40">{sel.room_type_name}</div>
                                                                <div className="text-sm font-light text-gold-400">₹{sel.base_price.toLocaleString()}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}

                                {/* Financial Resolution */}
                                {Object.keys(roomSelections).length > 0 ? (
                                    <div className="mt-10 pt-8 border-t border-white/5 space-y-6">
                                        <div className="space-y-4">
                                            <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-gold-100/20">
                                                <span>Aggregate Rent</span>
                                                <span className="text-white">₹{roomTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-gold-100/20">
                                                <span>Statutory Surcharge (12%)</span>
                                                <span className="text-white">₹{taxes.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            </div>
                                        </div>
                                        
                                        <div className="pt-8 border-t border-gold-400/20">
                                            <div className="flex justify-between items-end">
                                                <div className="space-y-1">
                                                    <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-gold-400">Total Payable</span>
                                                    <span className="text-[9px] font-bold text-gold-100/20 uppercase tracking-widest">Post-tax valuation</span>
                                                </div>
                                                <span className="text-3xl font-light text-white tracking-tighter">
                                                    ₹{totalPayable.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-8 rounded-[2rem] border border-dashed border-white/5 p-10 text-center bg-white/[0.01] flex flex-col items-center gap-5 transition-all duration-500">
                                        <div className="w-14 h-14 rounded-2xl bg-white/[0.02] flex items-center justify-center text-white/10 ring-1 ring-white/5 animate-pulse">
                                            <CheckCircle2 className="h-6 w-6" />
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20">Awaiting Selection</p>
                                            <p className="text-xs font-medium text-white/10 leading-relaxed">
                                                Select inventory to<br />process valuation
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Single-room: direct action */}
                            {!isMultiRoom && (
                                <div className="mt-12">
                                    <button
                                        onClick={handleContinue}
                                        disabled={!selectedRoomId || loading}
                                        className="w-full relative group overflow-hidden disabled:opacity-50 disabled:grayscale transition-all duration-500"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-700 transition-all duration-500 group-hover:scale-[1.02] rounded-2xl" />
                                        <div className="absolute inset-0 bg-[linear-gradient(110deg,#fff0,45%,#fff4,55%,#fff0)] bg-[length:200%_100%] animate-[shimmer_3s_infinite] pointer-events-none" />
                                        <div className="relative flex items-center justify-center gap-3 py-5 px-8 text-white font-bold uppercase tracking-[0.2em] text-xs">
                                            <span className="uppercase tracking-[0.15em] font-bold">Secure Selection</span>
                                            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>
                        
                        {!allAssigned && !loading && Object.keys(roomSelections).length > 0 && (
                            <div className="mt-6 flex justify-center">
                                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gold-400/40 animate-pulse">
                                    Awaiting full unit allocation
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
