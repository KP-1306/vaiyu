-- Interakt WhatsApp Integration — Patch (cap-aware deferral)
--
-- The send-notifications dispatcher needs a way to say "this row hit the
-- daily cap, don't punish it with retry-count + backoff — just hold it
-- until tomorrow morning IST and try again." This RPC is that path.
--
-- Separate from mark_notification_failed because:
--   • mark_notification_failed bumps retry_count and after 10 tries marks
--     the row permanently failed. A cap hit isn't a failure.
--   • We want a predictable wake-up time (morning IST) rather than 2-min
--     exponential backoff.

CREATE OR REPLACE FUNCTION public.defer_notification_to_tomorrow(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.notification_queue
     SET status          = 'pending',
         next_attempt_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
                            + interval '1 day' + interval '8 hours', -- 08:00 IST tomorrow
         error_message   = COALESCE(error_message, 'INTERAKT_DAILY_CAP_REACHED')
   WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.defer_notification_to_tomorrow(uuid) TO service_role;
COMMENT ON FUNCTION public.defer_notification_to_tomorrow(uuid) IS
  'Cap-aware deferral. Leaves retry_count untouched and schedules next attempt for 08:00 IST tomorrow. Called by send-notifications when a hotel hits its daily cap.';
