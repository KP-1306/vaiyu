-- 20260617000001_owner_analytics_ist_buckets.sql
--
-- Bucket Owner Analytics days in the hotel timezone (IST / Asia/Kolkata) instead
-- of UTC. Hotels run 24/7 and this dashboard is about ticket/SLA *timing*: with
-- UTC bucketing, activity between 00:00–05:30 IST landed on the previous
-- calendar day and "Today" showed yesterday until ~05:30 IST. All hotels are
-- Indian, so Asia/Kolkata is hardcoded (no per-hotel tz config until a non-IST
-- hotel exists — consistent with the no-premature-config rule).
--
-- Transformation applied to every date-bucketed view:
--   date(x) / x::date            -> (x AT TIME ZONE 'Asia/Kolkata')::date
--   CURRENT_DATE                 -> public.vaiyu_ist_today()
--   x >= CURRENT_DATE - 'N days' -> (x AT TIME ZONE 'Asia/Kolkata')::date >= ist_today - N
--
-- Each view is recreated WITH (security_invoker = on) so the RLS perimeter from
-- 20260616000006 is preserved atomically; the anon/PUBLIC revoke is re-asserted
-- at the end as defence-in-depth. Bodies are otherwise verbatim from the live
-- definitions (pg_get_viewdef), only the date expressions changed.

CREATE OR REPLACE FUNCTION public.vaiyu_ist_today()
RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;
COMMENT ON FUNCTION public.vaiyu_ist_today() IS 'Current calendar date in the hotel timezone (Asia/Kolkata). Used to bucket Owner Analytics by IST day.';

-- ─── ticket activity (Created vs Resolved) ─────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_ticket_activity WITH (security_invoker = on) AS
WITH daily AS (
  SELECT tickets.hotel_id,
         generate_series(public.vaiyu_ist_today()::timestamp - '29 days'::interval,
                         public.vaiyu_ist_today()::timestamp, '1 day'::interval)::date AS day
  FROM tickets GROUP BY tickets.hotel_id
), events AS (
  SELECT tickets.hotel_id, (tickets.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, 1 AS created_count, 0 AS resolved_count
  FROM tickets
  WHERE (tickets.created_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
  UNION ALL
  SELECT tickets.hotel_id, (tickets.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, 0 AS created_count, 1 AS resolved_count
  FROM tickets
  WHERE tickets.status = 'COMPLETED'::text AND (tickets.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
)
SELECT d.hotel_id, d.day,
       COALESCE(sum(e.created_count), 0::bigint) AS created_count,
       COALESCE(sum(e.resolved_count), 0::bigint) AS resolved_count
FROM daily d LEFT JOIN events e ON e.hotel_id = d.hotel_id AND e.day = d.day
GROUP BY d.hotel_id, d.day ORDER BY d.day DESC;

-- ─── SLA trend daily ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_sla_trend_daily WITH (security_invoker = on) AS
WITH daily AS (
  SELECT tickets.hotel_id,
         generate_series(public.vaiyu_ist_today()::timestamp - '29 days'::interval,
                         public.vaiyu_ist_today()::timestamp, '1 day'::interval)::date AS day
  FROM tickets GROUP BY tickets.hotel_id
)
SELECT d.hotel_id, d.day,
  count(t.id) FILTER (WHERE ss.breached = false AND NOT (EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS completed_within_sla,
  count(t.id) FILTER (WHERE ss.breached = true) AS breached_sla,
  count(t.id) FILTER (WHERE (EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS sla_exempted
FROM daily d
  LEFT JOIN tickets t ON t.hotel_id = d.hotel_id AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date = d.day
  LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY d.hotel_id, d.day ORDER BY d.day DESC;

-- ─── check-in trend daily ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_checkin_trend_daily WITH (security_invoker = on) AS
SELECT hotel_id, (scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS checkin_count
FROM stays
WHERE scheduled_checkin_at IS NOT NULL
GROUP BY hotel_id, (scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY (scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata')::date DESC;

-- ─── SLA breach breakdown ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_sla_breach_breakdown WITH (security_invoker = on) AS
SELECT t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       COALESCE(br.label, 'Other'::text) AS reason_label, te.reason_code, count(DISTINCT t.id) AS breached_count
FROM tickets t
  JOIN ticket_sla_state ss ON ss.ticket_id = t.id AND ss.breached = true
  JOIN LATERAL (SELECT te_1.reason_code FROM ticket_events te_1 WHERE te_1.ticket_id = t.id AND te_1.event_type = 'BLOCKED'::text ORDER BY te_1.created_at DESC LIMIT 1) te ON true
  LEFT JOIN block_reasons br ON br.code = te.reason_code
WHERE (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
  AND NOT (EXISTS (SELECT 1 FROM ticket_events ex WHERE ex.ticket_id = t.id AND ex.event_type = 'SLA_EXCEPTION_GRANTED'::text))
GROUP BY t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date, te.reason_code, br.label;

-- ─── block reason analysis ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_block_reason_analysis WITH (security_invoker = on) AS
SELECT t.hotel_id, (te.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, te.reason_code, count(*) AS block_count
FROM ticket_events te JOIN tickets t ON t.id = te.ticket_id
WHERE te.event_type = 'BLOCKED'::text AND (te.created_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
GROUP BY t.hotel_id, (te.created_at AT TIME ZONE 'Asia/Kolkata')::date, te.reason_code;

-- ─── activity breakdown (by department) ────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_activity_breakdown WITH (security_invoker = on) AS
SELECT hotel_id, day, department_name, sum(created_count) AS created_count, sum(resolved_count) AS resolved_count
FROM (
  SELECT t.hotel_id, (t.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sd.name AS department_name, count(*) AS created_count, 0 AS resolved_count
  FROM tickets t JOIN services s ON s.id = t.service_id JOIN departments sd ON sd.id = s.department_id
  WHERE (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
  GROUP BY t.hotel_id, (t.created_at AT TIME ZONE 'Asia/Kolkata')::date, sd.name
  UNION ALL
  SELECT t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sd.name AS department_name, 0 AS created_count, count(*) AS resolved_count
  FROM tickets t JOIN services s ON s.id = t.service_id JOIN departments sd ON sd.id = s.department_id
  WHERE t.status = 'COMPLETED'::text AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
  GROUP BY t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date, sd.name
) raw
GROUP BY hotel_id, day, department_name;

-- ─── SLA impact waterfall (breaches by department) ─────────────────────────
CREATE OR REPLACE VIEW public.v_owner_sla_impact_waterfall WITH (security_invoker = on) AS
SELECT t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sd.name AS department_name, count(*) AS breached_count
FROM tickets t
  JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  JOIN services s ON s.id = t.service_id
  JOIN departments sd ON sd.id = s.department_id
WHERE t.status = 'COMPLETED'::text AND ss.breached = true
  AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
  AND NOT (EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))
GROUP BY t.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date, sd.name;

-- ─── staff performance ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_staff_performance WITH (security_invoker = on) AS
SELECT hm.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, hm.id AS staff_id, p.full_name,
       count(*) FILTER (WHERE t.status = 'COMPLETED'::text) AS completed_tasks,
       count(*) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false) AS completed_within_sla
FROM tickets t
  JOIN hotel_members hm ON hm.id = t.current_assignee_id
  JOIN profiles p ON p.id = hm.user_id
  LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
WHERE (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30
GROUP BY hm.hotel_id, (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date, hm.id, p.full_name;

-- ─── KPI summary (30d completion window in IST) ────────────────────────────
CREATE OR REPLACE VIEW public.v_owner_kpi_summary WITH (security_invoker = on) AS
SELECT t.hotel_id,
  count(DISTINCT t.id) FILTER (WHERE t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AS total_tickets,
  count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30 AND NOT (EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS completed_within_sla,
  count(DISTINCT t.id) FILTER (WHERE (ss.breached = true OR (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.current_remaining_seconds <= 0) AND ((t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30 OR (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])))) AS breached_sla,
  count(DISTINCT t.id) FILTER (WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.current_remaining_seconds <= 1800 AND NOT (EXISTS (SELECT 1 FROM ticket_events te WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS at_risk_tickets,
  round(100.0 * count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30)::numeric / NULLIF(count(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED'::text AND (t.completed_at AT TIME ZONE 'Asia/Kolkata')::date >= public.vaiyu_ist_today() - 30), 0)::numeric, 2) AS sla_compliance_percent
FROM tickets t LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
GROUP BY t.hotel_id;

-- ─── occupancy stats (check-ins today/yesterday in IST) ────────────────────
CREATE OR REPLACE VIEW public.v_owner_occupancy_stats WITH (security_invoker = on) AS
SELECT r.hotel_id, count(*) AS total_rooms,
  count(*) FILTER (WHERE r.status = 'occupied'::room_operational_status) AS occupied_rooms,
  CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE r.status = 'occupied'::room_operational_status)::numeric / count(*)::numeric * 100::numeric, 2) ELSE 0::numeric END AS occupancy_percent,
  COALESCE(ct.check_ins_today, 0::bigint) AS check_ins_today,
  COALESCE(cy.check_ins_yesterday, 0::bigint) AS check_ins_yesterday
FROM rooms r
  LEFT JOIN (SELECT stays.hotel_id, count(*) AS check_ins_today FROM stays WHERE (stays.scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata')::date = public.vaiyu_ist_today() GROUP BY stays.hotel_id) ct ON ct.hotel_id = r.hotel_id
  LEFT JOIN (SELECT stays.hotel_id, count(*) AS check_ins_yesterday FROM stays WHERE (stays.scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata')::date = public.vaiyu_ist_today() - 1 GROUP BY stays.hotel_id) cy ON cy.hotel_id = r.hotel_id
WHERE r.is_out_of_order = false OR r.is_out_of_order IS NULL
GROUP BY r.hotel_id, ct.check_ins_today, cy.check_ins_yesterday;

-- ─── re-assert RLS perimeter (defence-in-depth) ────────────────────────────
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_owner_ticket_activity','v_owner_sla_trend_daily','v_owner_checkin_trend_daily',
    'v_owner_sla_breach_breakdown','v_owner_block_reason_analysis','v_owner_activity_breakdown',
    'v_owner_sla_impact_waterfall','v_owner_staff_performance','v_owner_kpi_summary','v_owner_occupancy_stats'
  ] LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM PUBLIC', v);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;
