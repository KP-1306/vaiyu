// web/src/components/packages/PackagePricingEditor.tsx
//
// Two-field pricing: numeric base (for Quote integration) + text display.
// Numeric is OPTIONAL; if set, we suggest a starting_price_text the operator
// can override.

import { Banknote, Lightbulb } from 'lucide-react';
import type { PackagePricingBasis } from '../../types/package';
import {
  PACKAGE_PRICING_BASIS_LABEL,
  PACKAGE_PRICING_BASIS_OPTIONS,
  suggestStartingPriceText,
} from '../../config/packages';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  basePriceRupees: number | null;
  basePriceBasis: PackagePricingBasis;
  startingPriceText: string;
  onBasePriceRupeesChange: (value: number | null) => void;
  onBasePriceBasisChange: (basis: PackagePricingBasis) => void;
  onStartingPriceTextChange: (value: string) => void;
  startingPriceTextError?: string;
}

export function PackagePricingEditor({
  basePriceRupees,
  basePriceBasis,
  startingPriceText,
  onBasePriceRupeesChange,
  onBasePriceBasisChange,
  onStartingPriceTextChange,
  startingPriceTextError,
}: Props) {
  const t = useOwnerT('owner-packages');
  const paise = basePriceRupees != null && Number.isFinite(basePriceRupees)
    ? Math.round(basePriceRupees * 100)
    : null;
  // Suggestion is guest-facing content (becomes the public starting_price_text) —
  // generated in English, never localised, matching the quote-draft precedent.
  const suggestion = paise != null ? suggestStartingPriceText(paise, basePriceBasis) : '';

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Banknote className="h-4 w-4 text-emerald-300" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-100">{t('pricing.title', 'Pricing')}</h3>
      </div>

      <p className="text-[11px] text-slate-500">
        {t('pricing.intro', 'The text below is what guests see on the package page. The optional numeric value feeds AI Quote Drafts when you build a quote from this package.')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr,1.4fr] gap-3">
        <Field label={t('pricing.numericBase', 'Numeric base (optional, ₹)')}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            value={basePriceRupees ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') onBasePriceRupeesChange(null);
              else {
                const n = Number(v);
                onBasePriceRupeesChange(Number.isFinite(n) ? n : null);
              }
            }}
            placeholder={t('pricing.numericPlaceholder', 'e.g. 8500')}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            data-testid="pricing-base-rupees"
          />
        </Field>

        <Field label={t('pricing.basis', 'Basis')}>
          <select
            value={basePriceBasis}
            onChange={(e) => onBasePriceBasisChange(e.target.value as PackagePricingBasis)}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
            data-testid="pricing-basis"
          >
            {PACKAGE_PRICING_BASIS_OPTIONS.map((b) => (
              <option key={b} value={b}>{t(`pricingBasis.${b}`, PACKAGE_PRICING_BASIS_LABEL[b])}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t('pricing.startingText', 'Starting-price text (shown to guests)')}>
        <input
          type="text"
          value={startingPriceText}
          onChange={(e) => onStartingPriceTextChange(e.target.value)}
          placeholder={t('pricing.startingPlaceholder', 'Starting ₹8,500 per room per night')}
          maxLength={100}
          className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
          data-testid="pricing-text"
        />
        {startingPriceTextError && <p className="mt-1 text-[10px] text-red-300">{startingPriceTextError}</p>}
      </Field>

      {suggestion && suggestion !== startingPriceText && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] text-emerald-200">
          <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1">
            {t('pricing.suggested', 'Suggested:')} <span className="font-mono">{suggestion}</span>
          </div>
          <button
            type="button"
            onClick={() => onStartingPriceTextChange(suggestion)}
            className="text-[11px] text-emerald-100 underline hover:text-emerald-50"
            data-testid="pricing-suggest-accept"
          >
            {t('pricing.useThis', 'Use this')}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
