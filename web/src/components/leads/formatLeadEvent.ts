// web/src/components/leads/formatLeadEvent.ts
//
// Pure event → display formatter. Every LeadEvent renders via one of these
// cases. Output drives the LeadDetailTimeline component.

import type { LeadEvent } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';

export type EventIconName =
  | 'plus'
  | 'arrow-right'
  | 'user-plus'
  | 'user-minus'
  | 'lock'
  | 'unlock'
  | 'message-circle'
  | 'tag'
  | 'edit-2'
  | 'check-circle'
  | 'trash-2'
  | 'rotate-ccw'
  | 'send'
  | 'help-circle';

export type EventColor = 'emerald' | 'blue' | 'indigo' | 'amber' | 'red' | 'slate';

export interface FormattedEvent {
  iconName: EventIconName;
  color: EventColor;
  title: string;
  detail: string | null;
  actor: string;
}

const UNKNOWN_ACTOR = 'unknown';

function statusLabel(s: string): string {
  return LEAD_STATUS_CONFIG[s as keyof typeof LEAD_STATUS_CONFIG]?.label ?? s;
}

function sourceLabel(s: string): string {
  return LEAD_SOURCE_CONFIG[s as keyof typeof LEAD_SOURCE_CONFIG]?.label ?? s;
}

function formatChanges(changes: Record<string, [unknown, unknown]>): string | null {
  const keys = Object.keys(changes);
  if (keys.length === 0) return null;
  return keys
    .map((k) => {
      const [oldV, newV] = changes[k];
      const o = oldV === null || oldV === undefined || oldV === '' ? '—' : String(oldV);
      const n = newV === null || newV === undefined || newV === '' ? '—' : String(newV);
      return `${k}: ${o} → ${n}`;
    })
    .join(' · ');
}

export function formatLeadEvent(event: LeadEvent): FormattedEvent {
  switch (event.event_type) {
    case 'CREATED': {
      const p = event.payload;
      return {
        iconName: 'plus',
        color: 'emerald',
        title: `Lead created from ${sourceLabel(p.source)}`,
        detail: p.source_detail ?? null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'STATUS_CHANGED': {
      const p = event.payload;
      let detail: string | null = null;
      if (p.auto_promoted) {
        detail = `Auto-promoted (${p.transition_mode ?? 'unknown mode'})`;
      } else if (p.reason) {
        detail = p.reason;
      }
      return {
        iconName: 'arrow-right',
        color: p.to === 'WON' ? 'emerald' : p.to === 'LOST' ? 'red' : 'blue',
        title: `Moved from ${statusLabel(p.from)} to ${statusLabel(p.to)}`,
        detail,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'ASSIGNED': {
      const p = event.payload;
      return {
        iconName: 'user-plus',
        color: 'indigo',
        title: `Assigned to ${p.to_user_name ?? UNKNOWN_ACTOR}`,
        detail: p.prev_user_name ? `Previously ${p.prev_user_name}` : null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'UNASSIGNED': {
      const p = event.payload;
      return {
        iconName: 'user-minus',
        color: 'slate',
        title: `Unassigned${p.from_user_name ? ` (was ${p.from_user_name})` : ''}`,
        detail: null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'CLAIMED': {
      const p = event.payload;
      return {
        iconName: 'lock',
        color: 'amber',
        title: `Claim taken by ${p.by_user_name}`,
        detail: p.took_over_expired ? 'Took over an expired claim' : null,
        actor: p.by_user_name,
      };
    }
    case 'CLAIM_RELEASED': {
      const p = event.payload;
      const kind =
        p.release_type === 'forced'
          ? 'Force-released'
          : p.release_type === 'auto_on_convert'
          ? 'Auto-released on convert'
          : 'Released';
      const detail = p.release_type === 'forced' && p.reason ? `Reason: ${p.reason}` : null;
      return {
        iconName: 'unlock',
        color: p.release_type === 'forced' ? 'red' : 'slate',
        title: `${kind}${p.release_type === 'forced' ? ` (was ${p.prev_holder_name})` : ''}`,
        detail,
        actor: p.by_user_name,
      };
    }
    case 'NOTE_ADDED': {
      const p = event.payload;
      return {
        iconName: 'message-circle',
        color: 'blue',
        title: p.text,
        detail: null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'TAG_ADDED':
      return {
        iconName: 'tag',
        color: 'indigo',
        title: `Tagged ${event.payload.tag}`,
        detail: null,
        actor: UNKNOWN_ACTOR,
      };
    case 'TAG_REMOVED':
      return {
        iconName: 'tag',
        color: 'slate',
        title: `Removed tag ${event.payload.tag}`,
        detail: null,
        actor: UNKNOWN_ACTOR,
      };
    case 'CONTACT_UPDATED': {
      const p = event.payload;
      return {
        iconName: 'edit-2',
        color: 'blue',
        title: 'Contact updated',
        detail: formatChanges(p.changes),
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'BASICS_UPDATED': {
      const p = event.payload;
      return {
        iconName: 'edit-2',
        color: 'blue',
        title: 'Stay details updated',
        detail: formatChanges(p.changes),
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'QUOTE_SENT': {
      const p = event.payload;
      return {
        iconName: 'send',
        color: 'emerald',
        title: `Quote sent via ${p.channel}`,
        detail: null,
        actor: UNKNOWN_ACTOR,
      };
    }
    case 'CONVERTED_TO_BOOKING': {
      const p = event.payload;
      const detailParts: string[] = [];
      if (p.promoted_through.length > 0) {
        detailParts.push(`Auto-promoted through ${p.promoted_through.length} stages`);
      }
      if (typeof p.conversion_latency_ms === 'number') {
        detailParts.push(`${p.conversion_latency_ms}ms`);
      }
      return {
        iconName: 'check-circle',
        color: 'emerald',
        title: `Converted to booking ${p.booking_code}`,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : null,
        actor: p.by_user_name,
      };
    }
    case 'SOFT_DELETED': {
      const p = event.payload;
      return {
        iconName: 'trash-2',
        color: 'red',
        title: 'Lead deleted',
        detail: p.reason ?? null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    case 'REOPENED': {
      const p = event.payload;
      return {
        iconName: 'rotate-ccw',
        color: 'amber',
        title: 'Reopened from Lost',
        detail: p.previous_reason ? `Previously: ${p.previous_reason}` : null,
        actor: p.by_user_name ?? UNKNOWN_ACTOR,
      };
    }
    default: {
      // Forward-compat fallback for unknown event types
      const evt = event as { event_type: string };
      return {
        iconName: 'help-circle',
        color: 'slate',
        title: evt.event_type,
        detail: null,
        actor: UNKNOWN_ACTOR,
      };
    }
  }
}
