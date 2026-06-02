-- Interakt WhatsApp Integration — Defer-Loop Bound (hostile-review fix)
--
-- Earlier patches deferred TEMPLATE_NOT_CONFIGURED + DAILY_CAP_REACHED without
-- bumping retry_count. Combined with status='pending', that meant the row
-- could defer indefinitely if the underlying condition was never resolved
-- (templates never wired, cap permanently 0). The notification_queue would
-- grow linearly with time.
--
-- Fix: make BOTH defer paths bump retry_count + permanently fail after a
-- bounded number of attempts (default 48 — roughly two days at 1-hour
-- intervals for templates, or two months at daily intervals for cap).
-- Once the row is 'failed', it stops being claimed by the worker and shows
-- up in v_hotel_whatsapp_health.failed_7d so owners notice.

CREATE OR REPLACE FUNCTION public.defer_notification_to_tomorrow(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.notification_queue
     SET status = CASE WHEN retry_count >= 48 THEN 'failed' ELSE 'pending' END,
         retry_count = retry_count + 1,
         next_attempt_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
                            + interval '1 day' + interval '8 hours', -- 08:00 IST tomorrow
         error_message = COALESCE(error_message, 'INTERAKT_DAILY_CAP_REACHED')
   WHERE id = p_id;
$$;
COMMENT ON FUNCTION public.defer_notification_to_tomorrow(uuid) IS
  'Cap-aware deferral. Schedules next attempt for 08:00 IST tomorrow. Bumps retry_count; after 48 attempts the row permanently fails — protects against infinite defer when cap stays 0.';

-- New RPC: defer one hour (for TEMPLATE_NOT_CONFIGURED). Bumps retry_count,
-- permanently fails after 48 attempts (≈48 hours of trying).
CREATE OR REPLACE FUNCTION public.defer_notification_one_hour(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.notification_queue
     SET status = CASE WHEN retry_count >= 48 THEN 'failed' ELSE 'pending' END,
         retry_count = retry_count + 1,
         next_attempt_at = now() + interval '1 hour',
         error_message = COALESCE(p_reason, error_message, 'DEFERRED')
   WHERE id = p_id;
$$;
GRANT EXECUTE ON FUNCTION public.defer_notification_one_hour(uuid, text) TO service_role;
COMMENT ON FUNCTION public.defer_notification_one_hour(uuid, text) IS
  'Bounded hourly deferral for transient unresolved conditions (template not configured, BSP 5xx, etc). Bumps retry_count; after 48 attempts permanently fails so owners see it in failed_7d.';
