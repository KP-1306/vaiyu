-- ============================================================================
-- Fix the 5s pg_net timeout on the per-minute queue-processor crons + bring
-- three ad-hoc (dashboard-created, untracked) cron jobs under version control.
-- ============================================================================
-- process-import-rows-job / send-notifications-job / generate-reminders-job were
-- created ad-hoc and fired net.http_post WITHOUT timeout_milliseconds, so each
-- inherited pg_net's 5000ms default. The target edge functions cold-start past 5s,
-- so pg_net recorded status NULL "Timeout of 5000 ms reached" — no response, no
-- observability (the same class of bug fixed for admin-alerts in 20260622000005).
--
-- Rather than re-hardcode the prod URL (which would make a local `db reset` post to
-- PROD every minute), route through a Vault-reading helper that mirrors
-- va_admin_invoke_alerts: it reads project_url at runtime and NO-OPs where the
-- secret is absent (i.e. local). 30s comfortably covers a cold start.
-- ============================================================================

-- Generic invoker: fire a public edge function via pg_net with a sane timeout.
-- Keeps the original calls' shape (no auth header — these fns deploy verify_jwt=off;
-- do NOT add the service-role key here).
CREATE OR REPLACE FUNCTION public.va_cron_invoke_fn(p_fn text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  IF v_url IS NULL THEN
    RAISE NOTICE 'va_cron_invoke_fn(%): no project_url in Vault; skipping (expected on local)', p_fn;
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'va_cron_invoke_fn(%) failed: %', p_fn, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.va_cron_invoke_fn(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_cron_invoke_fn(text) TO service_role;

-- Re-register the three jobs by name (cron.schedule upserts on jobname, preserving
-- the jobid) so they call the timeout-aware helper instead of a bare http_post.
-- Guarded by the pg_cron extension being present (it is on prod + local supabase).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('process-import-rows-job', '* * * * *',  $cmd$ SELECT public.va_cron_invoke_fn('process-import-rows'); $cmd$);
    PERFORM cron.schedule('send-notifications-job',  '* * * * *',  $cmd$ SELECT public.va_cron_invoke_fn('send-notifications');  $cmd$);
    PERFORM cron.schedule('generate-reminders-job',  '*/30 * * * *', $cmd$ SELECT public.va_cron_invoke_fn('generate-reminders'); $cmd$);
  END IF;
END
$do$;
