-- ============================================================
-- Maintenance: Master Cleanup Job
-- Purpose: Consolidates various table cleanups into one daily job.
-- Schedule: Every night at 1 AM (0 1 * * *)
-- ============================================================

-- 1. Remove individual job if exists (cleanup)
SELECT cron.unschedule('cleanup-cron-logs');

-- 2. Create the combined Master Job
SELECT cron.schedule('master-cleanup-job', '0 1 * * *', $$
BEGIN
    -- Cleanup Cron logs (Keep 3 days)
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';
    
    -- Cleanup Auth refresh tokens (Keep 7 days of active/unrevoked)
    DELETE FROM auth.refresh_tokens WHERE revoked = true OR updated_at < now() - interval '7 days';
    
    -- Cleanup Realtime subscriptions (Keep 1 day)
    DELETE FROM realtime.subscription WHERE created_at < now() - interval '1 day';
    
    -- Optional: Cleanup Auth audit logs
    DELETE FROM auth.audit_log_entries WHERE created_at < now() - interval '7 days';
END;
$$);
