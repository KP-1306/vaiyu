// web/src/components/leads/LeadSourceIcon.tsx

import type { LeadSource } from '../../types/lead';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  source: LeadSource;
  size?: number;
  /** When true, render the icon alongside the source label (for chips/menus). */
  showLabel?: boolean;
  className?: string;
}

export function LeadSourceIcon({ source, size = 18, showLabel = false, className = '' }: Props) {
  const t = useOwnerT('owner-leads');
  const cfg = LEAD_SOURCE_CONFIG[source];
  const Icon = cfg.Icon;
  const description = t(`sourceDesc.${source}`, cfg.description);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-white/70 ${className}`}
      title={description}
      aria-label={description}
    >
      <Icon size={size} aria-hidden="true" />
      {showLabel && <span className="text-xs">{t(`source.${source}`, cfg.label)}</span>}
    </span>
  );
}
