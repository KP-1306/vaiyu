// web/src/components/followup/FollowUpRowMenu.tsx
//
// Row-level action menu for follow-ups. Exposes the deferred RPCs that the
// initial UI didn't surface: Dismiss, Block (with reason), Unblock, Reopen.
//
// "Mark addressed" stays as the primary action button on the row itself —
// this menu is for the long-tail actions.

import { useEffect, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  MoreHorizontal,
  RotateCcw,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import type { FollowUpStatus } from '../../types/followUp';
import { useOwnerT } from '../../i18n/useOwnerT';

export interface FollowUpRowActions {
  onDismiss: (reason: string | null) => void;
  onBlock: (reason: string) => void;
  onUnblock: () => void;
  onReopen: () => void;
}

interface Props {
  status: FollowUpStatus;
  dismissed: boolean;
  actions: FollowUpRowActions;
  disabled?: boolean;
  testIdPrefix?: string;
}

type Mode =
  | { kind: 'closed' }
  | { kind: 'menu' }
  | { kind: 'block-form'; reason: string }
  | { kind: 'dismiss-form'; reason: string };

export function FollowUpRowMenu({
  status,
  dismissed,
  actions,
  disabled,
  testIdPrefix = 'follow-up',
}: Props) {
  const t = useOwnerT('owner-followup');
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside closes the menu/form
  useEffect(() => {
    if (mode.kind === 'closed') return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMode({ kind: 'closed' });
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMode({ kind: 'closed' });
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [mode.kind]);

  const canBlock = status !== 'BLOCKED' && status !== 'ADDRESSED' && !dismissed;
  const canUnblock = status === 'BLOCKED' && !dismissed;
  const canDismiss = !dismissed;
  const canReopen = dismissed || status === 'ADDRESSED';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMode((m) => (m.kind === 'closed' ? { kind: 'menu' } : { kind: 'closed' }))}
        disabled={disabled}
        aria-label={t('rowMenu.moreActions', 'More actions')}
        aria-haspopup="menu"
        aria-expanded={mode.kind !== 'closed'}
        data-testid={`${testIdPrefix}-row-menu-trigger`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>

      {mode.kind === 'menu' && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-slate-700 bg-[#0F1320] py-1 shadow-xl"
        >
          {canBlock && (
            <MenuItem
              icon={<Ban className="h-3.5 w-3.5 text-amber-300" />}
              label={t('rowMenu.markBlocked', 'Mark blocked')}
              onClick={() => setMode({ kind: 'block-form', reason: '' })}
              testId={`${testIdPrefix}-row-block`}
            />
          )}
          {canUnblock && (
            <MenuItem
              icon={<ShieldOff className="h-3.5 w-3.5 text-emerald-300" />}
              label={t('rowMenu.unblock', 'Unblock')}
              onClick={() => {
                actions.onUnblock();
                setMode({ kind: 'closed' });
              }}
              testId={`${testIdPrefix}-row-unblock`}
            />
          )}
          {canDismiss && (
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5 text-slate-400" />}
              label={t('rowMenu.dismiss', 'Dismiss')}
              onClick={() => setMode({ kind: 'dismiss-form', reason: '' })}
              testId={`${testIdPrefix}-row-dismiss`}
            />
          )}
          {canReopen && (
            <MenuItem
              icon={<RotateCcw className="h-3.5 w-3.5 text-emerald-300" />}
              label={t('rowMenu.reopen', 'Reopen')}
              onClick={() => {
                actions.onReopen();
                setMode({ kind: 'closed' });
              }}
              testId={`${testIdPrefix}-row-reopen`}
            />
          )}
        </div>
      )}

      {mode.kind === 'block-form' && (
        <ReasonForm
          title={t('rowMenu.blockTitle', 'Block this follow-up')}
          placeholder={t('rowMenu.blockPlaceholder', 'Why is this blocked? (e.g. open complaint, refund pending)')}
          confirmLabel={t('rowMenu.blockConfirm', 'Block')}
          confirmIcon={<Ban className="h-3.5 w-3.5" />}
          confirmTone="amber"
          requireReason
          value={mode.reason}
          onChange={(reason) => setMode({ kind: 'block-form', reason })}
          onCancel={() => setMode({ kind: 'closed' })}
          onConfirm={() => {
            if (!mode.reason.trim()) return;
            actions.onBlock(mode.reason.trim());
            setMode({ kind: 'closed' });
          }}
          testIdPrefix={`${testIdPrefix}-row-block`}
        />
      )}

      {mode.kind === 'dismiss-form' && (
        <ReasonForm
          title={t('rowMenu.dismissTitle', 'Dismiss this follow-up')}
          placeholder={t('rowMenu.dismissPlaceholder', 'Optional: why? (e.g. no longer relevant, guest cancelled)')}
          confirmLabel={t('rowMenu.dismissConfirm', 'Dismiss')}
          confirmIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          confirmTone="slate"
          value={mode.reason}
          onChange={(reason) => setMode({ kind: 'dismiss-form', reason })}
          onCancel={() => setMode({ kind: 'closed' })}
          onConfirm={() => {
            actions.onDismiss(mode.reason.trim() || null);
            setMode({ kind: 'closed' });
          }}
          testIdPrefix={`${testIdPrefix}-row-dismiss`}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
    >
      {icon}
      {label}
    </button>
  );
}

interface ReasonFormProps {
  title: string;
  placeholder: string;
  confirmLabel: string;
  confirmIcon: React.ReactNode;
  confirmTone: 'amber' | 'slate';
  requireReason?: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  testIdPrefix: string;
}

function ReasonForm({
  title,
  placeholder,
  confirmLabel,
  confirmIcon,
  confirmTone,
  requireReason,
  value,
  onChange,
  onCancel,
  onConfirm,
  testIdPrefix,
}: ReasonFormProps) {
  const t = useOwnerT('owner-followup');
  const confirmDisabled = requireReason && value.trim().length === 0;
  const confirmCls =
    confirmTone === 'amber'
      ? 'border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
      : 'border-slate-600 bg-slate-700/60 text-slate-100 hover:bg-slate-700';

  return (
    <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-slate-700 bg-[#0F1320] p-3 shadow-xl">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        autoFocus
        className="mt-2 w-full resize-y rounded-md border border-slate-700 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
        data-testid={`${testIdPrefix}-input`}
      />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
        >
          {t('rowMenu.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 disabled:cursor-not-allowed ${confirmCls}`}
          data-testid={`${testIdPrefix}-confirm`}
        >
          {confirmIcon}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
