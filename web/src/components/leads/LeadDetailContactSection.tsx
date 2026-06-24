// web/src/components/leads/LeadDetailContactSection.tsx

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit2, Loader2 } from 'lucide-react';
import type { Lead } from '../../types/lead';
import { updateLeadContact, LeadServiceError } from '../../services/leadService';
import {
  humanizeError,
  extractFieldErrors,
} from './LeadQuickAddModal.errorMapping';
import { fieldInputCls } from './leadDetailStyles';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  lead: Lead;
  canEdit: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavedRefresh: () => void;
}

export function LeadDetailContactSection({
  lead,
  canEdit,
  showToast,
  onDirtyChange,
  onSavedRefresh,
}: Props) {
  const t = useOwnerT('owner-leads');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lead.contact_name);
  const [phone, setPhone] = useState(lead.contact_phone ?? '');
  const [email, setEmail] = useState(lead.contact_email ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});

  useEffect(() => {
    setName(lead.contact_name);
    setPhone(lead.contact_phone ?? '');
    setEmail(lead.contact_email ?? '');
    setErrors({});
  }, [lead.id, lead.contact_name, lead.contact_phone, lead.contact_email]);

  const dirty =
    editing &&
    (name !== lead.contact_name ||
      (phone || '') !== (lead.contact_phone ?? '') ||
      (email || '') !== (lead.contact_email ?? ''));

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: () =>
      updateLeadContact(lead.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      }),
    onSuccess: () => {
      showToast(t('contact.updatedToast', 'Contact updated'), 'success');
      setEditing(false);
      setErrors({});
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-events', lead.id] });
      onSavedRefresh();
    },
    onError: (err) => {
      const lse = err as LeadServiceError;
      showToast(humanizeError(lse, t), 'error');
      const fe = extractFieldErrors(lse, t);
      setErrors({
        name: fe.contactName,
        phone: fe.contactPhone,
        email: fe.contactEmail,
      });
    },
  });

  function handleCancel() {
    setName(lead.contact_name);
    setPhone(lead.contact_phone ?? '');
    setEmail(lead.contact_email ?? '');
    setErrors({});
    setEditing(false);
  }

  function handleSubmit() {
    setErrors({});
    if (!name.trim()) {
      setErrors({ name: t('validation.nameRequired', 'Name is required') });
      return;
    }
    if (!phone.trim() && !email.trim()) {
      const msg = t('validation.phoneOrEmailRequired', 'Phone or email is required');
      setErrors({ phone: msg, email: msg });
      return;
    }
    mutation.mutate();
  }

  return (
    <section
      data-testid="lead-detail-contact-section"
      className="border-b border-white/10 px-5 py-4"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60">{t('contact.heading', 'Contact')}</h3>
        {!editing && canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
          >
            <Edit2 className="h-3 w-3" />
            {t('contact.edit', 'Edit')}
          </button>
        )}
      </header>

      {!editing ? (
        <dl className="space-y-1.5 text-sm">
          <Row label={t('contact.name', 'Name')} value={lead.contact_name} />
          <Row label={t('contact.phone', 'Phone')} value={lead.contact_phone ?? '—'} mono />
          <Row label={t('contact.email', 'Email')} value={lead.contact_email ?? '—'} />
        </dl>
      ) : (
        <div className="space-y-3">
          <Field label={t('contact.name', 'Name')} error={errors.name} required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={mutation.isPending}
              className={fieldInputCls(!!errors.name)}
            />
          </Field>
          <Field label={t('contact.phone', 'Phone')} error={errors.phone}>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={mutation.isPending}
              placeholder={t('contact.phonePlaceholder', '+91 98765 43210')}
              className={fieldInputCls(!!errors.phone)}
            />
          </Field>
          <Field label={t('contact.email', 'Email')} error={errors.email}>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mutation.isPending}
              className={fieldInputCls(!!errors.email)}
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-xs text-white/70 hover:text-white disabled:opacity-50"
            >
              {t('contact.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {t('contact.save', 'Save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs text-white/40 w-16 shrink-0">{label}</dt>
      <dd className={`text-white truncate ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-white/70 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
      {error && <span className="block text-[11px] text-red-400 mt-1">{error}</span>}
    </label>
  );
}
