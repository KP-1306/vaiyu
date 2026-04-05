-- ============================================================
-- VIEW: v_owner_checkin_trend_daily
-- Daily aggregated check-in counts for historical trending
-- ============================================================

CREATE OR REPLACE VIEW v_owner_checkin_trend_daily AS
SELECT
    hotel_id,
    DATE(scheduled_checkin_at) as day,
    COUNT(*) as checkin_count
FROM stays
WHERE scheduled_checkin_at IS NOT NULL
GROUP BY hotel_id, DATE(scheduled_checkin_at)
ORDER BY day DESC;

GRANT SELECT ON v_owner_checkin_trend_daily TO authenticated, service_role;
