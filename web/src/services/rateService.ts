// web/src/services/rateService.ts
// VAiyu Phase 1 rate management — Supabase I/O for rate plans, plan prices,
// and restrictions. Keeps the same error-wrapping discipline as pricingService.

import { supabase } from '../lib/supabase';
import { PricingServiceError } from './pricingService';
import type {
  RatePlan,
  RatePlanFormData,
  RatePlanPrice,
  RatePlanPriceFormData,
  RateRestriction,
  StayRestriction,
} from '../types/rate';

// Same shape as pricingService.wrapSupabaseError — duplicated here to avoid
// exporting internal helpers. If the logic diverges this is where to tweak.
function wrap(err: unknown, fallback: 'unknown' | 'validation' = 'unknown'): PricingServiceError {
  if (err instanceof PricingServiceError) return err;
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? 'Unexpected error';
  if (e?.code === 'PGRST116') return new PricingServiceError('not_found', msg, err);
  if (e?.code === '42501') return new PricingServiceError('permission_denied', msg, err);
  if (e?.code === '23505' || e?.code === '40001')
    return new PricingServiceError('conflict', msg, err);
  if (typeof msg === 'string' && /network|fetch/i.test(msg))
    return new PricingServiceError('network', msg, err);
  return new PricingServiceError(fallback, msg, err);
}

// ---------------------------------------------------------------------------
// Rate plans
// ---------------------------------------------------------------------------

export async function listRatePlans(hotelId: string): Promise<RatePlan[]> {
  const { data, error } = await supabase
    .from('rate_plans')
    .select(
      'id, hotel_id, name, plan_code, description, meal_plan, meal_code, cancellation_policy, refundable, channel_scope, priority, is_default, min_advance_days, max_advance_days, deleted_at, created_at, updated_at',
    )
    .eq('hotel_id', hotelId)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('priority', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw wrap(error);
  return (data ?? []) as RatePlan[];
}

export async function createRatePlan(
  hotelId: string,
  form: RatePlanFormData,
): Promise<RatePlan> {
  const payload = { ...form, hotel_id: hotelId };
  // If the new plan is marked default, clear default on any existing plan.
  if (form.is_default) await clearDefaultFlag(hotelId);

  const { data, error } = await supabase
    .from('rate_plans')
    .insert(payload)
    .select()
    .single();
  if (error) throw wrap(error, 'validation');
  return data as RatePlan;
}

export async function updateRatePlan(
  id: string,
  hotelId: string,
  patch: Partial<RatePlanFormData>,
  expectedUpdatedAt?: string,
): Promise<RatePlan> {
  if (patch.is_default === true) await clearDefaultFlag(hotelId, id);

  let q = supabase.from('rate_plans').update(patch).eq('id', id).is('deleted_at', null);
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt);

  const { data, error } = await q.select().maybeSingle();
  if (error) throw wrap(error, 'validation');
  if (!data) {
    // Distinguish deleted vs stale, same pattern as pricingService.updatePricingRule.
    const { data: still } = await supabase
      .from('rate_plans')
      .select('id, deleted_at')
      .eq('id', id)
      .maybeSingle();
    if (!still || still.deleted_at != null) {
      throw new PricingServiceError('not_found', 'Rate plan was deleted by another user.');
    }
    throw new PricingServiceError(
      'conflict',
      'Rate plan was edited by another user. Reload and try again.',
    );
  }
  return data as RatePlan;
}

export async function deleteRatePlan(id: string): Promise<void> {
  const { error } = await supabase
    .from('rate_plans')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw wrap(error);
}

// Only one plan per hotel can carry the is_default flag. This helper is called
// before setting the flag on another plan so we don't end up with two.
async function clearDefaultFlag(hotelId: string, exceptId?: string): Promise<void> {
  let q = supabase
    .from('rate_plans')
    .update({ is_default: false })
    .eq('hotel_id', hotelId)
    .eq('is_default', true);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw wrap(error);
}

// Create a rate plan and its initial per-room-type prices in one shot.
// Used by the "first plan" / default-plan setup flow so owners don't have
// to flip between two screens to get usable pricing live.
//
// Not a true DB transaction (Supabase JS doesn't expose multi-statement txns
// cheanly). If a price insert fails after the plan is created, we soft-delete
// the plan to keep the side-effect contained — the user sees one error and
// is back to a clean slate.
export async function createRatePlanWithPrices(
  hotelId: string,
  form: RatePlanFormData,
  prices: Array<{ room_type_id: string; price: number }>,
): Promise<RatePlan> {
  const plan = await createRatePlan(hotelId, form);
  if (prices.length === 0) return plan;

  const rows = prices
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .map((p) => ({
      hotel_id: hotelId,
      rate_plan_id: plan.id,
      room_type_id: p.room_type_id,
      price: p.price,
      valid_from: null,
      valid_to: null,
      dow_mask: 127,
      priority: 100,
      notes: null,
    }));

  if (rows.length === 0) return plan;

  const { error } = await supabase.from('rate_plan_prices').insert(rows);
  if (error) {
    // Roll back the plan so the owner sees a clean state instead of a plan
    // with partial / no prices.
    await supabase
      .from('rate_plans')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', plan.id);
    throw wrap(error, 'validation');
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Rate plan prices (per plan × room-type × date/dow)
// ---------------------------------------------------------------------------

export async function listPlanPrices(
  hotelId: string,
  ratePlanId: string,
): Promise<RatePlanPrice[]> {
  const { data, error } = await supabase
    .from('rate_plan_prices')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('rate_plan_id', ratePlanId)
    .order('room_type_id', { ascending: true })
    .order('priority', { ascending: false })
    .order('valid_from', { ascending: true, nullsFirst: true });
  if (error) throw wrap(error);
  return (data ?? []) as RatePlanPrice[];
}

export async function upsertPlanPrice(
  hotelId: string,
  form: RatePlanPriceFormData & { id?: string },
): Promise<RatePlanPrice> {
  const payload = { ...form, hotel_id: hotelId };
  if (form.id) {
    const { data, error } = await supabase
      .from('rate_plan_prices')
      .update(payload)
      .eq('id', form.id)
      .select()
      .single();
    if (error) throw wrap(error, 'validation');
    return data as RatePlanPrice;
  }
  const { data, error } = await supabase
    .from('rate_plan_prices')
    .insert(payload)
    .select()
    .single();
  if (error) throw wrap(error, 'validation');
  return data as RatePlanPrice;
}

export async function deletePlanPrice(id: string): Promise<void> {
  const { error } = await supabase.from('rate_plan_prices').delete().eq('id', id);
  if (error) throw wrap(error);
}

// ---------------------------------------------------------------------------
// Rate restrictions (MinLOS, CTA, CTD, stop-sell per date)
// ---------------------------------------------------------------------------

export async function listRestrictions(
  hotelId: string,
  fromDate: string,
  toDate: string,
): Promise<RateRestriction[]> {
  const { data, error } = await supabase
    .from('rate_restrictions')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });
  if (error) throw wrap(error);
  return (data ?? []) as RateRestriction[];
}

export async function upsertRestriction(
  hotelId: string,
  patch: Partial<RateRestriction> & { date: string },
): Promise<RateRestriction> {
  const payload = { ...patch, hotel_id: hotelId };
  // Unique index is (hotel, plan, room_type, date) with NULL coalesced to a
  // sentinel UUID, so we need an explicit conflict target — use `id` path.
  if (patch.id) {
    const { data, error } = await supabase
      .from('rate_restrictions')
      .update(payload)
      .eq('id', patch.id)
      .select()
      .single();
    if (error) throw wrap(error, 'validation');
    return data as RateRestriction;
  }
  const { data, error } = await supabase
    .from('rate_restrictions')
    .insert(payload)
    .select()
    .single();
  if (error) throw wrap(error, 'validation');
  return data as RateRestriction;
}

export async function deleteRestriction(id: string): Promise<void> {
  const { error } = await supabase.from('rate_restrictions').delete().eq('id', id);
  if (error) throw wrap(error);
}

// ---------------------------------------------------------------------------
// Permissions: who can grant a front-desk discount?
// ---------------------------------------------------------------------------
// Reuses the existing finance-manager RBAC helper. Same role gate as the
// pricing dashboard / pricing-rule editor — discount-granting is a
// financial decision that finance/manager roles already own.
//
// The server enforces this independently inside create_walkin_v2 (defence
// in depth — the UI hides the field, but a determined client could still
// submit a request without it).

export async function canGrantDiscount(hotelId: string): Promise<boolean> {
  if (!hotelId) return false;
  const { data, error } = await supabase.rpc('vaiyu_is_hotel_finance_manager', {
    p_hotel_id: hotelId,
  });
  if (error) {
    // Fail closed: an authorization check that errors should deny, not allow.
    return false;
  }
  return data === true;
}

// ---------------------------------------------------------------------------
// CTD check (used by checkout flows)
// ---------------------------------------------------------------------------

export async function isClosedToDeparture(
  hotelId: string,
  roomTypeId: string | null,
  dateIso: string,
): Promise<boolean> {
  if (!hotelId || !dateIso) return false;
  const { data, error } = await supabase.rpc('is_closed_to_departure', {
    p_hotel_id: hotelId,
    p_room_type_id: roomTypeId,
    p_date: dateIso,
  });
  if (error) return false;
  return data === true;
}

// ---------------------------------------------------------------------------
// Discount reporting (pricing_adjustments → dashboard summary)
// ---------------------------------------------------------------------------
// Aggregates the current month's discounts for the OwnerPricing dashboard
// card. Returns total ₹ given, count, and a per-reason breakdown that the
// finance team uses to spot patterns ("why is service_recovery so high?").

export type DiscountSummary = {
  total_amount: number;
  count: number;
  by_reason: Array<{ reason_code: string; amount: number; count: number }>;
};

export async function getMonthlyDiscountSummary(
  hotelId: string,
  monthIso: string, // 'YYYY-MM'
): Promise<DiscountSummary> {
  const startIso = `${monthIso}-01T00:00:00Z`;
  // Compute first-of-next-month for an exclusive upper bound.
  const [y, m] = monthIso.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const endIso = next.toISOString();

  const { data, error } = await supabase
    .from('pricing_adjustments')
    .select('reason_code, total_discount')
    .eq('hotel_id', hotelId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw wrap(error);

  const rows = (data ?? []) as Array<{ reason_code: string; total_discount: number }>;
  let total = 0;
  const byReason = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    const amt = Number(r.total_discount ?? 0);
    total += amt;
    const bucket = byReason.get(r.reason_code) ?? { amount: 0, count: 0 };
    bucket.amount += amt;
    bucket.count += 1;
    byReason.set(r.reason_code, bucket);
  }
  return {
    total_amount: total,
    count: rows.length,
    by_reason: Array.from(byReason.entries())
      .map(([reason_code, v]) => ({ reason_code, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ---------------------------------------------------------------------------
// Stay-level restriction aggregation (Availability walk-in enforcement)
// ---------------------------------------------------------------------------
// Aggregates `rate_restrictions` rows for every night in the stay window and
// returns one entry per room_type_id touched by any restriction in that
// window. Consumers (Availability.tsx) use it to (a) hide stop-sell room
// types, (b) block check-in when stay length < min_los on the check-in date.
//
// Scope rules:
//   • room_type_id NULL on a restriction row = applies to ALL room types.
//   • min_los is taken from the check-in date only (standard hotel behavior —
//     "stay this many nights if you ARRIVE this day"). Stop-sell/CTA are
//     aggregated across the whole stay because a mid-stay block also makes
//     the room unserviceable.

export async function listRestrictionsForStay(
  hotelId: string,
  checkinDate: string,
  checkoutDate: string,
  allRoomTypeIds: string[],
): Promise<Record<string, StayRestriction>> {
  if (!hotelId || allRoomTypeIds.length === 0) return {};

  // Fetch every restriction row touching the date range (inclusive of
  // check-in, exclusive of checkout — matches hotel "nights" convention).
  const { data, error } = await supabase
    .from('rate_restrictions')
    .select(
      'room_type_id, date, min_los, closed_to_arrival, closed_to_departure, stop_sell',
    )
    .eq('hotel_id', hotelId)
    .gte('date', checkinDate)
    .lt('date', checkoutDate);
  if (error) throw wrap(error);

  // Seed every requested room type with a clean record.
  const out: Record<string, StayRestriction> = {};
  for (const rtId of allRoomTypeIds) {
    out[rtId] = {
      room_type_id: rtId,
      any_stop_sell: false,
      any_cta: false,
      max_min_los: null,
    };
  }

  for (const row of data ?? []) {
    // Null room_type_id = applies to every room type at this hotel.
    const targets = row.room_type_id ? [row.room_type_id] : allRoomTypeIds;
    for (const rtId of targets) {
      const bucket = out[rtId];
      if (!bucket) continue;

      if (row.stop_sell) bucket.any_stop_sell = true;

      // CTA and min_los are only meaningful on the check-in date.
      if (row.date === checkinDate) {
        if (row.closed_to_arrival) bucket.any_cta = true;
        if (row.min_los != null) {
          bucket.max_min_los = Math.max(bucket.max_min_los ?? 0, row.min_los);
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Date-aware effective price (calls the SQL function directly)
// ---------------------------------------------------------------------------

export async function getEffectivePriceForDate(
  hotelId: string,
  roomTypeId: string,
  date: string,
): Promise<{
  base_price: number | null;
  effective_price: number | null;
  is_overridden: boolean;
  rule_id: string | null;
  applied_at: string | null;
  override_scope: string | null;
  rate_plan_id: string | null;
  rate_plan_name: string | null;
}> {
  const { data, error } = await supabase.rpc('get_effective_room_price', {
    p_hotel_id: hotelId,
    p_room_type_id: roomTypeId,
    p_date: date,
  });
  if (error) throw wrap(error);
  const row = (data ?? [])[0] ?? null;
  return (
    row ?? {
      base_price: null,
      effective_price: null,
      is_overridden: false,
      rule_id: null,
      applied_at: null,
      override_scope: null,
      rate_plan_id: null,
      rate_plan_name: null,
    }
  );
}
