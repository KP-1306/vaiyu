-- ============================================================================
-- Platform-ops alerting — pg_cron → admin-alerts edge function
-- ============================================================================
-- Pushes the Operator Console's attention signals to platform admins by email
-- (Resend, via the admin-alerts edge function). pg_cron can't call HTTPS directly
-- in a clean/secret-safe way, so a SECURITY DEFINER helper reads the project URL +
-- service-role key from Vault at RUNTIME (never embedded in cron.job.command / git)
-- and net.http_post's the function. No-ops gracefully if the secrets aren't set, so
-- the cron jobs are inert until activated.
--
-- ACTIVATION (one-time, prod): add two Vault secrets (Dashboard → Project Settings →
-- Vault, or SQL), then nothing else — the function deploys via CI and RESEND_API_KEY
-- is already a project function secret:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>',        'service_role_key');
-- Optional: set ADMIN_ALERT_EMAILS function secret (csv) to override recipients;
-- otherwise active platform_admins' emails are used.
-- ============================================================================

-- Dedup state for the "watch" cadence (and digest baseline). service_role/postgres
-- only — RLS on with no policies denies anon/authenticated.
CREATE TABLE IF NOT EXISTS public.platform_alert_state (
  kind        text PRIMARY KEY,
  fingerprint text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_alert_state FROM anon, authenticated;

-- Runtime invoker: reads Vault secrets and fires the edge function. Locked to
-- service_role/postgres (cron runs as the function owner).
CREATE OR REPLACE FUNCTION public.va_admin_invoke_alerts(p_mode text DEFAULT 'watch')
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
    RAISE NOTICE 'va_admin_invoke_alerts: missing Vault secrets (project_url/service_role_key); skipping';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/admin-alerts?mode=' || coalesce(p_mode, 'watch'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'va_admin_invoke_alerts failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.va_admin_invoke_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_invoke_alerts(text) TO service_role;

-- Schedule: watch every 5 min (alerts on change only), digest daily 09:00 IST.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('va_admin_alerts_watch', 'va_admin_alerts_digest');
    PERFORM cron.schedule('va_admin_alerts_watch',  '*/5 * * * *',  $cron$ SELECT public.va_admin_invoke_alerts('watch');  $cron$);
    PERFORM cron.schedule('va_admin_alerts_digest', '30 3 * * *',   $cron$ SELECT public.va_admin_invoke_alerts('digest'); $cron$); -- 03:30 UTC = 09:00 IST
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'admin-alerts cron schedule skipped: %', SQLERRM;
END $$;
