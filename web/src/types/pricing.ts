// web/src/types/pricing.ts
// VAiyu Pricing Module – Occupancy-Based Dynamic Pricing types

export type PricingAdjustmentType =
  | 'increase_pct'
  | 'decrease_pct'
  | 'set_fixed_price';

export type PricingScopeType = 'property' | 'room_type';

// Day of week: 0 = Sunday .. 6 = Saturday (matches JS Date.getDay()).
export type PricingDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PricingRule = {
  id: string;
  hotel_id: string;
  rule_name: string;
  active: boolean;
  scope_type: PricingScopeType;
  room_type_id: string | null;
  occupancy_min_pct: number;
  occupancy_max_pct: number | null;
  adjustment_type: PricingAdjustmentType;
  adjustment_value: number;
  min_price: number | null;
  max_price: number | null;
  priority: number;
  applicable_dow: PricingDow[] | null;
  season_start_mmdd: number | null;
  season_end_mmdd: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PricingRuleFormData = {
  rule_name: string;
  active: boolean;
  scope_type: PricingScopeType;
  room_type_id: string | null;
  occupancy_min_pct: number;
  occupancy_max_pct: number | null;
  adjustment_type: PricingAdjustmentType;
  adjustment_value: number;
  min_price: number | null;
  max_price: number | null;
  priority: number;
  applicable_dow: PricingDow[] | null;
  season_start_mmdd: number | null;
  season_end_mmdd: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
};

export type PricingChangeLog = {
  id: string;
  hotel_id: string;
  room_type_id: string | null;
  rule_id: string | null;
  previous_price: number;
  new_price: number;
  base_price_at_time: number;
  occupancy_pct_at_time: number;
  adjustment_type: string;
  adjustment_value: number;
  was_clamped: boolean;
  clamp_reason: string | null;
  matched_rule_name: string | null;
  explanation: string;
  note: string | null;
  applied_by: string;
  applied_at: string;
};

export type PricingCurrentRate = {
  id: string;
  hotel_id: string;
  room_type_id: string | null;
  base_price: number;
  override_price: number;
  rule_id: string | null;
  applied_by: string;
  applied_at: string;
  expires_at: string | null;
};

// Calendar date string in "YYYY-MM-DD" form. Timezone-free by design:
// the pricing engine operates on calendar days, not instants, so DOW,
// seasonality, and lead-time are never off-by-one due to browser tz.
export type IsoDate = string;

export type PricingEvaluationContext = {
  // Calendar date of the stay (check-in). "YYYY-MM-DD". Defaults to today (UTC).
  stayDate?: IsoDate;
  // Calendar date the evaluation is happening. "YYYY-MM-DD". Defaults to today (UTC).
  evaluationDate?: IsoDate;
  // Guardrail cap on price swings (percent of base). null | undefined = off.
  // Typically sourced from pricing_settings.max_delta_pct.
  maxDeltaPct?: number | null;
};

// Structured outcome from the pricing engine. Machine-readable; the UI layer
// renders it into localized, currency-formatted prose. Persisting the reason
// (alongside the prose `explanation`) would let future UIs re-render history
// in a different language without re-running the engine.
export type PricingClampReason = "min_price" | "max_price";

export type PricingReason =
  | { code: "no_rule_matched"; occupancy_pct: number }
  | {
      code: "rule_matched";
      rule_id: string;
      rule_name: string;
      occupancy_pct: number;
      occupancy_min_pct: number;
      occupancy_max_pct: number | null;
      adjustment_type: PricingAdjustmentType;
      adjustment_value: number;
      was_clamped: boolean;
      clamp_reason: PricingClampReason | null;
    };

// Guardrail evaluation result. `blocked` means the engine computed a
// recommendation that exceeds the configured max-delta cap; in auto-apply
// mode the caller MUST NOT write it, and UI SHOULD surface it for manual
// review. In recommend-only mode the recommendation is still shown — the
// human operator is the guardrail.
export type PricingGuardrail = {
  max_delta_pct: number | null;      // null = disabled
  actual_delta_pct: number;          // |new-base|/base*100, rounded to 2dp
  blocked: boolean;                  // true iff max_delta_pct != null && actual > cap
};

export type PricingEvaluationResult = {
  matched_rule: PricingRule | null;
  recommended_price: number;
  base_price: number;
  occupancy_pct: number;
  reason: PricingReason;
  // Human-readable explanation rendered with the default currency formatter.
  // Callers that need a different currency/locale should re-render via
  // `formatPricingExplanation(reason, basePrice, recommendedPrice, formatMoney)`.
  explanation: string;
  was_clamped: boolean;
  clamp_reason: PricingClampReason | null;
  guardrail: PricingGuardrail;
};
