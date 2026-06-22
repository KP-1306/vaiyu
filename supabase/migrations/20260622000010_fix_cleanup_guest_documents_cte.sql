-- ============================================================================
-- cleanup_guest_documents(): fix the out-of-scope CTE (second stacked bug)
-- ============================================================================
-- 20260622000009 removed the non-existent legal_hold predicate, which then
-- exposed a SECOND bug (the function had never run far enough to hit it): the
-- `doc_count` CTE was declared in the INSERT-into-temp statement but read in a
-- SEPARATE statement ("relation doc_count does not exist") — CTEs are scoped to
-- their own statement. Combine the DELETE + file capture + count into ONE
-- statement so all CTEs are in scope. (The DELETE is a data-modifying CTE, so it
-- runs exactly once and its RETURNING set is shared by the INSERT CTE and the
-- count.) Logic verified read-only: 0 guests currently eligible at 90 days, so the
-- first real run purges nothing and just enforces retention going forward.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_guest_documents(p_retention_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_docs INT := 0;
  v_deleted_files INT := 0;
BEGIN
  IF p_retention_days < 30 THEN
     RAISE EXCEPTION 'Retention days cannot be less than 30';
  END IF;

  CREATE TEMP TABLE temp_files_to_delete (file_path TEXT) ON COMMIT DROP;

  WITH guest_last_checkout AS (
      SELECT s.guest_id, max(s.actual_checkout_at) AS last_checkout
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
          WHERE s.guest_id = g.id AND s.status IN ('arriving','inhouse')
      )
      AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.guest_id = g.id AND b.status IN ('CREATED','CONFIRMED')
      )
  ),
  deleted_docs AS (
      DELETE FROM guest_id_documents d
      WHERE d.guest_id IN (SELECT id FROM eligible_guests)
      RETURNING front_image_url, back_image_url
  ),
  ins AS (
      INSERT INTO temp_files_to_delete (file_path)
      SELECT f
      FROM deleted_docs, unnest(ARRAY[front_image_url, back_image_url]) AS f
      WHERE f IS NOT NULL
      RETURNING 1
  )
  SELECT count(*) INTO v_deleted_docs FROM deleted_docs;

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
$function$;
