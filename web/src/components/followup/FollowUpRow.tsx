// web/src/components/followup/FollowUpRow.tsx
//
// One follow-up record. Renders chips, priority pill, blocked warning, and the
// two allowed actions: "Mark addressed" (in-memory only) and "Copy note"
// (clipboard). NO send actions, NO ticket writes.

import { useState } from 'react';
import { AlertCircle, Check, Copy, User } from 'lucide-react';
import type { FollowUpItem, FollowUpPriority, FollowUpStatus } from '../../types/followUp';
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  isDueToday,
  isOverdue,
  todayIsoLocal,
} from '../../config/followUpRadar';
import { FollowUpBlockedWarning } from './FollowUpBlockedBanner';
import { FollowUpRowMenu, type FollowUpRowActions } from './FollowUpRowMenu';
import { track } from '../../lib/analytics';

type CopyState = 'idle' | 'copied' | 'error';

interface Props {
  item: FollowUpItem;
  /** True if the user has marked it addressed in this session. */
  isAddressedOverlay: boolean;
  /** True if the row is soft-dismissed (has a non-null dismissed_at). */
  dismissed?: boolean;
  onMarkAddressed: (id: string) => void;
  onDismiss?: (id: string, reason: string | null) => void;
  onBlock?: (id: string, reason: string) => void;
  onUnblock?: (id: string) => void;
  onReopen?: (id: string) => void;
}

const PRIORITY_PILL: Record<FollowUpPriority, string> = {
  CRITICAL: 'bg-red-500/15 text-red-200 border-red-500/40',
  HIGH: 'bg-orange-500/15 text-orange-200 border-orange-500/40',
  MEDIUM: 'bg-amber-500/10 text-amber-200 border-amber-500/30',
  LOW: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
};

const STATUS_PILL: Record<FollowUpStatus, string> = {
  PENDING: 'bg-slate-700/40 text-slate-200 border-slate-600',
  DUE: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  OVERDUE: 'bg-red-500/15 text-red-200 border-red-500/40',
  BLOCKED: 'bg-red-700/25 text-red-100 border-red-500/50',
  ADDRESSED: 'bg-slate-700/30 text-slate-300 border-slate-600',
};

function dueLabel(dueAt: string): string {
  const today = todayIsoLocal();
  if (dueAt === today) return 'Due today';
  if (isOverdue(dueAt)) {
    const diffMs = new Date(today).getTime() - new Date(dueAt).getTime();
    const days = Math.max(1, Math.round(diffMs / 86400000));
    return `Overdue by ${days} day${days === 1 ? '' : 's'}`;
  }
  // Future
  const diffMs = new Date(dueAt).getTime() - new Date(today).getTime();
  const days = Math.max(1, Math.round(diffMs / 86400000));
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export function FollowUpRow({
  item,
  isAddressedOverlay,
  dismissed = false,
  onMarkAddressed,
  onDismiss,
  onBlock,
  onUnblock,
  onReopen,
}: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const addressed = isAddressedOverlay || item.status === 'ADDRESSED';
  const blocked = item.status === 'BLOCKED' || !!item.blockedReason;

  // Row-level menu actions are optional — if the parent didn't wire them
  // (e.g. older callers), we hide the menu entirely. New callers pass all four.
  const menuActions: FollowUpRowActions | null =
    onDismiss && onBlock && onUnblock && onReopen
      ? {
          onDismiss: (reason) => onDismiss(item.id, reason),
          onBlock: (reason) => onBlock(item.id, reason),
          onUnblock: () => onUnblock(item.id),
          onReopen: () => onReopen(item.id),
        }
      : null;

  async function copyNote() {
    // navigator.clipboard requires a secure context (https or localhost).
    // Fall back to a visible error so the user knows the click didn't silently fail.
    if (!navigator.clipboard?.writeText) {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(item.recommendedManualAction);
      setCopyState('copied');
      track('follow_up_copy_note', { id: item.id, category: item.category });
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  return (
    <article
      data-testid={`follow-up-row-${item.id}`}
      className={`rounded-2xl border bg-[#151A25] p-4 transition-colors ${
        blocked
          ? 'border-red-500/30'
          : isDueToday(item.dueAt) && !addressed
          ? 'border-emerald-500/30'
          : isOverdue(item.dueAt) && !addressed
          ? 'border-red-500/20'
          : 'border-slate-800'
      } ${addressed ? 'opacity-70' : ''}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-100 break-words">
            {item.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400 break-words">{item.context}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_PILL[item.priority]}`}
          >
            {PRIORITY_LABEL[item.priority]}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              STATUS_PILL[addressed ? 'ADDRESSED' : item.status]
            }`}
          >
            {STATUS_LABEL[addressed ? 'ADDRESSED' : item.status]}
          </span>
          {menuActions && (
            <FollowUpRowMenu
              status={item.status}
              dismissed={dismissed}
              actions={menuActions}
            />
          )}
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-200">
          {CATEGORY_LABEL[item.category]}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-slate-500">Due:</span>
          <span className="text-slate-200">{dueLabel(item.dueAt)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3 text-slate-500" aria-hidden />
          <span className="text-slate-300">{item.assignedTo ?? 'Unassigned'}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-slate-500">
          <span className="font-mono text-[10px]">{item.entityReference}</span>
        </span>
      </div>

      {blocked && item.blockedReason && (
        <div className="mt-3">
          <FollowUpBlockedWarning reason={item.blockedReason} />
        </div>
      )}

      <div className="mt-3 rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Recommended next step
        </p>
        <p className="mt-1 text-xs text-slate-200">{item.recommendedManualAction}</p>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={copyNote}
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
            copyState === 'error'
              ? 'border-red-500/50 bg-red-500/10 text-red-200'
              : 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-800'
          }`}
          data-testid={`follow-up-copy-${item.id}`}
        >
          {copyState === 'copied' ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              Copied
            </>
          ) : copyState === 'error' ? (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-hidden />
              Copy failed
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy note
            </>
          )}
        </button>
        <button
          type="button"
          disabled={addressed || blocked}
          onClick={() => onMarkAddressed(item.id)}
          title={
            blocked
              ? 'Resolve the guest issue first — outreach is blocked.'
              : addressed
              ? 'Already marked addressed in this session.'
              : 'Mark this follow-up as addressed (session only).'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          data-testid={`follow-up-mark-${item.id}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          {addressed ? 'Addressed' : 'Mark addressed'}
        </button>
      </footer>
    </article>
  );
}
