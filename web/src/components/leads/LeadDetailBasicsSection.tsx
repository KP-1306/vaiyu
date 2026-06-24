// web/src/components/leads/LeadDetailBasicsSection.tsx

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit2, Loader2 } from 'lucide-react';
import type { Lead } from '../../types/lead';
import { updateLeadBasics, LeadServiceError } from '../../services/leadService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';
import { fieldInputCls } from './leadDetailStyles';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  lead: Lead;
  canEdit: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavedRefresh: () => void;
}

interface FormState {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  value: string;
  sourceDetail: string;
  tagsCsv: string;
}

function initialState(lead: Lead): FormState {
  return {
    checkIn: lead.requested_check_in ?? '',
    checkOut: lead.requested_check_out ?? '',
    adults: lead.party_adults,
    children: lead.party_children,
    rooms: lead.room_count,
    value: lead.value_estimate?.toString() ?? '',
    sourceDetail: lead.source_detail ?? '',
    tagsCsv: lead.tags.join(', '),
  };
}

export function LeadDetailBasicsSection({
  lead,
  canEdit,
  showToast,
  onDirtyChange,
  onSavedRefresh,
}: Props) {
  const t = useOwnerT('owner-leads');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(initialState(lead));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initialState(lead));
    setError(null);
  }, [lead.id, lead.requested_check_in, lead.requested_check_out, lead.party_adults,
      lead.party_children, lead.room_count, lead.value_estimate, lead.source_detail, lead.tags]);

  const initial = initialState(lead);
  const dirty =
    editing &&
    (form.checkIn !== initial.checkIn ||
      form.checkOut !== initial.checkOut ||
      form.adults !== initial.adults ||
      form.children !== initial.children ||
      form.rooms !== initial.rooms ||
      form.value !== initial.value ||
      form.sourceDetail !== initial.sourceDetail ||
      form.tagsCsv !== initial.tagsCsv);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: () => {
      const tags = form.tagsCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return updateLeadBasics(lead.id, {
        checkIn: form.checkIn || undefined,
        checkOut: form.checkOut || undefined,
        partyAdults: form.adults,
        partyChildren: form.children,
        roomCount: form.rooms,
        valueEstimate: form.value === '' ? undefined : Number(form.value),
        sourceDetail: form.sourceDetail.trim() || undefined,
        tags,
      });
    },
    onSuccess: () => {
      showToast(t('basics.updatedToast', 'Stay details updated'), 'success');
      setEditing(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-events', lead.id] });
      onSavedRefresh();
    },
    onError: (err) => {
      const lse = err as LeadServiceError;
      const msg = humanizeError(lse, t);
      setError(msg);
      showToast(msg, 'error');
    },
  });

  function handleCancel() {
    setForm(initialState(lead));
    setError(null);
    setEditing(false);
  }

  function handleSubmit() {
    setError(null);
    if (form.checkIn && form.checkOut && form.checkOut <= form.checkIn) {
      setError(t('basics.checkoutAfterCheckin', 'Check-out must be after check-in'));
      return;
    }
    mutation.mutate();
  }

  const partyStr =
    lead.party_children > 0
      ? `${t('basics.adults', '{{count}} adults', { count: lead.party_adults })}, ${t('basics.children', '{{count}} children', { count: lead.party_children })}`
      : t('basics.adults', '{{count}} adults', { count: lead.party_adults });

  return (
    <section
      data-testid="lead-detail-basics-section"
      className="border-b border-white/10 px-5 py-4"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60">{t('basics.heading', 'Stay details')}</h3>
        {!editing && canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
          >
            <Edit2 className="h-3 w-3" />
            {t('basics.edit', 'Edit')}
          </button>
        )}
      </header>

      {!editing ? (
        <dl className="space-y-1.5 text-sm">
          <Row label={t('basics.checkIn', 'Check-in')} value={lead.requested_check_in ?? '—'} />
          <Row label={t('basics.checkOut', 'Check-out')} value={lead.requested_check_out ?? '—'} />
          <Row label={t('basics.party', 'Party')} value={partyStr} />
          <Row label={t('basics.rooms', 'Rooms')} value={String(lead.room_count)} />
          <Row label={t('basics.value', 'Value')} value={lead.value_estimate != null ? `₹${lead.value_estimate}` : '—'} />
          <Row label={t('basics.sourceDetail', 'Source detail')} value={lead.source_detail ?? '—'} />
          <Row label={t('basics.tags', 'Tags')} value={lead.tags.length > 0 ? lead.tags.join(', ') : '—'} />
        </dl>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('basics.checkIn', 'Check-in')}>
              <input
                type="date"
                value={form.checkIn}
                onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                disabled={mutation.isPending}
                className={fieldInputCls(false)}
              />
            </Field>
            <Field label={t('basics.checkOut', 'Check-out')}>
              <input
                type="date"
                value={form.checkOut}
                onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                disabled={mutation.isPending}
                className={fieldInputCls(false)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('basics.adultsField', 'Adults')}>
              <input
                type="number"
                min={0}
                value={form.adults}
                onChange={(e) => setForm({ ...form, adults: Number(e.target.value) || 0 })}
                disabled={mutation.isPending}
                className={fieldInputCls(false)}
              />
            </Field>
            <Field label={t('basics.childrenField', 'Children')}>
              <input
                type="number"
                min={0}
                value={form.children}
                onChange={(e) => setForm({ ...form, children: Number(e.target.value) || 0 })}
                disabled={mutation.isPending}
                className={fieldInputCls(false)}
              />
            </Field>
            <Field label={t('basics.roomsField', 'Rooms')}>
              <input
                type="number"
                min={1}
                value={form.rooms}
                onChange={(e) => setForm({ ...form, rooms: Number(e.target.value) || 1 })}
                disabled={mutation.isPending}
                className={fieldInputCls(false)}
              />
            </Field>
          </div>
          <Field label={t('basics.valueEstimate', 'Value estimate (₹)')}>
            <input
              type="number"
              min={0}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              disabled={mutation.isPending}
              className={fieldInputCls(false)}
            />
          </Field>
          <Field label={t('basics.sourceDetail', 'Source detail')}>
            <input
              type="text"
              value={form.sourceDetail}
              onChange={(e) => setForm({ ...form, sourceDetail: e.target.value })}
              disabled={mutation.isPending}
              className={fieldInputCls(false)}
            />
          </Field>
          <Field label={t('basics.tagsField', 'Tags (comma-separated)')}>
            <input
              type="text"
              value={form.tagsCsv}
              onChange={(e) => setForm({ ...form, tagsCsv: e.target.value })}
              disabled={mutation.isPending}
              placeholder={t('basics.tagsPlaceholder', 'honeymoon, repeat_guest')}
              className={fieldInputCls(false)}
            />
          </Field>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-xs text-white/70 hover:text-white disabled:opacity-50"
            >
              {t('basics.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {t('basics.save', 'Save')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs text-white/40 w-28 shrink-0">{label}</dt>
      <dd className="text-white text-sm truncate">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-white/70 mb-1">{label}</span>
      {children}
    </label>
  );
}
