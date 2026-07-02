// web/src/components/assets/AssetUploadSlot.tsx
//
// Dark-theme upload widget for the Digital Asset Manager. Routes to the
// correct bucket based on requirement storage_zone (public hotel-assets vs
// private hotel-asset-vault). Client-side validates MIME + size + PII regex
// before hitting the server.

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, ShieldAlert, FileImage } from 'lucide-react';

import {
  uploadAssetFile,
  extractAssetErrorCode,
  friendlyAssetError,
  validateBeforeUpload,
} from '../../services/digitalAssetService';
import type { AssetStorageZone } from '../../types/digitalAssets';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  hotelId: string;
  requirementCode: string;
  zone: AssetStorageZone;
  allowMultiple: boolean;
  /** When true the slot renders compact (used in row layout); false = workspace banner */
  compact?: boolean;
  onUploaded?: () => void;
}

export function AssetUploadSlot({
  hotelId,
  requirementCode,
  zone,
  allowMultiple,
  compact = true,
  onUploaded,
}: Props) {
  const t = useOwnerT('owner-assets');
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const list = Array.from(files);
    setUploading(true);
    try {
      for (const file of list) {
        const v = validateBeforeUpload(file);
        if (!v.ok) {
          setError(v.message);
          continue;
        }
        await uploadAssetFile({
          hotelId,
          requirementCode,
          zone,
          file,
        });
      }
      qc.invalidateQueries({ queryKey: ['asset-status', hotelId] });
      qc.invalidateQueries({ queryKey: ['asset-files', hotelId] });
      onUploaded?.();
    } catch (err: unknown) {
      const code = extractAssetErrorCode(err);
      setError(friendlyAssetError(code, (err as Error).message ?? t('upload.uploadFailed', 'Upload failed.')));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    if (e.type === 'dragleave') setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  }

  const containerCls = compact
    ? 'rounded-lg border border-dashed px-3 py-3 text-center transition-colors'
    : 'rounded-xl border border-dashed px-6 py-8 text-center transition-colors';

  const stateCls = uploading
    ? 'border-indigo-500/40 bg-indigo-500/10 cursor-wait'
    : dragActive
      ? 'border-indigo-400 bg-indigo-500/15'
      : 'border-slate-700 bg-slate-950/40 hover:border-indigo-500/50 hover:bg-indigo-500/10 cursor-pointer';

  return (
    <div className="space-y-2">
      <div
        className={`${containerCls} ${stateCls}`}
        onDragEnter={uploading ? undefined : onDrag}
        onDragLeave={uploading ? undefined : onDrag}
        onDragOver={uploading ? undefined : onDrag}
        onDrop={uploading ? undefined : onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        data-testid={`asset-upload-${requirementCode}`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          multiple={allowMultiple}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-[12px] font-medium text-indigo-300">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('upload.uploading', 'Uploading…')}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-[12px] font-medium text-slate-300">
            <Upload className="h-4 w-4 text-indigo-400" aria-hidden />
            <span>
              {allowMultiple
                ? t('upload.dropFiles', 'Drop files or click to upload')
                : t('upload.dropFile', 'Drop a file or click to upload')}
              <span className="ml-1 text-slate-500">· {t('upload.specs', 'JPG / PNG / WEBP / PDF · ≤10 MB')}</span>
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {zone === 'PRIVATE_VAULT' && !uploading && !error && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
          <FileImage className="h-3 w-3" aria-hidden />
          {t('upload.privateNote', 'Private vault — viewable via signed link only.')}
        </div>
      )}
    </div>
  );
}
