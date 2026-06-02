// web/src/services/dripService.ts
//
// Typed wrapper for the Lead Drip Engine RPCs + read queries.
// Mirrors migration 20260526000005_lead_drip_engine.sql.
//
// All writes go through SECURITY DEFINER RPCs (auth checks inside the RPC).
// Reads go straight to the tables (RLS-gated by vaiyu_is_hotel_member).
// Errors map onto DripServiceError with stable codes parseable by the UI.

import { supabase } from '../lib/supabase';
import type {
  DripRule,
  DripStep,
  LeadDripSubscription,
  LeadDripEvent,
  LeadDripSubscriptionDetail,
} from '../types/drip';

export type DripServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'HOTEL_NOT_FOUND'
  | 'RULE_NOT_FOUND'
  | 'STEP_NOT_FOUND'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'LEAD_NOT_FOUND'
  | 'REASON_REQUIRED'
  | 'SUBJECT_REQUIRED'
  | 'BODY_REQUIRED'
  | 'INVALID_DELAY'
  | 'UNKNOWN_ERROR';

const KNOWN_CODES: DripServiceErrorCode[] = [
  'NOT_AUTHORIZED', 'HOTEL_NOT_FOUND', 'RULE_NOT_FOUND', 'STEP_NOT_FOUND',
  'SUBSCRIPTION_NOT_FOUND', 'LEAD_NOT_FOUND', 'REASON_REQUIRED',
  'SUBJECT_REQUIRED', 'BODY_REQUIRED', 'INVALID_DELAY',
];

export class DripServiceError extends Error {
  code: DripServiceErrorCode;
  constructor(code: DripServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'DripServiceError';
  }
}

function parseErr(err: unknown): DripServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m?.[1] && (KNOWN_CODES as string[]).includes(m[1])) {
      return new DripServiceError(m[1] as DripServiceErrorCode, msg);
    }
    return new DripServiceError('UNKNOWN_ERROR', msg);
  }
  return new DripServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Rules + Steps (manager-editable) ─────────────────────────────────────

export async function listDripRules(hotelId: string): Promise<DripRule[]> {
  const { data, error } = await supabase
    .from('drip_rules')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('code', { ascending: true });
  if (error) throw parseErr(error);
  return (data ?? []) as DripRule[];
}

export async function listDripSteps(ruleId: string): Promise<DripStep[]> {
  const { data, error } = await supabase
    .from('drip_steps')
    .select('*')
    .eq('rule_id', ruleId)
    .order('step_idx', { ascending: true });
  if (error) throw parseErr(error);
  return (data ?? []) as DripStep[];
}

export interface UpdateDripStepInput {
  stepId: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  delayHours?: number;
  active?: boolean;
}

export async function updateDripStepTemplate(input: UpdateDripStepInput): Promise<void> {
  const { error } = await supabase.rpc('update_drip_step_template', {
    p_step_id: input.stepId,
    p_subject_template: input.subjectTemplate ?? null,
    p_body_template: input.bodyTemplate ?? null,
    p_delay_hours: input.delayHours ?? null,
    p_active: input.active ?? null,
  });
  if (error) throw parseErr(error);
}

export async function setDripRuleActive(ruleId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_drip_rule_active', {
    p_rule_id: ruleId,
    p_active: active,
  });
  if (error) throw parseErr(error);
}

export async function seedDefaultDripRules(hotelId: string): Promise<{ rules_created: number }> {
  const { data, error } = await supabase.rpc('seed_default_drip_rules', { p_hotel_id: hotelId });
  if (error) throw parseErr(error);
  const obj = (data ?? {}) as { rules_created?: number };
  return { rules_created: obj.rules_created ?? 0 };
}

// ─── Subscriptions (per-lead) ─────────────────────────────────────────────

export async function listSubscriptionsForLead(leadId: string): Promise<LeadDripSubscription[]> {
  const { data, error } = await supabase
    .from('lead_drip_subscriptions')
    .select('*')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false });
  if (error) throw parseErr(error);
  return (data ?? []) as LeadDripSubscription[];
}

export async function listSubscriptionsForHotel(
  hotelId: string,
  options: { status?: LeadDripSubscription['status'][]; limit?: number } = {},
): Promise<LeadDripSubscription[]> {
  let q = supabase
    .from('lead_drip_subscriptions')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('next_step_due_at', { ascending: true, nullsFirst: false })
    .limit(options.limit ?? 100);
  if (options.status && options.status.length > 0) {
    q = q.in('status', options.status);
  }
  const { data, error } = await q;
  if (error) throw parseErr(error);
  return (data ?? []) as LeadDripSubscription[];
}

export async function subscribeLeadToDrip(
  leadId: string,
  ruleCode: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('subscribe_lead_to_drip', {
    p_lead_id: leadId,
    p_rule_code: ruleCode,
    p_started_at: null,
  });
  if (error) throw parseErr(error);
  return (data as string | null) ?? null;
}

export async function pauseLeadDrip(subscriptionId: string, reason = 'MANUAL'): Promise<void> {
  const { error } = await supabase.rpc('pause_lead_drip', {
    p_subscription_id: subscriptionId,
    p_reason: reason,
  });
  if (error) throw parseErr(error);
}

export async function resumeLeadDrip(subscriptionId: string): Promise<void> {
  const { error } = await supabase.rpc('resume_lead_drip', {
    p_subscription_id: subscriptionId,
  });
  if (error) throw parseErr(error);
}

export async function cancelLeadDrip(subscriptionId: string, reason = 'MANUAL'): Promise<void> {
  const { error } = await supabase.rpc('cancel_lead_drip', {
    p_subscription_id: subscriptionId,
    p_reason: reason,
  });
  if (error) throw parseErr(error);
}

// ─── Events (timeline) ────────────────────────────────────────────────────

export async function listDripEventsForSubscription(
  subscriptionId: string,
  limit = 50,
): Promise<LeadDripEvent[]> {
  const { data, error } = await supabase
    .from('lead_drip_events')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw parseErr(error);
  return (data ?? []) as LeadDripEvent[];
}

// ─── Composite read: one lead's drip state ────────────────────────────────

export async function getLeadDripDetail(
  leadId: string,
  ruleId: string,
): Promise<LeadDripSubscriptionDetail | null> {
  const [subRes, ruleRes, stepsRes] = await Promise.all([
    supabase
      .from('lead_drip_subscriptions')
      .select('*')
      .eq('lead_id', leadId)
      .eq('rule_id', ruleId)
      .maybeSingle(),
    supabase.from('drip_rules').select('*').eq('id', ruleId).maybeSingle(),
    supabase.from('drip_steps').select('*').eq('rule_id', ruleId).order('step_idx', { ascending: true }),
  ]);
  if (subRes.error) throw parseErr(subRes.error);
  if (ruleRes.error) throw parseErr(ruleRes.error);
  if (stepsRes.error) throw parseErr(stepsRes.error);

  if (!subRes.data || !ruleRes.data) return null;
  const sub = subRes.data as LeadDripSubscription;
  const steps = (stepsRes.data ?? []) as DripStep[];
  const nextStep =
    sub.next_step_idx != null ? steps.find((s) => s.step_idx === sub.next_step_idx) ?? null : null;

  const evRes = await supabase
    .from('lead_drip_events')
    .select('*')
    .eq('subscription_id', sub.id)
    .order('occurred_at', { ascending: false })
    .limit(50);
  if (evRes.error) throw parseErr(evRes.error);

  return {
    subscription: sub,
    rule: ruleRes.data as DripRule,
    steps,
    nextStep,
    events: (evRes.data ?? []) as LeadDripEvent[],
  };
}
