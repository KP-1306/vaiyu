// web/src/types/followUp.ts
//
// Follow-up Radar v0 — types only. Mock-data-only feature; not real automation.
// No database, no Edge Functions, no real ticket/SLA reads in v0.

export type FollowUpCategory =
  | 'DIRECT_ENQUIRY'
  | 'QUOTE_SENT'
  | 'PACKAGE_ENQUIRY'
  | 'REVIEW_REQUEST'
  | 'OWNER_REPLY'
  | 'UNRESOLVED_COMPLAINT'
  | 'SLA_ESCALATION';

export type FollowUpStatus =
  | 'PENDING'
  | 'DUE'
  | 'OVERDUE'
  | 'BLOCKED'
  | 'ADDRESSED';

export type FollowUpPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// Mock-only blocker flags. NEVER read from real tickets/SLA in v0.
export interface FollowUpItem {
  id: string;
  category: FollowUpCategory;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  title: string;
  context: string;
  entityReference: string; // e.g. "lead-mock-1", "quote-mock-3" — never a real UUID
  dueAt: string; // ISO date (YYYY-MM-DD) for deterministic "today / overdue" checks
  assignedTo: string | null;
  blockedReason: string | null;
  relatedTicketStatus: 'NONE' | 'OPEN_COMPLAINT' | 'SLA_BREACH' | null;
  recommendedManualAction: string;
}

export type FollowUpBucket = 'DUE_TODAY' | 'OVERDUE' | 'BLOCKED' | 'PENDING' | 'ADDRESSED';
