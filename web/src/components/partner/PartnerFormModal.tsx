// web/src/components/partner/PartnerFormModal.tsx
//
// Single modal that handles both create and edit for a partner. Validates
// client-side to match the DB CHECK constraints (kind ↔ category alignment,
// email format, commission only on AGENT, etc.) so the operator gets clear
// feedback before the RPC bounces.

import { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  createPartner,
  updatePartner,
  PartnerServiceError,
} from '../../services/partnerService';
import {
  PARTNER_AGENT_CATEGORIES,
  PARTNER_CATEGORY_LABEL,
  PARTNER_VENDOR_CATEGORIES,
  categoriesForKind,
  type Partner,
  type PartnerCategory,
  type PartnerKind,
} from '../../types/partner';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface CreateProps {
  open: boolean;
  mode: 'create';
  hotelId: string;
  initialKind?: PartnerKind;
  onClose: () => void;
  onSaved: (id: string) => void;
}

interface EditProps {
  open: boolean;
  mode: 'edit';
  partner: Partner;
  onClose: () => void;
  onSaved: (id: string) => void;
}

type Props = CreateProps | EditProps;

interface FormState {
  partnerName: string;
  kind: PartnerKind;
  category: PartnerCategory;
  serviceArea: string;
  servicesOfferedRaw: string;       // comma-separated input
  preferredUseCase: string;
  priceNoteText: string;
  emergencyAvailability: boolean;
  contactName: string;
  contactPhone: string;
  alternateContact: string;
  email: string;
  notes: string;
  tagsRaw: string;
  commissionPctRaw: string;
  payoutTerms: string;
}

function initialState(props: Props): FormState {
  if (props.mode === 'edit') {
    const p = props.partner;
    return {
      partnerName: p.partner_name,
      kind: p.kind,
      category: p.category,
      serviceArea: p.service_area,
      servicesOfferedRaw: p.services_offered.join(', '),
      preferredUseCase: p.preferred_use_case,
      priceNoteText: p.price_note_text,
      emergencyAvailability: p.emergency_availability,
      contactName: p.contact_name,
      contactPhone: p.contact_phone ?? '',
      alternateContact: p.alternate_contact ?? '',
      email: p.email ?? '',
      notes: p.notes,
      tagsRaw: p.tags.join(', '),
      commissionPctRaw: p.commission_pct != null ? String(p.commission_pct) : '',
      payoutTerms: p.payout_terms ?? '',
    };
  }
  const kind = props.initialKind ?? 'VENDOR';
  return {
    partnerName: '',
    kind,
    category: (kind === 'AGENT' ? PARTNER_AGENT_CATEGORIES : PARTNER_VENDOR_CATEGORIES)[0],
    serviceArea: '',
    servicesOfferedRaw: '',
    preferredUseCase: '',
    priceNoteText: '',
    emergencyAvailability: false,
    contactName: '',
    contactPhone: '',
    alternateContact: '',
    email: '',
    notes: '',
    tagsRaw: '',
    commissionPctRaw: '',
    payoutTerms: '',
  };
}

function splitChips(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function PartnerFormModal(props: Props) {
  const t = useOwnerT('owner-partner');
  const nameId      = useId();
  const categoryId  = useId();
  const phoneId     = useId();
  const altPhoneId  = useId();
  const emailId     = useId();
  const areaId      = useId();
  const useCaseId   = useId();
  const priceId     = useId();
  const notesId     = useId();
  const servicesId  = useId();
  const tagsId      = useId();
  const commissionId = useId();
  const payoutId    = useId();

  const [form, setForm] = useState<FormState>(() => initialState(props));
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Reset form when reopening (or props change).
  useEffect(() => {
    if (props.open) {
      setForm(initialState(props));
      setErrorCode(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.open,
    props.mode,
    props.mode === 'edit' ? props.partner.id : undefined,
    props.mode === 'create' ? props.initialKind : undefined,
  ]);

  // When the kind changes (create mode only), reset category to a valid one.
  useEffect(() => {
    if (props.mode === 'create') {
      const valid = categoriesForKind(form.kind);
      if (!valid.includes(form.category)) {
        setForm((f) => ({ ...f, category: valid[0] }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.kind, props.mode]);

  const categories = useMemo(() => categoriesForKind(form.kind), [form.kind]);

  const isEmailValid =
    form.email.trim() === '' ||
    (form.email.length >= 5 && form.email.length <= 254 && EMAIL_RE.test(form.email));

  const commissionPctNum =
    form.commissionPctRaw.trim() === '' ? null : Number(form.commissionPctRaw);
  const isCommissionValid =
    commissionPctNum === null ||
    (Number.isFinite(commissionPctNum) && commissionPctNum >= 0 && commissionPctNum <= 100);

  const canSubmit =
    !busy &&
    form.partnerName.trim().length > 0 &&
    isEmailValid &&
    isCommissionValid;

  if (!props.open) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setErrorCode(null);
    try {
      const commonInput = {
        partnerName: form.partnerName.trim(),
        category: form.category,
        serviceArea: form.serviceArea.trim(),
        servicesOffered: splitChips(form.servicesOfferedRaw),
        preferredUseCase: form.preferredUseCase.trim(),
        priceNoteText: form.priceNoteText.trim(),
        emergencyAvailability: form.emergencyAvailability,
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim() || null,
        alternateContact: form.alternateContact.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim(),
        tags: splitChips(form.tagsRaw),
        commissionPct: form.kind === 'AGENT' ? commissionPctNum : null,
        payoutTerms: form.kind === 'AGENT' ? (form.payoutTerms.trim() || null) : null,
      };

      if (props.mode === 'create') {
        const { id } = await createPartner({
          hotelId: props.hotelId,
          kind: form.kind,
          ...commonInput,
        });
        props.onSaved(id);
        props.onClose();
      } else {
        await updatePartner({
          id: props.partner.id,
          ...commonInput,
          clearCommission: form.kind === 'AGENT' ? false : true,
        });
        props.onSaved(props.partner.id);
        props.onClose();
      }
    } catch (e) {
      if (e instanceof PartnerServiceError) setErrorCode(e.code);
      else setErrorCode('UNKNOWN_ERROR');
    } finally {
      setBusy(false);
    }
  };

  const title = props.mode === 'create' ? t('form.addTitle', 'Add partner') : t('form.editTitle', 'Edit partner');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${nameId}-title`}
      className="vaiyu-owner fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) props.onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-700 bg-[#0F1320] text-slate-100 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-[#0F1320] px-5 py-3">
          <h2 id={`${nameId}-title`} className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            aria-label={t('form.closeAriaLabel', 'Close')}
            className="text-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Kind toggle — create only; edit cannot change kind to keep audit clean */}
          {props.mode === 'create' && (
            <div className="grid grid-cols-2 gap-2">
              {(['VENDOR', 'AGENT'] as PartnerKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  disabled={busy}
                  className={
                    form.kind === k
                      ? 'rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200'
                      : 'rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800'
                  }
                >
                  {k === 'AGENT' ? t('kind.agentDescriptor', 'Agent (commissionable booker)') : t('kind.vendorDescriptor', 'Vendor (operational supplier)')}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField id={nameId} label={t('form.partnerName', 'Partner name')} required>
              <input
                id={nameId}
                value={form.partnerName}
                onChange={(e) => setForm((f) => ({ ...f, partnerName: e.target.value }))}
                disabled={busy}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                maxLength={120}
              />
            </FormField>

            <FormField id={categoryId} label={t('form.category', 'Category')} required>
              <select
                id={categoryId}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as PartnerCategory }))}
                disabled={busy}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{t(`category.${c}`, PARTNER_CATEGORY_LABEL[c])}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField id={areaId} label={t('form.serviceArea', 'Service area')}>
              <input
                id={areaId}
                value={form.serviceArea}
                onChange={(e) => setForm((f) => ({ ...f, serviceArea: e.target.value }))}
                disabled={busy}
                placeholder="e.g. Rishikesh, Haridwar, Dehradun"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </FormField>

            <FormField id={priceId} label={t('form.priceNote', 'Price note (free text)')}>
              <input
                id={priceId}
                value={form.priceNoteText}
                onChange={(e) => setForm((f) => ({ ...f, priceNoteText: e.target.value }))}
                disabled={busy}
                placeholder="e.g. ₹1500/day, negotiable"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </FormField>
          </div>

          <FormField id={servicesId} label={t('form.servicesOffered', 'Services offered (comma-separated)')}>
            <input
              id={servicesId}
              value={form.servicesOfferedRaw}
              onChange={(e) => setForm((f) => ({ ...f, servicesOfferedRaw: e.target.value }))}
              disabled={busy}
              placeholder="e.g. Tempo Traveller, Innova, Sedan"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            />
          </FormField>

          <FormField id={useCaseId} label={t('form.preferredUseCase', 'Preferred use case (when to call them)')}>
            <input
              id={useCaseId}
              value={form.preferredUseCase}
              onChange={(e) => setForm((f) => ({ ...f, preferredUseCase: e.target.value }))}
              disabled={busy}
              placeholder="e.g. Char Dham bulk transfers, family safari"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            />
          </FormField>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.emergencyAvailability}
              onChange={(e) => setForm((f) => ({ ...f, emergencyAvailability: e.target.checked }))}
              disabled={busy}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
            />
            {t('form.emergency', 'Emergency availability (responds outside business hours)')}
          </label>

          <div className="border-t border-slate-800 pt-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">{t('form.contactSection', 'Contact')}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField id="contact-name" label={t('form.contactPerson', 'Contact person')}>
                <input
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  disabled={busy}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                />
              </FormField>
              <FormField id={emailId} label={t('form.email', 'Email')}>
                <input
                  id={emailId}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={busy}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                />
                {form.email.trim() && !isEmailValid && (
                  <p className="mt-1 text-[11px] text-amber-300">{t('form.invalidEmail', "Doesn't look like a valid email.")}</p>
                )}
              </FormField>
              <FormField id={phoneId} label={t('form.phone', 'Phone (auto-normalised)')}>
                <input
                  id={phoneId}
                  type="tel"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  disabled={busy}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                />
              </FormField>
              <FormField id={altPhoneId} label={t('form.altPhone', 'Alternate phone')}>
                <input
                  id={altPhoneId}
                  type="tel"
                  value={form.alternateContact}
                  onChange={(e) => setForm((f) => ({ ...f, alternateContact: e.target.value }))}
                  disabled={busy}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                />
              </FormField>
            </div>
          </div>

          {form.kind === 'AGENT' && (
            <div className="border-t border-slate-800 pt-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-amber-300">
                {t('form.agentCommission', 'Agent commission (manual ledger — not auto-paid)')}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField id={commissionId} label={t('form.commissionPct', 'Default commission %')}>
                  <input
                    id={commissionId}
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={form.commissionPctRaw}
                    onChange={(e) => setForm((f) => ({ ...f, commissionPctRaw: e.target.value }))}
                    disabled={busy}
                    placeholder="e.g. 10"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                  />
                  {!isCommissionValid && (
                    <p className="mt-1 text-[11px] text-amber-300">{t('form.invalidCommission', 'Must be between 0 and 100.')}</p>
                  )}
                </FormField>
                <FormField id={payoutId} label={t('form.payoutTerms', 'Payout terms')}>
                  <input
                    id={payoutId}
                    value={form.payoutTerms}
                    onChange={(e) => setForm((f) => ({ ...f, payoutTerms: e.target.value }))}
                    disabled={busy}
                    placeholder="e.g. Net 30 days, UPI"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                  />
                </FormField>
              </div>
            </div>
          )}

          <FormField id={tagsId} label={t('form.tags', 'Tags (comma-separated)')}>
            <input
              id={tagsId}
              value={form.tagsRaw}
              onChange={(e) => setForm((f) => ({ ...f, tagsRaw: e.target.value }))}
              disabled={busy}
              placeholder="e.g. local, English-speaking, GST-registered"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            />
          </FormField>

          <FormField id={notesId} label={t('form.internalNotes', 'Internal notes')}>
            <textarea
              id={notesId}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              disabled={busy}
              rows={3}
              className="w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
            />
          </FormField>

          {errorCode && (
            <div role="alert" className="rounded-md border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200">
              {partnerErrorLabel(errorCode, t)}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-800 bg-[#0F1320] px-5 py-3">
          <button
            type="button"
            onClick={props.onClose}
            disabled={busy}
            className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {t('form.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="partner-submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {busy ? t('form.saving', 'Saving…') : (props.mode === 'create' ? t('form.add', 'Add partner') : t('form.save', 'Save changes'))}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function partnerErrorLabel(code: string, t?: OwnerT): string {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  switch (code) {
    case 'NAME_REQUIRED':        return tr('error.NAME_REQUIRED', 'Partner name is required.');
    case 'INVALID_CATEGORY':     return tr('error.INVALID_CATEGORY', 'Pick a valid category for this kind.');
    case 'INVALID_KIND':         return tr('error.INVALID_KIND', 'Pick Vendor or Agent.');
    case 'INVALID_EMAIL':        return tr('error.INVALID_EMAIL', "That email doesn't look right.");
    case 'INVALID_COMMISSION_PCT': return tr('error.INVALID_COMMISSION_PCT', 'Commission must be 0-100.');
    case 'VENDOR_NO_COMMISSION': return tr('error.VENDOR_NO_COMMISSION', "Vendor rows can't carry commission. Switch to Agent kind first.");
    case 'NOT_AUTHORIZED':       return tr('error.NOT_AUTHORIZED', "You don't have permission to manage partners for this hotel.");
    case 'ARCHIVED_NOT_EDITABLE': return tr('error.ARCHIVED_NOT_EDITABLE', 'This partner is archived. Unarchive first.');
    case 'PARTNER_NOT_FOUND':    return tr('error.PARTNER_NOT_FOUND', 'Partner no longer exists.');
    default:                     return tr('error.UNKNOWN_ERROR', 'Save failed. Please try again.');
  }
}
