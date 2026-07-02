-- 20260702000002_dam_rpcs_platform_admin_widen.sql
--
-- Widen the 5 DAM *author* RPCs so a platform admin can seed a hotel's
-- marketing media (VAiyu 'seed' step) IN ADDITION TO hotel members.
-- STRICTLY ADDITIVE:
--   IF NOT vaiyu_is_hotel_member(x) -> IF NOT (is_platform_admin() OR vaiyu_is_hotel_member(x))
-- Every existing caller (hotel members) keeps identical access; platform
-- admins gain it. Bodies are the EXACT live definitions (pg_get_functiondef);
-- only the membership-gate line changes. Mirrors the storage.objects
-- hotel-assets policy that already trusts is_platform_admin() (20260623000009).
-- approve/reject stay platform-admin-only; SELECT/read paths untouched.

CREATE OR REPLACE FUNCTION public.record_hotel_asset_file(p_hotel_id uuid, p_requirement_code text, p_bucket text, p_storage_path text, p_mime_type text, p_file_size_bytes integer, p_idempotency_key uuid, p_width_px integer DEFAULT NULL::integer, p_height_px integer DEFAULT NULL::integer, p_alt_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req           public.asset_requirements%ROWTYPE;
  v_asset         public.hotel_assets%ROWTYPE;
  v_existing      public.hotel_asset_files%ROWTYPE;
  v_file_id       uuid;
  v_actor_id      uuid := auth.uid();
  v_actor_name    text;
  v_old_status    public.asset_status;
BEGIN
  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(p_hotel_id)) THEN
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
END $function$

;


CREATE OR REPLACE FUNCTION public.remove_hotel_asset_file(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_file        public.hotel_asset_files%ROWTYPE;
  v_asset       public.hotel_assets%ROWTYPE;
  v_remaining   integer;
  v_new_status  public.asset_status;
BEGIN
  SELECT * INTO v_file FROM public.hotel_asset_files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FILE_NOT_FOUND' USING ERRCODE = '02000';
  END IF;

  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(v_file.hotel_id)) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = v_file.hotel_asset_id;

  DELETE FROM public.hotel_asset_files WHERE id = p_file_id;

  SELECT COUNT(*) INTO v_remaining
    FROM public.hotel_asset_files
    WHERE hotel_asset_id = v_asset.id;

  -- State transition on last-file removal
  IF v_remaining = 0 AND v_asset.status IN ('COLLECTED', 'APPROVED') THEN
    v_new_status := 'NEEDS_REPLACEMENT';
    UPDATE public.hotel_assets
      SET status = v_new_status,
          reviewed_at = NULL,
          review_actor_id = NULL,
          review_actor_name = NULL
      WHERE id = v_asset.id;
  ELSE
    v_new_status := v_asset.status;
  END IF;

  PERFORM public.vaiyu_log_audit(
    'asset_file_removed',
    'hotel_asset_files',
    p_file_id,
    v_file.hotel_id,
    jsonb_build_object(
      'requirement_code', v_asset.requirement_code,
      'bucket', v_file.bucket,
      'storage_path', v_file.storage_path,
      'remaining_files', v_remaining,
      'previous_status', v_asset.status,
      'new_status', v_new_status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'hotel_asset_id', v_asset.id,
    'remaining_files', v_remaining,
    'previous_status', v_asset.status,
    'new_status', v_new_status,
    'storage_path', v_file.storage_path,
    'bucket', v_file.bucket
  );
END $function$

;


CREATE OR REPLACE FUNCTION public.reorder_hotel_asset_files(p_hotel_asset_id uuid, p_ordered_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset    public.hotel_assets%ROWTYPE;
  v_count    integer;
  v_i        integer;
BEGIN
  SELECT * INTO v_asset FROM public.hotel_assets WHERE id = p_hotel_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSET_NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(v_asset.hotel_id)) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.hotel_asset_files
    WHERE hotel_asset_id = p_hotel_asset_id
      AND id = ANY(p_ordered_ids);
  IF v_count <> array_length(p_ordered_ids, 1) THEN
    RAISE EXCEPTION 'REORDER_LIST_MISMATCH: not all file IDs belong to this asset'
      USING ERRCODE = '22023';
  END IF;

  -- sort_order is not in the immutability trigger's column list, so the
  -- update is allowed; identity columns stay locked.
  FOR v_i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.hotel_asset_files
      SET sort_order = v_i - 1
      WHERE id = p_ordered_ids[v_i];
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END $function$

;


CREATE OR REPLACE FUNCTION public.set_hotel_asset_status(p_hotel_id uuid, p_requirement_code text, p_status asset_status, p_owner_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset      public.hotel_assets%ROWTYPE;
  v_file_cnt   integer;
  v_old_status public.asset_status;
BEGIN
  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(p_hotel_id)) THEN
    RAISE EXCEPTION 'NOT_HOTEL_MEMBER' USING ERRCODE = '42501';
  END IF;

  -- Owner can only toggle COLLECTED ↔ NEEDS_REPLACEMENT.
  -- APPROVED and REJECTED are admin-only via approve_hotel_asset / reject_hotel_asset.
  IF p_status NOT IN ('COLLECTED', 'NEEDS_REPLACEMENT') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED_FROM_OWNER: owner can only set COLLECTED or NEEDS_REPLACEMENT'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_asset
    FROM public.hotel_assets
    WHERE hotel_id = p_hotel_id AND requirement_code = p_requirement_code;

  IF NOT FOUND THEN
    -- Lazy-create only allows status transition if there are no files yet
    IF p_status <> 'NEEDS_REPLACEMENT' THEN
      RAISE EXCEPTION 'NO_FILES_TO_MARK_COLLECTED' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.hotel_assets (hotel_id, requirement_code, status, collected_via, owner_notes)
    VALUES (p_hotel_id, p_requirement_code, 'NEEDS_REPLACEMENT', 'OWNER_UPLOAD', p_owner_notes)
    RETURNING * INTO v_asset;
    v_old_status := NULL;
  ELSE
    v_old_status := v_asset.status;
    -- COLLECTED requires at least one file
    IF p_status = 'COLLECTED' THEN
      SELECT COUNT(*) INTO v_file_cnt
        FROM public.hotel_asset_files
        WHERE hotel_asset_id = v_asset.id;
      IF v_file_cnt = 0 THEN
        RAISE EXCEPTION 'NO_FILES_TO_MARK_COLLECTED' USING ERRCODE = '22023';
      END IF;
    END IF;
    -- Owner can't override an APPROVED row to anything except via admin reject
    IF v_asset.status = 'APPROVED' AND p_status = 'NEEDS_REPLACEMENT' THEN
      RAISE EXCEPTION 'CANNOT_UNAPPROVE_DIRECTLY: contact VAiyu team to mark this as needs replacement'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.hotel_assets
      SET status = p_status,
          owner_notes = COALESCE(p_owner_notes, owner_notes)
      WHERE id = v_asset.id
      RETURNING * INTO v_asset;
  END IF;

  PERFORM public.vaiyu_log_audit(
    'asset_status_changed_by_owner',
    'hotel_assets',
    v_asset.id,
    p_hotel_id,
    jsonb_build_object(
      'requirement_code', p_requirement_code,
      'previous_status', v_old_status,
      'new_status', p_status
    )
  );

  RETURN jsonb_build_object('ok', true, 'hotel_asset_id', v_asset.id, 'new_status', p_status);
END $function$

;


CREATE OR REPLACE FUNCTION public.upsert_hotel_asset_note(p_hotel_id uuid, p_requirement_code text, p_owner_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset public.hotel_assets%ROWTYPE;
  v_notes text;
BEGIN
  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(p_hotel_id)) THEN
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
END $function$

;
