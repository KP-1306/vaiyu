// web/src/components/seo/BlueprintForm.tsx
//
// Composed editor for an SEO blueprint draft. Drives a live Policy-Shield
// classification + (in edit mode) optional risk override with required note.

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  SEO_CATEGORY_HINT,
  SEO_CATEGORY_LABEL,
  SEO_CATEGORY_OPTIONS,
  SEO_CONNECTED_MODULE_OPTIONS,
  SEO_RISK_LABEL,
} from '../../config/localSeoPlanner';
import type {
  SeoBlueprintCategory,
  SeoBlueprintRisk,
  SeoProofItem,
} from '../../types/seoBlueprint';
import {
  classifyDraft,
  defaultProofFor,
  humanizeError,
  validate,
  type ProofContext,
  type SeoBlueprintFormDraft,
} from './BlueprintForm.validation';
import { PolicyShieldBanner } from './PolicyShieldBanner';
import { ProofChecklist } from './ProofChecklist';

const OVERRIDE_OPTIONS: SeoBlueprintRisk[] = [
  'SAFE_BLUEPRINT', 'NEEDS_PROOF', 'RISKY_DOORWAY',
  'FAKE_LOCAL_CLAIM', 'DUPLICATE_LOW_VALUE', 'ON_HOLD',
];

interface SubmitPayload {
  draft: SeoBlueprintFormDraft;
  riskOverride: SeoBlueprintRisk | null;
  overrideReason: string;
}

interface Props {
  initial: SeoBlueprintFormDraft;
  /** When editing an existing blueprint, the owner may override the computed risk (with a reason). */
  allowOverride?: boolean;
  /** Optional hotel context — specialises generic proof labels (e.g. city). */
  proofContext?: ProofContext;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (payload: SubmitPayload) => void;
  onCancel: () => void;
}

export function BlueprintForm({
  initial,
  allowOverride = false,
  proofContext,
  busy = false,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<SeoBlueprintFormDraft>(initial);
  const [riskOverride, setRiskOverride] = useState<SeoBlueprintRisk | null>(null);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [touched, setTouched] = useState(false);

  // Live (client-mirrored) Policy-Shield classification — server still wins on write.
  const computedRisk = useMemo(() => classifyDraft(draft, false), [draft]);

  const validation = useMemo(
    () => validate(draft, { riskOverride, overrideReason }),
    [draft, riskOverride, overrideReason],
  );

  function setCategory(cat: SeoBlueprintCategory) {
    setDraft((prev) => ({
      ...prev,
      targetCategory: cat,
      // Re-seed proof items when the category changes (preserve previously satisfied keys).
      requiredProof: mergeProof(defaultProofFor(cat, proofContext), prev.requiredProof),
    }));
  }

  function setProof(next: SeoProofItem[]) {
    setDraft((prev) => ({ ...prev, requiredProof: next }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!validation.ok) return;
    onSubmit({ draft, riskOverride, overrideReason });
  }

  const errors = touched ? validation.errors : {};

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="blueprint-form"
    >
      {/* Page-title concept */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Concept</h3>

        <Field label="Page-title concept" error={errors.TITLE_REQUIRED ? humanizeError('TITLE_REQUIRED') : errors.TITLE_TOO_LONG ? humanizeError('TITLE_TOO_LONG') : undefined}>
          <input
            type="text"
            value={draft.pageTitleConcept}
            onChange={(e) => setDraft((d) => ({ ...d, pageTitleConcept: e.target.value }))}
            placeholder='e.g. "Family stay in Mukteshwar"'
            maxLength={160}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            data-testid="blueprint-title"
          />
        </Field>

        <Field label="Target category">
          <select
            value={draft.targetCategory}
            onChange={(e) => setCategory(e.target.value as SeoBlueprintCategory)}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            data-testid="blueprint-category"
          >
            {SEO_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{SEO_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">{SEO_CATEGORY_HINT[draft.targetCategory]}</p>
        </Field>
      </section>

      {/* Live Policy Shield + Proof checklist */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Policy Shield</h3>
        <PolicyShieldBanner risk={computedRisk} />

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Proof checklist (advisory in v0)
          </p>
          <ProofChecklist items={draft.requiredProof} onChange={setProof} />
        </div>
      </section>

      {/* Guidance */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Guidance</h3>

        <Field label="Why it matters (optional)">
          <textarea
            value={draft.whyItMatters}
            onChange={(e) => setDraft((d) => ({ ...d, whyItMatters: e.target.value }))}
            placeholder="What kind of guest would land here, and what would convert them?"
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
          />
        </Field>

        <Field label="Hinglish guidance (optional)">
          <textarea
            value={draft.hinglishGuidance}
            onChange={(e) => setDraft((d) => ({ ...d, hinglishGuidance: e.target.value }))}
            placeholder='e.g. "Asli photos chahiye, Char Dham route ka time honestly likhna."'
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
          />
        </Field>

        <Field label="Safe next action (optional)">
          <input
            type="text"
            value={draft.safeNextAction}
            onChange={(e) => setDraft((d) => ({ ...d, safeNextAction: e.target.value }))}
            placeholder='e.g. "Upload 5 real photos and a local-attractions list"'
            maxLength={1000}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
          />
        </Field>

        <Field label="Connected module suggestion (optional)">
          <select
            value={draft.connectedModuleSuggestion}
            onChange={(e) => setDraft((d) => ({ ...d, connectedModuleSuggestion: e.target.value }))}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          >
            {SEO_CONNECTED_MODULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </section>

      {/* Notes */}
      <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">Notes</h3>
        <Field label="Owner notes (visible to all hotel members)">
          <textarea
            value={draft.ownerNotes}
            onChange={(e) => setDraft((d) => ({ ...d, ownerNotes: e.target.value }))}
            rows={2}
            maxLength={4000}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </Field>
        <Field label="Internal notes (manager-level context)">
          <textarea
            value={draft.internalNotes}
            onChange={(e) => setDraft((d) => ({ ...d, internalNotes: e.target.value }))}
            rows={2}
            maxLength={4000}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </Field>
      </section>

      {/* Risk override (edit mode only) */}
      {allowOverride && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-300 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-100">Override the Policy Shield</p>
              <p className="text-[11px] text-amber-200/80">
                Use only when a human assertion overrides the deterministic flag (e.g. you've verified a fake local claim, or are parking this idea). A reason is required and recorded in audit.
              </p>
            </div>
          </div>
          <Field label="Override risk to">
            <select
              value={riskOverride ?? ''}
              onChange={(e) => setRiskOverride((e.target.value || null) as SeoBlueprintRisk | null)}
              className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              data-testid="risk-override"
            >
              <option value="">— No override (use computed: {SEO_RISK_LABEL[computedRisk]}) —</option>
              {OVERRIDE_OPTIONS.map((r) => (
                <option key={r} value={r}>{SEO_RISK_LABEL[r]}</option>
              ))}
            </select>
          </Field>
          {riskOverride && (
            <Field
              label="Reason (required)"
              error={errors.OVERRIDE_REASON_REQUIRED ? humanizeError('OVERRIDE_REASON_REQUIRED') : undefined}
            >
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder='e.g. "Verified false claim — landmark is actually 80km away."'
                className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                data-testid="override-reason"
              />
            </Field>
          )}
        </section>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || (touched && !validation.ok)}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="blueprint-submit"
        >
          {busy ? 'Saving…' : submitLabel}
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
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </span>
      {children}
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
    </label>
  );
}

/**
 * Merge default proof items for a category with previously-satisfied items by
 * key, so changing categories doesn't erase ticks the user already made.
 */
function mergeProof(defaults: SeoProofItem[], prev: SeoProofItem[]): SeoProofItem[] {
  const prevByKey = new Map(prev.map((p) => [p.key, p.satisfied]));
  return defaults.map((p) => ({ ...p, satisfied: prevByKey.get(p.key) ?? false }));
}
