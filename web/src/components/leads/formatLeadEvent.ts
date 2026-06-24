// web/src/components/leads/formatLeadEvent.ts
//
// Pure event → display formatter. Every LeadEvent renders via one of these
// cases. Output drives the LeadDetailTimeline component.

import type { LeadEvent } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';
import type { OwnerT } from '../../i18n/useOwnerT';

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

// Optional `t` keeps this pure helper unit-testable in English (called with no
// `t` → English literal, with {{vars}} interpolated locally) while the Timeline
// component passes `t` to localise (owner-leads ns). Status/source codes stay the
// lookup KEY — only their display label is localised, never the value.
type Vars = Record<string, string | number>;

function makeTr(t?: OwnerT) {
  return (key: string, en: string, vars?: Vars): string => {
    if (t) return t(key, en, vars);
    if (!vars) return en;
    return en.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      vars[k] !== undefined ? String(vars[k]) : '',
    );
  };
}

function statusLabel(s: string, t?: OwnerT): string {
  const en = LEAD_STATUS_CONFIG[s as keyof typeof LEAD_STATUS_CONFIG]?.label ?? s;
  return t ? t(`status.${s}`, en) : en;
}

function sourceLabel(s: string, t?: OwnerT): string {
  const en = LEAD_SOURCE_CONFIG[s as keyof typeof LEAD_SOURCE_CONFIG]?.label ?? s;
  return t ? t(`source.${s}`, en) : en;
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

export function formatLeadEvent(event: LeadEvent, t?: OwnerT): FormattedEvent {
  const tr = makeTr(t);
  const unknownActor = tr('timeline.unknownActor', 'unknown');

  switch (event.event_type) {
    case 'CREATED': {
      const p = event.payload;
      return {
        iconName: 'plus',
        color: 'emerald',
        title: tr('timeline.created', 'Lead created from {{source}}', {
          source: sourceLabel(p.source, t),
        }),
        detail: p.source_detail ?? null,
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'STATUS_CHANGED': {
      const p = event.payload;
      let detail: string | null = null;
      if (p.auto_promoted) {
        detail = tr('timeline.autoPromoted', 'Auto-promoted ({{mode}})', {
          mode: p.transition_mode ?? 'unknown mode',
        });
      } else if (p.reason) {
        detail = p.reason;
      }
      return {
        iconName: 'arrow-right',
        color: p.to === 'WON' ? 'emerald' : p.to === 'LOST' ? 'red' : 'blue',
        title: tr('timeline.movedFromTo', 'Moved from {{from}} to {{to}}', {
          from: statusLabel(p.from, t),
          to: statusLabel(p.to, t),
        }),
        detail,
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'ASSIGNED': {
      const p = event.payload;
      return {
        iconName: 'user-plus',
        color: 'indigo',
        title: tr('timeline.assignedTo', 'Assigned to {{name}}', {
          name: p.to_user_name ?? unknownActor,
        }),
        detail: p.prev_user_name
          ? tr('timeline.previously', 'Previously {{name}}', { name: p.prev_user_name })
          : null,
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'UNASSIGNED': {
      const p = event.payload;
      return {
        iconName: 'user-minus',
        color: 'slate',
        title: p.from_user_name
          ? tr('timeline.unassignedWas', 'Unassigned (was {{name}})', { name: p.from_user_name })
          : tr('timeline.unassigned', 'Unassigned'),
        detail: null,
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'CLAIMED': {
      const p = event.payload;
      return {
        iconName: 'lock',
        color: 'amber',
        title: tr('timeline.claimTakenBy', 'Claim taken by {{name}}', { name: p.by_user_name }),
        detail: p.took_over_expired
          ? tr('timeline.tookOverExpired', 'Took over an expired claim')
          : null,
        actor: p.by_user_name,
      };
    }
    case 'CLAIM_RELEASED': {
      const p = event.payload;
      let title: string;
      if (p.release_type === 'forced') {
        title = tr('timeline.forceReleasedWas', 'Force-released (was {{name}})', {
          name: p.prev_holder_name,
        });
      } else if (p.release_type === 'auto_on_convert') {
        title = tr('timeline.autoReleasedOnConvert', 'Auto-released on convert');
      } else {
        title = tr('timeline.released', 'Released');
      }
      const detail =
        p.release_type === 'forced' && p.reason
          ? tr('timeline.reasonDetail', 'Reason: {{reason}}', { reason: p.reason })
          : null;
      return {
        iconName: 'unlock',
        color: p.release_type === 'forced' ? 'red' : 'slate',
        title,
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
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'TAG_ADDED':
      return {
        iconName: 'tag',
        color: 'indigo',
        title: tr('timeline.tagged', 'Tagged {{tag}}', { tag: event.payload.tag }),
        detail: null,
        actor: unknownActor,
      };
    case 'TAG_REMOVED':
      return {
        iconName: 'tag',
        color: 'slate',
        title: tr('timeline.removedTag', 'Removed tag {{tag}}', { tag: event.payload.tag }),
        detail: null,
        actor: unknownActor,
      };
    case 'CONTACT_UPDATED': {
      const p = event.payload;
      return {
        iconName: 'edit-2',
        color: 'blue',
        title: tr('timeline.contactUpdated', 'Contact updated'),
        detail: formatChanges(p.changes),
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'BASICS_UPDATED': {
      const p = event.payload;
      return {
        iconName: 'edit-2',
        color: 'blue',
        title: tr('timeline.basicsUpdated', 'Stay details updated'),
        detail: formatChanges(p.changes),
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'QUOTE_SENT': {
      const p = event.payload;
      return {
        iconName: 'send',
        color: 'emerald',
        title: tr('timeline.quoteSentVia', 'Quote sent via {{channel}}', { channel: p.channel }),
        detail: null,
        actor: unknownActor,
      };
    }
    case 'CONVERTED_TO_BOOKING': {
      const p = event.payload;
      const detailParts: string[] = [];
      if (p.promoted_through.length > 0) {
        detailParts.push(
          tr('timeline.promotedThroughStages', 'Auto-promoted through {{count}} stages', {
            count: p.promoted_through.length,
          }),
        );
      }
      if (typeof p.conversion_latency_ms === 'number') {
        detailParts.push(`${p.conversion_latency_ms}ms`);
      }
      return {
        iconName: 'check-circle',
        color: 'emerald',
        title: tr('timeline.convertedToBooking', 'Converted to booking {{code}}', {
          code: p.booking_code,
        }),
        detail: detailParts.length > 0 ? detailParts.join(' · ') : null,
        actor: p.by_user_name,
      };
    }
    case 'SOFT_DELETED': {
      const p = event.payload;
      return {
        iconName: 'trash-2',
        color: 'red',
        title: tr('timeline.leadDeleted', 'Lead deleted'),
        detail: p.reason ?? null,
        actor: p.by_user_name ?? unknownActor,
      };
    }
    case 'REOPENED': {
      const p = event.payload;
      return {
        iconName: 'rotate-ccw',
        color: 'amber',
        title: tr('timeline.reopenedFromLost', 'Reopened from {{status}}', {
          status: statusLabel('LOST', t),
        }),
        detail: p.previous_reason
          ? tr('timeline.previousReason', 'Previously: {{reason}}', { reason: p.previous_reason })
          : null,
        actor: p.by_user_name ?? unknownActor,
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
        actor: unknownActor,
      };
    }
  }
}
