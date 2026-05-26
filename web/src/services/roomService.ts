// web/src/services/roomService.ts
//
// Thin service for fetching rooms for the convert-to-booking room picker.
// Rooms RLS allows hotel members to SELECT (verified Day 9).
// Pricing lives in a separate table (pricing_current_rates) keyed by
// (hotel_id, room_type_id); we merge client-side.

import { supabase } from '../lib/supabase';
import { LeadServiceError } from './leadService';

export interface RoomForPicker {
  id: string;
  number: string;
  room_type_id: string;
  room_type_name: string;
  /** Effective per-night rate (override_price > base_price > 0). */
  default_rate: number;
}

interface RoomRow {
  id: string;
  number: string;
  room_type_id: string;
  room_types: { name: string } | null;
}

interface PriceRow {
  room_type_id: string | null;
  base_price: number;
  override_price: number;
}

export async function listRoomsForHotel(hotelId: string): Promise<RoomForPicker[]> {
  const [roomsResult, pricesResult] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, number, room_type_id, room_types(name)')
      .eq('hotel_id', hotelId)
      .order('number', { ascending: true }),
    supabase
      .from('pricing_current_rates')
      .select('room_type_id, base_price, override_price')
      .eq('hotel_id', hotelId),
  ]);

  if (roomsResult.error) {
    throw new LeadServiceError(
      'UNKNOWN_ERROR',
      roomsResult.error.message ?? 'Could not load rooms',
      null,
      null,
      roomsResult.error,
    );
  }
  if (pricesResult.error) {
    throw new LeadServiceError(
      'UNKNOWN_ERROR',
      pricesResult.error.message ?? 'Could not load pricing',
      null,
      null,
      pricesResult.error,
    );
  }

  // Build room_type_id → effective_rate map
  const rateByType = new Map<string, number>();
  for (const p of (pricesResult.data ?? []) as PriceRow[]) {
    if (!p.room_type_id) continue; // property-level rate (null room_type) ignored for room picker
    // override_price always > 0 per CHECK constraint; prefer it
    rateByType.set(p.room_type_id, p.override_price);
  }

  const rooms = (roomsResult.data ?? []) as unknown as RoomRow[];
  return rooms.map((r) => ({
    id: r.id,
    number: r.number,
    room_type_id: r.room_type_id,
    room_type_name: r.room_types?.name ?? 'Unknown type',
    default_rate: rateByType.get(r.room_type_id) ?? 0,
  }));
}
