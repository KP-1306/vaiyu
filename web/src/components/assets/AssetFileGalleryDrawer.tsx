// web/src/components/assets/AssetFileGalleryDrawer.tsx
//
// Drawer for managing files attached to a hotel_assets row. Supports:
//   • Upload (drag-drop or click)
//   • Inline alt-text edit per file
//   • Reorder via drag handle (mouse) AND keyboard up/down buttons (a11y)
//   • Remove file
//
// Private vault files render via signed URL (lazy fetch); public files
// render via getPublicUrl with a created_at cache-buster.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, Trash2, FileText, Loader2, GripVertical, FileImage,
  ChevronUp, ChevronDown, Check,
} from 'lucide-react';

import {
  listAssetFiles,
  removeAssetFile,
  reorderAssetFiles,
  updateAssetFileAltText,
  getAssetFileViewUrl,
  extractAssetErrorCode,
  friendlyAssetError,
} from '../../services/digitalAssetService';
import { AssetUploadSlot } from './AssetUploadSlot';
import { PrivacyDisclaimerBanner } from './PrivacyDisclaimerBanner';
import type { AssetFileRow, AssetStatusRow } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  row: AssetStatusRow;
  onClose: () => void;
}

export function AssetFileGalleryDrawer({ row, onClose }: Props) {
  const t = useOwnerT('owner-assets');
  const qc = useQueryClient();

  const filesQ = useQuery({
    queryKey: ['asset-files', row.hotel_id, row.hotel_asset_id],
    queryFn: () => (row.hotel_asset_id ? listAssetFiles(row.hotel_asset_id) : Promise.resolve([])),
    enabled: !!row.hotel_asset_id,
    staleTime: 15_000,
  });

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<AssetFileRow[]>([]);
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    if (filesQ.data) setLocalOrder(filesQ.data);
  }, [filesQ.data]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const removeMutation = useMutation({
    mutationFn: (fileId: string) => removeAssetFile(fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-status', row.hotel_id] });
      qc.invalidateQueries({ queryKey: ['asset-files', row.hotel_id, row.hotel_asset_id] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      row.hotel_asset_id ? reorderAssetFiles(row.hotel_asset_id, orderedIds) : Promise.resolve(),
    onSuccess: () => {
      setReorderError(null);
      qc.invalidateQueries({ queryKey: ['asset-files', row.hotel_id, row.hotel_asset_id] });
    },
    onError: (err) => {
      const code = extractAssetErrorCode(err);
      setReorderError(friendlyAssetError(code, (err as Error)?.message ?? t('drawer.reorderError', 'Could not save the new order.')));
      if (filesQ.data) setLocalOrder(filesQ.data);
    },
  });

  function applyReorder(next: AssetFileRow[]) {
    setLocalOrder(next);
    reorderMutation.mutate(next.map((f) => f.id));
  }

  function moveByOffset(fileId: string, delta: -1 | 1) {
    const idx = localOrder.findIndex((f) => f.id === fileId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= localOrder.length) return;
    const next = [...localOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    applyReorder(next);
  }

  function onDragStart(id: string) { setDraggedId(id); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const next = [...localOrder];
    const fromIdx = next.findIndex((f) => f.id === draggedId);
    const toIdx = next.findIndex((f) => f.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDraggedId(null); return; }
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    applyReorder(next);
    setDraggedId(null);
  }

  return (
    <div className="vaiyu-owner fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={t('drawer.dialogLabel', 'Manage files')}>
      <div className="flex-1 bg-black/60" onClick={onClose} role="presentation" />
      <aside className="flex w-full max-w-xl flex-col bg-[#0B0E14] shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-800 bg-[#0F1320] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-widest text-indigo-300">
              {t('drawer.kicker', 'Manage files')}
            </p>
            <h2 className="mt-0.5 truncate text-base font-semibold text-slate-100">
              {row.display_name_en}
            </h2>
            <p className="mt-1 text-[12px] text-slate-400">
              {row.allow_multiple_files
                ? t('drawer.subtitleMulti', 'Upload as many as you have. Drag the handle or use the arrows to reorder.')
                : t('drawer.subtitleSingle', 'One file per requirement. Re-uploading replaces the existing file.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label={t('drawer.closeAria', 'Close drawer (Esc)')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <AssetUploadSlot
              hotelId={row.hotel_id}
              requirementCode={row.requirement_code}
              zone={row.storage_zone}
              allowMultiple={row.allow_multiple_files}
              compact={false}
            />

            <PrivacyDisclaimerBanner compact />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {t('drawer.filesHeader', 'Files ({{count}})', { count: localOrder.length })}
                </h3>
                {reorderMutation.isPending && (
                  <span className="text-[10px] text-slate-400">{t('drawer.savingOrder', 'Saving order…')}</span>
                )}
              </div>

              {reorderError && (
                <p className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-300">
                  {reorderError}
                </p>
              )}

              {filesQ.isLoading && (
                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {t('drawer.loadingFiles', 'Loading files…')}
                </div>
              )}
              {!filesQ.isLoading && localOrder.length === 0 && (
                <p className="rounded-md border border-dashed border-slate-700 bg-[#0F1320] py-6 text-center text-[12px] text-slate-400">
                  {t('drawer.noFiles', 'No files yet.')}
                </p>
              )}
              <ul className="space-y-2">
                {localOrder.map((f, idx) => (
                  <FileRow
                    key={f.id}
                    file={f}
                    index={idx}
                    total={localOrder.length}
                    allowReorder={row.allow_multiple_files}
                    isDragging={draggedId === f.id}
                    onDragStart={() => onDragStart(f.id)}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(f.id)}
                    onMoveUp={() => moveByOffset(f.id, -1)}
                    onMoveDown={() => moveByOffset(f.id, +1)}
                    onRemove={() => {
                      if (window.confirm(t('drawer.confirmRemove', 'Remove this file?'))) removeMutation.mutate(f.id);
                    }}
                    onAltSaved={() => {
                      qc.invalidateQueries({ queryKey: ['asset-files', row.hotel_id, row.hotel_asset_id] });
                    }}
                  />
                ))}
              </ul>
              {removeMutation.isError && (
                <p className="mt-2 text-[11.5px] text-rose-400">
                  {friendlyAssetError(
                    extractAssetErrorCode(removeMutation.error),
                    (removeMutation.error as Error)?.message ?? t('drawer.removeError', 'Could not remove file.')
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

interface FileRowProps {
  file: AssetFileRow;
  index: number;
  total: number;
  allowReorder: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onAltSaved: () => void;
}

function FileRow({
  file, index, total, allowReorder, isDragging,
  onDragStart, onDragOver, onDrop, onMoveUp, onMoveDown, onRemove, onAltSaved,
}: FileRowProps) {
  const t = useOwnerT('owner-assets');
  const [altDraft, setAltDraft] = useState(file.alt_text ?? '');
  const [altDirty, setAltDirty] = useState(false);
  const [altSaving, setAltSaving] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);

  useEffect(() => {
    setAltDraft(file.alt_text ?? '');
    setAltDirty(false);
  }, [file.alt_text, file.id]);

  async function saveAlt() {
    setAltSaving(true);
    setAltError(null);
    try {
      const cleaned = altDraft.trim();
      await updateAssetFileAltText(file.id, cleaned.length === 0 ? null : cleaned);
      setAltDirty(false);
      onAltSaved();
    } catch (e) {
      const code = extractAssetErrorCode(e);
      setAltError(friendlyAssetError(code, (e as Error)?.message ?? t('drawer.saveAltError', 'Could not save alt text.')));
    } finally {
      setAltSaving(false);
    }
  }

  return (
    <li
      draggable={allowReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-lg border bg-[#0F1320] p-2 ${isDragging ? 'border-indigo-400 opacity-60' : 'border-slate-800'}`}
    >
      <div className="flex items-start gap-3">
        {allowReorder && (
          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
              aria-label={t('drawer.moveUp', 'Move file up')}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-500" aria-hidden />
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30"
              aria-label={t('drawer.moveDown', 'Move file down')}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
        <FilePreview file={file} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-slate-200">
            {file.storage_path.split('/').pop()}
          </div>
          <div className="text-[10.5px] text-slate-400">
            {file.mime_type} · {Math.round(file.file_size_bytes / 1024)} KB
            {file.width_px && file.height_px ? ` · ${file.width_px}×${file.height_px}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-rose-400 hover:bg-rose-500/10"
          aria-label={t('drawer.removeFile', 'Remove file')}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400" htmlFor={`alt-${file.id}`}>
          {t('drawer.altTextLabel', 'Alt text')}
        </label>
        <input
          id={`alt-${file.id}`}
          type="text"
          value={altDraft}
          maxLength={280}
          placeholder={t('drawer.altTextPlaceholder', "Describe what's in this image (helps SEO + accessibility)")}
          onChange={(e) => { setAltDraft(e.target.value); setAltDirty(true); }}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        {altDirty && (
          <button
            type="button"
            onClick={saveAlt}
            disabled={altSaving}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-50"
          >
            {altSaving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
            {t('drawer.save', 'Save')}
          </button>
        )}
      </div>
      {altError && (
        <p className="mt-1 text-[10.5px] text-rose-400">{altError}</p>
      )}
    </li>
  );
}

function FilePreview({ file }: { file: AssetFileRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.mime_type.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    void (async () => {
      try {
        const u = await getAssetFileViewUrl(file);
        if (!cancelled) setUrl(u);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [file, isImage]);

  if (!isImage) {
    return (
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-slate-800 bg-slate-900/60 text-slate-500">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  if (!url) {
    return (
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-slate-800 bg-slate-900/60 text-slate-500">
        <FileImage className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={file.alt_text ?? ''}
      className="h-12 w-12 shrink-0 rounded-md border border-slate-800 object-cover"
      loading="lazy"
    />
  );
}
