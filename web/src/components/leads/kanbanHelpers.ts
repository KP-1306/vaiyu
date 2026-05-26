// web/src/components/leads/kanbanHelpers.ts
//
// Pure helpers for the kanban board:
//   - drop validation (mirrors RPC + adds CONVERTED block for UI)
//   - confirmation-modal routing
//   - column-cap labeling
//   - drag telemetry breadcrumbs (Sentry-bound)
//   - viewport detection (drag UX differs desktop vs mobile)
//
// No React, no DOM (except detectViewport's window guard). All testable.

import { ALLOWED_TRANSITIONS, type LeadStatus } from '../../types/lead';
import { addBreadcrumb } from '../../lib/monitoring';

export const KANBAN_COLUMN_ORDER: readonly LeadStatus[] = [
  'NEW',
  'QUALIFIED',
  'QUOTED',
  'WON',
  'CONVERTED',
  'LOST',
];

export const COLUMN_CAP = 50;

/**
 * Drop validation for the kanban UI. Mirrors the RPC's ALLOWED_TRANSITIONS
 * but also blocks CONVERTED drops (the conversion flow lives in the lead
 * detail drawer in Day 10 because it needs walk-in args).
 */
export function canDropInKanban(from: LeadStatus, to: LeadStatus): boolean {
  if (to === 'CONVERTED') return false; // Day 8: convert requires booking (Day 10 wires real flow)
  if (from === to) return false;
  return (ALLOWED_TRANSITIONS[from] as readonly LeadStatus[]).includes(to);
}

/** Returns the modal type required for this drop target, or null. */
export function requiresConfirmationModal(to: LeadStatus): 'LOST' | null {
  return to === 'LOST' ? 'LOST' : null;
}

/** User-facing tooltip text when a drop is refused. Empty string = silent. */
export function explainBlockedDrop(from: LeadStatus, to: LeadStatus): string {
  if (to === 'CONVERTED') return 'Open the lead and use Convert to create a booking.';
  if (from === to) return '';
  if (!canDropInKanban(from, to)) {
    return `Cannot move from ${from} to ${to}.`;
  }
  return '';
}

/** "Showing 50 of 142 — view all in list" — returns null when not needed. */
export function moreInColumnLabel(visible: number, total: number | null): string | null {
  if (total === null || total <= visible) return null;
  return `Showing ${visible} of ${total} — view all in list`;
}

// ─── Drag telemetry ────────────────────────────────────────────────────────

export type DragTelemetryEvent =
  | { type: 'drag.started'; from: LeadStatus; leadId: string; viewport: 'desktop' | 'mobile' }
  | {
      type: 'drag.cancelled';
      from: LeadStatus;
      leadId: string;
      reason: 'no_target' | 'invalid_drop' | 'esc' | 'modal_cancel';
    }
  | {
      type: 'drag.completed';
      from: LeadStatus;
      to: LeadStatus;
      leadId: string;
      duration_ms: number;
      required_modal: boolean;
    }
  | {
      type: 'drag.invalid_drop';
      from: LeadStatus;
      attempted_to: LeadStatus;
      leadId: string;
    };

/**
 * Drag interaction telemetry. Fires as Sentry breadcrumbs so any later error
 * capture has full drag context. Dev mode also console.debugs for live
 * inspection during local UX iteration. Volume is naturally low (1-3 events
 * per actual drag) — no rate limiting needed.
 */
export function trackDragEvent(event: DragTelemetryEvent): void {
  const level: 'info' | 'warning' =
    event.type === 'drag.cancelled' || event.type === 'drag.invalid_drop' ? 'warning' : 'info';
  addBreadcrumb({
    category: 'leadKanban.drag',
    message: event.type,
    level,
    data: event as unknown as Record<string, unknown>,
  });
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[kanban] ${event.type}`, event);
  }
}

/** Drag UX differs significantly between desktop + mobile — tag breadcrumbs for analysis. */
export function detectViewport(): 'desktop' | 'mobile' {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 640 ? 'mobile' : 'desktop';
}
