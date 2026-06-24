// web/src/components/visibility/VisibilityDisclaimerBanner.tsx
//
// Verbatim disclaimer banner. Bilingual toggle.

import { useState } from 'react';
import { Info, Languages } from 'lucide-react';
import {
  VISIBILITY_DISCLAIMER_EN,
  VISIBILITY_DISCLAIMER_HI,
} from '../../config/visibilityScore';
import { useOwnerT } from '../../i18n/useOwnerT';

export function VisibilityDisclaimerBanner() {
  const t = useOwnerT('owner-visibility');
  const [hi, setHi] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-3 text-[12px] text-slate-300">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>{hi ? VISIBILITY_DISCLAIMER_HI : VISIBILITY_DISCLAIMER_EN}</p>
        </div>
        <button
          type="button"
          onClick={() => setHi((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
          aria-label={hi ? t('disclaimer.toggleToEnglish', 'English') : t('disclaimer.toggleToHinglish', 'Hinglish')}
        >
          <Languages className="h-3 w-3" />
          {hi ? t('disclaimer.toggleToEnglish', 'English') : t('disclaimer.toggleToHinglish', 'Hinglish')}
        </button>
      </div>
    </div>
  );
}
