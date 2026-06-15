-- 20260616_whatsapp_stale_failure_cleanup.sql
--
-- One-off cleanup of the permanently-failed WhatsApp notification rows that
-- accumulated because the post-checkout / precheckin enqueues did not gate on
-- hotels.whatsapp_enabled (fixed structurally in migration 20260616000001).
--
-- These rows are terminal: status='failed', retry_count >= 10, no send ever
-- occurred and none will. They are pure noise in failed_7d / owner dashboards.
--
-- RUN ORDER:
--   STEP 1 first (read-only) — review the exact rows + counts together.
--   STEP 2 only after the STEP 1 output matches expectations.
--
-- NOT placed in a migration on purpose: deleting prod data should be a
-- reviewed, explicit action, not something that auto-runs on every db reset.
-- Mirrors supabase/maintenance/20260611_walkin_orphan_cleanup.sql.

-- ─── STEP 1 — PREVIEW (read-only) ────────────────────────────────────────────
-- Expected (as observed 2026-06-16): ~36 rows total —
--   post_checkout_thankyou: 27 WHATSAPP_DISABLED_FOR_HOTEL + 4 "ID not configured"
--   precheckin_link:         2  WHATSAPP_DISABLED_FOR_HOTEL + 3 "ID not configured"

SELECT template_code,
       error_message,
       count(*)                          AS rows,
       min(created_at)::date             AS first_seen,
       max(created_at)::date             AS last_seen
  FROM public.notification_queue
 WHERE channel = 'whatsapp'
   AND status  = 'failed'
   AND error_message IN ('WHATSAPP_DISABLED_FOR_HOTEL',
                         'Hotel WhatsApp ID not configured')
 GROUP BY template_code, error_message
 ORDER BY rows DESC;

-- Grand total that STEP 2 will delete:
SELECT count(*) AS will_delete
  FROM public.notification_queue
 WHERE channel = 'whatsapp'
   AND status  = 'failed'
   AND error_message IN ('WHATSAPP_DISABLED_FOR_HOTEL',
                         'Hotel WhatsApp ID not configured');


-- ─── STEP 2 — DELETE (run only after reviewing STEP 1) ───────────────────────
-- Tightly scoped: only failed WhatsApp rows whose failure reason is one of the
-- two config-noise messages above. Will NOT touch sent rows, email rows,
-- pending rows, or rows that failed for any other (real) reason.
--
-- Wrapped so you can inspect the row count before committing.
--
-- BEGIN;
--
-- DELETE FROM public.notification_queue
--  WHERE channel = 'whatsapp'
--    AND status  = 'failed'
--    AND error_message IN ('WHATSAPP_DISABLED_FOR_HOTEL',
--                          'Hotel WhatsApp ID not configured');
--
-- -- Confirm the count, then:
-- COMMIT;   -- or ROLLBACK; if it looks wrong
