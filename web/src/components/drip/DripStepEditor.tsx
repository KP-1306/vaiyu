// web/src/components/drip/DripStepEditor.tsx
//
// Inline editor for a single drip_step. Operator can change:
//   • subject_template
//   • body_template (multi-line)
//   • delay_hours
//   • active toggle
//
// Save calls update_drip_step_template RPC which writes an audit row to
// va_audit_logs. No-op if no field changed.

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

import { updateDripStepTemplate, DripServiceError } from '../../services/dripService';
import { DRIP_PLACEHOLDERS, type DripStep } from '../../types/drip';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  step: DripStep;
  onSaved?: () => void;
}

export function DripStepEditor({ step, onSaved }: Props) {
  const t = useOwnerT('owner-drip');
  const [subject, setSubject] = useState(step.subject_template);
  const [body, setBody] = useState(step.body_template);
  const [delayHours, setDelayHours] = useState(String(step.delay_hours));
  const [active, setActive] = useState(step.active);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-sync when the step prop changes (e.g., after another save invalidates cache).
  useEffect(() => {
    setSubject(step.subject_template);
    setBody(step.body_template);
    setDelayHours(String(step.delay_hours));
    setActive(step.active);
  }, [step.id, step.subject_template, step.body_template, step.delay_hours, step.active]);

  const delayNum = Number(delayHours);
  const dirty =
    subject !== step.subject_template ||
    body !== step.body_template ||
    delayNum !== step.delay_hours ||
    active !== step.active;
  const subjectValid = subject.trim().length > 0;
  const bodyValid    = body.trim().length > 0;
  const delayValid   = Number.isFinite(delayNum) && delayNum >= 0;

  const canSave = dirty && !busy && subjectValid && bodyValid && delayValid;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateDripStepTemplate({
        stepId: step.id,
        subjectTemplate: subject !== step.subject_template ? subject : undefined,
        bodyTemplate:    body !== step.body_template       ? body    : undefined,
        delayHours:      delayNum !== step.delay_hours     ? delayNum : undefined,
        active:          active !== step.active            ? active   : undefined,
      });
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError(e instanceof DripServiceError ? e.code : 'UNKNOWN_ERROR');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">
          {t('step.label', 'Step {{n}}', { n: step.step_idx + 1 })} · <code className="text-slate-300">{step.template_code}</code>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            disabled={busy}
            className="h-3 w-3 rounded border-slate-600 bg-slate-900"
          />
          {t('step.active', 'Active')}
        </label>
      </div>

      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
            {t('step.sendWhen', 'Send when (hours from subscription start)')}
          </label>
          <input
            type="number"
            min="0"
            value={delayHours}
            onChange={(e) => setDelayHours(e.target.value)}
            disabled={busy}
            className="w-32 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
          {!delayValid && <p className="mt-0.5 text-[10.5px] text-amber-300">{t('step.nonNegative', 'Must be a non-negative number.')}</p>}
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">{t('step.subject', 'Subject')}</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">{t('step.body', 'Body')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
            rows={6}
            className="w-full resize-y rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-[10.5px] text-slate-500">
          {t('step.placeholders', 'Available placeholders:')}{' '}
          {DRIP_PLACEHOLDERS.map((p, i) => (
            <span key={p}>
              <code className="text-slate-300">{p}</code>
              {i < DRIP_PLACEHOLDERS.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {error && (
          <span className="text-[11px] text-red-300">
            {t(`step.error.${error}`, dripErrorLabel(error))}
          </span>
        )}
        {savedAt && !dirty && !busy && (
          <span className="text-[11px] text-emerald-300">{t('step.saved', 'Saved.')}</span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11.5px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Save className="h-3 w-3" aria-hidden />}
          {t('step.saveStep', 'Save step')}
        </button>
      </div>
    </div>
  );
}

function dripErrorLabel(code: string): string {
  switch (code) {
    case 'SUBJECT_REQUIRED': return 'Subject required.';
    case 'BODY_REQUIRED':    return 'Body required.';
    case 'INVALID_DELAY':    return 'Delay must be ≥ 0.';
    case 'NOT_AUTHORIZED':   return 'Manager role required.';
    case 'STEP_NOT_FOUND':   return 'Step no longer exists.';
    default:                 return 'Save failed.';
  }
}
