// web/src/components/leads/StatusFilterChips.tsx
//
// Multi-select chip group for lead status. Click toggles. Reuses
// LEAD_STATUS_CONFIG so colors stay consistent with LeadStatusPill.

import type { LeadStatus } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  value: LeadStatus[];
  onChange: (next: LeadStatus[]) => void;
}

const ALL_STATUSES: LeadStatus[] = [
  'NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST',
];

export function StatusFilterChips({ value, onChange }: Props) {
  const t = useOwnerT('owner-leads');
  function toggle(status: LeadStatus) {
    if (value.includes(status)) {
      onChange(value.filter((s) => s !== status));
    } else {
      onChange([...value, status]);
    }
  }

  return (
    <div role="group" aria-label={t('a11y.filterByStatus', 'Filter by status')} className="flex flex-wrap gap-1.5">
      {ALL_STATUSES.map((s) => {
        const active = value.includes(s);
        const cfg = LEAD_STATUS_CONFIG[s];
        return (
          <button
            key={s}
            type="button"
            data-testid={`status-filter-chip-${s}`}
            onClick={() => toggle(s)}
            aria-pressed={active}
            className={`
              inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium
              uppercase tracking-wide ring-1 transition-colors
              ${active
                ? `${cfg.bg} ${cfg.text} ${cfg.ring}`
                : 'bg-white/[0.03] text-white/50 ring-white/10 hover:bg-white/[0.06] hover:text-white/70'
              }
            `}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? cfg.dot : 'bg-white/20'}`} aria-hidden="true" />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}
