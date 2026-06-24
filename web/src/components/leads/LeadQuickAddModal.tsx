// web/src/components/leads/LeadQuickAddModal.tsx
//
// Thin shell modal wiring up the extracted helpers:
//   - validation.ts     — client-side field checks
//   - optimistic.ts     — build the cache-injected row
//   - errorMapping.ts   — humanize server errors + field-level highlights
//   - useFocusTrap.ts   — keyboard accessibility
//
// CRITICAL INVARIANT (do not break): onSuccess does NOT setQueryData with the
// real result. Only onMutate (add optimistic) and onError (rollback) call
// setQueryData. The realtime invalidation triggered in onSettled handles the
// canonical refetch.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { createLead, LeadServiceError } from '../../services/leadService';
import type {
  CreateLeadInput,
  CreateLeadResult,
  Lead,
  LeadSource,
} from '../../types/lead';
import { LEAD_SOURCE_CONFIG } from './LeadSourceIcon.config';
import {
  validateLeadInput,
  hasValidationErrors,
  firstErrorField,
  type ValidationErrors,
} from './LeadQuickAddModal.validation';
import { buildOptimisticLead } from './LeadQuickAddModal.optimistic';
import { humanizeError, extractFieldErrors } from './LeadQuickAddModal.errorMapping';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

const SOURCE_OPTIONS = Object.entries(LEAD_SOURCE_CONFIG).map(([value, cfg]) => ({
  value: value as LeadSource,
  label: cfg.label,
}));

const EMPTY_INPUT: CreateLeadInput = {
  hotelId: '',
  source: 'WALK_IN',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  sourceDetail: '',
  checkIn: '',
  checkOut: '',
  partyAdults: 1,
  partyChildren: 0,
  roomCount: 1,
  notes: '',
};

export function LeadQuickAddModal({ hotelId, isOpen, onClose, showToast }: Props) {
  const t = useOwnerT('owner-leads');
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<CreateLeadInput>({ ...EMPTY_INPUT, hotelId });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] =
    useState<CreateLeadResult['duplicate_warning']>(null);

  const mutation = useMutation({
    mutationFn: (input: CreateLeadInput) => createLead(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['leads', hotelId] });
      const prev = queryClient.getQueryData<Lead[]>(['leads', hotelId]) ?? [];
      const userResp = await supabase.auth.getUser();
      const optimistic = buildOptimisticLead(input, hotelId, userResp.data.user?.id ?? null);
      queryClient.setQueryData<Lead[]>(['leads', hotelId], [optimistic, ...prev]);
      return { prev };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['leads', hotelId], ctx.prev);
      const lse = err as LeadServiceError;
      const msg = humanizeError(lse, t);
      setSubmitError(msg);
      setErrors(extractFieldErrors(lse, t));
      showToast(msg, 'error');
    },
    onSuccess: (result) => {
      // INVARIANT: do NOT setQueryData here. Refetch in onSettled is the canonical source.
      showToast(t('quickAdd.createdToast', 'Lead created — {{name}}', { name: form.contactName.trim() }), 'success');
      if (result.duplicate_warning) {
        setDuplicateWarning(result.duplicate_warning);
        // Keep modal open so user can review the duplicate banner
      } else {
        handleClose();
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', hotelId] });
    },
  });

  // Reset form whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setForm({ ...EMPTY_INPUT, hotelId });
      setErrors({});
      setSubmitError(null);
      setDuplicateWarning(null);
    }
  }, [isOpen, hotelId]);

  // Focus trap
  useFocusTrap(modalRef, isOpen);

  // Esc key closes (but not while in-flight)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mutation.isPending) {
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mutation.isPending]);

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function update<K extends keyof CreateLeadInput>(key: K, value: CreateLeadInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear per-field error on edit
    if (errors[key as keyof ValidationErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setDuplicateWarning(null);

    const trimmed: CreateLeadInput = {
      ...form,
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone?.trim() || undefined,
      contactEmail: form.contactEmail?.trim() || undefined,
      sourceDetail: form.sourceDetail?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      checkIn: form.checkIn || undefined,
      checkOut: form.checkOut || undefined,
    };

    const validationErrors = validateLeadInput(trimmed, t);
    if (hasValidationErrors(validationErrors)) {
      setErrors(validationErrors);
      // Focus first errored field
      const firstField = firstErrorField(validationErrors);
      if (firstField) {
        const el = modalRef.current?.querySelector<HTMLElement>(
          `[name="${firstField}"]`,
        );
        el?.focus();
      }
      return;
    }

    mutation.mutate(trimmed);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onMouseDown={(e) => {
        // Close on backdrop click (but ignore clicks bubbled from inside the modal)
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-modal-title"
        data-testid="lead-quick-add-modal"
        className="
          w-full sm:max-w-2xl bg-[#101218] sm:rounded-2xl
          border-t sm:border border-white/10
          max-h-[95vh] flex flex-col overflow-hidden
        "
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h2 id="lead-modal-title" className="text-base font-semibold text-white">
            {t('quickAdd.title', 'New lead')}
          </h2>
          <button
            type="button"
            aria-label={t('quickAdd.close', 'Close')}
            onClick={handleClose}
            disabled={mutation.isPending}
            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Source + source detail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('quickAdd.source', 'Source')} required htmlFor="lead-source">
              <select
                id="lead-source"
                name="source"
                value={form.source}
                onChange={(e) => update('source', e.target.value as LeadSource)}
                disabled={mutation.isPending}
                className={selectCls}
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(`source.${opt.value}`, opt.label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('quickAdd.sourceDetail', 'Source detail')} htmlFor="lead-source-detail">
              <input
                id="lead-source-detail"
                name="sourceDetail"
                type="text"
                value={form.sourceDetail ?? ''}
                onChange={(e) => update('sourceDetail', e.target.value)}
                placeholder={t('quickAdd.sourceDetailPlaceholder', 'e.g. Booking.com / Ramesh Travels')}
                disabled={mutation.isPending}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Contact name */}
          <Field
            label={t('quickAdd.guestName', 'Guest name')}
            required
            htmlFor="lead-name"
            error={errors.contactName}
          >
            <input
              ref={firstFieldRef}
              id="lead-name"
              name="contactName"
              type="text"
              value={form.contactName}
              onChange={(e) => update('contactName', e.target.value)}
              autoFocus
              autoComplete="name"
              aria-required="true"
              aria-invalid={!!errors.contactName}
              aria-describedby={errors.contactName ? 'lead-name-error' : undefined}
              disabled={mutation.isPending}
              className={inputCls + errorBorder(errors.contactName)}
              data-testid="lead-form-name"
            />
          </Field>

          {/* Phone + email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label={t('quickAdd.phone', 'Phone')}
              htmlFor="lead-phone"
              hint={t('quickAdd.phoneOrEmailHint', 'Phone or email is required')}
              error={errors.contactPhone}
            >
              <input
                id="lead-phone"
                name="contactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.contactPhone ?? ''}
                onChange={(e) => update('contactPhone', e.target.value)}
                placeholder={t('quickAdd.phonePlaceholder', '+91 98765 43210')}
                aria-invalid={!!errors.contactPhone}
                aria-describedby={errors.contactPhone ? 'lead-phone-error' : undefined}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.contactPhone)}
                data-testid="lead-form-phone"
              />
            </Field>
            <Field label={t('quickAdd.email', 'Email')} htmlFor="lead-email" error={errors.contactEmail}>
              <input
                id="lead-email"
                name="contactEmail"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.contactEmail ?? ''}
                onChange={(e) => update('contactEmail', e.target.value)}
                placeholder={t('quickAdd.emailPlaceholder', 'guest@example.com')}
                aria-invalid={!!errors.contactEmail}
                aria-describedby={errors.contactEmail ? 'lead-email-error' : undefined}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.contactEmail)}
              />
            </Field>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('quickAdd.checkIn', 'Check-in')} htmlFor="lead-checkin" error={errors.checkIn}>
              <input
                id="lead-checkin"
                name="checkIn"
                type="date"
                value={form.checkIn ?? ''}
                onChange={(e) => update('checkIn', e.target.value)}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.checkIn)}
              />
            </Field>
            <Field label={t('quickAdd.checkOut', 'Check-out')} htmlFor="lead-checkout" error={errors.checkOut}>
              <input
                id="lead-checkout"
                name="checkOut"
                type="date"
                value={form.checkOut ?? ''}
                onChange={(e) => update('checkOut', e.target.value)}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.checkOut)}
              />
            </Field>
          </div>

          {/* Party + rooms + value */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            <Field label={t('quickAdd.adults', 'Adults')} htmlFor="lead-adults" error={errors.partyAdults}>
              <input
                id="lead-adults"
                name="partyAdults"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.partyAdults ?? 1}
                onChange={(e) => update('partyAdults', Number(e.target.value) || 0)}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.partyAdults)}
              />
            </Field>
            <Field label={t('quickAdd.children', 'Children')} htmlFor="lead-children" error={errors.partyChildren}>
              <input
                id="lead-children"
                name="partyChildren"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.partyChildren ?? 0}
                onChange={(e) => update('partyChildren', Number(e.target.value) || 0)}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.partyChildren)}
              />
            </Field>
            <Field label={t('quickAdd.rooms', 'Rooms')} htmlFor="lead-rooms" error={errors.roomCount}>
              <input
                id="lead-rooms"
                name="roomCount"
                type="number"
                inputMode="numeric"
                min={1}
                value={form.roomCount ?? 1}
                onChange={(e) => update('roomCount', Number(e.target.value) || 1)}
                disabled={mutation.isPending}
                className={inputCls + errorBorder(errors.roomCount)}
              />
            </Field>
            <Field label={t('quickAdd.estValue', 'Est. value (₹)')} htmlFor="lead-value">
              <input
                id="lead-value"
                name="valueEstimate"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.valueEstimate ?? ''}
                onChange={(e) =>
                  update('valueEstimate', e.target.value === '' ? undefined : Number(e.target.value))
                }
                placeholder={t('quickAdd.estValuePlaceholder', '0')}
                disabled={mutation.isPending}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Notes */}
          <Field label={t('quickAdd.notes', 'Notes')} htmlFor="lead-notes">
            <textarea
              id="lead-notes"
              name="notes"
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              placeholder={t('quickAdd.notesPlaceholder', 'What did the guest ask for? Any preferences?')}
              disabled={mutation.isPending}
              className={inputCls + ' resize-y'}
            />
          </Field>

          {/* Submission error banner */}
          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Duplicate warning (post-success, modal stays open) */}
          {duplicateWarning && (
            <div
              role="alert"
              data-testid="lead-duplicate-warning"
              className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"
            >
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">{t('quickAdd.duplicateCreated', 'Lead created.')}</div>
                <div className="text-xs text-amber-200/80 mt-0.5">
                  {t('quickAdd.duplicateHeadsUp', 'Heads up — a similar lead exists from {{count}} days ago ({{status}}). You may want to review it.', {
                    count: duplicateWarning.days_ago,
                    status: t(`status.${duplicateWarning.recent_status}`, duplicateWarning.recent_status),
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-xs underline text-amber-200/80 hover:text-amber-100"
              >
                {t('quickAdd.close', 'Close')}
              </button>
            </div>
          )}
        </form>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('quickAdd.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            data-testid="lead-form-submit"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[120px] justify-center"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('quickAdd.saving', 'Saving…')}
              </>
            ) : (
              t('quickAdd.saveLead', 'Save lead')
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Internal small components ────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ';
const selectCls = inputCls;

function errorBorder(err: string | undefined): string {
  return err ? ' !border-red-500/60' : '';
}

interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, required, error, hint, children }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-xs font-medium text-white/70 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="block text-[11px] text-red-400 mt-1">
          {error}
        </span>
      )}
      {!error && hint && (
        <span className="block text-[11px] text-white/40 mt-1">{hint}</span>
      )}
    </label>
  );
}
