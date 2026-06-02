// web/src/services/followUpService.ts
//
// Follow-up Radar v1 — typed wrapper around the follow_ups RPCs + table reads.
// All writes go through SECURITY DEFINER RPCs that pair the UPDATE with a
// follow_up_events audit row. Listing is a plain RLS-scoped SELECT.

import { supabase } from '../lib/supabase';
import type {
  FollowUpCategory,
  FollowUpItem,
  FollowUpPriority,
  FollowUpStatus,
} from '../types/followUp';

interface FollowUpRow {
  id: string;
  hotel_id: string;
  lead_id: string | null;
  category: FollowUpCategory;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  title: string;
  context: string;
  entity_reference: string;
  recommended_manual_action: string;
  due_at: string;
  assigned_to: string | null;
  blocked_reason: string | null;
  related_ticket_status: 'NONE' | 'OPEN_COMPLAINT' | 'SLA_BREACH' | null;
  addressed_at: string | null;
  addressed_by: string | null;
  addressed_note: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: FollowUpRow): FollowUpItem {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    priority: row.priority,
    title: row.title,
    context: row.context,
    entityReference: row.entity_reference,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    blockedReason: row.blocked_reason,
    relatedTicketStatus: row.related_ticket_status,
    recommendedManualAction: row.recommended_manual_action,
  };
}

export type FollowUpServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'FOLLOW_UP_NOT_FOUND'
  | 'TITLE_REQUIRED'
  | 'REASON_REQUIRED'
  | 'BLOCKED_CANNOT_ADDRESS'
  | 'ADDRESSED_CANNOT_BLOCK'
  | 'ALREADY_DISMISSED'
  | 'INVALID_TICKET_STATUS'
  | 'LEAD_NOT_FOUND'
  | 'LEAD_HOTEL_MISMATCH'
  | 'ASSIGNEE_NOT_MEMBER'
  | 'UNKNOWN_ERROR';

export class FollowUpServiceError extends Error {
  code: FollowUpServiceErrorCode;
  constructor(code: FollowUpServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'FollowUpServiceError';
  }
}

function parseError(err: unknown): FollowUpServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m && m[1]) {
      const known: FollowUpServiceErrorCode[] = [
        'NOT_AUTHORIZED', 'FOLLOW_UP_NOT_FOUND', 'TITLE_REQUIRED', 'REASON_REQUIRED',
        'BLOCKED_CANNOT_ADDRESS', 'ADDRESSED_CANNOT_BLOCK', 'ALREADY_DISMISSED',
        'INVALID_TICKET_STATUS', 'LEAD_NOT_FOUND', 'LEAD_HOTEL_MISMATCH', 'ASSIGNEE_NOT_MEMBER',
      ];
      const code = m[1];
      if ((known as string[]).includes(code)) {
        return new FollowUpServiceError(code as FollowUpServiceErrorCode, msg);
      }
    }
    return new FollowUpServiceError('UNKNOWN_ERROR', msg);
  }
  return new FollowUpServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export interface ListFollowUpsOptions {
  includeDismissed?: boolean;
  includeAddressed?: boolean;
  categories?: FollowUpCategory[];
  limit?: number;
}

export interface ListFollowUpsResult {
  items: FollowUpItem[];
  raw: FollowUpRow[]; // surfaces dismissed/addressed_at if caller needs them
}

export async function listFollowUps(
  hotelId: string,
  options: ListFollowUpsOptions = {},
): Promise<ListFollowUpsResult> {
  let q = supabase
    .from('follow_ups')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('priority', { ascending: true }) // PG enum order: CRITICAL → HIGH → MEDIUM → LOW
    .order('due_at', { ascending: true })
    .limit(options.limit ?? 200);
  if (!options.includeDismissed) q = q.is('dismissed_at', null);
  if (!options.includeAddressed) q = q.neq('status', 'ADDRESSED');
  if (options.categories && options.categories.length > 0) {
    q = q.in('category', options.categories);
  }
  const { data, error } = await q;
  if (error) throw parseError(error);
  const rows = (data ?? []) as FollowUpRow[];
  return { items: rows.map(rowToItem), raw: rows };
}

// ─── Writes ────────────────────────────────────────────────────────────────

export interface CreateFollowUpInput {
  hotelId: string;
  category: FollowUpCategory;
  title: string;
  context?: string;
  entityReference?: string;
  dueAt?: string;            // YYYY-MM-DD; defaults to category template offset
  priority?: FollowUpPriority;
  assignedTo?: string | null;
  leadId?: string | null;
  recommendedAction?: string;
}

export async function createFollowUp(input: CreateFollowUpInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_follow_up', {
    p_hotel_id: input.hotelId,
    p_category: input.category,
    p_title: input.title,
    p_context: input.context ?? '',
    p_entity_reference: input.entityReference ?? '',
    p_due_at: input.dueAt ?? null,
    p_priority: input.priority ?? null,
    p_assigned_to: input.assignedTo ?? null,
    p_lead_id: input.leadId ?? null,
    p_recommended_action: input.recommendedAction ?? null,
  });
  if (error) throw parseError(error);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new FollowUpServiceError('UNKNOWN_ERROR', 'No id returned');
  return id;
}

export async function markFollowUpAddressed(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('mark_follow_up_addressed', {
    p_id: id,
    p_note: note ?? null,
  });
  if (error) throw parseError(error);
}

export async function markFollowUpBlocked(
  id: string,
  reason: string,
  relatedTicketStatus?: 'NONE' | 'OPEN_COMPLAINT' | 'SLA_BREACH',
): Promise<void> {
  const { error } = await supabase.rpc('mark_follow_up_blocked', {
    p_id: id,
    p_reason: reason,
    p_related_ticket_status: relatedTicketStatus ?? null,
  });
  if (error) throw parseError(error);
}

export async function unblockFollowUp(id: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_follow_up', { p_id: id });
  if (error) throw parseError(error);
}

export async function dismissFollowUp(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_follow_up', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parseError(error);
}

export async function reopenFollowUp(id: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_follow_up', { p_id: id });
  if (error) throw parseError(error);
}

export interface SyncResult {
  ok: boolean;
  created: number;
}

export async function syncFollowUpsFromLeads(hotelId: string): Promise<SyncResult> {
  const { data, error } = await supabase.rpc('sync_follow_ups_from_leads', {
    p_hotel_id: hotelId,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as { ok?: boolean; created?: number };
  return { ok: !!obj.ok, created: Number(obj.created ?? 0) };
}
