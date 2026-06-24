// web/src/components/leads/LeadDetailNotesSection.tsx

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Loader2, Clock } from 'lucide-react';
import type { LeadEvent } from '../../types/lead';
import { addLeadNote, LeadServiceError } from '../../services/leadService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface Props {
  leadId: string;
  events: LeadEvent[];
  canEdit: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

const MAX_PREVIEW_NOTES = 5;

function formatRelative(iso: string, t: OwnerT): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return t('rel.justNow', 'just now');
  if (diffMin < 60) return t('rel.mAgo', '{{m}}m ago', { m: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t('rel.hAgo', '{{h}}h ago', { h: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return t('rel.dAgo', '{{d}}d ago', { d: diffDay });
  return t('rel.moAgo', '{{mo}}mo ago', { mo: Math.round(diffDay / 30) });
}

export function LeadDetailNotesSection({ leadId, events, canEdit, showToast }: Props) {
  const t = useOwnerT('owner-leads');
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const noteEvents = events.filter((e) => e.event_type === 'NOTE_ADDED').slice(0, MAX_PREVIEW_NOTES);

  const mutation = useMutation({
    mutationFn: () => addLeadNote(leadId, text.trim()),
    onSuccess: () => {
      showToast(t('notes.addedToast', 'Note added'), 'success');
      setText('');
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['lead-events', leadId] });
    },
    onError: (err) => {
      const lse = err as LeadServiceError;
      showToast(humanizeError(lse, t), 'error');
    },
  });

  function handleSubmit() {
    if (text.trim() === '') return;
    mutation.mutate();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <section
      data-testid="lead-detail-notes-section"
      className="border-b border-white/10 px-5 py-4"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60">{t('notes.heading', 'Notes')}</h3>
      </header>

      {canEdit && (
        <div className="space-y-2 mb-4">
          <textarea
            data-testid="lead-detail-add-note-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={mutation.isPending}
            placeholder={t('notes.placeholder', 'Add a note (Ctrl+Enter to save)')}
            className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none disabled:opacity-50 resize-y"
          />
          <div className="flex items-center justify-end">
            <button
              type="button"
              data-testid="lead-detail-add-note-submit"
              onClick={handleSubmit}
              disabled={mutation.isPending || text.trim() === ''}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquarePlus className="h-3 w-3" />}
              {t('notes.addNote', 'Add note')}
            </button>
          </div>
        </div>
      )}

      {noteEvents.length === 0 ? (
        <div className="text-xs text-white/30 italic">{t('notes.noNotes', 'No notes yet')}</div>
      ) : (
        <ul className="space-y-2">
          {noteEvents.map((event) => {
            if (event.event_type !== 'NOTE_ADDED') return null;
            return (
              <li
                key={event.id}
                className="rounded-md border border-white/10 bg-white/[0.02] p-2.5"
              >
                <div className="text-sm text-white whitespace-pre-wrap break-words">
                  {event.payload.text}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/40">
                  <span>{event.payload.by_user_name ?? t('notes.unknown', 'unknown')}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatRelative(event.occurred_at, t)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {events.filter((e) => e.event_type === 'NOTE_ADDED').length > MAX_PREVIEW_NOTES && (
        <div className="mt-2 text-[11px] text-white/40">
          {t('notes.showingRecent', 'Showing {{count}} most recent notes — full history in timeline below.', { count: MAX_PREVIEW_NOTES })}
        </div>
      )}
    </section>
  );
}
