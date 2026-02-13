-- Migration: Schedule Import Workers (Cron)
-- Purpose: Automate the execution of background workers (Edge Functions) using pg_cron.
-- Reference: This ensures rows are processed continuously without manual intervention.

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Schedule 'process-import-rows' to run every minute
-- NOTE: You must replace 'YOUR_FUNCTION_URL' and 'YOUR_SERVICE_ROLE_KEY' with actual values.
-- In managed Supabase, these are often available via vault or need to be hardcoded/env-subsituted.

-- Job: Process Pending Import Rows (Every minute)
SELECT cron.schedule(
    'process-import-rows-job', -- Job name
    '* * * * *',              -- Every minute
    $$
    SELECT
        net.http_post(
            -- URL: The deployed Edge Function URL
            url := 'https://vsqiuwbmawygkxxjrxnt.supabase.co/functions/v1/process-import-rows',
            
            -- Headers: Authorization with Service Role Key (to bypass RLS if needed, or mapped internal)
            headers := ('{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}')::jsonb,
            
            -- Body: Empty JSON (Worker fetches rows via RPC)
            body := '{}'::jsonb
        ) as request_id;
    $$
);

-- Job: Retry Notifications (Every minute)
-- NOTE: Requires a 'send-notifications' edge function (Implementation pending)
SELECT cron.schedule(
    'send-notifications-job',
    '* * * * *',
    $$
    SELECT
        net.http_post(
            url := 'https://vsqiuwbmawygkxxjrxnt.supabase.co/functions/v1/send-notifications',
            headers := ('{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}')::jsonb,
            body := '{}'::jsonb
        ) as request_id;
    $$
);

-- Job: Generate Reminders (Every 30 minutes)
SELECT cron.schedule(
    'generate-reminders-job',
    '*/30 * * * *',
    $$
    SELECT
        net.http_post(
            url := 'https://vsqiuwbmawygkxxjrxnt.supabase.co/functions/v1/generate-reminders',
            headers := ('{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}')::jsonb,
            body := '{}'::jsonb
        ) as request_id;
    $$
);

-- 3. Monitoring Query (Reference)
-- Run this to check if jobs are running:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
