-- ============================================================
-- GUEST CHECK-IN SYSTEM LIFECYCLE MANAGEMENT
-- ============================================================

-- 1. Cleanup Function (Production Safe - Checkout Based)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_guest_documents(
  p_retention_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_docs INT := 0;
  v_deleted_files INT := 0;
  v_current_count INT;
BEGIN
  -- Safety Guard
  IF p_retention_days < 30 THEN
     RAISE EXCEPTION 'Retention days cannot be less than 30';
  END IF;

  -- Temp table for storage cleanup
  CREATE TEMP TABLE temp_files_to_delete (file_path TEXT) ON COMMIT DROP;

  WITH guest_last_checkout AS (
      SELECT 
          s.guest_id,
          max(s.actual_checkout_at) AS last_checkout
      FROM stays s
      WHERE s.actual_checkout_at IS NOT NULL
      GROUP BY s.guest_id
  ),
  eligible_guests AS (
      SELECT g.id
      FROM guests g
      JOIN guest_last_checkout lc ON lc.guest_id = g.id
      WHERE lc.last_checkout < now() - (p_retention_days || ' days')::interval
      AND NOT EXISTS (
          SELECT 1 FROM stays s
          WHERE s.guest_id = g.id
          AND s.status IN ('arriving','inhouse')
      )
      AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.guest_id = g.id
          AND b.status IN ('CREATED','CONFIRMED')
      )
  ),
  deleted_docs AS (
      DELETE FROM guest_id_documents d
      WHERE d.guest_id IN (SELECT id FROM eligible_guests)
      AND coalesce(d.legal_hold,false) = false
      RETURNING front_image_url, back_image_url
  ),
  files AS (
      SELECT unnest(ARRAY[front_image_url, back_image_url]) AS file_path
      FROM deleted_docs
  )
  INSERT INTO temp_files_to_delete
  SELECT file_path
  FROM files
  WHERE file_path IS NOT NULL;

  GET DIAGNOSTICS v_deleted_docs = ROW_COUNT;
  -- The ROW_COUNT of the INSERT represents files, but we want successful doc deletes.
  -- Actually, we can't easily get the deleted doc count effectively from the INSERT ROW_COUNT if we want the exact docs.
  -- However, the user provided code captures deleted_docs in CTE. 
  -- Let's stick to the user's logic or strict interpretation. 
  -- User's code: "SELECT c INTO v_deleted_docs FROM doc_count;" (which assumes a count aggregation CTE)
  -- The user provided a `doc_count` CTE in the prompt which I will include.

  WITH deleted_storage AS (
      DELETE FROM storage.objects
      WHERE bucket_id = 'guest-documents'
      AND name IN (SELECT file_path FROM temp_files_to_delete)
      RETURNING name
  )
  SELECT count(*) INTO v_deleted_files FROM deleted_storage;

  RETURN jsonb_build_object(
      'status','success',
      'deleted_documents', v_deleted_docs/2, -- Approximate since we inserted potentially 2 files per doc? No, v_deleted_docs is from the INSERT usually if following prev pattern.
      -- Wait, I will use the USER'S exact provided CTE structure for correctness.
      'deleted_files', v_deleted_files
  );
END;
$$;

-- Note: Re-defining function with the User's EXACT Logic below to ensure no deviation
CREATE OR REPLACE FUNCTION cleanup_guest_documents(
  p_retention_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_docs INT := 0;
  v_deleted_files INT := 0;
BEGIN
  -- Safety Guard
  IF p_retention_days < 30 THEN
     RAISE EXCEPTION 'Retention days cannot be less than 30';
  END IF;

  -- Temp table for storage cleanup
  CREATE TEMP TABLE temp_files_to_delete (file_path TEXT) ON COMMIT DROP;

  WITH guest_last_checkout AS (
      SELECT 
          s.guest_id,
          max(s.actual_checkout_at) AS last_checkout
      FROM stays s
      WHERE s.actual_checkout_at IS NOT NULL
      GROUP BY s.guest_id
  ),
  eligible_guests AS (
      SELECT g.id
      FROM guests g
      JOIN guest_last_checkout lc ON lc.guest_id = g.id
      WHERE lc.last_checkout < now() - (p_retention_days || ' days')::interval
      AND NOT EXISTS (
          SELECT 1 FROM stays s
          WHERE s.guest_id = g.id
          AND s.status IN ('arriving','inhouse')
      )
      AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.guest_id = g.id
          AND b.status IN ('CREATED','CONFIRMED')
      )
  ),
  deleted_docs AS (
      DELETE FROM guest_id_documents d
      WHERE d.guest_id IN (SELECT id FROM eligible_guests)
      AND coalesce(d.legal_hold,false) = false
      RETURNING front_image_url, back_image_url
  ),
  doc_count AS (
      SELECT count(*) AS c FROM deleted_docs
  ),
  files AS (
      SELECT unnest(ARRAY[front_image_url, back_image_url]) AS file_path
      FROM deleted_docs
  )
  INSERT INTO temp_files_to_delete
  SELECT file_path
  FROM files
  WHERE file_path IS NOT NULL;

  -- Capture doc count from the CTE
  SELECT c INTO v_deleted_docs FROM doc_count;
  -- Fallback if 0 (though coalesce in CTE might handle it, SQL requires execution)
  IF v_deleted_docs IS NULL THEN v_deleted_docs := 0; END IF;

  -- Delete from storage
  WITH deleted_storage AS (
      DELETE FROM storage.objects
      WHERE bucket_id = 'guest-documents'
      AND name IN (SELECT file_path FROM temp_files_to_delete)
      RETURNING name
  )
  SELECT count(*) INTO v_deleted_files FROM deleted_storage;

  RETURN jsonb_build_object(
      'status','success',
      'deleted_documents', v_deleted_docs,
      'deleted_files', v_deleted_files
  );
END;
$$;


-- 2. Secure Execution
-- ============================================================
REVOKE ALL ON FUNCTION cleanup_guest_documents(INT) FROM public;
GRANT EXECUTE ON FUNCTION cleanup_guest_documents(INT) TO service_role;

SELECT cron.unschedule('cleanup_guest_documents_daily');
-- 3. Schedule Cron Job
-- ============================================================
-- Daily at 02:30 AM
SELECT cron.schedule(
  'cleanup_guest_documents_daily',
  '30 2 * * *',
  $$ SELECT cleanup_guest_documents(90); $$
);
