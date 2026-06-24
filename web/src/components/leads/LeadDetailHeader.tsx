// web/src/components/leads/LeadDetailHeader.tsx

import { X } from 'lucide-react';
import type { Lead } from '../../types/lead';
import { LeadDetailStatusMenu } from './LeadDetailStatusMenu';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  lead: Lead;
  canEdit: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  onAfterChange: () => void;
  onClose: () => void;
  closeDisabled: boolean;
}

export function LeadDetailHeader({
  lead,
  canEdit,
  showToast,
  onAfterChange,
  onClose,
  closeDisabled,
}: Props) {
  const t = useOwnerT('owner-leads');
  return (
    <header className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-white truncate" title={lead.contact_name}>
          {lead.contact_name}
        </div>
        <div className="mt-1.5">
          <LeadDetailStatusMenu
            leadId={lead.id}
            currentStatus={lead.status}
            disabled={!canEdit}
            showToast={showToast}
            onAfterChange={onAfterChange}
          />
        </div>
      </div>
      <button
        type="button"
        data-testid="lead-detail-close"
        aria-label={t('a11y.close', 'Close')}
        onClick={onClose}
        disabled={closeDisabled}
        className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
      >
        <X className="h-5 w-5" />
      </button>
    </header>
  );
}
