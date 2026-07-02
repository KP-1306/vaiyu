// web/src/components/assets/PrivacyDisclaimerBanner.tsx
//
// Two banners required by PO brief — privacy guardrail (no PII) and business
// disclaimer (no guaranteed Google approval). Both stamped EN + Hinglish.
// Reused inside upload modals AND at top of the workspace. Dark theme.

import { ShieldAlert, Info } from 'lucide-react';
import { DAM_COPY } from '../../config/digitalAssetManager';
import { useOwnerT } from '../../i18n/useOwnerT';

export function PrivacyDisclaimerBanner({ compact = false }: { compact?: boolean }) {
  const t = useOwnerT('owner-assets');
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 sm:p-4">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400 sm:h-5 sm:w-5" aria-hidden />
          <div className="space-y-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-rose-300 sm:text-[11px]">
              {t('banner.privacyTitle', 'Privacy — DO NOT upload personal IDs')}
            </p>
            <p className="text-[13px] leading-snug text-rose-100">
              {DAM_COPY.privacyEN}
            </p>
            {!compact && (
              <p className="text-[12px] leading-snug text-rose-200/70">
                {DAM_COPY.privacyHI}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:p-4">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400 sm:h-5 sm:w-5" aria-hidden />
          <div className="space-y-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-300 sm:text-[11px]">
              {t('banner.disclaimerTitle', 'No guarantees')}
            </p>
            <p className="text-[13px] leading-snug text-amber-100">
              {DAM_COPY.disclaimerEN}
            </p>
            {!compact && (
              <p className="text-[12px] leading-snug text-amber-200/70">
                {DAM_COPY.disclaimerHI}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HinglishOnboardingHelper() {
  return (
    <div className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-[12px] leading-snug text-indigo-100">
      <span className="font-semibold">{DAM_COPY.googleProofHI}</span>{' '}
      <span className="text-indigo-200/70">{DAM_COPY.onboardingHI}</span>
    </div>
  );
}
