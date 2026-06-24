// web/src/components/seasonal/SeasonalDisclaimerBanner.tsx
//
// Required disclaimer for the Seasonal Demand Calendar workspace. Renders the
// PO-mandated copy in both English + Hinglish. Compact variant drops the
// Hinglish line for in-modal usage.

import { Info } from 'lucide-react';
import {
  SEASONAL_DISCLAIMER_EN,
  SEASONAL_DISCLAIMER_HI,
} from '../../config/seasonalCalendar';
import { useOwnerT } from '../../i18n/useOwnerT';

export function SeasonalDisclaimerBanner({ compact = false }: { compact?: boolean }) {
  const t = useOwnerT('owner-seasonal');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 sm:p-4">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 sm:h-5 sm:w-5" aria-hidden />
        <div className="space-y-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-700 sm:text-[11px]">
            {t('disclaimer.heading', 'Planning guide — no guarantees')}
          </p>
          <p className="text-[13px] leading-snug text-amber-900">
            {SEASONAL_DISCLAIMER_EN}
          </p>
          {!compact && (
            <p className="text-[12px] leading-snug text-amber-800/80">
              {SEASONAL_DISCLAIMER_HI}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
