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
import { getEffectivePrices } from "../../services/pricingService";
import { listRestrictionsForStay } from "../../services/rateService";
import type { StayRestriction } from "../../types/rate";
import { Ban, ShieldAlert } from "lucide-react";

interface Room {
    id: string;
    number: string;
    floor: number;
    room_type_id: string;
    room_types: {
        id: string;
        name: string;
    } | null;
    // Effective price: override from pricing_current_rates if present,
    // otherwise MIN(rate_plan_prices). Resolved via v_effective_room_price.
    base_price: number;
    is_overridden: boolean;
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
    // Per-hotel tax config from `hotels.tax_percentage` / `tax_inclusive`.
    // Default 12% / exclusive matches the historical hardcoded behavior.
    const [hotelTax, setHotelTax] = useState<{ pct: number; inclusive: boolean }>({ pct: 12, inclusive: false });

    // Restrictions aggregated for this stay's date window. Drives both
    // (a) hiding stop-sell room types and (b) the MinLOS banner/block logic.
    const [restrictionsByType, setRestrictionsByType] = useState<Record<string, StayRestriction>>({});
    const [restrictionsBlock, setRestrictionsBlock] = useState<string | null>(null);

    // Multi-room state
    const roomsCount = stayDetails?.rooms_count || 1;
    const isMultiRoom = roomsCount > 1;
    const [currentStep, setCurrentStep] = useState(0);
    // Map: step index -> { room_id, room_type_id, room_number, room_type_name, base_price }
    const [roomSelections, setRoomSelections] = useState<Record<number, any>>({});

    // Two-step room picker: first choose room type, then a specific room.
    // Per-step so each allocation in a multi-room booking can target a
    // different type. Falls back to a flat grid for small inventories or
    // when only one type is available — see `shouldFlatten` below.
    const [selectedTypeByStep, setSelectedTypeByStep] = useState<Record<number, string | null>>({});
    const [roomSearch, setRoomSearch] = useState("");

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

            let hotelQuery = supabase.from("hotels").select("id, default_checkin_time, default_checkout_time, tax_percentage, tax_inclusive").limit(1);
            if (slug) {
                hotelQuery = hotelQuery.eq("slug", slug);
            }

            const { data: hotelData } = await hotelQuery.single();
            const hid = hotelData?.id;
            const hCheckin = hotelData?.default_checkin_time || "14:00";
            const hCheckout = hotelData?.default_checkout_time || "11:00";

            setHotelId(hid || null);
            setHotelTax({
                pct: Number(hotelData?.tax_percentage ?? 12),
                inclusive: Boolean(hotelData?.tax_inclusive),
            });
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

            // Fetch effective prices (override-aware) via v_effective_room_price.
            // Falls back to MIN(rate_plan_prices) when no override exists.
            const roomTypeIds = [...new Set((allRooms as any[])?.map(r => r.room_type_id) || [])] as string[];
            const [effective, restrictionMap] = await Promise.all([
                getEffectivePrices(hid, roomTypeIds),
                listRestrictionsForStay(hid, stayDetails.checkin_date, stayDetails.checkout_date, roomTypeIds),
            ]);
            setRestrictionsByType(restrictionMap);

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

            // Stop-sell: exclude rooms whose room_type is blocked for any
            // night in the stay window. CTA handled below at the form level.
            const stopSellTypes = new Set(
                Object.values(restrictionMap)
                    .filter(r => r.any_stop_sell)
                    .map(r => r.room_type_id),
            );

            const available = ((allRooms as any[])?.filter(r =>
                !occupiedRoomIds.has(r.id) &&
                !stopSellTypes.has(r.room_type_id),
            ) || []).map(r => {
                const ep = effective[r.room_type_id];
                return {
                    ...r,
                    base_price: ep?.effective_price ?? 0,
                    is_overridden: !!ep?.is_overridden,
                };
            });
            setRooms(available);

            // Compute hard blocks up-front so the UI can show a single
            // actionable error instead of letting staff progress and hit
            // a server-side rejection.
            const nights = Math.max(
                1,
                Math.round(
                    (new Date(stayDetails.checkout_date).getTime() -
                        new Date(stayDetails.checkin_date).getTime()) /
                        (1000 * 60 * 60 * 24),
                ),
            );
            const ctaTypes = Object.values(restrictionMap).filter(r => r.any_cta);
            const minLosViolations = Object.values(restrictionMap).filter(
                r => r.max_min_los != null && r.max_min_los > nights,
            );

            if (ctaTypes.length === Object.keys(restrictionMap).length && ctaTypes.length > 0) {
                setRestrictionsBlock(
                    `Check-in is closed on ${stayDetails.checkin_date} for all room types. Pick a different arrival date.`,
                );
            } else if (minLosViolations.length > 0) {
                const maxRequired = Math.max(...minLosViolations.map(v => v.max_min_los ?? 0));
                setRestrictionsBlock(
                    `Minimum stay for ${stayDetails.checkin_date} is ${maxRequired} night${maxRequired === 1 ? "" : "s"}. Current stay is ${nights} night${nights === 1 ? "" : "s"}. Extend the checkout date to continue.`,
                );
            } else {
                setRestrictionsBlock(null);
            }
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
        // Tax-inclusive hotels: rate already bakes in tax → no separate
        // line. Tax-exclusive: add pct on top. NULL → 12% default.
        const taxes = hotelTax.inclusive ? 0 : total * (hotelTax.pct / 100);
        const totalPayable = hotelTax.inclusive ? total : total + taxes;
        return { roomTotal: total, taxes, totalPayable };
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
                is_overridden: !!room.is_overridden,
            }
        }));
    };

    const handleNext = () => {
        if (!selectedRoomId) return;
        if (isLastStep) {
            handleContinue();
        } else {
            setCurrentStep(prev => prev + 1);
            setRoomSearch("");
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
            setRoomSearch("");
        } else {
            navigate({ pathname: "../walkin-details", search: slug ? `?slug=${slug}` : "" }, { state: { guestDetails, stayDetails } });
        }
    };

    function pickRoomType(typeId: string) {
        setSelectedTypeByStep(prev => ({ ...prev, [currentStep]: typeId }));
        setRoomSearch("");
    }

    function backToRoomTypes() {
        setSelectedTypeByStep(prev => ({ ...prev, [currentStep]: null }));
        setRoomSelections(prev => {
            const next = { ...prev };
            delete next[currentStep];
            return next;
        });
        setRoomSearch("");
    }

    const handleContinue = async () => {
        if (!allAssigned) return;
        if (restrictionsBlock) return; // guardrail: MinLOS/CTA block
        setLoading(true);
        try {
            // Build room selections array for v2. `amount_per_night` locks the
            // effective rate at check-in time: create_walkin_v2 persists it to
            // booking_rooms.amount_total and inserts a ROOM_CHARGE folio entry,
            // so the guest is insulated from later pricing_current_rates changes.
            const selections = Object.values(roomSelections).map(sel => ({
                room_id: sel.room_id,
                room_type_id: sel.room_type_id,
                amount_per_night: sel.base_price,
            }));

            const { roomTotal, taxes, totalPayable } = getTotalPricing();

            // Build room numbers string
            const roomNumbers = Object.values(roomSelections)
                .map(sel => sel.room_number)
                .join(', ');

            const roomTypeDisplay = Object.values(roomSelections)
                .map(sel => sel.room_type_name)
                .join(', ');

            navigate({ pathname: "../walkin-payment", search: slug ? `?slug=${slug}` : "" }, {
                state: {
                    guestDetails,
                    stayDetails,
                    roomSelections: selections,
                    pricing: {
                        basePrice: 0,
                        roomTotal,
                        taxes,
                        totalPayable,
                        taxPct: hotelTax.pct,
                        taxInclusive: hotelTax.inclusive,
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

    // Group available rooms by type and decide whether to render the flat
    // grid (small inventories / single-type properties) or the two-step
    // type → room picker. Threshold is intentionally conservative: at ≤ 12
    // rooms the wall-of-cards is still scannable, so we don't add a click.
    const FLATTEN_THRESHOLD = 12;
    const roomGroups = (() => {
        const map = new Map<string, { id: string; name: string; rooms: Room[]; price: number }>();
        for (const r of availableRooms) {
            const tid = r.room_type_id;
            if (!map.has(tid)) {
                map.set(tid, {
                    id: tid,
                    name: r.room_types?.name || "Standard",
                    rooms: [],
                    price: r.base_price || 0,
                });
            }
            const g = map.get(tid)!;
            g.rooms.push(r);
            // Keep the lowest price as the displayed "from" price
            if (r.base_price && (g.price === 0 || r.base_price < g.price)) {
                g.price = r.base_price;
            }
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    })();

    const selectedTypeId = selectedTypeByStep[currentStep] ?? null;
    const shouldFlatten = availableRooms.length <= FLATTEN_THRESHOLD || roomGroups.length <= 1;
    const showRoomList = shouldFlatten || !!selectedTypeId;
    const selectedGroup = selectedTypeId ? roomGroups.find(g => g.id === selectedTypeId) : null;

    const roomsForList = (() => {
        let pool = shouldFlatten ? availableRooms : (selectedGroup?.rooms ?? []);
        const q = roomSearch.trim().toLowerCase();
        if (q) pool = pool.filter(r => r.number.toLowerCase().includes(q));
        return pool;
    })();

    return (
        <div className="mx-auto max-w-6xl space-y-12 pb-24">
            {/* ── Progress Identification ── */}
            <div className="px-4">
                <CheckInStepper steps={WALKIN_STEPS} currentStep={1} />
            </div>

            {/* Restrictions banner (MinLOS / CTA). Hard-blocks Continue. */}
            {restrictionsBlock && (
                <div className="mx-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-rose-300">
                            Stay restriction
                        </p>
                        <p className="text-sm text-rose-100 mt-1 leading-relaxed">
                            {restrictionsBlock}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate({ pathname: "../walkin-details", search: slug ? `?slug=${slug}` : "" }, { state: { guestDetails, stayDetails } })}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-rose-200 transition whitespace-nowrap"
                    >
                        Edit dates
                    </button>
                </div>
            )}

            {/* Any-room-type stop-sell notice (informational, not blocking) */}
            {!restrictionsBlock && Object.values(restrictionsByType).some(r => r.any_stop_sell) && (
                <div className="mx-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 flex items-start gap-3">
                    <Ban className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-100">
                        Some room types are blocked for this stay window (stop-sell) and have been hidden from the list.
                    </p>
                </div>
            )}

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
                                onClick={() => navigate({ pathname: "../walkin-details", search: slug ? `?slug=${slug}` : "" }, { state: { guestDetails, stayDetails } })}
                                className="gn-btn gn-btn--secondary px-8 py-3 text-[10px]"
                            >
                                Refine Parameters
                            </button>
                        </div>
                    ) : showRoomList ? (
                        <div className="space-y-5 pb-10">
                            {/* Header row: back-to-types + count (only in two-step mode) */}
                            {!shouldFlatten && selectedGroup && (
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <button
                                        onClick={backToRoomTypes}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.06] text-[10px] font-bold uppercase tracking-[0.2em] transition"
                                    >
                                        <ArrowLeft className="h-3.5 w-3.5" /> All Room Types
                                    </button>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-400/60">
                                        {selectedGroup.name} · {selectedGroup.rooms.length} unit{selectedGroup.rooms.length === 1 ? "" : "s"}
                                    </div>
                                </div>
                            )}

                            {/* Search by room number — only when there's enough rooms to justify it */}
                            {((shouldFlatten && availableRooms.length > 6) || (!shouldFlatten && selectedGroup && selectedGroup.rooms.length > 6)) && (
                                <input
                                    value={roomSearch}
                                    onChange={e => setRoomSearch(e.target.value)}
                                    placeholder="Find room number…"
                                    className="w-full sm:max-w-xs px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold-400/40 focus:ring-2 focus:ring-gold-400/15 transition"
                                />
                            )}

                            {roomsForList.length === 0 ? (
                                <div className="py-16 text-center text-white/40 text-sm">
                                    No rooms match "{roomSearch}".
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {roomsForList.map((room) => {
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
                        </div>
                    ) : (
                        // Step A: Room type cards. Each card = one type with
                        // available count + lowest effective price. Tap drills
                        // into the rooms of that type (Step B above).
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-10">
                            {roomGroups.map((g) => (
                                <button
                                    key={g.id}
                                    onClick={() => pickRoomType(g.id)}
                                    className="group relative flex flex-col gap-5 p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-gold-400/20 hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition-all duration-300 text-left"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="w-12 h-12 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400 ring-1 ring-gold-400/20">
                                            <Bed className="h-6 w-6" />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gold-400/60">
                                            {g.rooms.length} avail
                                        </span>
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="text-2xl font-light text-white tracking-tight">{g.name}</div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                                            From ₹{g.price.toLocaleString()} / night
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/30 pt-3 border-t border-white/5">
                                        <span>Tap to view rooms</span>
                                        <ArrowRight className="h-3 w-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition" />
                                    </div>
                                </button>
                            ))}
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
                                disabled={!selectedRoomId || !!restrictionsBlock}
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
                                                                <div className="text-sm font-light text-gold-400">
                                                                    ₹{sel.base_price.toLocaleString()}
                                                                    <span className="text-[9px] text-gold-100/40 font-normal ml-1">/ night</span>
                                                                </div>
                                                                <div className="text-[10px] text-white/50 mt-0.5">
                                                                    × {nights} night{nights === 1 ? "" : "s"} = ₹{(sel.base_price * nights).toLocaleString()}
                                                                </div>
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
                                            {!hotelTax.inclusive && hotelTax.pct > 0 && (
                                                <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-gold-100/20">
                                                    <span>Statutory Surcharge ({hotelTax.pct}%)</span>
                                                    <span className="text-white">₹{taxes.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                </div>
                                            )}
                                            {hotelTax.inclusive && (
                                                <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-gold-100/20">
                                                    <span>Tax (inclusive)</span>
                                                    <span className="text-white/40">included</span>
                                                </div>
                                            )}
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
                                        disabled={!selectedRoomId || loading || !!restrictionsBlock}
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
