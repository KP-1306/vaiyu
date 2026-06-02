// web/src/services/gbpChecklistService.ts
//
// Typed wrappers around Google Business Checklist RPCs + RLS-scoped reads.

import { supabase } from '../lib/supabase';
import {
  GBPServiceError,
  type GBPAttestationRow,
  type GBPAttestationState,
  type GBPReadinessRow,
  type GBPServiceErrorCode,
} from '../types/gbpChecklist';

// ── Error mapping ───────────────────────────────────────────────────────────

const KNOWN_CODES: GBPServiceErrorCode[] = [
  'NOT_A_MEMBER',
  'NOT_A_MANAGER',
  'INVALID_STATE',
  'USE_MANAGER_VERIFY_RPC',
  'INVALID_ITEM_KEY',
  'ITEM_KEY_NOT_IN_CATALOG',
  'ITEM_NOT_SELF_ATTESTABLE',
  'EVIDENCE_URL_TOO_LONG',
  'NOTE_TOO_LONG',
  'NOTHING_TO_VERIFY',
  'NOTHING_TO_UNVERIFY',
  'ATTESTATION_LOCKED',
  'REASON_REQUIRED',
  'REASON_TOO_LONG',
];

export function extractGBPErrorCode(err: unknown): GBPServiceErrorCode | null {
  if (!err || typeof err !== 'object' || !('message' in err)) return null;
  const msg = String((err as { message?: string }).message ?? '');
  const code = KNOWN_CODES.find((c) => msg.includes(c));
  return code ?? null;
}

function parseError(err: unknown): GBPServiceError {
  const code = extractGBPErrorCode(err) ?? 'UNKNOWN_ERROR';
  const msg = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: string }).message ?? '')
    : 'Unknown error';
  return new GBPServiceError(code, msg);
}

export function friendlyGBPError(code: GBPServiceErrorCode | null, fallback: string): string {
  switch (code) {
    case 'NOT_A_MEMBER':
      return 'You do not have permission for this action.';
    case 'NOT_A_MANAGER':
      return 'Only the hotel owner or manager can verify this.';
    case 'INVALID_STATE':
      return 'Invalid attestation state.';
    case 'USE_MANAGER_VERIFY_RPC':
      return 'Use the manager verify action instead.';
    case 'INVALID_ITEM_KEY':
      return 'Invalid checklist item key.';
    case 'ITEM_KEY_NOT_IN_CATALOG':
      return 'This checklist item no longer exists. Refresh the page.';
    case 'ITEM_NOT_SELF_ATTESTABLE':
      return 'This item is read-only — it cannot be manually attested. (Auto-detected or linked to another module.)';
    case 'EVIDENCE_URL_TOO_LONG':
      return 'Evidence URL is too long (max 2048 characters).';
    case 'NOTE_TOO_LONG':
      return 'Manager note is too long (max 1000 characters).';
    case 'NOTHING_TO_VERIFY':
      return 'Owner must self-attest before manager verification.';
    case 'NOTHING_TO_UNVERIFY':
      return 'This item is not verified yet — nothing to unverify.';
    case 'ATTESTATION_LOCKED':
      return 'Only the manager who verified this can unverify it.';
    case 'REASON_REQUIRED':
      return 'A reason is required to unverify.';
    case 'REASON_TOO_LONG':
      return 'Reason is too long (max 1000 characters).';
    case 'UNKNOWN_ERROR':
    case null:
    default:
      return fallback;
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listGBPAttestations(hotelId: string): Promise<GBPAttestationRow[]> {
  const { data, error } = await supabase
    .from('gbp_checklist_attestations')
    .select('*')
    .eq('hotel_id', hotelId);
  if (error) throw parseError(error);
  return (data ?? []) as GBPAttestationRow[];
}

export async function getGBPReadiness(hotelId: string): Promise<GBPReadinessRow | null> {
  const { data, error } = await supabase
    .from('v_hotel_gbp_readiness')
    .select('*')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw parseError(error);
  return (data as GBPReadinessRow | null) ?? null;
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function setGBPAttestation(input: {
  hotelId: string;
  itemKey: string;
  state: Exclude<GBPAttestationState, 'MANAGER_VERIFIED'>;
  evidenceUrl?: string | null;
}): Promise<{ id: string; state: GBPAttestationState }> {
  const { data, error } = await supabase.rpc('set_gbp_attestation', {
    p_hotel_id: input.hotelId,
    p_item_key: input.itemKey,
    p_state: input.state,
    p_evidence_url: input.evidenceUrl ?? null,
  });
  if (error) throw parseError(error);
  return data as { id: string; state: GBPAttestationState };
}

export async function managerVerifyGBPAttestation(input: {
  hotelId: string;
  itemKey: string;
  note?: string | null;
}): Promise<{ id: string; state: GBPAttestationState }> {
  const { data, error } = await supabase.rpc('manager_verify_gbp_attestation', {
    p_hotel_id: input.hotelId,
    p_item_key: input.itemKey,
    p_note: input.note ?? null,
  });
  if (error) throw parseError(error);
  return data as { id: string; state: GBPAttestationState };
}

export async function managerUnverifyGBPAttestation(input: {
  hotelId: string;
  itemKey: string;
  reason: string;
}): Promise<{ id: string; state: GBPAttestationState }> {
  const { data, error } = await supabase.rpc('manager_unverify_gbp_attestation', {
    p_hotel_id: input.hotelId,
    p_item_key: input.itemKey,
    p_reason: input.reason,
  });
  if (error) throw parseError(error);
  return data as { id: string; state: GBPAttestationState };
}
