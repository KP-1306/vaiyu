// web/src/components/packages/PackageDisclaimerBanner.tsx
//
// Mandatory disclaimer rendered in the workspace + builder + landing page.

import { Info } from 'lucide-react';
import { PACKAGE_DISCLAIMER } from '../../config/packages';

export function PackageDisclaimerBanner({
  variant = 'dark',
}: {
  variant?: 'dark' | 'light';
}) {
  const dark = variant === 'dark';
  return (
    <div
      role="note"
      className={
        dark
          ? 'rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100'
          : 'rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900'
      }
    >
      <div className="flex items-start gap-3">
        <Info className={`h-4 w-4 mt-0.5 shrink-0 ${dark ? 'text-amber-300' : 'text-amber-600'}`} aria-hidden />
        <div className="space-y-1">
          <p className={dark ? 'font-medium text-amber-100' : 'font-medium text-amber-900'}>
            Indicative proposal — manual verification required.
          </p>
          <p className={dark ? 'text-amber-100/80' : 'text-amber-800/90'}>
            {PACKAGE_DISCLAIMER}
          </p>
          <p className={dark ? 'text-amber-100/70 italic' : 'text-amber-800/70 italic'}>
            Package details guidelines hain. Final rate aur availability staff manually confirm karenge.
          </p>
        </div>
      </div>
    </div>
  );
}
