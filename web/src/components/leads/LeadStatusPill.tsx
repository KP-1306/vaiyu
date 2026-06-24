// web/src/components/leads/LeadStatusPill.tsx

import type { LeadStatus } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  status: LeadStatus;
  size?: 'sm' | 'md';
}

export function LeadStatusPill({ status, size = 'md' }: Props) {
  const t = useOwnerT('owner-leads');
  const cfg = LEAD_STATUS_CONFIG[status];
  const label = t(`status.${status}`, cfg.label);
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';
  return (
    <span
      role="status"
      aria-label={t('a11y.leadStatus', 'Lead status: {{label}}', { label })}
      className={`inline-flex items-center gap-1 rounded-full ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring} ${pad} font-medium uppercase tracking-wide`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
