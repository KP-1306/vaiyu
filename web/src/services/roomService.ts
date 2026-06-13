// web/src/services/roomService.ts
//
// Thin service for fetching rooms for the convert-to-booking room picker.
// Rooms RLS allows hotel members to SELECT (verified Day 9).
// Pricing is resolved via the SAME override-aware path the walk-in flow uses
// (getEffectivePrices → v_effective_room_price): per-type override →
// property-wide override → rate_plan_prices, honoring expires_at. This keeps the
// lead-convert picker quoting identically to walk-in Availability.

import { supabase } from '../lib/supabase';
import { LeadServiceError } from './leadService';
import { getEffectivePrices, type EffectivePrice } from './pricingService';

export interface RoomForPicker {
  id: string;
  number: string;
  room_type_id: string;
  room_type_name: string;
  /** Effective per-night rate from v_effective_room_price (0 when unpriced). */
  default_rate: number;
}

interface RoomRow {
  id: string;
  number: string;
  room_type_id: string;
  room_types: { name: string } | null;
}

export async function listRoomsForHotel(hotelId: string): Promise<RoomForPicker[]> {
  const roomsResult = await supabase
    .from('rooms')
    .select('id, number, room_type_id, room_types(name)')
    .eq('hotel_id', hotelId)
    .order('number', { ascending: true });

  if (roomsResult.error) {
    throw new LeadServiceError(
      'UNKNOWN_ERROR',
      roomsResult.error.message ?? 'Could not load rooms',
      null,
      null,
      roomsResult.error,
    );
  }

  const rooms = (roomsResult.data ?? []) as unknown as RoomRow[];

  // Resolve the effective per-night rate through the same override-aware path
  // walk-in Availability uses, so both flows quote identically. getEffectivePrices
  // reads v_effective_room_price: per-type override → property-wide override →
  // rate_plan_prices, honoring expires_at. Falls back to 0 only when nothing is
  // priced anywhere (picker then shows "—" and staff types the rate).
  const roomTypeIds = [
    ...new Set(rooms.map((r) => r.room_type_id).filter(Boolean)),
  ] as string[];

  let effective: Record<string, EffectivePrice>;
  try {
    effective = await getEffectivePrices(hotelId, roomTypeIds);
  } catch (err) {
    throw new LeadServiceError(
      'UNKNOWN_ERROR',
      'Could not load pricing',
      null,
      null,
      err,
    );
  }

  return rooms.map((r) => ({
    id: r.id,
    number: r.number,
    room_type_id: r.room_type_id,
    room_type_name: r.room_types?.name ?? 'Unknown type',
    default_rate: effective[r.room_type_id]?.effective_price ?? 0,
  }));
}
