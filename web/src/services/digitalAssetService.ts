// web/src/services/digitalAssetService.ts
//
// Typed wrapper for Digital Asset Manager v0 RPCs + view reads.
// Mirrors migration 20260528000001_digital_asset_manager.sql.
//
// The upload flow is two-step:
//   1. Client uploads the binary to the correct bucket via supabase.storage.
//      `uploadAssetFile()` picks the bucket from the requirement's storage_zone
//      and routes accordingly. RLS on storage.objects enforces hotel folder.
//   2. Client calls record_hotel_asset_file RPC to register the metadata
//      (status transitions, idempotency, audit). This is the single source
//      of truth — UI reads from v_hotel_asset_status afterwards.
// Signed URLs for private vault files are minted client-side via
// supabase.storage.from(bucket).createSignedUrl().

import { supabase } from '../lib/supabase';
import {
  DAM_BUCKET_PRIVATE_VAULT,
  DAM_BUCKET_PUBLIC_MARKETING,
  DAM_VAULT_SIGNED_URL_TTL_SECONDS,
  DAM_MAX_FILE_BYTES,
  DAM_ALLOWED_MIME_TYPES,
  DAM_PII_FILENAME_REGEX,
} from '../config/digitalAssetManager';
import type {
  AssetRequirementRow,
  AssetStatusRow,
  AssetFileRow,
  AssetStatus,
  AssetStorageZone,
  DigitalAssetErrorCode,
} from '../types/digitalAssets';

// ─── Browser-safe UUID generator ───────────────────────────────────────────

export function newIdempotencyKey(): string {
  // crypto.randomUUID is available in all modern browsers + Node 19+
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (very old Safari): non-crypto, fine for idempotency keys
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Error mapping ─────────────────────────────────────────────────────────

export function extractAssetErrorCode(err: unknown): DigitalAssetErrorCode | null {
  const msg = (err as { message?: string })?.message ?? String(err);
  const known: DigitalAssetErrorCode[] = [
    'NOT_HOTEL_MEMBER',
    'IDEMPOTENCY_KEY_REQUIRED',
    'UNKNOWN_REQUIREMENT',
    'WRONG_BUCKET_FOR_ZONE',
    'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER',
    'PII_FILENAME_REJECTED',
    'MIME_NOT_ALLOWED',
    'FILE_TOO_LARGE',
    'NO_FILES_TO_MARK_COLLECTED',
    'NO_FILES_TO_APPROVE',
    'STATUS_NOT_ALLOWED_FROM_OWNER',
    'CANNOT_UNAPPROVE_DIRECTLY',
    'PLATFORM_ADMIN_ONLY',
    'REJECTION_REASON_REQUIRED',
    'ASSET_NOT_FOUND',
    'FILE_NOT_FOUND',
    'REORDER_LIST_MISMATCH',
    'HOTEL_NOT_FOUND',
  ];
  for (const code of known) {
    if (msg.includes(code)) return code;
  }
  return null;
}

export function friendlyAssetError(code: DigitalAssetErrorCode | null, fallback: string): string {
  switch (code) {
    case 'PII_FILENAME_REJECTED':
      return "This filename looks like a personal ID document. We don't accept Aadhaar, PAN, passports, cheques, or bank statements — only public business materials.";
    case 'MIME_NOT_ALLOWED':
      return 'File type not supported. Use JPG, PNG, WEBP, HEIC, or PDF.';
    case 'FILE_TOO_LARGE':
      return 'File is too large. Max size is 10 MB.';
    case 'WRONG_BUCKET_FOR_ZONE':
      return "Bucket mismatch — please refresh and retry. If it keeps happening, contact VAiyu support.";
    case 'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER':
      return "Upload path is outside your hotel folder. Refresh and try again.";
    case 'NOT_HOTEL_MEMBER':
      return "You don't have access to this hotel.";
    case 'PLATFORM_ADMIN_ONLY':
      return 'Only the VAiyu onboarding team can approve or reject assets.';
    case 'NO_FILES_TO_MARK_COLLECTED':
      return 'Upload at least one file before marking this as collected.';
    case 'CANNOT_UNAPPROVE_DIRECTLY':
      return 'Approved assets can only be changed by the VAiyu team. Contact support to mark for replacement.';
    default:
      return fallback;
  }
}

// ─── Catalog read ──────────────────────────────────────────────────────────

export async function listAssetRequirements(): Promise<AssetRequirementRow[]> {
  const { data, error } = await supabase
    .from('asset_requirements')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as AssetRequirementRow[];
}

// ─── Status view ───────────────────────────────────────────────────────────

export async function listAssetStatus(hotelId: string): Promise<AssetStatusRow[]> {
  const { data, error } = await supabase
    .from('v_hotel_asset_status')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('category_rank')
    .order('priority_rank')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as AssetStatusRow[];
}

export async function getTopMissingAssets(
  hotelId: string,
  limit = 3,
): Promise<AssetStatusRow[]> {
  const { data, error } = await supabase
    .from('v_hotel_asset_status')
    .select('*')
    .eq('hotel_id', hotelId)
    .in('status', ['MISSING', 'REJECTED', 'NEEDS_REPLACEMENT'])
    .order('priority_rank')
    .order('category_rank')
    .order('sort_order')
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AssetStatusRow[];
}

// ─── Files list (for a single requirement / hotel_asset_id) ────────────────

export async function listAssetFiles(hotelAssetId: string): Promise<AssetFileRow[]> {
  const { data, error } = await supabase
    .from('hotel_asset_files')
    .select('*')
    .eq('hotel_asset_id', hotelAssetId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as AssetFileRow[];
}

// ─── Upload helpers ────────────────────────────────────────────────────────

export function pickBucketForZone(zone: AssetStorageZone): 'hotel-assets' | 'hotel-asset-vault' {
  return zone === 'PRIVATE_VAULT' ? DAM_BUCKET_PRIVATE_VAULT : DAM_BUCKET_PUBLIC_MARKETING;
}

export function buildStoragePath(input: {
  hotelId: string;
  requirementCode: string;
  fileName: string;
  idempotencyKey: string;
}): string {
  // Path: {hotel_id}/dam/{requirement_code}/{idempotency_key}.{ext}
  // The `dam/` prefix isolates DAM uploads from existing logo/cover paths
  // (which live at root: {hotel_id}/logo.png, {hotel_id}/cover.png).
  const ext = input.fileName.includes('.')
    ? input.fileName.split('.').pop()!.toLowerCase()
    : 'bin';
  // Strip query strings and slashes from extension defensively.
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
  return `${input.hotelId}/dam/${input.requirementCode}/${input.idempotencyKey}.${safeExt}`;
}

/** Client-side validation. Server re-validates everything. */
export function validateBeforeUpload(file: File): { ok: true } | { ok: false; code: DigitalAssetErrorCode; message: string } {
  if (file.size <= 0 || file.size > DAM_MAX_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: 'File is too large. Max 10 MB.' };
  }
  // Some browsers report empty MIME type for HEIC. Allow when extension matches.
  const mime = file.type || '';
  const looksLikeHeicByName = /\.(heic|heif)$/i.test(file.name);
  const allowed = DAM_ALLOWED_MIME_TYPES.includes(mime) || looksLikeHeicByName;
  if (!allowed) {
    return { ok: false, code: 'MIME_NOT_ALLOWED', message: `MIME type ${mime || '(unknown)'} not supported.` };
  }
  if (DAM_PII_FILENAME_REGEX.test(file.name)) {
    return {
      ok: false,
      code: 'PII_FILENAME_REJECTED',
      message: "Filename looks like a personal ID document. We don't accept Aadhaar/PAN/passport/cheque/bank statements.",
    };
  }
  return { ok: true };
}

export interface UploadAssetFileInput {
  hotelId: string;
  requirementCode: string;
  zone: AssetStorageZone;
  file: File;
  altText?: string;
  /** Optional pre-generated key; one is created if absent. */
  idempotencyKey?: string;
}

export interface UploadAssetFileResult {
  ok: true;
  fileId: string;
  hotelAssetId: string;
  storagePath: string;
  bucket: string;
  idempotent: boolean;
  previousStatus: AssetStatus | null;
  newStatus: AssetStatus;
}

/**
 * Full upload + record flow. Throws on any error; caller maps via
 * extractAssetErrorCode + friendlyAssetError.
 */
export async function uploadAssetFile(input: UploadAssetFileInput): Promise<UploadAssetFileResult> {
  const validation = validateBeforeUpload(input.file);
  if (!validation.ok) {
    throw new Error(validation.code);
  }

  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const bucket = pickBucketForZone(input.zone);
  const storagePath = buildStoragePath({
    hotelId: input.hotelId,
    requirementCode: input.requirementCode,
    fileName: input.file.name,
    idempotencyKey,
  });

  // 1. Upload to storage. `upsert: false` because path is unique per key.
  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(storagePath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
      cacheControl: bucket === DAM_BUCKET_PUBLIC_MARKETING ? '3600' : 'no-store',
    });
  if (uploadErr && !/already exists/i.test(uploadErr.message)) {
    throw uploadErr;
  }

  // 2. Probe optional image dimensions (best-effort, only for images)
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  if (input.file.type.startsWith('image/') && typeof document !== 'undefined') {
    try {
      const dims = await readImageDimensions(input.file);
      widthPx = dims.width;
      heightPx = dims.height;
    } catch {
      // Best-effort only — ignore failures (HEIC etc).
    }
  }

  // 3. Record metadata + status transition
  const { data, error } = await supabase.rpc('record_hotel_asset_file', {
    p_hotel_id: input.hotelId,
    p_requirement_code: input.requirementCode,
    p_bucket: bucket,
    p_storage_path: storagePath,
    p_mime_type: input.file.type || 'application/octet-stream',
    p_file_size_bytes: input.file.size,
    p_idempotency_key: idempotencyKey,
    p_width_px: widthPx,
    p_height_px: heightPx,
    p_alt_text: input.altText ?? null,
  });

  if (error) throw error;
  const r = data as {
    ok: boolean;
    idempotent: boolean;
    file_id: string;
    hotel_asset_id: string;
    previous_status: AssetStatus | null;
    new_status: AssetStatus;
  };
  return {
    ok: true,
    fileId: r.file_id,
    hotelAssetId: r.hotel_asset_id,
    storagePath,
    bucket,
    idempotent: r.idempotent,
    previousStatus: r.previous_status ?? null,
    newStatus: r.new_status,
  };
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// ─── Remove + reorder ──────────────────────────────────────────────────────

export async function removeAssetFile(fileId: string): Promise<{
  hotelAssetId: string;
  remainingFiles: number;
  newStatus: AssetStatus;
  storagePath: string;
  bucket: string;
}> {
  const { data, error } = await supabase.rpc('remove_hotel_asset_file', { p_file_id: fileId });
  if (error) throw error;
  const r = data as {
    ok: boolean;
    hotel_asset_id: string;
    remaining_files: number;
    new_status: AssetStatus;
    storage_path: string;
    bucket: string;
  };
  // Best-effort: also delete the storage object. RLS allows hotel members.
  try {
    await supabase.storage.from(r.bucket).remove([r.storage_path]);
  } catch {
    // Orphan cleanup happens at admin sweep; not blocking
  }
  return {
    hotelAssetId: r.hotel_asset_id,
    remainingFiles: r.remaining_files,
    newStatus: r.new_status,
    storagePath: r.storage_path,
    bucket: r.bucket,
  };
}

export async function reorderAssetFiles(hotelAssetId: string, orderedFileIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_hotel_asset_files', {
    p_hotel_asset_id: hotelAssetId,
    p_ordered_ids: orderedFileIds,
  });
  if (error) throw error;
}

export async function updateAssetFileAltText(fileId: string, altText: string | null): Promise<void> {
  const { error } = await supabase.rpc('update_hotel_asset_file_alt_text', {
    p_file_id: fileId,
    p_alt_text: altText,
  });
  if (error) throw error;
}

// ─── Owner status + notes ──────────────────────────────────────────────────

export async function setAssetStatus(input: {
  hotelId: string;
  requirementCode: string;
  status: 'COLLECTED' | 'NEEDS_REPLACEMENT';
  ownerNotes?: string;
}): Promise<{ hotelAssetId: string; newStatus: AssetStatus }> {
  const { data, error } = await supabase.rpc('set_hotel_asset_status', {
    p_hotel_id: input.hotelId,
    p_requirement_code: input.requirementCode,
    p_status: input.status,
    p_owner_notes: input.ownerNotes ?? null,
  });
  if (error) throw error;
  const r = data as { ok: boolean; hotel_asset_id: string; new_status: AssetStatus };
  return { hotelAssetId: r.hotel_asset_id, newStatus: r.new_status };
}

export async function upsertAssetNote(input: {
  hotelId: string;
  requirementCode: string;
  ownerNotes: string;
}): Promise<{ hotelAssetId: string }> {
  const { data, error } = await supabase.rpc('upsert_hotel_asset_note', {
    p_hotel_id: input.hotelId,
    p_requirement_code: input.requirementCode,
    p_owner_notes: input.ownerNotes,
  });
  if (error) throw error;
  const r = data as { ok: boolean; hotel_asset_id: string };
  return { hotelAssetId: r.hotel_asset_id };
}

// ─── Admin (platform_admin only) ───────────────────────────────────────────

export async function approveAsset(input: {
  hotelAssetId: string;
  internalNotes?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('approve_hotel_asset', {
    p_hotel_asset_id: input.hotelAssetId,
    p_internal_notes: input.internalNotes ?? null,
  });
  if (error) throw error;
}

export async function rejectAsset(input: {
  hotelAssetId: string;
  reason: string;
  internalNotes?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('reject_hotel_asset', {
    p_hotel_asset_id: input.hotelAssetId,
    p_reason: input.reason,
    p_internal_notes: input.internalNotes ?? null,
  });
  if (error) throw error;
}

// ─── Signed URL minting for vault files ────────────────────────────────────

export async function getAssetFileViewUrl(file: AssetFileRow): Promise<string> {
  if (file.bucket === DAM_BUCKET_PUBLIC_MARKETING) {
    const { data } = supabase.storage.from(file.bucket).getPublicUrl(file.storage_path);
    // Cache-buster keyed to created_at so replaced files don't show stale CDN
    return `${data.publicUrl}?t=${encodeURIComponent(file.created_at)}`;
  }
  const { data, error } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.storage_path, DAM_VAULT_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
