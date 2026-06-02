// web/src/components/partner/PartnerLiabilityFooter.tsx
//
// Per PO brief: directory pages must carry the verbatim liability disclaimer
// in both English and Hindi. Renders as a thin block at the bottom of the
// directory and inside each partner detail drawer.

import { AlertTriangle } from 'lucide-react';
import {
  PARTNER_LIABILITY_DISCLAIMER_EN,
  PARTNER_LIABILITY_DISCLAIMER_HI,
} from '../../types/partner';

interface Props {
  compact?: boolean;
}

export function PartnerLiabilityFooter({ compact = false }: Props) {
  return (
    <div
      role="note"
      className={
        compact
          ? 'rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/90'
          : 'mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/90'
      }
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={compact ? 'mt-0.5 h-3 w-3 shrink-0 text-amber-300' : 'mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300'} aria-hidden />
        <div className="space-y-1">
          <p>{PARTNER_LIABILITY_DISCLAIMER_EN}</p>
          <p className="text-amber-200/80">{PARTNER_LIABILITY_DISCLAIMER_HI}</p>
        </div>
      </div>
    </div>
  );
}
