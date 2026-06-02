// web/src/services/seoBlueprintService.ts
//
// Typed wrapper around the Local SEO Landing Planner RPCs + RLS-scoped reads.

import { supabase } from '../lib/supabase';
import type {
  SeoBlueprint,
  SeoBlueprintCategory,
  SeoBlueprintEvent,
  SeoBlueprintRisk,
  SeoBlueprintStatus,
  SeoBlueprintSummary,
  SeoProofItem,
  SeoReviewStatus,
} from '../types/seoBlueprint';

export type SeoBlueprintServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'BLUEPRINT_NOT_FOUND'
  | 'BLUEPRINT_DELETED'
  | 'NOT_EDITABLE'
  | 'INVALID_TRANSITION'
  | 'NOTE_REQUIRED'
  | 'TITLE_REQUIRED'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'RISK_BLOCKS_APPROVAL'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

export class SeoBlueprintServiceError extends Error {
  code: SeoBlueprintServiceErrorCode;
  constructor(code: SeoBlueprintServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'SeoBlueprintServiceError';
  }
}

const KNOWN_CODES: SeoBlueprintServiceErrorCode[] = [
  'NOT_AUTHORIZED', 'BLUEPRINT_NOT_FOUND', 'BLUEPRINT_DELETED', 'NOT_EDITABLE',
  'INVALID_TRANSITION', 'NOTE_REQUIRED', 'TITLE_REQUIRED', 'OVERRIDE_REASON_REQUIRED',
  'RISK_BLOCKS_APPROVAL', 'INVALID_REQUEST',
];

function parseError(err: unknown): SeoBlueprintServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m && m[1] && (KNOWN_CODES as string[]).includes(m[1])) {
      return new SeoBlueprintServiceError(m[1] as SeoBlueprintServiceErrorCode, msg);
    }
    return new SeoBlueprintServiceError('UNKNOWN_ERROR', msg);
  }
  return new SeoBlueprintServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export interface ListSeoBlueprintsOptions {
  includeArchived?: boolean;
  includeDeleted?: boolean;
  categories?: SeoBlueprintCategory[];
  statuses?: SeoBlueprintStatus[];
  risks?: SeoBlueprintRisk[];
  reviewStatuses?: SeoReviewStatus[];
  search?: string;
  limit?: number;
}

export async function listSeoBlueprints(
  hotelId: string,
  options: ListSeoBlueprintsOptions = {},
): Promise<SeoBlueprint[]> {
  let q = supabase
    .from('seo_landing_blueprints')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 200);
  if (!options.includeDeleted) q = q.is('deleted_at', null);
  if (!options.includeArchived) q = q.neq('status', 'ARCHIVED');
  if (options.categories?.length) q = q.in('target_category', options.categories);
  if (options.statuses?.length) q = q.in('status', options.statuses);
  if (options.risks?.length) q = q.in('risk_classification', options.risks);
  if (options.reviewStatuses?.length) q = q.in('review_status', options.reviewStatuses);
  if (options.search) {
    const term = `%${options.search}%`;
    q = q.or(`page_title_concept.ilike.${term},owner_notes.ilike.${term}`);
  }
  const { data, error } = await q;
  if (error) throw parseError(error);
  return (data ?? []) as SeoBlueprint[];
}

export async function getSeoBlueprint(id: string): Promise<SeoBlueprint | null> {
  const { data, error } = await supabase
    .from('seo_landing_blueprints')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw parseError(error);
  return (data as SeoBlueprint | null) ?? null;
}

export async function getSeoBlueprintEvents(blueprintId: string, limit = 100): Promise<SeoBlueprintEvent[]> {
  const { data, error } = await supabase
    .from('seo_landing_blueprint_events')
    .select('*')
    .eq('blueprint_id', blueprintId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw parseError(error);
  return (data ?? []) as SeoBlueprintEvent[];
}

export async function getSeoBlueprintSummary(hotelId: string): Promise<SeoBlueprintSummary> {
  const { data, error } = await supabase.rpc('get_seo_blueprint_summary', { p_hotel_id: hotelId });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as {
    total?: number;
    by_risk?: Record<string, number>;
    by_status?: Record<string, number>;
  };
  return {
    total: Number(obj.total ?? 0),
    byRisk: (obj.by_risk ?? {}) as SeoBlueprintSummary['byRisk'],
    byStatus: (obj.by_status ?? {}) as SeoBlueprintSummary['byStatus'],
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface CreateSeoBlueprintInput {
  hotelId: string;
  pageTitleConcept: string;
  targetCategory: SeoBlueprintCategory;
  requiredProof?: SeoProofItem[];
  whyItMatters?: string;
  hinglishGuidance?: string;
  safeNextAction?: string;
  connectedModuleSuggestion?: string;
  ownerNotes?: string;
  internalNotes?: string;
}

export interface CreateSeoBlueprintResult {
  id: string;
  riskClassification: SeoBlueprintRisk;
  status: SeoBlueprintStatus;
}

export async function createSeoBlueprint(input: CreateSeoBlueprintInput): Promise<CreateSeoBlueprintResult> {
  const { data, error } = await supabase.rpc('create_seo_blueprint', {
    p_hotel_id: input.hotelId,
    p_page_title_concept: input.pageTitleConcept,
    p_target_category: input.targetCategory,
    p_required_proof: input.requiredProof ?? [],
    p_why_it_matters: input.whyItMatters ?? null,
    p_hinglish_guidance: input.hinglishGuidance ?? null,
    p_safe_next_action: input.safeNextAction ?? null,
    p_connected_module_suggestion: input.connectedModuleSuggestion ?? null,
    p_owner_notes: input.ownerNotes ?? null,
    p_internal_notes: input.internalNotes ?? null,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as { id?: string; risk_classification?: SeoBlueprintRisk; status?: SeoBlueprintStatus };
  if (!obj.id) throw new SeoBlueprintServiceError('UNKNOWN_ERROR', 'No id returned');
  return {
    id: obj.id,
    riskClassification: obj.risk_classification ?? 'NEEDS_PROOF',
    status: obj.status ?? 'DRAFT',
  };
}

export interface UpdateSeoBlueprintInput {
  id: string;
  pageTitleConcept?: string;
  targetCategory?: SeoBlueprintCategory;
  requiredProof?: SeoProofItem[];
  whyItMatters?: string;
  hinglishGuidance?: string;
  safeNextAction?: string;
  connectedModuleSuggestion?: string;
  ownerNotes?: string;
  internalNotes?: string;
  riskOverride?: SeoBlueprintRisk;
  overrideReason?: string;
}

export interface UpdateSeoBlueprintResult {
  id: string;
  riskClassification: SeoBlueprintRisk;
  computedRisk: SeoBlueprintRisk;
}

export async function updateSeoBlueprint(input: UpdateSeoBlueprintInput): Promise<UpdateSeoBlueprintResult> {
  const { data, error } = await supabase.rpc('update_seo_blueprint', {
    p_id: input.id,
    p_page_title_concept: input.pageTitleConcept ?? null,
    p_target_category: input.targetCategory ?? null,
    p_required_proof: input.requiredProof ?? null,
    p_why_it_matters: input.whyItMatters ?? null,
    p_hinglish_guidance: input.hinglishGuidance ?? null,
    p_safe_next_action: input.safeNextAction ?? null,
    p_connected_module_suggestion: input.connectedModuleSuggestion ?? null,
    p_owner_notes: input.ownerNotes ?? null,
    p_internal_notes: input.internalNotes ?? null,
    p_risk_override: input.riskOverride ?? null,
    p_override_reason: input.overrideReason ?? null,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as { id?: string; risk_classification?: SeoBlueprintRisk; computed_risk?: SeoBlueprintRisk };
  return {
    id: obj.id ?? input.id,
    riskClassification: obj.risk_classification ?? 'NEEDS_PROOF',
    computedRisk: obj.computed_risk ?? 'NEEDS_PROOF',
  };
}

export async function submitSeoBlueprintForReview(id: string): Promise<void> {
  const { error } = await supabase.rpc('submit_seo_blueprint_for_review', { p_id: id });
  if (error) throw parseError(error);
}

export async function approveSeoBlueprint(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('approve_seo_blueprint', { p_id: id, p_note: note ?? null });
  if (error) throw parseError(error);
}

export async function requestSeoBlueprintChanges(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('request_seo_blueprint_changes', { p_id: id, p_note: note });
  if (error) throw parseError(error);
}

export async function holdSeoBlueprint(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('hold_seo_blueprint', { p_id: id, p_reason: reason ?? null });
  if (error) throw parseError(error);
}

export async function resumeSeoBlueprint(id: string): Promise<void> {
  const { error } = await supabase.rpc('resume_seo_blueprint', { p_id: id });
  if (error) throw parseError(error);
}

export async function archiveSeoBlueprint(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('archive_seo_blueprint', { p_id: id, p_reason: reason ?? null });
  if (error) throw parseError(error);
}

export async function softDeleteSeoBlueprint(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_seo_blueprint', { p_id: id, p_reason: reason ?? null });
  if (error) throw parseError(error);
}
