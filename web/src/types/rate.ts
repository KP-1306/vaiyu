// web/src/types/rate.ts
// VAiyu Phase 1 rate management — types shared by owner screens and services.

export type MealCode = 'EP' | 'CP' | 'MAP' | 'AP';
export type ChannelScope = 'all' | 'direct' | 'ota' | 'corporate' | 'walk_in';

export interface RatePlan {
  id: string;
  hotel_id: string;
  name: string;
  plan_code: string | null;
  description: string | null;
  meal_plan: string | null;
  meal_code: MealCode | null;
  cancellation_policy: string | null;
  refundable: boolean;
  channel_scope: ChannelScope;
  priority: number;
  is_default: boolean;
  min_advance_days: number | null;
  max_advance_days: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RatePlanFormData {
  name: string;
  plan_code: string | null;
  description: string | null;
  meal_code: MealCode | null;
  cancellation_policy: string | null;
  refundable: boolean;
  channel_scope: ChannelScope;
  priority: number;
  is_default: boolean;
  min_advance_days: number | null;
  max_advance_days: number | null;
}

export interface RatePlanPrice {
  id: string;
  hotel_id: string | null;
  rate_plan_id: string;
  room_type_id: string;
  price: number;
  valid_from: string | null;
  valid_to: string | null;
  // dow_mask bits: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. 127 = every day.
  dow_mask: number;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RatePlanPriceFormData {
  rate_plan_id: string;
  room_type_id: string;
  price: number;
  valid_from: string | null;
  valid_to: string | null;
  dow_mask: number;
  priority: number;
  notes: string | null;
}

export interface RateRestriction {
  id: string;
  hotel_id: string;
  rate_plan_id: string | null;
  room_type_id: string | null;
  date: string;
  min_los: number | null;
  max_los: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  created_at: string;
  updated_at: string;
}

// UI helpers for the dow_mask bitmap.
export const DOW_LABELS: ReadonlyArray<{ bit: number; short: string; long: string }> = [
  { bit: 1 << 0, short: 'Sun', long: 'Sunday' },
  { bit: 1 << 1, short: 'Mon', long: 'Monday' },
  { bit: 1 << 2, short: 'Tue', long: 'Tuesday' },
  { bit: 1 << 3, short: 'Wed', long: 'Wednesday' },
  { bit: 1 << 4, short: 'Thu', long: 'Thursday' },
  { bit: 1 << 5, short: 'Fri', long: 'Friday' },
  { bit: 1 << 6, short: 'Sat', long: 'Saturday' },
];
export const DOW_ALL_DAYS = 127;
export const DOW_WEEKDAYS = 0b0111110; // Mon..Fri
export const DOW_WEEKENDS = 0b1000001; // Sun + Sat

export const MEAL_CODE_LABELS: Record<MealCode, string> = {
  EP: 'EP — Room only',
  CP: 'CP — Breakfast',
  MAP: 'MAP — Breakfast + 1 meal',
  AP: 'AP — All meals',
};

export const CHANNEL_SCOPE_LABELS: Record<ChannelScope, string> = {
  all: 'All channels',
  direct: 'Direct (website)',
  ota: 'OTA',
  corporate: 'Corporate',
  walk_in: 'Walk-in only',
};

// ─── Front-desk discount reasons ────────────────────────────
// Keep in sync with chk_pricing_adjustments_reason in migration 005.
export type DiscountReason =
  | 'manager_discretion'
  | 'loyalty'
  | 'service_recovery'
  | 'price_match'
  | 'corporate'
  | 'long_stay'
  | 'other';

export const DISCOUNT_REASON_LABELS: Record<DiscountReason, string> = {
  manager_discretion: 'Manager discretion',
  loyalty: 'Loyalty / repeat guest',
  service_recovery: 'Service recovery',
  price_match: 'Price match',
  corporate: 'Corporate rate',
  long_stay: 'Long-stay negotiation',
  other: 'Other',
};

// Soft cap: warn when discount percentage crosses this. Hard cap = 100%.
export const DISCOUNT_SOFT_CAP_PCT = 20;

// Helpers for restriction aggregation (used by Availability.tsx to decide
// which rooms to hide and which min-stay to enforce).
export type StayRestriction = {
  room_type_id: string;
  any_stop_sell: boolean;
  any_cta: boolean;             // closed-to-arrival on the check-in date
  max_min_los: number | null;   // largest min-LOS across all nights in stay
};
