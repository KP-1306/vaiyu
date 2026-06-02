// web/src/services/partnerService.ts
//
// Typed wrapper for Partner Network RPCs + v_partner_directory view reads.
// Mirrors migration 20260526000007_partner_network.sql.

import { supabase } from '../lib/supabase';
import type {
  Partner,
  PartnerDirectoryRow,
  PartnerEvent,
  PartnerCommission,
  PartnerKind,
  PartnerCategory,
  PartnerStatus,
  PartnerVerificationStatus,
} from '../types/partner';

export type PartnerServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'PARTNER_NOT_FOUND'
  | 'LEAD_NOT_FOUND'
  | 'BOOKING_HOTEL_MISMATCH'
  | 'LEAD_HOTEL_MISMATCH'
  | 'PARTNER_HOTEL_MISMATCH'
  | 'NAME_REQUIRED'
  | 'INVALID_KIND'
  | 'INVALID_CATEGORY'
  | 'INVALID_EMAIL'
  | 'INVALID_STATUS'
  | 'INVALID_VERIFICATION_STATUS'
  | 'INVALID_AMOUNT'
  | 'INVALID_COMMISSION_PCT'
  | 'VENDOR_NO_COMMISSION'
  | 'TARGET_REQUIRED'
  | 'COMMISSION_REQUIRES_AGENT_KIND'
  | 'REASON_REQUIRED'
  | 'REASON_REQUIRED_FOR_DO_NOT_USE'
  | 'ARCHIVED_NOT_EDITABLE'
  | 'CANNOT_CANCEL_PAID'
  | 'COMMISSION_CANCELLED'
  | 'COMMISSION_NOT_FOUND'
  | 'PAYOUT_REFERENCE_REQUIRED'
  | 'IDEMPOTENCY_KEY_MISMATCH'
  | 'UNKNOWN_ERROR';

const KNOWN_CODES: PartnerServiceErrorCode[] = [
  'NOT_AUTHORIZED', 'PARTNER_NOT_FOUND', 'LEAD_NOT_FOUND',
  'BOOKING_HOTEL_MISMATCH', 'LEAD_HOTEL_MISMATCH', 'PARTNER_HOTEL_MISMATCH',
  'NAME_REQUIRED', 'INVALID_KIND', 'INVALID_CATEGORY', 'INVALID_EMAIL',
  'INVALID_STATUS', 'INVALID_VERIFICATION_STATUS', 'INVALID_AMOUNT',
  'INVALID_COMMISSION_PCT', 'VENDOR_NO_COMMISSION', 'TARGET_REQUIRED',
  'COMMISSION_REQUIRES_AGENT_KIND', 'REASON_REQUIRED',
  'REASON_REQUIRED_FOR_DO_NOT_USE', 'ARCHIVED_NOT_EDITABLE',
  'CANNOT_CANCEL_PAID', 'COMMISSION_CANCELLED', 'COMMISSION_NOT_FOUND',
  'PAYOUT_REFERENCE_REQUIRED', 'IDEMPOTENCY_KEY_MISMATCH',
];

export class PartnerServiceError extends Error {
  code: PartnerServiceErrorCode;
  constructor(code: PartnerServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PartnerServiceError';
  }
}

function parseErr(err: unknown): PartnerServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m?.[1] && (KNOWN_CODES as string[]).includes(m[1])) {
      return new PartnerServiceError(m[1] as PartnerServiceErrorCode, msg);
    }
    return new PartnerServiceError('UNKNOWN_ERROR', msg);
  }
  return new PartnerServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Reads ────────────────────────────────────────────────────────────────

export interface ListPartnersOptions {
  kinds?: PartnerKind[];
  categories?: PartnerCategory[];
  statuses?: PartnerStatus[];
  verificationStatuses?: PartnerVerificationStatus[];
  includeArchived?: boolean;
  search?: string;       // matches name + service_area via ilike OR
  limit?: number;
}

export async function listPartners(
  hotelId: string,
  options: ListPartnersOptions = {},
): Promise<PartnerDirectoryRow[]> {
  let q = supabase
    .from('v_partner_directory')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 200);

  if (!options.includeArchived) q = q.eq('is_archived', false);
  if (options.kinds && options.kinds.length > 0)         q = q.in('kind', options.kinds);
  if (options.categories && options.categories.length > 0) q = q.in('category', options.categories);
  if (options.statuses && options.statuses.length > 0)   q = q.in('status', options.statuses);
  if (options.verificationStatuses && options.verificationStatuses.length > 0)
    q = q.in('verification_status', options.verificationStatuses);
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim().replace(/[%_]/g, '')}%`;
    q = q.or(`partner_name.ilike.${term},service_area.ilike.${term}`);
  }

  const { data, error } = await q;
  if (error) throw parseErr(error);
  return (data ?? []) as PartnerDirectoryRow[];
}

export async function getPartner(id: string): Promise<PartnerDirectoryRow | null> {
  const { data, error } = await supabase
    .from('v_partner_directory')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw parseErr(error);
  return (data as PartnerDirectoryRow | null) ?? null;
}

export async function listPartnerEvents(
  partnerId: string,
  limit = 100,
): Promise<PartnerEvent[]> {
  const { data, error } = await supabase
    .from('partner_events')
    .select('*')
    .eq('partner_id', partnerId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw parseErr(error);
  return (data ?? []) as PartnerEvent[];
}

export async function listPartnerCommissions(
  partnerId: string,
): Promise<PartnerCommission[]> {
  const { data, error } = await supabase
    .from('partner_commissions')
    .select('*')
    .eq('partner_id', partnerId)
    .order('accrued_at', { ascending: false });
  if (error) throw parseErr(error);
  return (data ?? []) as PartnerCommission[];
}

export async function listHotelCommissions(
  hotelId: string,
  status?: PartnerCommission['status'],
): Promise<PartnerCommission[]> {
  let q = supabase
    .from('partner_commissions')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('accrued_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw parseErr(error);
  return (data ?? []) as PartnerCommission[];
}

// ─── Mutations ────────────────────────────────────────────────────────────

export interface CreatePartnerInput {
  hotelId: string;
  partnerName: string;
  kind: PartnerKind;
  category: PartnerCategory;
  serviceArea?: string;
  servicesOffered?: string[];
  preferredUseCase?: string;
  priceNoteText?: string;
  emergencyAvailability?: boolean;
  contactName?: string;
  contactPhone?: string | null;
  alternateContact?: string | null;
  email?: string | null;
  notes?: string;
  tags?: string[];
  /** AGENT only — server rejects if kind=VENDOR. */
  commissionPct?: number | null;
  /** AGENT only. */
  payoutTerms?: string | null;
}

export async function createPartner(input: CreatePartnerInput): Promise<{ id: string; status: PartnerStatus }> {
  const { data, error } = await supabase.rpc('create_partner', {
    p_hotel_id: input.hotelId,
    p_partner_name: input.partnerName,
    p_kind: input.kind,
    p_category: input.category,
    p_service_area: input.serviceArea ?? '',
    p_services_offered: input.servicesOffered ?? [],
    p_preferred_use_case: input.preferredUseCase ?? '',
    p_price_note_text: input.priceNoteText ?? '',
    p_emergency_availability: input.emergencyAvailability ?? false,
    p_contact_name: input.contactName ?? '',
    p_contact_phone: input.contactPhone ?? null,
    p_alternate_contact: input.alternateContact ?? null,
    p_email: input.email ?? null,
    p_notes: input.notes ?? '',
    p_tags: input.tags ?? [],
    p_commission_pct: input.commissionPct ?? null,
    p_payout_terms: input.payoutTerms ?? null,
  });
  if (error) throw parseErr(error);
  const obj = (data ?? {}) as { id?: string; status?: PartnerStatus };
  if (!obj.id) throw new PartnerServiceError('UNKNOWN_ERROR', 'No id returned');
  return { id: obj.id, status: obj.status ?? 'DRAFT' };
}

export interface UpdatePartnerInput {
  id: string;
  partnerName?: string;
  category?: PartnerCategory;
  serviceArea?: string;
  servicesOffered?: string[];
  preferredUseCase?: string;
  priceNoteText?: string;
  emergencyAvailability?: boolean;
  contactName?: string;
  contactPhone?: string | null;
  alternateContact?: string | null;
  email?: string | null;
  notes?: string;
  tags?: string[];
  commissionPct?: number | null;
  payoutTerms?: string | null;
  /** Force-clear commission fields (overrides commissionPct/payoutTerms). */
  clearCommission?: boolean;
}

export async function updatePartner(input: UpdatePartnerInput): Promise<void> {
  const { error } = await supabase.rpc('update_partner', {
    p_id: input.id,
    p_partner_name: input.partnerName ?? null,
    p_category: input.category ?? null,
    p_service_area: input.serviceArea ?? null,
    p_services_offered: input.servicesOffered ?? null,
    p_preferred_use_case: input.preferredUseCase ?? null,
    p_price_note_text: input.priceNoteText ?? null,
    p_emergency_availability: input.emergencyAvailability ?? null,
    p_contact_name: input.contactName ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_alternate_contact: input.alternateContact ?? null,
    p_email: input.email ?? null,
    p_notes: input.notes ?? null,
    p_tags: input.tags ?? null,
    p_commission_pct: input.commissionPct ?? null,
    p_payout_terms: input.payoutTerms ?? null,
    p_clear_commission: input.clearCommission ?? false,
  });
  if (error) throw parseErr(error);
}

export async function setPartnerStatus(
  id: string,
  status: PartnerStatus,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_partner_status', {
    p_id: id,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw parseErr(error);
}

export async function setPartnerVerification(
  id: string,
  status: PartnerVerificationStatus,
  notes?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_partner_verification', {
    p_id: id,
    p_status: status,
    p_notes: notes ?? null,
  });
  if (error) throw parseErr(error);
}

export async function archivePartner(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('archive_partner', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parseErr(error);
}

export async function unarchivePartner(id: string): Promise<void> {
  const { error } = await supabase.rpc('unarchive_partner', { p_id: id });
  if (error) throw parseErr(error);
}

export async function linkLeadPartner(leadId: string, partnerId: string | null): Promise<void> {
  const { error } = await supabase.rpc('link_lead_partner', {
    p_lead_id: leadId,
    p_partner_id: partnerId,
  });
  if (error) throw parseErr(error);
}

// ─── Commissions (AGENT only) ─────────────────────────────────────────────

export interface RecordCommissionInput {
  partnerId: string;
  amountInr: number;
  leadId?: string | null;
  bookingId?: string | null;
  notes?: string;
  /** UUID v4 per "Record commission" click. Same key returns existing row. */
  idempotencyKey?: string;
}

export async function recordPartnerCommission(
  input: RecordCommissionInput,
): Promise<{ id: string; status: 'ACCRUED' | 'PAID' | 'CANCELLED'; idempotentHit: boolean }> {
  const { data, error } = await supabase.rpc('record_partner_commission', {
    p_partner_id: input.partnerId,
    p_amount_inr: input.amountInr,
    p_lead_id: input.leadId ?? null,
    p_booking_id: input.bookingId ?? null,
    p_notes: input.notes ?? '',
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw parseErr(error);
  const obj = (data ?? {}) as { id?: string; status?: 'ACCRUED' | 'PAID' | 'CANCELLED'; idempotent_hit?: boolean };
  if (!obj.id) throw new PartnerServiceError('UNKNOWN_ERROR', 'No id returned');
  return {
    id: obj.id,
    status: obj.status ?? 'ACCRUED',
    idempotentHit: !!obj.idempotent_hit,
  };
}

export interface MarkCommissionPaidInput {
  id: string;
  payoutReference: string;
  payoutMethod?: string;
  paidAt?: string;  // ISO; defaults to now() server-side
}

export async function markCommissionPaid(input: MarkCommissionPaidInput): Promise<void> {
  const { error } = await supabase.rpc('mark_commission_paid', {
    p_id: input.id,
    p_payout_reference: input.payoutReference,
    p_payout_method: input.payoutMethod ?? null,
    p_paid_at: input.paidAt ?? null,
  });
  if (error) throw parseErr(error);
}

export async function cancelCommission(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_commission', {
    p_id: id,
    p_reason: reason,
  });
  if (error) throw parseErr(error);
}
