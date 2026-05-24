// web/src/services/pricingService.ts
// VAiyu Pricing Module – Supabase I/O layer.
// Pure engine lives in ./pricingEngine.ts; re-exported here for back-compat.

import { supabase } from '../lib/supabase';
import type {
  PricingEvaluationResult,
  PricingRule,
  PricingRuleFormData,
} from '../types/pricing';

export {
  evaluatePricingRules,
  formatPricingExplanation,
} from './pricingEngine';

// ---------------------------------------------------------------------------
// Typed service errors
// ---------------------------------------------------------------------------
// Callers should discriminate on `.kind` to render specific UI (e.g. "rule
// deleted by another user" vs "network failed"). Wrapping preserves the
// underlying cause via `.cause` for logging without leaking it to the UI.

export type PricingServiceErrorKind =
  | 'validation'
  | 'not_found'
  | 'permission_denied'
  | 'conflict'
  | 'network'
  | 'unknown';

export class PricingServiceError extends Error {
  readonly kind: PricingServiceErrorKind;
  constructor(kind: PricingServiceErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'PricingServiceError';
    this.kind = kind;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

// Narrow a PostgREST/Supabase error into our typed union. The `code` property
// follows Postgres SQLSTATE-ish values ("PGRST116" for 0-rows, "42501" for RLS
// denial, etc.); we match the subset that matters for callers.
function wrapSupabaseError(
  err: unknown,
  fallback: PricingServiceErrorKind = 'unknown',
): PricingServiceError {
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
// Occupancy calculation
// ---------------------------------------------------------------------------

export async function getHotelOccupancy(
  hotelId: string,
): Promise<{ total: number; occupied: number; pct: number }> {
  // Stays sometimes get stuck in 'inhouse' if auto-checkout didn't run (or
  // when bookings get voided without cleaning up the stay row). Pricing math
  // should reflect *actually-occupied tonight*, not "ever set to inhouse",
  // so filter by scheduled_checkout_at >= now().
  const nowIso = new Date().toISOString();
  const [{ count: total }, { count: occupied }] = await Promise.all([
    supabase
      .from('rooms')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId),
    supabase
      .from('stays')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId)
      .in('status', ['inhouse', 'arriving'])
      .gt('scheduled_checkout_at', nowIso),
  ]);

  const t = total ?? 0;
  const o = occupied ?? 0;
  return { total: t, occupied: o, pct: t > 0 ? (o / t) * 100 : 0 };
}

// ---------------------------------------------------------------------------
// Pricing rules CRUD
// ---------------------------------------------------------------------------

export async function listPricingRules(hotelId: string): Promise<PricingRule[]> {
  // Soft-deleted rules stay in the table (pricing_change_log.rule_id FKs must
  // resolve for history) but never surface in the rules editor or evaluator.
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('hotel_id', hotelId)
    .is('deleted_at', null)
    .order('priority', { ascending: true });

  if (error) throw wrapSupabaseError(error);
  return (data ?? []) as PricingRule[];
}

export async function createPricingRule(
  hotelId: string,
  userId: string,
  form: PricingRuleFormData,
): Promise<PricingRule> {
  const { data, error } = await supabase
    .from('pricing_rules')
    .insert({ ...form, hotel_id: hotelId, created_by: userId })
    .select()
    .single();

  if (error) throw wrapSupabaseError(error, 'validation');
  return data as PricingRule;
}

export async function updatePricingRule(
  id: string,
  patch: Partial<PricingRuleFormData>,
  // When provided, the UPDATE only matches if the row's current `updated_at`
  // equals this value — a lightweight optimistic-concurrency check so two
  // admins editing the same rule can't silently clobber each other. The
  // AFTER-UPDATE trigger bumps `updated_at` to NOW(), so the returned row's
  // new `updated_at` becomes the next caller's expected value.
  expectedUpdatedAt?: string,
): Promise<PricingRule> {
  let q = supabase
    .from('pricing_rules')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null);
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt);

  const { data, error } = await q.select().maybeSingle();
  if (error) throw wrapSupabaseError(error, 'validation');
  if (!data) {
    // Zero rows matched: either the rule was edited elsewhere (stale
    // expectedUpdatedAt) or soft-deleted. Distinguish by re-reading.
    const { data: still } = await supabase
      .from('pricing_rules')
      .select('id, deleted_at')
      .eq('id', id)
      .maybeSingle();
    if (!still || still.deleted_at != null) {
      throw new PricingServiceError('not_found', 'Rule was deleted by another user.');
    }
    throw new PricingServiceError(
      'conflict',
      'Rule was edited by another user. Reload and try again.',
    );
  }
  return data as PricingRule;
}

export async function deletePricingRule(id: string): Promise<void> {
  // Soft-delete: stamp deleted_at so the rule disappears from UI but
  // pricing_change_log history remains resolvable.
  const { error } = await supabase
    .from('pricing_rules')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw wrapSupabaseError(error);
}

// ---------------------------------------------------------------------------
// Apply pricing (writes current_rates + change_log atomically-ish)
// ---------------------------------------------------------------------------

export type ApplyPricingSource = 'manual' | 'auto';

export async function applyPricing(params: {
  hotelId: string;
  evaluation: PricingEvaluationResult;
  roomTypeId?: string | null;
  note?: string | null;
  source?: ApplyPricingSource;
  // Idempotency key — if the same id is submitted again (double-click, retry
  // on network blip, etc.) the RPC returns the original log id without side
  // effects. Defaulted to a fresh UUID so even callers that forget to pass
  // one get per-call idempotency for free.
  clientRequestId?: string;
}): Promise<string> {
  const {
    hotelId,
    evaluation,
    roomTypeId = null,
    note = null,
    source = 'manual',
    clientRequestId = (globalThis.crypto ?? crypto).randomUUID(),
  } = params;

  if (!hotelId) throw new PricingServiceError('validation', 'hotelId required');
  if (!(evaluation.recommended_price > 0))
    throw new PricingServiceError('validation', 'recommended_price must be > 0');
  if (!(evaluation.base_price > 0))
    throw new PricingServiceError('validation', 'base_price must be > 0');

  const { data, error } = await supabase.rpc('apply_pricing_change', {
    p_hotel_id: hotelId,
    p_room_type_id: roomTypeId,
    p_rule_id: evaluation.matched_rule?.id ?? null,
    p_base_price: evaluation.base_price,
    p_new_price: evaluation.recommended_price,
    p_occupancy_pct: evaluation.occupancy_pct,
    p_adjustment_type: evaluation.matched_rule?.adjustment_type ?? 'set_fixed_price',
    p_adjustment_value:
      evaluation.matched_rule?.adjustment_value ?? evaluation.recommended_price,
    p_was_clamped: evaluation.was_clamped,
    p_clamp_reason: evaluation.clamp_reason,
    p_matched_rule_name: evaluation.matched_rule?.rule_name ?? null,
    p_explanation: evaluation.explanation,
    p_note: note,
    p_source: source,
    p_client_request_id: clientRequestId,
  });

  if (error) throw wrapSupabaseError(error);

  // The RPC is declared to return the new change-log row id (uuid). Validate
  // that shape at the boundary so downstream code never traffics in `any`.
  if (typeof data !== 'string' || data.length === 0) {
    throw new PricingServiceError(
      'unknown',
      'apply_pricing_change returned an unexpected payload',
      data,
    );
  }
  return data;
}

// ---------------------------------------------------------------------------
// Pricing engine settings (recommend_only / auto_apply kill-switch)
// ---------------------------------------------------------------------------

export type PricingSettings = {
  auto_apply_enabled: boolean;
  recommend_only: boolean;
  // NULL = guardrail disabled. 1..100 = max allowed |new-base|/base*100.
  max_delta_pct: number | null;
  // Server-side cap on per-room discount percentage at walk-in.
  // NULL = no cap; 1..100 = hard reject above this %.
  max_discount_pct: number | null;
};

export async function getPricingSettings(hotelId: string): Promise<PricingSettings> {
  const { data, error } = await supabase
    .from('pricing_settings')
    .select('auto_apply_enabled, recommend_only, max_delta_pct, max_discount_pct')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw wrapSupabaseError(error);
  return (
    data ?? {
      auto_apply_enabled: false,
      recommend_only: true,
      max_delta_pct: 25,
      max_discount_pct: null,
    }
  );
}

export async function upsertPricingSettings(
  hotelId: string,
  userId: string,
  patch: {
    auto_apply_enabled?: boolean;
    recommend_only?: boolean;
    // Pass `null` to explicitly disable the guardrail; omit to leave unchanged.
    max_delta_pct?: number | null;
    max_discount_pct?: number | null;
  },
): Promise<void> {
  // Read-merge-write so a partial patch (e.g. only `recommend_only`) does not
  // silently clobber the other fields.
  const current = await getPricingSettings(hotelId);
  const merged = {
    auto_apply_enabled: patch.auto_apply_enabled ?? current.auto_apply_enabled,
    recommend_only: patch.recommend_only ?? current.recommend_only,
    // Distinguish "omitted" from "explicitly null" — null is the disabled state.
    max_delta_pct:
      'max_delta_pct' in patch ? patch.max_delta_pct ?? null : current.max_delta_pct,
    max_discount_pct:
      'max_discount_pct' in patch ? patch.max_discount_pct ?? null : current.max_discount_pct,
  };

  const { error } = await supabase
    .from('pricing_settings')
    .upsert(
      {
        hotel_id: hotelId,
        ...merged,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hotel_id' },
    );
  if (error) throw wrapSupabaseError(error);
}

// ---------------------------------------------------------------------------
// Effective room price (walk-in flow)
// ---------------------------------------------------------------------------
// Reads `v_effective_room_price` — the view that resolves:
//   per-room-type override → property-wide override → MIN(rate_plan_prices).
// Used by the walk-in Availability screen so applied pricing actually
// reaches the guest. Pre-checkin / reservations flows are intentionally
// not rewired yet (see project_pricing_booking_integration memory).

export type EffectivePrice = {
  room_type_id: string;
  base_price: number;
  effective_price: number;
  is_overridden: boolean;
  rule_id: string | null;
  applied_at: string | null;
  override_scope: 'room_type' | 'property' | null;
};

export async function getEffectivePrices(
  hotelId: string,
  roomTypeIds: string[],
): Promise<Record<string, EffectivePrice>> {
  if (!hotelId || roomTypeIds.length === 0) return {};
  const { data, error } = await supabase
    .from('v_effective_room_price')
    .select(
      'room_type_id, base_price, effective_price, is_overridden, rule_id, applied_at, override_scope',
    )
    .eq('hotel_id', hotelId)
    .in('room_type_id', roomTypeIds);
  if (error) throw wrapSupabaseError(error);
  const out: Record<string, EffectivePrice> = {};
  for (const row of data ?? []) {
    out[(row as EffectivePrice).room_type_id] = {
      ...(row as EffectivePrice),
      base_price: Number((row as EffectivePrice).base_price ?? 0),
      effective_price: Number((row as EffectivePrice).effective_price ?? 0),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Room types (for rule scope selection)
// ---------------------------------------------------------------------------

export async function listRoomTypes(
  hotelId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('room_types')
    .select('id, name')
    .eq('hotel_id', hotelId)
    .order('name');

  if (error) throw wrapSupabaseError(error);
  return data ?? [];
}
