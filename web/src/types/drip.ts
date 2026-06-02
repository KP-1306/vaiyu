// web/src/types/drip.ts
//
// Lead Drip Engine — types only. Position 2 of the growth sheet.
// Mirrors the DB schema from migration 20260526000005_lead_drip_engine.sql.

export type DripChannel = 'EMAIL' | 'WHATSAPP' | 'SMS';

export type DripTriggerEvent =
  | 'LEAD_CREATED'        // new lead, status=NEW, eligible sources
  | 'LEAD_QUOTED'         // status moved to QUOTED
  | 'LEAD_LOST_WALKIN';   // status moved to LOST, source=WALK_IN

export type DripSubStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_CHANNEL';

export type DripEventType =
  | 'SUBSCRIBED'
  | 'STEP_QUEUED'
  | 'STEP_SKIPPED'
  | 'PAUSED'
  | 'RESUMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'BOUNCED'
  | 'CAP_HIT';

/** Stock codes seeded per hotel. Custom codes allowed but uppercase-only. */
export type DripRuleCode = 'GENERAL_ENQUIRY' | 'QUOTE_SENT' | 'WALKIN_LOST' | string;

export interface DripRule {
  id: string;
  hotel_id: string;
  code: DripRuleCode;
  name: string;
  description: string;
  trigger_event: DripTriggerEvent;
  default_channel: DripChannel;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface DripStep {
  id: string;
  rule_id: string;
  step_idx: number;
  /** Absolute hours from subscription.started_at, NOT cumulative. */
  delay_hours: number;
  channel: DripChannel;
  template_code: string;
  subject_template: string;
  body_template: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadDripSubscription {
  id: string;
  hotel_id: string;
  lead_id: string;
  rule_id: string;
  status: DripSubStatus;
  /** Why the sub is paused — set when status=PAUSED. */
  paused_reason: string | null;
  started_at: string;
  last_step_idx: number;     // -1 = no steps run yet
  last_step_at: string | null;
  next_step_idx: number | null;
  next_step_due_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadDripEvent {
  id: string;
  subscription_id: string;
  hotel_id: string;
  lead_id: string;
  event_type: DripEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
  event_schema_version: number;
}

/** Combined read for a single subscription with its rule + steps. */
export interface LeadDripSubscriptionDetail {
  subscription: LeadDripSubscription;
  rule: DripRule;
  steps: DripStep[];
  nextStep: DripStep | null;
  events: LeadDripEvent[];
}

/** Placeholder tokens supported by drip templates. Operator-facing list. */
export const DRIP_PLACEHOLDERS = [
  '{{guest_name}}',
  '{{hotel_name}}',
  '{{hotel_city}}',
  '{{check_in}}',
  '{{check_out}}',
  '{{nights}}',
  '{{contact_phone}}',
] as const;

export type DripPlaceholder = typeof DRIP_PLACEHOLDERS[number];
