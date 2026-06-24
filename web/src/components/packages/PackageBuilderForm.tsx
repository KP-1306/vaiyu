// web/src/components/packages/PackageBuilderForm.tsx
//
// Main builder form. Composes the sub-section components and tracks one draft
// in local state. Auto-syncs slug from name unless the operator has manually
// edited the slug (sticky once edited).

import { useState } from 'react';
import {
  CATEGORY_HINGLISH_HINT,
  PACKAGE_CATEGORY_LABEL,
  PACKAGE_CATEGORY_OPTIONS,
} from '../../config/packages';
import type { PackageCategory } from '../../types/package';
import {
  autoSlugFromName,
  emptyDraft,
  humanizeError,
  validate,
  type PackageFormDraft,
} from './PackageBuilderForm.validation';
import { PackageInclusionsEditor } from './PackageInclusionsEditor';
import { PackageSeasonPicker } from './PackageSeasonPicker';
import { PackagePricingEditor } from './PackagePricingEditor';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  initial?: Partial<PackageFormDraft>;
  /** Disable name+slug edits (used for edit mode where slug is already taken). */
  lockSlug?: boolean;
  busy?: boolean;
  submitLabel?: string;
  onSubmit: (draft: PackageFormDraft) => void;
  onCancel?: () => void;
}

export function PackageBuilderForm({
  initial,
  lockSlug = false,
  busy = false,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const t = useOwnerT('owner-packages');
  const [draft, setDraft] = useState<PackageFormDraft>({ ...emptyDraft(), ...initial });
  const [slugTouched, setSlugTouched] = useState<boolean>(!!initial?.slug);

  function patch<K extends keyof PackageFormDraft>(key: K, value: PackageFormDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(name: string) {
    setDraft((prev) => ({
      ...prev,
      name,
      slug: slugTouched || lockSlug ? prev.slug : autoSlugFromName(name),
    }));
  }

  const result = validate(draft);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.ok) return;
    onSubmit(draft);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Marketing core */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">{t('form.marketing', 'Marketing')}</h3>

        <Field label={t('form.name', 'Package name')} error={result.errors.name && humanizeError(result.errors.name, t)}>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('form.namePlaceholder', 'e.g. Char Dham Yatra Special — 4N')}
            maxLength={120}
            className={inputCls(!!result.errors.name)}
            data-testid="package-name"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('form.slug', 'URL slug')} error={result.errors.slug && humanizeError(result.errors.slug, t)}>
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => {
                setSlugTouched(true);
                patch('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
              disabled={lockSlug}
              placeholder="char-dham-yatra-4n"
              maxLength={80}
              className={inputCls(!!result.errors.slug)}
              data-testid="package-slug"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              {t('form.slugHelp', 'Public URL will be')} <span className="font-mono">/p/&lt;hotel&gt;/package/{draft.slug || '—'}</span>
            </p>
          </Field>

          <Field label={t('form.category', 'Category')}>
            <select
              value={draft.category}
              onChange={(e) => patch('category', e.target.value as PackageCategory)}
              className={inputCls(false)}
              data-testid="package-category"
            >
              {PACKAGE_CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>{t(`category.${c}`, PACKAGE_CATEGORY_LABEL[c])}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] italic text-slate-500">
              {t(`categoryHint.${draft.category}`, CATEGORY_HINGLISH_HINT[draft.category])}
            </p>
          </Field>
        </div>

        <Field label={t('form.targetGuest', 'Target guest type (optional)')}>
          <input
            type="text"
            value={draft.targetGuestType}
            onChange={(e) => patch('targetGuestType', e.target.value)}
            placeholder={t('form.targetGuestPlaceholder', 'e.g. Couples, families with young kids, devotees')}
            className={inputCls(false)}
          />
        </Field>

        <Field label={t('form.shortPitch', 'Short pitch (1-2 sentences for cards)')} error={result.errors.shortPitch && humanizeError(result.errors.shortPitch, t)}>
          <textarea
            rows={2}
            value={draft.shortPitch}
            onChange={(e) => patch('shortPitch', e.target.value)}
            placeholder={t('form.shortPitchPlaceholder', 'A short summary the operator (and guest) sees on the package card.')}
            maxLength={280}
            className={inputCls(!!result.errors.shortPitch)}
          />
        </Field>

        <Field label={t('form.longDesc', 'Long description (markdown ok)')} error={result.errors.longDescription && humanizeError(result.errors.longDescription, t)}>
          <textarea
            rows={5}
            value={draft.longDescription}
            onChange={(e) => patch('longDescription', e.target.value)}
            placeholder={t('form.longDescPlaceholder', "Day-by-day plan, what makes it special, anything you'd say on a brochure.")}
            maxLength={8000}
            className={inputCls(!!result.errors.longDescription)}
          />
        </Field>

        <Field label={t('form.heroImage', 'Hero image URL (optional)')}>
          <input
            type="url"
            value={draft.heroImageUrl}
            onChange={(e) => patch('heroImageUrl', e.target.value)}
            placeholder={t('form.heroImagePlaceholder', 'https://… (upload elsewhere; paste link)')}
            className={inputCls(false)}
          />
        </Field>
      </section>

      {/* Stay shape */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">{t('form.stayShape', 'Stay shape')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('form.nights', 'Nights')} error={result.errors.durationNights && humanizeError(result.errors.durationNights, t)}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={draft.durationNights}
              onChange={(e) => patch('durationNights', Number(e.target.value) || 0)}
              className={inputCls(!!result.errors.durationNights)}
              data-testid="package-nights"
            />
          </Field>
          <Field label={t('form.minAdults', 'Min adults')} error={result.errors.minPartyAdults && humanizeError(result.errors.minPartyAdults, t)}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.minPartyAdults}
              onChange={(e) => patch('minPartyAdults', Number(e.target.value) || 1)}
              className={inputCls(!!result.errors.minPartyAdults)}
            />
          </Field>
          <Field label={t('form.maxAdults', 'Max adults')} error={result.errors.maxPartyAdults && humanizeError(result.errors.maxPartyAdults, t)}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={draft.maxPartyAdults ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                patch('maxPartyAdults', v === '' ? null : Number(v) || null);
              }}
              className={inputCls(!!result.errors.maxPartyAdults)}
            />
          </Field>
        </div>
      </section>

      <PackageSeasonPicker
        months={draft.seasonMonths}
        onMonthsChange={(v) => patch('seasonMonths', v)}
        validFrom={draft.validFrom}
        validUntil={draft.validUntil}
        onValidFromChange={(v) => patch('validFrom', v)}
        onValidUntilChange={(v) => patch('validUntil', v)}
        dateError={result.errors.validUntil && humanizeError(result.errors.validUntil, t)}
      />

      <PackageInclusionsEditor
        food={draft.foodInclusions}
        activity={draft.activityInclusions}
        transfer={draft.transferInclusions}
        custom={draft.customInclusions}
        onFoodChange={(v) => patch('foodInclusions', v)}
        onActivityChange={(v) => patch('activityInclusions', v)}
        onTransferChange={(v) => patch('transferInclusions', v)}
        onCustomChange={(v) => patch('customInclusions', v)}
      />

      <PackagePricingEditor
        basePriceRupees={draft.basePriceRupees}
        basePriceBasis={draft.basePriceBasis}
        startingPriceText={draft.startingPriceText}
        onBasePriceRupeesChange={(v) => patch('basePriceRupees', v)}
        onBasePriceBasisChange={(v) => patch('basePriceBasis', v)}
        onStartingPriceTextChange={(v) => patch('startingPriceText', v)}
        startingPriceTextError={
          result.errors.startingPriceText && humanizeError(result.errors.startingPriceText, t)
        }
      />

      {/* CTA + internal notes */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">{t('form.ctaSection', 'CTA & internal notes')}</h3>

        <Field label={t('form.ctaLabel', 'Enquiry CTA label')} error={result.errors.enquiryCtaLabel && humanizeError(result.errors.enquiryCtaLabel, t)}>
          <input
            type="text"
            value={draft.enquiryCtaLabel}
            onChange={(e) => patch('enquiryCtaLabel', e.target.value)}
            placeholder={t('form.ctaPlaceholder', 'Enquire now / WhatsApp us / Plan my yatra')}
            maxLength={40}
            className={inputCls(!!result.errors.enquiryCtaLabel)}
          />
        </Field>

        <Field label={t('form.internalNotes', 'Internal notes (not shown to guests)')}>
          <textarea
            rows={3}
            value={draft.internalNotes}
            onChange={(e) => patch('internalNotes', e.target.value)}
            placeholder={t('form.internalNotesPlaceholder', 'Reminders for your team: vendor contacts, pickup arrangements, blackout dates.')}
            className={inputCls(false)}
          />
        </Field>
      </section>

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            {t('form.cancel', 'Cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={!result.ok || busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="package-submit-button"
        >
          {submitLabel ?? t('form.saveDraft', 'Save draft')}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | false;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </span>
      {children}
      {error && <span className="mt-1 block text-[10px] text-red-300">{error}</span>}
    </label>
  );
}

function inputCls(hasErr: boolean): string {
  return `w-full rounded-md border bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none ${
    hasErr ? 'border-red-500/60 focus:border-red-400' : 'border-slate-700 focus:border-emerald-400'
  }`;
}
