// web/src/components/assets/AssetRequirementRow.tsx
//
// One requirement per row in the asset workspace. Compact + actionable.
// Owner notes editable inline; click "Manage" to open the file gallery drawer
// for multi-file requirements.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link as LinkIcon, FolderOpen, MessageSquare, AlertTriangle, Loader2,
  Check, X, Pencil,
} from 'lucide-react';

import { AssetStatusBadge, AssetPriorityBadge } from './AssetStatusBadge';
import { AssetUploadSlot } from './AssetUploadSlot';
import { AssetFileGalleryDrawer } from './AssetFileGalleryDrawer';
import {
  upsertAssetNote,
  setAssetStatus,
  extractAssetErrorCode,
  friendlyAssetError,
} from '../../services/digitalAssetService';
import type { AssetStatusRow } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  row: AssetStatusRow;
  showHinglish: boolean;
}

export function AssetRequirementRow({ row, showHinglish }: Props) {
  const t = useOwnerT('owner-assets');
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(row.owner_notes ?? '');
  const [notesError, setNotesError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNotesDraft(row.owner_notes ?? '');
  }, [row.owner_notes, row.requirement_code]);

  const isLinkedBrand = row.collected_via === 'AUTO_LINK_BRAND';
  const fileCount = row.file_count;
  const needsAction = row.status === 'MISSING' || row.status === 'REJECTED' || row.status === 'NEEDS_REPLACEMENT';

  const notesMutation = useMutation({
    mutationFn: (notes: string) =>
      upsertAssetNote({
        hotelId: row.hotel_id,
        requirementCode: row.requirement_code,
        ownerNotes: notes,
      }),
    onSuccess: () => {
      setNotesOpen(false);
      setNotesError(null);
      qc.invalidateQueries({ queryKey: ['asset-status', row.hotel_id] });
    },
    onError: (err) => {
      const code = extractAssetErrorCode(err);
      setNotesError(friendlyAssetError(code, (err as Error)?.message ?? t('row.saveNoteError', 'Could not save note.')));
    },
  });

  const replaceMutation = useMutation({
    mutationFn: () =>
      setAssetStatus({
        hotelId: row.hotel_id,
        requirementCode: row.requirement_code,
        status: 'NEEDS_REPLACEMENT',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-status', row.hotel_id] });
    },
  });

  useEffect(() => {
    if (notesOpen) notesRef.current?.focus();
  }, [notesOpen]);

  return (
    <>
      <article
        className={`rounded-lg border bg-[#0F1320] p-3 sm:p-4 ${
          needsAction ? 'border-amber-500/30' : 'border-slate-800'
        }`}
        data-testid={`asset-row-${row.requirement_code}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2 sm:flex-nowrap">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <AssetPriorityBadge priority={row.priority} />
              <h3 className="text-sm font-semibold text-slate-100">{row.display_name_en}</h3>
              <AssetStatusBadge status={row.status} />
              {isLinkedBrand && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                  <LinkIcon className="h-2.5 w-2.5" aria-hidden /> {t('row.linkedFromSettings', 'linked from Hotel Settings')}
                </span>
              )}
            </div>
            {showHinglish && (
              <p className="mt-1 text-[12.5px] leading-snug text-slate-300">
                {row.display_name_hi}
              </p>
            )}
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
              <span className="text-slate-400">{t('row.why', 'Why:')} </span>{row.why_it_matters_en}
              {showHinglish && (
                <span className="ml-1 text-slate-400">— {row.why_it_matters_hi}</span>
              )}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
              <span className="text-slate-500">{t('row.tip', 'Tip:')} </span>{row.recommended_action_en}
              {showHinglish && (
                <span className="ml-1 text-slate-500">— {row.recommended_action_hi}</span>
              )}
            </p>
            {row.status === 'REJECTED' && row.rejection_reason && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11.5px] text-rose-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span><span className="font-semibold">{t('row.rejected', 'Rejected:')} </span>{row.rejection_reason}</span>
              </p>
            )}

            {!notesOpen && row.owner_notes && (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="mt-1.5 flex items-start gap-1 text-left text-[11px] text-slate-400 hover:text-slate-200"
              >
                <MessageSquare className="mt-0.5 h-3 w-3" aria-hidden />
                <span className="flex-1">{row.owner_notes}</span>
                <Pencil className="mt-0.5 h-2.5 w-2.5 shrink-0 text-slate-400" aria-hidden />
              </button>
            )}

            {!notesOpen && !row.owner_notes && (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-slate-200"
              >
                <MessageSquare className="h-3 w-3" aria-hidden /> {t('row.addNote', 'Add a note')}
              </button>
            )}

            {notesOpen && (
              <div className="mt-2 space-y-1.5">
                <textarea
                  ref={notesRef}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={t('row.notesPlaceholder', "Anything VAiyu or your team should know? (e.g. 'Waiting on signboard installer next week')")}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">{notesDraft.length}/2000</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setNotesOpen(false); setNotesDraft(row.owner_notes ?? ''); }}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      <X className="h-3 w-3" aria-hidden /> {t('row.cancel', 'Cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => notesMutation.mutate(notesDraft.trim())}
                      disabled={notesMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-50"
                    >
                      {notesMutation.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        : <Check className="h-3 w-3" aria-hidden />}
                      {t('row.saveNote', 'Save note')}
                    </button>
                  </div>
                </div>
                {notesError && <p className="text-[10.5px] text-rose-400">{notesError}</p>}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 sm:min-w-[140px]">
            <div className="text-right text-[10.5px] uppercase tracking-wider text-slate-400">
              {t('row.fileCount', '{{count}} files', { count: fileCount })}
            </div>
            {(fileCount > 0 || row.allow_multiple_files) && row.hotel_asset_id && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                disabled={isLinkedBrand}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                title={isLinkedBrand ? t('row.linkedTitle', 'Linked from Hotel Settings — manage there') : undefined}
              >
                <FolderOpen className="h-3 w-3" aria-hidden />
                {fileCount > 0 ? t('row.manage', 'Manage') : t('row.addFiles', 'Add files')}
              </button>
            )}
            {row.status === 'COLLECTED' && fileCount > 0 && !isLinkedBrand && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('row.confirmReplace', 'Mark this asset as needing replacement? It will not be hidden, but a status flag will show it needs updating.'))) {
                    replaceMutation.mutate();
                  }
                }}
                disabled={replaceMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
              >
                {t('row.markNeedsReplacement', 'Mark as needs replacement')}
              </button>
            )}
          </div>
        </div>

        {/* Inline upload to add the FIRST file. Single-file rows always use it; a
            multi-file row uses it until a record exists — after the first file the
            "Manage / Add files" gallery drawer above takes over. Without this, a
            fresh multi-file requirement (room / dining / view photos) had no way to
            add its first file (the drawer button needs an existing hotel_asset_id). */}
        {fileCount === 0 && !isLinkedBrand && (!row.allow_multiple_files || !row.hotel_asset_id) && (
          <div className="mt-3">
            <AssetUploadSlot
              hotelId={row.hotel_id}
              requirementCode={row.requirement_code}
              zone={row.storage_zone}
              allowMultiple={row.allow_multiple_files}
              compact
            />
          </div>
        )}
      </article>

      {drawerOpen && (
        <AssetFileGalleryDrawer row={row} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}
