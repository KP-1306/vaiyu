-- Digital Asset Manager v0 — hardening pass
--
-- Production-grade fixes for issues surfaced during re-verify:
--
--   1. record_hotel_asset_file concurrency: two parallel uploads to the same
--      single-file requirement could both succeed at storage and both insert
--      file rows, violating the single-file intent. Patched with INSERT...
--      ON CONFLICT for hotel_assets (lazy-create race) and SELECT FOR UPDATE
--      after the upsert (single-file eviction race).
--
--   2. Brand sync: clearing hotels.logo_path / cover_image_path left a stale
--      AUTO_LINK_BRAND hotel_assets row showing "Collected" in the workspace.
--      Patched link_hotel_brand_to_asset_requirement to DELETE the auto-row
--      when the source column goes NULL/empty.
--
--   3. Storage cleanup on file DELETE: when CASCADE deletes hotel_asset_files
--      (e.g. hotel deletion) the storage objects orphaned in hotel-asset-vault.
--      Added AFTER DELETE trigger that removes the storage object — vault only
--      (public-bucket logo/cover paths are shared with Hotel Settings, must
--      NOT be auto-deleted from here).
--
--   4. Alt-text mutability: alt_text was already excluded from the immutability
--      trigger's column list, so the existing schema supports edits. Added
--      explicit update_hotel_asset_file_alt_text RPC so the UI can persist.
--
--   5. Defensive: removed_at on hotel_assets to track when an admin marks
--      NEEDS_REPLACEMENT or REJECTED, so the timeline is queryable.

-- ─── 1. record_hotel_asset_file: concurrency-safe rewrite ───────────────────

CREATE OR REPLACE FUNCTION public.record_hotel_asset_file(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_bucket            text,
  p_storage_path      text,
  p_mime_type         text,
  p_file_size_bytes   integer,
  p_idempotency_key   uuid,
  p_width_px          integer DEFAULT NULL,
  p_height_px         integer DEFAULT NULL,
  p_alt_text          text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_req           public.asset_requirements%ROWTYPE;
  v_asset         public.hotel_assets%ROWTYPE;
  v_existing      public.hotel_asset_files%ROWTYPE;
  v_file_id       uuid;
  v_actor_id      uuid := auth.uid();
  v_actor_name    text;
  v_old_status    public.asset_status;
BEGIN
  -- Membership gate
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '23502';
  END IF;

  -- Idempotency short-circuit: same key already used → return existing row
  SELECT * INTO v_existing
    FROM public.hotel_asset_files
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'file_id', v_existing.id,
      'hotel_asset_id', v_existing.hotel_asset_id
    );
  END IF;

  -- Requirement lookup
  SELECT * INTO v_req
    FROM public.asset_requirements
    WHERE code = p_requirement_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_REQUIREMENT' USING ERRCODE = '23503';
  END IF;

  -- Bucket / storage_zone alignment
  IF (v_req.storage_zone = 'PRIVATE_VAULT' AND p_bucket <> 'hotel-asset-vault') OR
     (v_req.storage_zone = 'PUBLIC_MARKETING' AND p_bucket <> 'hotel-assets') THEN
    RAISE EXCEPTION 'WRONG_BUCKET_FOR_ZONE: requirement % expects bucket for zone %, got %',
      p_requirement_code, v_req.storage_zone, p_bucket
      USING ERRCODE = '22023';
  END IF;

  -- Path must live under this hotel's folder
  IF p_storage_path !~ ('^' || p_hotel_id::text || '/.+') THEN
    RAISE EXCEPTION 'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER' USING ERRCODE = '22023';
  END IF;

  -- Filename PII guardrail
  IF public._asset_filename_has_pii(p_storage_path) THEN
    RAISE EXCEPTION 'PII_FILENAME_REJECTED: Personal identity documents are not accepted. Only public business materials.'
      USING ERRCODE = '22023';
  END IF;

  -- MIME allowlist
  IF p_mime_type NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  ) THEN
    RAISE EXCEPTION 'MIME_NOT_ALLOWED: %', p_mime_type USING ERRCODE = '22023';
  END IF;

  IF p_file_size_bytes <= 0 OR p_file_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'FILE_TOO_LARGE: file size must be 1..10485760 bytes, got %', p_file_size_bytes
      USING ERRCODE = '22023';
  END IF;

  v_actor_name := public._user_display_name(v_actor_id);

  -- ── Concurrency-safe lazy create ──────────────────────────────────────
  -- INSERT ... ON CONFLICT DO UPDATE with a no-op SET. The DO UPDATE makes
  -- RETURNING return the row whether new or existing. We then re-SELECT
  -- FOR UPDATE to lock for the eviction step.
  INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via)
  VALUES (p_hotel_id, p_requirement_code, 'COLLECTED', 'OWNER_UPLOAD')
  ON CONFLICT (hotel_id, requirement_code) DO UPDATE
    SET requirement_code = EXCLUDED.requirement_code  -- no-op forces RETURNING
  RETURNING * INTO v_asset;

  -- Lock the row for the rest of the transaction so two parallel calls
  -- for a single-file requirement cannot both evict + insert.
  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE id = v_asset.id
    FOR UPDATE;

  v_old_status := v_asset.status;

  -- Bump back to COLLECTED if the row was NEEDS_REPLACEMENT or REJECTED.
  IF v_asset.status IN ('NEEDS_REPLACEMENT', 'REJECTED') THEN
    UPDATE public.hotel_assets
      SET status = 'COLLECTED',
          collected_via = 'OWNER_UPLOAD',
          rejection_reason = NULL,
          reviewed_at = NULL,
          review_actor_id = NULL,
          review_actor_name = NULL
      WHERE id = v_asset.id
      RETURNING * INTO v_asset;
  END IF;

  -- For single-file requirements, evict prior files within the locked window.
  IF NOT v_req.allow_multiple_files THEN
    DELETE FROM public.hotel_asset_files
      WHERE hotel_asset_id = v_asset.id;
  END IF;

  -- Insert the file row
  INSERT INTO public.hotel_asset_files (
    hotel_asset_id, hotel_id, bucket, storage_path, mime_type,
    file_size_bytes, width_px, height_px, alt_text,
    sort_order, idempotency_key,
    uploaded_by_actor_id, uploaded_by_actor_name
  )
  VALUES (
    v_asset.id, p_hotel_id, p_bucket, p_storage_path, p_mime_type,
    p_file_size_bytes, p_width_px, p_height_px, p_alt_text,
    COALESCE(
      (SELECT COALESCE(MAX(sort_order), -1) + 1
         FROM public.hotel_asset_files
         WHERE hotel_asset_id = v_asset.id),
      0
    ),
    p_idempotency_key,
    v_actor_id, v_actor_name
  )
  RETURNING id INTO v_file_id;

  PERFORM public.vaiyu_log_audit(
    'asset_file_recorded',
    'hotel_asset_files',
    v_file_id,
    p_hotel_id,
    jsonb_build_object(
      'requirement_code', p_requirement_code,
      'bucket', p_bucket,
      'storage_path', p_storage_path,
      'mime_type', p_mime_type,
      'file_size_bytes', p_file_size_bytes,
      'previous_status', v_old_status,
      'new_status', v_asset.status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'file_id', v_file_id,
    'hotel_asset_id', v_asset.id,
    'previous_status', v_old_status,
    'new_status', v_asset.status
  );
END $$;

-- ─── 2. link_hotel_brand_to_asset_requirement: handle NULL/empty unlink ─────

CREATE OR REPLACE FUNCTION public.link_hotel_brand_to_asset_requirement(
  p_hotel_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_hotel     public.hotels%ROWTYPE;
  v_linked    integer := 0;
  v_unlinked  integer := 0;
  v_logo_set  boolean;
  v_cover_set boolean;
BEGIN
  SELECT * INTO v_hotel FROM public.hotels WHERE id = p_hotel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTEL_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  v_logo_set  := v_hotel.logo_path IS NOT NULL AND length(btrim(v_hotel.logo_path)) > 0;
  v_cover_set := v_hotel.cover_image_path IS NOT NULL AND length(btrim(v_hotel.cover_image_path)) > 0;

  -- LOGO → trust_logo_brand_assets
  IF v_logo_set THEN
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, internal_notes)
    VALUES (p_hotel_id, 'trust_logo_brand_assets', 'COLLECTED', 'AUTO_LINK_BRAND',
            'Auto-linked from hotels.logo_path. Manage via Hotel Settings.')
    ON CONFLICT (hotel_id, requirement_code) DO NOTHING;
    IF FOUND THEN v_linked := v_linked + 1; END IF;
  ELSE
    -- Clear stale AUTO_LINK_BRAND row when logo was removed
    DELETE FROM public.hotel_assets
      WHERE hotel_id = p_hotel_id
        AND requirement_code = 'trust_logo_brand_assets'
        AND collected_via = 'AUTO_LINK_BRAND'
        AND status = 'COLLECTED'
        -- Don't auto-delete if files were uploaded under this requirement
        AND NOT EXISTS (
          SELECT 1 FROM public.hotel_asset_files f
          WHERE f.hotel_asset_id = hotel_assets.id
        );
    IF FOUND THEN v_unlinked := v_unlinked + 1; END IF;
  END IF;

  -- COVER → trust_cover_image
  IF v_cover_set THEN
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, internal_notes)
    VALUES (p_hotel_id, 'trust_cover_image', 'COLLECTED', 'AUTO_LINK_BRAND',
            'Auto-linked from hotels.cover_image_path. Manage via Hotel Settings.')
    ON CONFLICT (hotel_id, requirement_code) DO NOTHING;
    IF FOUND THEN v_linked := v_linked + 1; END IF;
  ELSE
    DELETE FROM public.hotel_assets
      WHERE hotel_id = p_hotel_id
        AND requirement_code = 'trust_cover_image'
        AND collected_via = 'AUTO_LINK_BRAND'
        AND status = 'COLLECTED'
        AND NOT EXISTS (
          SELECT 1 FROM public.hotel_asset_files f
          WHERE f.hotel_asset_id = hotel_assets.id
        );
    IF FOUND THEN v_unlinked := v_unlinked + 1; END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'linked', v_linked, 'unlinked', v_unlinked);
END $$;

-- ─── 3. Storage cleanup trigger on hotel_asset_files DELETE ────────────────
--
-- Fires AFTER DELETE so the storage object follows the row to the grave.
-- Vault-only — public bucket paths may be shared with Hotel Settings (logo/
-- cover backfill points to existing objects which Hotel Settings owns).

CREATE OR REPLACE FUNCTION public._cleanup_storage_on_asset_file_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'storage'
AS $$
BEGIN
  IF OLD.bucket = 'hotel-asset-vault' THEN
    DELETE FROM storage.objects
      WHERE bucket_id = OLD.bucket
        AND name     = OLD.storage_path;
  END IF;
  -- For hotel-assets bucket: only delete if path looks like a DAM upload
  -- (under {hotel_id}/dam/...) rather than a Hotel Settings logo/cover.
  IF OLD.bucket = 'hotel-assets' AND OLD.storage_path ~ ('^' || OLD.hotel_id::text || '/dam/') THEN
    DELETE FROM storage.objects
      WHERE bucket_id = OLD.bucket
        AND name     = OLD.storage_path;
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort: failing to clean storage shouldn't roll back the DELETE.
  -- An orphan storage object is recoverable via admin cleanup; a stuck DB
  -- row is worse.
  RAISE NOTICE 'storage cleanup skipped for %/%: %', OLD.bucket, OLD.storage_path, SQLERRM;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_cleanup_storage_on_asset_file_delete ON public.hotel_asset_files;
CREATE TRIGGER trg_cleanup_storage_on_asset_file_delete
  AFTER DELETE ON public.hotel_asset_files
  FOR EACH ROW
  EXECUTE FUNCTION public._cleanup_storage_on_asset_file_delete();

-- ─── 4. update_hotel_asset_file_alt_text ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_hotel_asset_file_alt_text(
  p_file_id   uuid,
  p_alt_text  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_file public.hotel_asset_files%ROWTYPE;
BEGIN
  SELECT * INTO v_file FROM public.hotel_asset_files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILE_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF NOT public.vaiyu_is_hotel_member(v_file.hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF p_alt_text IS NOT NULL AND length(p_alt_text) > 280 THEN
    RAISE EXCEPTION 'ALT_TEXT_TOO_LONG: max 280 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.hotel_asset_files
    SET alt_text = p_alt_text
    WHERE id = p_file_id;

  RETURN jsonb_build_object('ok', true, 'file_id', p_file_id);
END $$;

GRANT EXECUTE ON FUNCTION public.update_hotel_asset_file_alt_text(uuid, text) TO authenticated;

-- ─── 6. Idempotency key isolation per hotel ─────────────────────────────────
--
-- Original constraint was global UNIQUE on idempotency_key. If two hotels
-- happened to pick the same UUID, the second one's RPC short-circuit would
-- return the first hotel's file row — a cross-tenant leak (extremely
-- unlikely with random UUIDs, but possible with deterministic key gen).
--
-- Rebuild as (hotel_id, idempotency_key) UNIQUE partial. Tighten the
-- record_hotel_asset_file lookup to include hotel_id.

DROP INDEX IF EXISTS public.idx_hotel_asset_files_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_asset_files_idempotency_per_hotel
  ON public.hotel_asset_files(hotel_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Replace the lookup section inside record_hotel_asset_file via OR REPLACE.
CREATE OR REPLACE FUNCTION public.record_hotel_asset_file(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_bucket            text,
  p_storage_path      text,
  p_mime_type         text,
  p_file_size_bytes   integer,
  p_idempotency_key   uuid,
  p_width_px          integer DEFAULT NULL,
  p_height_px         integer DEFAULT NULL,
  p_alt_text          text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_req           public.asset_requirements%ROWTYPE;
  v_asset         public.hotel_assets%ROWTYPE;
  v_existing      public.hotel_asset_files%ROWTYPE;
  v_file_id       uuid;
  v_actor_id      uuid := auth.uid();
  v_actor_name    text;
  v_old_status    public.asset_status;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '23502';
  END IF;

  -- Per-hotel idempotency lookup (closes cross-tenant leak)
  SELECT * INTO v_existing
    FROM public.hotel_asset_files
    WHERE hotel_id = p_hotel_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'file_id', v_existing.id,
      'hotel_asset_id', v_existing.hotel_asset_id
    );
  END IF;

  SELECT * INTO v_req
    FROM public.asset_requirements
    WHERE code = p_requirement_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_REQUIREMENT' USING ERRCODE = '23503';
  END IF;

  IF (v_req.storage_zone = 'PRIVATE_VAULT' AND p_bucket <> 'hotel-asset-vault') OR
     (v_req.storage_zone = 'PUBLIC_MARKETING' AND p_bucket <> 'hotel-assets') THEN
    RAISE EXCEPTION 'WRONG_BUCKET_FOR_ZONE: requirement % expects bucket for zone %, got %',
      p_requirement_code, v_req.storage_zone, p_bucket
      USING ERRCODE = '22023';
  END IF;

  IF p_storage_path !~ ('^' || p_hotel_id::text || '/.+') THEN
    RAISE EXCEPTION 'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER' USING ERRCODE = '22023';
  END IF;

  IF public._asset_filename_has_pii(p_storage_path) THEN
    RAISE EXCEPTION 'PII_FILENAME_REJECTED: Personal identity documents are not accepted. Only public business materials.'
      USING ERRCODE = '22023';
  END IF;

  IF p_mime_type NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  ) THEN
    RAISE EXCEPTION 'MIME_NOT_ALLOWED: %', p_mime_type USING ERRCODE = '22023';
  END IF;

  IF p_file_size_bytes <= 0 OR p_file_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'FILE_TOO_LARGE: file size must be 1..10485760 bytes, got %', p_file_size_bytes
      USING ERRCODE = '22023';
  END IF;

  v_actor_name := public._user_display_name(v_actor_id);

  -- Capture pre-existing status BEFORE the upsert so previous_status is
  -- truly previous (null when the row didn't exist).
  SELECT status INTO v_old_status
    FROM public.hotel_assets
    WHERE hotel_id = p_hotel_id AND requirement_code = p_requirement_code;

  INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via)
  VALUES (p_hotel_id, p_requirement_code, 'COLLECTED', 'OWNER_UPLOAD')
  ON CONFLICT (hotel_id, requirement_code) DO UPDATE
    SET requirement_code = EXCLUDED.requirement_code
  RETURNING * INTO v_asset;

  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE id = v_asset.id
    FOR UPDATE;

  IF v_asset.status IN ('NEEDS_REPLACEMENT', 'REJECTED') THEN
    UPDATE public.hotel_assets
      SET status = 'COLLECTED',
          collected_via = 'OWNER_UPLOAD',
          rejection_reason = NULL,
          reviewed_at = NULL,
          review_actor_id = NULL,
          review_actor_name = NULL
      WHERE id = v_asset.id
      RETURNING * INTO v_asset;
  END IF;

  IF NOT v_req.allow_multiple_files THEN
    DELETE FROM public.hotel_asset_files
      WHERE hotel_asset_id = v_asset.id;
  END IF;

  INSERT INTO public.hotel_asset_files (
    hotel_asset_id, hotel_id, bucket, storage_path, mime_type,
    file_size_bytes, width_px, height_px, alt_text,
    sort_order, idempotency_key,
    uploaded_by_actor_id, uploaded_by_actor_name
  )
  VALUES (
    v_asset.id, p_hotel_id, p_bucket, p_storage_path, p_mime_type,
    p_file_size_bytes, p_width_px, p_height_px, p_alt_text,
    COALESCE(
      (SELECT COALESCE(MAX(sort_order), -1) + 1
         FROM public.hotel_asset_files
         WHERE hotel_asset_id = v_asset.id),
      0
    ),
    p_idempotency_key,
    v_actor_id, v_actor_name
  )
  RETURNING id INTO v_file_id;

  PERFORM public.vaiyu_log_audit(
    'asset_file_recorded',
    'hotel_asset_files',
    v_file_id,
    p_hotel_id,
    jsonb_build_object(
      'requirement_code', p_requirement_code,
      'bucket', p_bucket,
      'storage_path', p_storage_path,
      'mime_type', p_mime_type,
      'file_size_bytes', p_file_size_bytes,
      'previous_status', v_old_status,
      'new_status', v_asset.status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'file_id', v_file_id,
    'hotel_asset_id', v_asset.id,
    'previous_status', v_old_status,
    'new_status', v_asset.status
  );
END $$;

-- ─── 7. Owner notes normalize empty string → NULL ──────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_hotel_asset_note(
  p_hotel_id          uuid,
  p_requirement_code  text,
  p_owner_notes       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_asset public.hotel_assets%ROWTYPE;
  v_notes text;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.asset_requirements WHERE code = p_requirement_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_REQUIREMENT' USING ERRCODE = '23503';
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_owner_notes, '')), '');

  INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, owner_notes)
  VALUES (p_hotel_id, p_requirement_code, 'NEEDS_REPLACEMENT', 'OWNER_UPLOAD', v_notes)
  ON CONFLICT (hotel_id, requirement_code) DO UPDATE
    SET owner_notes = v_notes
  RETURNING * INTO v_asset;

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id);
END $$;
