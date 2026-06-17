-- ============================================================
-- VAiyu: Owner Analytics — scale flat as ticket history grows
-- ============================================================
-- Measured at 50k tickets/hotel (local, 2026-06-18): two views scanned the
-- ENTIRE ticket history because they had no usable date bound:
--   * v_owner_kpi_summary    : 1,417 ms (Seq Scan of all 50k; NO date WHERE)
--   * v_owner_sla_trend_daily : 1,475 ms (join `date(completed_at)=day` is
--                               non-sargable -> scans all history per day)
-- Both grow linearly with tenant age (at 200k tickets ~5-6 s). The rest of the
-- analytics views are date-bounded and only needed an index to range-scan the
-- 30-day window instead of all of a hotel's tickets.
--
-- FIX (all proven on the 50k dataset; all output-identical for any hotel with
-- activity in the window):
--   1. Composite indexes (hotel_id, completed_at) and (hotel_id, created_at)
--      -> date-bounded views become per-hotel 30-day range scans
--         (breach_breakdown measured 0.34 ms after).
--   2. kpi_summary: bound the scan to "active OR completed within 30d".
--      Old completed tickets (>30d, not active) contribute 0 to EVERY aggregate,
--      so this is output-identical. Measured 1,417 ms -> 0.9 ms.
--   3. sla_trend_daily: pre-aggregate the 30-day window with a SARGABLE
--      completed_at range, then LEFT JOIN a 30-day skeleton -> no full-history
--      scan, no date() on the join column.
--
-- Indexes are additive; CREATE INDEX (not CONCURRENTLY) is safe because the
-- prod tickets table is small today and building now (while small) is cheapest.
-- View bodies keep the plain-view + vaiyu_can_view_hotel_analytics() wrapper
-- from 20260617000004 (security unchanged).
-- ============================================================

-- 1) Composite indexes ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tickets_hotel_completed ON public.tickets (hotel_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_tickets_hotel_created   ON public.tickets (hotel_id, created_at);

-- 2) kpi_summary: bound the scan (active OR completed within 30d) --------------
CREATE OR REPLACE VIEW public.v_owner_kpi_summary WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
    count(DISTINCT t.id) FILTER (WHERE t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AS total_tickets,
    count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false AND t.completed_at >= (CURRENT_DATE - '30 days'::interval) AND NOT (EXISTS ( SELECT 1
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS completed_within_sla,
    count(DISTINCT t.id) FILTER (WHERE (ss.breached = true OR (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.current_remaining_seconds <= 0) AND (t.completed_at >= (CURRENT_DATE - '30 days'::interval) OR (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])))) AS breached_sla,
    count(DISTINCT t.id) FILTER (WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.current_remaining_seconds <= 1800 AND NOT (EXISTS ( SELECT 1
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS at_risk_tickets,
    round(100.0 * count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false AND t.completed_at >= (CURRENT_DATE - '30 days'::interval))::numeric / NULLIF(count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND t.completed_at >= (CURRENT_DATE - '30 days'::interval)), 0)::numeric, 2) AS sla_compliance_percent
   FROM tickets t
     LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])
         OR t.completed_at >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY t.hotel_id
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

-- 3) sla_trend_daily: sargable 30-day window + skeleton join -------------------
CREATE OR REPLACE VIEW public.v_owner_sla_trend_daily WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 WITH days AS (
         SELECT generate_series(CURRENT_DATE - '29 days'::interval, CURRENT_DATE::timestamp without time zone, '1 day'::interval)::date AS day
        ), recent AS (
         SELECT t.hotel_id,
            date(t.completed_at) AS day,
            count(t.id) FILTER (WHERE ss.breached = false AND NOT (EXISTS ( SELECT 1
                   FROM ticket_events te
                  WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS completed_within_sla,
            count(t.id) FILTER (WHERE ss.breached = true) AS breached_sla,
            count(t.id) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM ticket_events te
                  WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS sla_exempted
           FROM tickets t
             LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
          WHERE t.completed_at >= (CURRENT_DATE - '29 days'::interval)   -- sargable: uses (hotel_id, completed_at)
          GROUP BY t.hotel_id, date(t.completed_at)
        )
 SELECT h.id AS hotel_id,
    d.day,
    COALESCE(r.completed_within_sla, 0) AS completed_within_sla,
    COALESCE(r.breached_sla, 0) AS breached_sla,
    COALESCE(r.sla_exempted, 0) AS sla_exempted
   FROM hotels h
     CROSS JOIN days d
     LEFT JOIN recent r ON r.hotel_id = h.id AND r.day = d.day
  ORDER BY d.day DESC
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

-- grants unchanged (inherited); re-assert no-anon for safety
REVOKE ALL ON public.v_owner_kpi_summary FROM anon, PUBLIC;
REVOKE ALL ON public.v_owner_sla_trend_daily FROM anon, PUBLIC;
GRANT SELECT ON public.v_owner_kpi_summary TO authenticated, service_role;
GRANT SELECT ON public.v_owner_sla_trend_daily TO authenticated, service_role;
