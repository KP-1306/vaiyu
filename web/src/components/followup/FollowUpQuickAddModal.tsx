// web/src/components/followup/FollowUpQuickAddModal.tsx
//
// Manual-create modal for follow-ups. Operator types a title, picks a
// category (defaults to DIRECT_ENQUIRY), optionally sets a due date and
// priority. Submit hits the create_follow_up RPC.

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type {
  FollowUpCategory,
  FollowUpPriority,
} from '../../types/followUp';
import {
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  todayIsoLocal,
} from '../../config/followUpRadar';
import {
  createFollowUp,
  FollowUpServiceError,
} from '../../services/followUpService';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  open: boolean;
  hotelId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function FollowUpQuickAddModal({ open, hotelId, onClose, onCreated }: Props) {
  const t = useOwnerT('owner-followup');
  const [category, setCategory] = useState<FollowUpCategory>('DIRECT_ENQUIRY');
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [dueAt, setDueAt] = useState(todayIsoLocal());
  const [priority, setPriority] = useState<FollowUpPriority | ''>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setCategory('DIRECT_ENQUIRY');
    setTitle('');
    setContext('');
    setDueAt(todayIsoLocal());
    setPriority('');
    setErr(null);
    setBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr(t('quickAdd.titleRequired', 'Title is required'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createFollowUp({
        hotelId,
        category,
        title: title.trim(),
        context: context.trim(),
        dueAt,
        priority: priority || undefined,
      });
      reset();
      onClose();
      onCreated();
    } catch (e) {
      const msg = e instanceof FollowUpServiceError ? e.message : (e as Error).message;
      setErr(msg ?? t('quickAdd.couldNotCreate', 'Could not create follow-up'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vaiyu-owner fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F1320] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{t('quickAdd.title', 'Add follow-up')}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t('quickAdd.subtitle', "Manual entry — for items the system didn't auto-create.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-md p-1.5 text-slate-400 hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Field label={t('quickAdd.category', 'Category')}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FollowUpCategory)}
              className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              data-testid="follow-up-quickadd-category"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`, CATEGORY_LABEL[c])}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('quickAdd.titleField', 'Title')}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('quickAdd.titlePlaceholder', 'e.g. Call Mr Sharma about the wedding enquiry')}
              autoFocus
              maxLength={140}
              className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              data-testid="follow-up-quickadd-title"
            />
          </Field>

          <Field label={t('quickAdd.context', 'Context (optional)')}>
            <textarea
              rows={2}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              maxLength={500}
              placeholder={t('quickAdd.contextPlaceholder', 'A line or two about what to do.')}
              className="w-full resize-y rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('quickAdd.dueDate', 'Due date')}>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              />
            </Field>
            <Field label={t('quickAdd.priorityOptional', 'Priority (optional)')}>
              <select
                value={priority}
                onChange={(e) => setPriority((e.target.value || '') as FollowUpPriority | '')}
                className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                <option value="">{t('quickAdd.autoByCategory', 'Auto (by category)')}</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`, PRIORITY_LABEL[p])}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {err && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              {t('quickAdd.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="follow-up-quickadd-submit"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t('quickAdd.createFollowUp', 'Create follow-up')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
