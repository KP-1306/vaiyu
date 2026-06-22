-- ============================================================================
-- Guest ID-document retention v2 — redact-and-tombstone via an edge function
-- ============================================================================
-- The old cleanup_guest_documents() tried to DELETE FROM storage.objects in SQL,
-- which Supabase blocks (storage.protect_delete trigger) — so it could never purge
-- the ID images. Retention now runs in the cleanup-guest-documents edge function
-- (Storage API) driven by these RPCs. Hospitality-standard design:
--   • retention window = 365 days after the guest's LAST checkout (30-day floor),
--   • DELETE the sensitive ID images from storage, and
--   • REDACT-and-tombstone the DB row: scrub the scan/number/hashes, set purged_at,
--     is_active=false — keeping a non-sensitive stub (document_type, verified_at) so
--     "this guest's ID was collected, verified, and purged on X" stays provable
--     (FRRO/audit one way, DPDP storage-limitation the other).
-- ============================================================================

ALTER TABLE public.guest_id_documents
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- Eligible docs to purge: guest's last checkout older than retention, no active stay,
-- no pending booking, not already purged. Read-only; the edge fn drives deletion.
CREATE OR REPLACE FUNCTION public.guest_docs_due_for_purge(p_retention_days int DEFAULT 365)
RETURNS TABLE(id uuid, front_image_url text, back_image_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      WHERE lc.last_checkout < now() - (greatest(30, coalesce(p_retention_days, 365)) || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM stays s WHERE s.guest_id = g.id AND s.status IN ('arriving','inhouse'))
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.guest_id = g.id AND b.status IN ('CREATED','CONFIRMED'))
  )
  SELECT d.id, d.front_image_url, d.back_image_url
  FROM public.guest_id_documents d
  WHERE d.guest_id IN (SELECT id FROM eligible_guests)
    AND d.purged_at IS NULL;
$$;

-- Redact one doc to a non-sensitive tombstone (called after its images are removed).
CREATE OR REPLACE FUNCTION public.mark_guest_doc_purged(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.guest_id_documents
     SET front_image_url        = NULL,
         back_image_url         = NULL,
         storage_key            = NULL,
         document_number_masked = NULL,
         front_hash             = NULL,
         back_hash              = NULL,
         document_number_hash   = NULL,
         is_active              = false,
         purged_at              = now(),
         updated_at             = now()
   WHERE id = p_id;
$$;

-- Vault-authed cron invoker (mirrors va_admin_invoke_alerts): posts to the edge fn
-- with the service-role bearer + a 30s timeout. No-ops where Vault secrets are absent.
CREATE OR REPLACE FUNCTION public.va_invoke_cleanup_guest_documents(p_retention_days int DEFAULT 365)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'va_invoke_cleanup_guest_documents: missing Vault secrets; skipping (expected on local)';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/cleanup-guest-documents',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object('retention_days', coalesce(p_retention_days, 365)),
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'va_invoke_cleanup_guest_documents failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_docs_due_for_purge(int)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_guest_doc_purged(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.va_invoke_cleanup_guest_documents(int)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_docs_due_for_purge(int)          TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_guest_doc_purged(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.va_invoke_cleanup_guest_documents(int) TO service_role;

-- Repoint the daily cron to the edge-fn invoker (was calling the broken SQL fn).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup_guest_documents_daily', '30 2 * * *',
      $cmd$ SELECT public.va_invoke_cleanup_guest_documents(365); $cmd$
    );
  END IF;
END
$do$;

-- Retire the broken, now-superseded SQL function (cron-only, no other callers).
DROP FUNCTION IF EXISTS public.cleanup_guest_documents(integer);
