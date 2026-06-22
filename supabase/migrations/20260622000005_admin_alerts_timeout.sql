-- ============================================================================
-- admin-alerts: raise the pg_net call timeout from the 5s default to 30s
-- ============================================================================
-- va_admin_invoke_alerts() fired admin-alerts via net.http_post WITHOUT a
-- timeout_milliseconds, so pg_net used its 5000ms default. The function does a
-- cold start + va_admin_cron_health + several COUNT queries + a per-admin
-- auth.admin.getUserById() loop in recipients(), which routinely exceeds 5s.
-- pg_net then abandoned the request (status NULL, "Timeout of 5000 ms reached"),
-- so we got NO response captured and NO confirmation the digest/alert sent —
-- even though the edge function itself kept running. 30s comfortably covers a
-- cold start; the watch cadence is 5 min so a longer ceiling is harmless.
-- ============================================================================
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
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'va_admin_invoke_alerts failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.va_admin_invoke_alerts(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.va_admin_invoke_alerts(text) TO service_role;
