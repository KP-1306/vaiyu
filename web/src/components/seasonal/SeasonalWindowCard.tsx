// web/src/components/seasonal/SeasonalWindowCard.tsx
//
// One window's full surface in the workspace. Includes:
//   • header (title, urgency badge, days-until, dismissed/hidden state)
//   • dates (with approximate-window disclaimer)
//   • why-it-matters + recommended action
//   • checklist (SeasonalChecklist)
//   • owner notes editor (debounced save)
//   • governance actions (mark ready, dismiss, override urgency, hide)
//   • inline expandable timeline (replaces a heavier drawer per reviewer note)

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  X,
  Eye,
  EyeOff,
  Loader2,
  Clock,
} from 'lucide-react';

import {
  SEASONAL_PRIORITY_LABEL,
  SEASONAL_REVIEW_STATUS_LABEL,
  SEASONAL_URGENCY_LABEL,
  SEASONAL_URGENCY_TONE,
  formatDaysUntil,
  formatWindowRange,
  type UrgencyTone,
} from '../../config/seasonalCalendar';
import {
  dismissSeasonalWindowForYear,
  extractSeasonalErrorCode,
  friendlySeasonalError,
  getSeasonalWindowTimeline,
  markSeasonalWindowReady,
  overrideSeasonalWindowUrgency,
  resumeSeasonalWindow,
  returnSeasonalWindowToPlanning,
  setSeasonalWindowPermanentlyHidden,
  SEASONAL_EVENT_LABEL,
  updateSeasonalWindowNotes,
} from '../../services/seasonalCalendarService';
import { seasonalCalendarQueryKeys } from '../../services/seasonalCalendarQueryKeys';
import type {
  SeasonalWindowUrgency,
  VisibleSeasonalWindow,
} from '../../types/seasonalCalendar';
import { SeasonalChecklist } from './SeasonalChecklist';

interface Props {
  hotelId: string;
  hotelSlug: string;
  window: VisibleSeasonalWindow;
  language: 'en' | 'hi';
  /** When true, governance actions (dismiss/mark-ready/override/hide) are hidden. */
  hideManagerActions?: boolean;
}

const URGENCY_BADGE: Record<UrgencyTone, string> = {
  rose:  'bg-rose-100 text-rose-800 border-rose-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  sky:   'bg-sky-100 text-sky-800 border-sky-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
};

const PRIORITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  HIGH:     'bg-amber-500',
  MEDIUM:   'bg-sky-500',
  LOW:      'bg-slate-400',
};

export function SeasonalWindowCard({ hotelId, hotelSlug, window: w, language, hideManagerActions }: Props) {
  const qc = useQueryClient();
  const tone = SEASONAL_URGENCY_TONE[w.computed_urgency];
  const isDismissed = w.review_status === 'DISMISSED';
  const isReady = w.review_status === 'READY';
  const isHidden = w.is_permanently_hidden;

  // ── Local state for inline forms ──
  const [showTimeline, setShowTimeline] = useState(false);
  const [actionFormOpen, setActionFormOpen] = useState<null | 'dismiss' | 'override' | 'hide'>(null);
  const [reason, setReason] = useState('');
  const [overrideValue, setOverrideValue] = useState<SeasonalWindowUrgency>('QUIET');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Notes (debounced save) ──
  // localDirty prevents two failure modes:
  //   (1) realtime invalidation arriving mid-typing (before the 700ms debounce
  //       fires) would clobber the user's unsaved input via the sync useEffect
  //   (2) after a successful save we re-enable external sync
  const [ownerNotes, setOwnerNotes] = useState(w.owner_notes ?? '');
  const [localDirty, setLocalDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<Date | null>(null);
  const [notesErrorMsg, setNotesErrorMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Sync external (realtime) value into the textarea ONLY when the user
    // hasn't typed anything uncommitted. This protects unsaved local input
    // from being clobbered by a refetch.
    if ((w.owner_notes ?? '') !== ownerNotes && !notesSaving && !localDirty) {
      setOwnerNotes(w.owner_notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.owner_notes]);

  const saveNotes = (newValue: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setNotesSaving(true);
      setNotesErrorMsg(null);
      try {
        await updateSeasonalWindowNotes({
          hotelId,
          windowCode: w.window_code,
          ownerNotes: newValue,
        });
        setNotesSavedAt(new Date());
        setLocalDirty(false);
        qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
      } catch (err) {
        const code = extractSeasonalErrorCode(err);
        // Clear the stale "Saved" indicator so we don't show "Saved" alongside
        // a save-failed error from a later change. localDirty stays true so the
        // user's unsaved input isn't clobbered by realtime sync.
        setNotesSavedAt(null);
        setNotesErrorMsg(friendlySeasonalError(code, 'Could not save notes. Try again.'));
      } finally {
        setNotesSaving(false);
      }
    }, 700);
  };

  // ── Governance mutations ──
  const markReady = useMutation({
    mutationFn: () => markSeasonalWindowReady({ hotelId, windowCode: w.window_code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) }),
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not mark ready.')),
  });
  const returnToPlanning = useMutation({
    mutationFn: () => returnSeasonalWindowToPlanning({ hotelId, windowCode: w.window_code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) }),
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not return to planning.')),
  });
  const resume = useMutation({
    mutationFn: () => resumeSeasonalWindow({ hotelId, windowCode: w.window_code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) }),
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not resume.')),
  });
  const dismiss = useMutation({
    mutationFn: (r: string) => dismissSeasonalWindowForYear({ hotelId, windowCode: w.window_code, reason: r }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
      setActionFormOpen(null);
      setReason('');
    },
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not dismiss.')),
  });
  const override = useMutation({
    mutationFn: ({ urgency, r }: { urgency: SeasonalWindowUrgency | null; r?: string }) =>
      overrideSeasonalWindowUrgency({ hotelId, windowCode: w.window_code, urgency, reason: r }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
      setActionFormOpen(null);
      setReason('');
    },
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not override.')),
  });
  const setHidden = useMutation({
    mutationFn: ({ hidden, r }: { hidden: boolean; r?: string }) =>
      setSeasonalWindowPermanentlyHidden({ hotelId, windowCode: w.window_code, hidden, reason: r }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seasonalCalendarQueryKeys.list(hotelId) });
      setActionFormOpen(null);
      setReason('');
    },
    onError: (err) => setErrorMsg(friendlySeasonalError(extractSeasonalErrorCode(err), 'Could not update.')),
  });

  const title = language === 'en' ? w.display_name_en : w.display_name_hi;
  const why = language === 'en' ? w.why_it_matters_en : w.why_it_matters_hi;
  const reco = language === 'en' ? w.recommended_action_en : w.recommended_action_hi;
  const segment = language === 'en' ? w.target_guest_segment_en : w.target_guest_segment_hi;
  const pkgIdea = language === 'en' ? w.suggested_package_idea_en : w.suggested_package_idea_hi;
  const dateDisclaimer = language === 'en' ? w.date_disclaimer_en : w.date_disclaimer_hi;

  return (
    <article
      id={w.window_code}
      data-testid={`seasonal-window-${w.window_code}`}
      className={`scroll-mt-4 rounded-xl border bg-white p-4 shadow-sm transition-opacity ${
        isHidden ? 'opacity-60' : ''
      } ${isDismissed ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[w.priority] ?? PRIORITY_DOT.MEDIUM}`}
              aria-label={`Priority: ${SEASONAL_PRIORITY_LABEL[w.priority]}`}
            />
            <h3 className="truncate text-base font-semibold text-slate-900 sm:text-[15px]">{title}</h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-600">
            <Calendar className="h-3 w-3 text-slate-400" aria-hidden />
            <span>
              {formatWindowRange({
                startMonth: w.start_month,
                startDay: w.start_day,
                endMonth: w.end_month,
                endDay: w.end_day,
                isApproximate: w.is_approximate,
              })}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-medium text-slate-700">
              {formatDaysUntil(w.days_to_start, w.computed_urgency)}
            </span>
            {!w.is_regional_match && (
              <>
                <span className="text-slate-300">·</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                  May not apply to your region
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isDismissed ? (
            <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {SEASONAL_REVIEW_STATUS_LABEL.DISMISSED}
            </span>
          ) : isReady ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="h-3 w-3" aria-hidden /> {SEASONAL_REVIEW_STATUS_LABEL.READY}
            </span>
          ) : (
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${URGENCY_BADGE[tone]}`}
            >
              {SEASONAL_URGENCY_LABEL[w.computed_urgency]}
              {w.urgency_override && <span className="ml-1 text-[9px] normal-case opacity-80">(override)</span>}
            </span>
          )}
          {isHidden && (
            <span
              className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
              title={w.permanently_hidden_reason ?? undefined}
            >
              Hidden
            </span>
          )}
        </div>
      </div>

      {/* ── Approximate-date disclaimer ── */}
      {w.is_approximate && dateDisclaimer && (
        <p className="mt-2 rounded-md border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 text-[11.5px] leading-snug text-amber-800">
          {dateDisclaimer}
        </p>
      )}

      {/* ── Why it matters + recommended action ── */}
      <div className="mt-3 grid gap-2 text-[12.5px] text-slate-700 sm:grid-cols-2">
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2">
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {language === 'en' ? 'Why it matters' : 'Kyun important hai'}
          </div>
          <p className="leading-snug">{why}</p>
        </div>
        <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2">
          <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {language === 'en' ? 'Recommended action' : 'Recommended action'}
          </div>
          <p className="leading-snug">{reco}</p>
        </div>
      </div>

      {segment && (
        <p className="mt-2 text-[11.5px] text-slate-500">
          <span className="font-semibold">{language === 'en' ? 'Guests: ' : 'Guests: '}</span>{segment}
        </p>
      )}
      {pkgIdea && (
        <p className="mt-1 text-[11.5px] text-slate-500">
          <span className="font-semibold">{language === 'en' ? 'Package idea: ' : 'Package idea: '}</span>{pkgIdea}
        </p>
      )}

      {/* ── Checklist ── */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {language === 'en' ? 'Preparation checklist' : 'Taiyaari checklist'}
          </div>
          <div className="text-[11px] text-slate-500">
            {w.checklist_done} / {w.checklist_total} done
          </div>
        </div>
        <SeasonalChecklist
          hotelId={hotelId}
          hotelSlug={hotelSlug}
          window={w}
          language={language}
          disabled={isDismissed || isHidden}
        />
      </div>

      {/* ── Owner notes ── */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {language === 'en' ? 'Your notes' : 'Aapke notes'}
        </label>
        <textarea
          value={ownerNotes}
          maxLength={4000}
          onChange={(e) => {
            setOwnerNotes(e.target.value);
            setLocalDirty(true);
            // Clear the stale "Saved" indicator the moment the user starts a
            // new edit. Otherwise it lingers misleadingly until the next save
            // completes ~700ms later.
            if (notesSavedAt !== null) setNotesSavedAt(null);
            saveNotes(e.target.value);
          }}
          disabled={isDismissed || isHidden}
          rows={2}
          placeholder={
            language === 'en'
              ? 'e.g. Asha confirmed photos by Friday; pending: heater service.'
              : 'jaise: Asha ne Friday tak photos confirm ki; pending: heater service.'
          }
          className={`mt-1 w-full rounded-md border px-2.5 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 disabled:bg-slate-50 disabled:text-slate-500 ${
            notesErrorMsg
              ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
              : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500'
          }`}
        />
        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px]">
          {notesSaving ? (
            <span className="flex items-center gap-1 text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
            </span>
          ) : notesErrorMsg ? (
            <span className="flex items-center gap-1 text-rose-600">
              <AlertTriangle className="h-3 w-3" aria-hidden /> {notesErrorMsg}
            </span>
          ) : notesSavedAt ? (
            <span className="text-slate-400">Saved</span>
          ) : null}
        </div>
      </div>

      {/* ── Governance actions ── */}
      {!hideManagerActions && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {!actionFormOpen && (
            <div className="flex flex-wrap items-center gap-1.5">
              {!isDismissed && !isReady && (
                <button
                  type="button"
                  onClick={() => markReady.mutate()}
                  disabled={markReady.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {markReady.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  {language === 'en' ? 'Mark READY' : 'Mark READY'}
                </button>
              )}
              {isReady && (
                <button
                  type="button"
                  onClick={() => returnToPlanning.mutate()}
                  disabled={returnToPlanning.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-3 w-3" /> Return to planning
                </button>
              )}
              {isDismissed ? (
                <button
                  type="button"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-3 w-3" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActionFormOpen('dismiss')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                >
                  <X className="h-3 w-3" /> Dismiss for this cycle
                </button>
              )}
              {!isDismissed && (
                <button
                  type="button"
                  onClick={() => {
                    setOverrideValue(w.urgency_override ?? 'QUIET');
                    setActionFormOpen('override');
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
                >
                  <AlertTriangle className="h-3 w-3" /> {w.urgency_override ? 'Edit override' : 'Override urgency'}
                </button>
              )}
              {w.urgency_override && (
                <button
                  type="button"
                  onClick={() => override.mutate({ urgency: null })}
                  disabled={override.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear override
                </button>
              )}
              {isHidden ? (
                <button
                  type="button"
                  onClick={() => setHidden.mutate({ hidden: false })}
                  disabled={setHidden.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Eye className="h-3 w-3" /> Unhide
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActionFormOpen('hide')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50"
                >
                  <EyeOff className="h-3 w-3" /> Hide forever
                </button>
              )}
            </div>
          )}

          {/* Inline form for dismiss / override / hide */}
          {actionFormOpen && (
            <InlineReasonForm
              variant={actionFormOpen}
              currentOverride={overrideValue}
              onOverrideChange={setOverrideValue}
              reason={reason}
              onReasonChange={setReason}
              language={language}
              busy={dismiss.isPending || override.isPending || setHidden.isPending}
              onCancel={() => {
                setActionFormOpen(null);
                setReason('');
                setErrorMsg(null);
              }}
              onSubmit={() => {
                if (actionFormOpen === 'dismiss') dismiss.mutate(reason);
                else if (actionFormOpen === 'override') override.mutate({ urgency: overrideValue, r: reason });
                else if (actionFormOpen === 'hide') setHidden.mutate({ hidden: true, r: reason });
              }}
            />
          )}

          {/* Dismissal reason display when dismissed */}
          {isDismissed && w.dismissed_reason && (
            <p className="mt-2 text-[11.5px] text-slate-600">
              <span className="font-semibold">Reason:</span> {w.dismissed_reason}
            </p>
          )}
          {isHidden && w.permanently_hidden_reason && (
            <p className="mt-2 text-[11.5px] text-slate-600">
              <span className="font-semibold">Hide reason:</span> {w.permanently_hidden_reason}
            </p>
          )}
          {w.urgency_override && w.urgency_override_reason && (
            <p className="mt-2 text-[11.5px] text-slate-600">
              <span className="font-semibold">Override reason:</span> {w.urgency_override_reason}
            </p>
          )}
        </div>
      )}

      {/* ── Error toast ── */}
      {errorMsg && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="ml-auto text-rose-600 hover:text-rose-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Inline timeline (replaces drawer per reviewer note) ── */}
      <div className="mt-3 border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
        >
          <Clock className="h-3 w-3" aria-hidden />
          {showTimeline ? 'Hide history' : 'View history'}
          {showTimeline ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showTimeline && (
          <TimelineList
            hotelId={hotelId}
            windowCode={w.window_code}
            seasonYear={w.season_year}
          />
        )}
      </div>
    </article>
  );
}

function InlineReasonForm({
  variant,
  currentOverride,
  onOverrideChange,
  reason,
  onReasonChange,
  language,
  busy,
  onCancel,
  onSubmit,
}: {
  variant: 'dismiss' | 'override' | 'hide';
  currentOverride: SeasonalWindowUrgency;
  onOverrideChange: (v: SeasonalWindowUrgency) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  language: 'en' | 'hi';
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const title =
    variant === 'dismiss' ? (language === 'en' ? 'Dismiss for this cycle' : 'Iss cycle ke liye dismiss karein')
    : variant === 'override' ? (language === 'en' ? 'Override urgency' : 'Urgency override karein')
    : (language === 'en' ? 'Hide forever' : 'Hamesha ke liye hide karein');
  const hint =
    variant === 'dismiss' ? 'e.g. Boutique stay, not targeting pilgrim segment this year.'
    : variant === 'override' ? 'e.g. We are running staff training this month; suppress urgency.'
    : 'e.g. We never serve this segment.';
  const submitLabel =
    variant === 'dismiss' ? 'Dismiss'
    : variant === 'override' ? 'Save override'
    : 'Hide forever';

  const disabled = busy || !reason.trim();

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5">
      <div className="mb-1.5 text-[12px] font-semibold text-slate-800">{title}</div>
      {variant === 'override' && (
        <div className="mb-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Force urgency to:</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {(['NOW', 'PREPARE', 'WATCH', 'QUIET'] as SeasonalWindowUrgency[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onOverrideChange(u)}
                className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium ${
                  currentOverride === u
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        rows={2}
        placeholder={hint}
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />} {submitLabel}
        </button>
      </div>
    </div>
  );
}

function TimelineList({
  hotelId,
  windowCode,
  seasonYear,
}: {
  hotelId: string;
  windowCode: string;
  seasonYear: number;
}) {
  const q = useQuery({
    queryKey: seasonalCalendarQueryKeys.timeline(hotelId, windowCode, seasonYear),
    queryFn: () => getSeasonalWindowTimeline(hotelId, windowCode, seasonYear, 20),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Could not load history.{' '}
        <button
          type="button"
          onClick={() => q.refetch()}
          className="underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }
  const events = q.data ?? [];
  if (events.length === 0) {
    return <p className="mt-2 text-[11px] text-slate-500">No activity yet.</p>;
  }
  return (
    <ol className="mt-2 space-y-1.5">
      {events.map((e) => (
        <li
          key={e.id}
          className="flex items-start gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-[11.5px] text-slate-700"
        >
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="font-medium text-slate-800">{SEASONAL_EVENT_LABEL[e.event_type]}</span>
              {e.actor_name && <span className="text-slate-500">by {e.actor_name}</span>}
              <span className="text-slate-400">{formatRelativeTime(e.occurred_at)}</span>
            </div>
            {e.payload && Object.keys(e.payload).length > 0 && (
              <div className="text-[10.5px] text-slate-500">
                {renderPayloadHint(e.payload)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / 1440)}d ago`;
}

function renderPayloadHint(payload: Record<string, unknown>): string {
  if (typeof payload.item_key === 'string') return `item: ${payload.item_key}`;
  if (typeof payload.reason === 'string') return `reason: ${payload.reason}`;
  if (typeof payload.from === 'string' && typeof payload.to === 'string') return `${payload.from} → ${payload.to}`;
  if (typeof payload.checklist_done === 'number' && typeof payload.checklist_total === 'number') {
    return `${payload.checklist_done}/${payload.checklist_total} done`;
  }
  return '';
}
