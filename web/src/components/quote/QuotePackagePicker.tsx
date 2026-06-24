// web/src/components/quote/QuotePackagePicker.tsx
//
// Quote draft package picker. Shows real Experience Packages for the hotel
// (active + approved). Falls back to in-memory MOCK_PACKAGES only when the
// hotel has no published packages yet.

import { useQuery } from '@tanstack/react-query';
import { Loader2, Package as PackageIcon, Tag } from 'lucide-react';
import {
  mergeQuotePackages,
  resolveQuotePackage,
} from '../../services/quotePackageAdapter';
import { listActivePackages } from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
  selectedInclusions: string[];
  onInclusionsChange: (next: string[]) => void;
  hotelId?: string;
}

export function QuotePackagePicker({
  selectedCode,
  onSelect,
  selectedInclusions,
  onInclusionsChange,
  hotelId,
}: Props) {
  const t = useOwnerT('owner-quote');
  const realQ = useQuery({
    queryKey: hotelId ? packageQueryKeys.active(hotelId) : ['packages', 'active', 'noop'],
    queryFn: () => (hotelId ? listActivePackages(hotelId) : Promise.resolve([])),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const realPackages = realQ.data ?? [];
  const options = mergeQuotePackages(realPackages);
  const pkg = resolveQuotePackage(selectedCode, realPackages);
  const usingMock = realPackages.length === 0;

  function toggleInclusion(name: string) {
    onInclusionsChange(
      selectedInclusions.includes(name)
        ? selectedInclusions.filter((n) => n !== name)
        : [...selectedInclusions, name],
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
          <PackageIcon className="h-4 w-4 text-emerald-300" aria-hidden />
          {t('packagePicker.title', 'Choose a package')}
        </h3>
        {realQ.isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-slate-500" aria-hidden />
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {usingMock ? t('packagePicker.sampleTemplates', 'Sample templates') : t('packagePicker.yourPackages', 'Your packages')}
          </span>
        )}
      </div>

      <select
        data-testid="quote-package-picker"
        value={selectedCode ?? ''}
        onChange={(e) => {
          const code = e.target.value || null;
          onSelect(code);
          onInclusionsChange([]); // reset inclusions when package changes
        }}
        className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
      >
        <option value="">{t('packagePicker.noPackageOption', '— No package (custom proposal) —')}</option>
        {options.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name} · {t('packagePicker.from', 'from')} {p.startingPriceText}
          </option>
        ))}
      </select>

      {usingMock && !realQ.isLoading && (
        <p className="text-[10px] text-amber-300/90">
          {t('packagePicker.noPublished', 'No published packages yet. Showing sample templates — head to Experience Packages in the dashboard to build your own.')}
        </p>
      )}

      {pkg && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
          <div className="text-xs text-slate-400 inline-flex items-center gap-1.5">
            <Tag className="h-3 w-3 text-slate-500" aria-hidden />
            {t('packagePicker.startingAt', 'Starting at')} <span className="text-slate-200">{pkg.startingPriceText}</span>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              {t('packagePicker.inclusionsTitle', 'Inclusions (tick what to include in this draft)')}
            </p>
            {pkg.inclusions.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t('packagePicker.noInclusions', 'No inclusions configured for this package.')}</p>
            ) : (
              <div className="space-y-1.5">
                {pkg.inclusions.map((inc) => {
                  const checked = selectedInclusions.includes(inc);
                  return (
                    <label
                      key={inc}
                      className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInclusion(inc)}
                        className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                      />
                      <span>{inc}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-500">
              {t('packagePicker.leaveUnticked', "Leave all unticked to include the package's default list in the draft.")}
            </p>
          </div>
          {pkg.policyNotes && (
            <p className="text-[11px] text-slate-400">
              <span className="text-slate-500">{t('packagePicker.notesPrefix', 'Notes:')} </span>
              {pkg.policyNotes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
