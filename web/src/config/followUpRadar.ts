// web/src/config/followUpRadar.ts
//
// Follow-up Radar v0 — feature flag, mock dataset, and deterministic helpers.
//
// IMPORTANT: This file is the single source of truth for v0 behaviour. It is
// frontend-only, mock-only, and contains NO network calls, NO real ticket/SLA
// reads, and NO automation. "Mark addressed" is an in-memory overlay tracked
// by the route component (cleared on refresh by design).

import type {
  FollowUpBucket,
  FollowUpCategory,
  FollowUpItem,
  FollowUpPriority,
  FollowUpStatus,
} from '../types/followUp';

export const FOLLOW_UP_RADAR_V0_ENABLED = true;

// ── Labels (English + Hinglish micro-copy lives in the components) ─────────

export const CATEGORY_LABEL: Record<FollowUpCategory, string> = {
  DIRECT_ENQUIRY: 'Direct enquiry',
  QUOTE_SENT: 'Quote sent',
  PACKAGE_ENQUIRY: 'Package enquiry',
  REVIEW_REQUEST: 'Review request',
  OWNER_REPLY: 'Owner reply',
  UNRESOLVED_COMPLAINT: 'Unresolved complaint',
  SLA_ESCALATION: 'SLA escalation',
};

export const STATUS_LABEL: Record<FollowUpStatus, string> = {
  PENDING: 'Pending',
  DUE: 'Due',
  OVERDUE: 'Overdue',
  BLOCKED: 'Blocked',
  ADDRESSED: 'Addressed',
};

export const PRIORITY_LABEL: Record<FollowUpPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

// Higher = more urgent. Used for sort.
const PRIORITY_WEIGHT: Record<FollowUpPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// ── Deterministic helpers ──────────────────────────────────────────────────

// Local YYYY-MM-DD — avoids UTC drift around midnight IST.
export function todayIsoLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDueToday(dueAt: string, now?: Date): boolean {
  return dueAt === todayIsoLocal(now);
}

export function isOverdue(dueAt: string, now?: Date): boolean {
  return dueAt < todayIsoLocal(now);
}

export function sortByPriority(a: FollowUpItem, b: FollowUpItem): number {
  const diff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (diff !== 0) return diff;
  // Tie-break: earlier dueAt first
  return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
}

export function bucketFor(item: FollowUpItem, now?: Date): FollowUpBucket {
  if (item.status === 'ADDRESSED') return 'ADDRESSED';
  if (item.status === 'BLOCKED' || item.blockedReason) return 'BLOCKED';
  if (isOverdue(item.dueAt, now)) return 'OVERDUE';
  if (isDueToday(item.dueAt, now)) return 'DUE_TODAY';
  return 'PENDING';
}

export function groupByBucket(
  items: FollowUpItem[],
  now?: Date,
): Record<FollowUpBucket, FollowUpItem[]> {
  const out: Record<FollowUpBucket, FollowUpItem[]> = {
    DUE_TODAY: [],
    OVERDUE: [],
    BLOCKED: [],
    PENDING: [],
    ADDRESSED: [],
  };
  for (const it of items) out[bucketFor(it, now)].push(it);
  for (const k of Object.keys(out) as FollowUpBucket[]) out[k].sort(sortByPriority);
  return out;
}

// ── Mock dataset ───────────────────────────────────────────────────────────
//
// Synthetic only — no real PII. Dates are computed relative to "today" so the
// dataset stays meaningful regardless of when the user opens the radar.

function offsetDays(days: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return todayIsoLocal(d);
}

export function buildMockItems(now: Date = new Date()): FollowUpItem[] {
  return [
    {
      id: 'fu-mock-1',
      category: 'DIRECT_ENQUIRY',
      status: 'DUE',
      priority: 'HIGH',
      title: 'Sample guest A1 — first reply pending',
      context: 'Enquired via website 2 days ago. No reply sent yet.',
      entityReference: 'lead-mock-1',
      dueAt: offsetDays(0, now),
      assignedTo: 'You',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Reply with check-in/out availability, room types and rate. Ask preferred call window.',
    },
    {
      id: 'fu-mock-2',
      category: 'QUOTE_SENT',
      status: 'OVERDUE',
      priority: 'CRITICAL',
      title: 'Quote to demo enquiry — Mr. Sharma (mock) — no nudge yet',
      context: 'Quote sent 5 days ago, guest never opened the email.',
      entityReference: 'quote-mock-2',
      dueAt: offsetDays(-2, now),
      assignedTo: 'Manager',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Send polite nudge with revised dates option. Offer to call instead of email.',
    },
    {
      id: 'fu-mock-3',
      category: 'PACKAGE_ENQUIRY',
      status: 'PENDING',
      priority: 'MEDIUM',
      title: 'Honeymoon package — Demo couple (mock)',
      context: 'Asked for 3N/4D package with sightseeing add-ons.',
      entityReference: 'lead-mock-3',
      dueAt: offsetDays(1, now),
      assignedTo: null,
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Build 3 package options (budget / standard / premium). Share PDF.',
    },
    {
      id: 'fu-mock-4',
      category: 'REVIEW_REQUEST',
      status: 'DUE',
      priority: 'LOW',
      title: 'Review request — Demo stay #DM-1042 (mock)',
      context: 'Guest checked out yesterday. Review link not yet sent.',
      entityReference: 'stay-mock-1042',
      dueAt: offsetDays(0, now),
      assignedTo: 'Front Desk',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Share Google / OTA review link via your usual channel within 24 hours of checkout.',
    },
    {
      id: 'fu-mock-5',
      category: 'OWNER_REPLY',
      status: 'OVERDUE',
      priority: 'HIGH',
      title: 'Negative review reply pending — Demo (mock)',
      context: 'A 2-star review posted 6 days ago has no owner reply yet.',
      entityReference: 'review-mock-5',
      dueAt: offsetDays(-3, now),
      assignedTo: 'Owner',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Draft a calm, factual public reply. Acknowledge, apologise where fair, share fix.',
    },
    {
      id: 'fu-mock-6',
      category: 'UNRESOLVED_COMPLAINT',
      status: 'BLOCKED',
      priority: 'CRITICAL',
      title: 'Sample guest C7 — outreach blocked by open complaint (mock)',
      context: 'Lead wants a callback but a related complaint ticket is open.',
      entityReference: 'lead-mock-6',
      dueAt: offsetDays(0, now),
      assignedTo: 'Manager',
      blockedReason:
        'Guest has an open complaint ticket. Resolve the complaint before any sales outreach.',
      relatedTicketStatus: 'OPEN_COMPLAINT',
      recommendedManualAction:
        'Do NOT call yet. Close the complaint ticket first, then circle back tomorrow.',
    },
    {
      id: 'fu-mock-7',
      category: 'SLA_ESCALATION',
      status: 'BLOCKED',
      priority: 'CRITICAL',
      title: 'Demo enquiry — outreach blocked by SLA breach (mock)',
      context: 'A guest service SLA has breached for this guest.',
      entityReference: 'lead-mock-7',
      dueAt: offsetDays(-1, now),
      assignedTo: 'Owner',
      blockedReason:
        'A guest service SLA is currently breached. Sales outreach must wait until SLA is back in green.',
      relatedTicketStatus: 'SLA_BREACH',
      recommendedManualAction:
        'Coordinate with ops to resolve the SLA breach first. Then reopen this follow-up.',
    },
    {
      id: 'fu-mock-8',
      category: 'DIRECT_ENQUIRY',
      status: 'ADDRESSED',
      priority: 'MEDIUM',
      title: 'Sample guest B3 — already replied (mock)',
      context: 'Acknowledged with rates. Awaiting guest confirmation.',
      entityReference: 'lead-mock-8',
      dueAt: offsetDays(-1, now),
      assignedTo: 'You',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'No action needed unless guest re-engages. Mark addressed is set.',
    },
    {
      id: 'fu-mock-9',
      category: 'QUOTE_SENT',
      status: 'PENDING',
      priority: 'MEDIUM',
      title: 'Corporate quote — Demo Pvt Ltd (mock)',
      context: 'Quote sent yesterday. Followup window opens tomorrow.',
      entityReference: 'quote-mock-9',
      dueAt: offsetDays(2, now),
      assignedTo: 'Manager',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Call 48 hours after quote if no reply. Keep call short, confirm receipt.',
    },
    {
      id: 'fu-mock-10',
      category: 'REVIEW_REQUEST',
      status: 'OVERDUE',
      priority: 'LOW',
      title: 'Review nudge — Demo stay #DM-1019 (mock)',
      context: 'Guest checked out 4 days ago. Review nudge missed.',
      entityReference: 'stay-mock-1019',
      dueAt: offsetDays(-3, now),
      assignedTo: 'Front Desk',
      blockedReason: null,
      relatedTicketStatus: 'NONE',
      recommendedManualAction:
        'Send a soft nudge. Avoid pestering — one reminder is enough.',
    },
  ];
}

// Pure helper used by both the workspace route and the compact dashboard card.
export interface RadarCounts {
  dueToday: number;
  overdue: number;
  blocked: number;
  pending: number;
  addressed: number;
  total: number;
  criticalUnaddressed: number;
}

export function countByBucket(items: FollowUpItem[], now?: Date): RadarCounts {
  const grouped = groupByBucket(items, now);
  const criticalUnaddressed =
    grouped.DUE_TODAY.filter((i) => i.priority === 'CRITICAL').length +
    grouped.OVERDUE.filter((i) => i.priority === 'CRITICAL').length +
    grouped.BLOCKED.filter((i) => i.priority === 'CRITICAL').length;
  return {
    dueToday: grouped.DUE_TODAY.length,
    overdue: grouped.OVERDUE.length,
    blocked: grouped.BLOCKED.length,
    pending: grouped.PENDING.length,
    addressed: grouped.ADDRESSED.length,
    total: items.length,
    criticalUnaddressed,
  };
}

export const CATEGORY_OPTIONS: FollowUpCategory[] = [
  'DIRECT_ENQUIRY',
  'QUOTE_SENT',
  'PACKAGE_ENQUIRY',
  'REVIEW_REQUEST',
  'OWNER_REPLY',
  'UNRESOLVED_COMPLAINT',
  'SLA_ESCALATION',
];

export const PRIORITY_OPTIONS: FollowUpPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export const STATUS_OPTIONS: FollowUpStatus[] = [
  'PENDING',
  'DUE',
  'OVERDUE',
  'BLOCKED',
  'ADDRESSED',
];
