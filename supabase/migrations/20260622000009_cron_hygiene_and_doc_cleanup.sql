-- ============================================================================
-- Cron hygiene + guest-document cleanup fix (found via the silent-failure sweep)
-- ============================================================================
-- Three broken jobs surfaced from cron.job_run_details:
--   1. master-cleanup-job — SQL syntax error, never pruned cron.job_run_details,
--      which bloated to ~1M rows and timed out va_admin_cron_health (so the
--      cron-fails ALERT was blind). Re-register with a clean single-statement prune.
--   2. sla_update_job — command was the literal placeholder '<SQL HERE>', failing
--      every minute (~1440/day). It's a dead duplicate of update-sla-statuses-every-2m
--      (which runs SELECT update_ticket_sla_statuses() fine). Unschedule it.
--   3. cleanup_guest_documents() — referenced guest_id_documents.legal_hold, a column
--      that does not exist (no legal-hold feature in the schema), so the daily 90-day
--      ID-document purge errored every run (govt IDs retained past policy). Drop the
--      predicate. (Re-add it only if/when a legal_hold column is actually introduced.)
-- The one-time prune of the existing ~1M-row backlog is run as data cleanup outside
-- this migration; this migration prevents recurrence + restores the purge.
-- ============================================================================

-- (3) Fix the retention purge — identical to the deployed version minus the
-- non-existent legal_hold predicate.
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
  doc_count AS (
      SELECT count(*) AS c FROM deleted_docs
  ),
  files AS (
      SELECT unnest(ARRAY[front_image_url, back_image_url]) AS file_path
      FROM deleted_docs
  )
  INSERT INTO temp_files_to_delete
  SELECT file_path FROM files WHERE file_path IS NOT NULL;

  SELECT c INTO v_deleted_docs FROM doc_count;
  IF v_deleted_docs IS NULL THEN v_deleted_docs := 0; END IF;

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

-- (1+2) Cron fixes — guarded by pg_cron presence.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- (2) Kill the broken '<SQL HERE>' duplicate (real SLA job stays).
    PERFORM cron.unschedule('sla_update_job')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sla_update_job');

    -- (1) Re-register the cron-log pruner with a clean single statement (was a
    -- syntax error). Upserts on jobname.
    PERFORM cron.schedule(
      'master-cleanup-job', '0 1 * * *',
      $mc$ DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'; $mc$
    );
  END IF;
END
$do$;

-- NOTE: the one-time 361MB bloat was reclaimed with `VACUUM FULL cron.job_run_details`
-- via the Management API (which has MAINTAIN), run outside this migration (VACUUM can't
-- run in a transaction). An index on cron.job_run_details(jobid, start_time) would also
-- speed va_admin_cron_health, but CREATE INDEX needs table OWNERSHIP which no available
-- role has ("must be owner of table job_run_details") — so it's omitted. Not needed:
-- with master-cleanup-job now pruning to 7 days the table stays small (~15MB) and the
-- health RPC runs fine.
