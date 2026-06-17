-- ============================================================
-- VAiyu: Owner Analytics views — kill the ~10s dashboard load
-- ============================================================
-- PROBLEM (measured on prod, authenticated owner JWT):
--   The 11 OwnerAnalytics widgets fire 11 view queries in parallel; total load
--   = the slowest. The v_owner_* views were security_invoker (2026-06-16 leak
--   fix), which forces the planner to expand the full tickets/stays RLS policy
--   tree into EVERY plan. Measured PLANNING time 893 ms/view (execution ~37 ms).
--   On a cold plan cache (after any deploy) + concurrency this compounds to ~10s
--   and intermittent statement-timeout 500s. EXPLAIN plan was 486 rows deep.
--
-- FIX (proven locally; planning 67ms -> 2.4ms on the worst view):
--   Make each view PLAIN (security_invoker off => no RLS plan expansion) and
--   re-impose tenant scoping EXPLICITLY with a SECURITY DEFINER membership
--   helper. Audience = ops-management tier (per product decision 2026-06-17:
--   "normal staff should not see analytics") — mirrors vaiyu_can_view_all_hotel_tickets.
--   Platform admins see all (fixes a pre-existing bug where they got EMPTY
--   analytics for non-member hotels, because ticket_sla_state/ticket_events RLS
--   is membership-only and dropped their joins under security_invoker).
--
-- SECURITY EQUIVALENCE (proven, see session 2026-06-17):
--   A non-admin manager sees ONLY their own hotel under BOTH the old
--   security_invoker views and these — cross-tenant isolation is identical.
--   anon stays revoked. The view bodies are VERBATIM from pg_get_viewdef; only
--   an outer `WHERE vaiyu_can_view_hotel_analytics(hotel_id)` wrapper is added,
--   so aggregation logic is provably unchanged (managers see identical values).
--
-- NOT INCLUDED here (deliberate):
--   * v_owner_arrivals_dashboard  -> scoped member-tier in 20260617000003
--     (it feeds the front-desk v_arrival_dashboard_rows; manager-tier would
--     blank the front desk).
--   * v_owner_kpis_ist  -> hardcoded DEMO1/DEMO2 demo view, no hotel_id, unused
--     by app + edge functions, already security_invoker + anon-revoked. Left as-is.
-- ============================================================

-- ---------- Owner-analytics audience helper (ops-management tier + platform admin) ----------
CREATE OR REPLACE FUNCTION public.vaiyu_can_view_hotel_analytics(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.hotel_members hm
      LEFT JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
      LEFT JOIN public.hotel_roles hr         ON hr.id = hmr.role_id
      WHERE hm.user_id   = auth.uid()
        AND hm.hotel_id  = p_hotel_id
        AND hm.is_active = true
        AND (
          upper(coalesce(hr.code, '')) IN (
            'OWNER','OWNER_0','HOTEL_OWNER','SUPERVISOR',
            'MANAGER','GENERAL_MANAGER','OPS_MANAGER','ADMIN','ADMINISTRATOR'
          )
          OR upper(coalesce(hm.role, '')) IN (
            'OWNER','OWNER_0','HOTEL_OWNER','SUPERVISOR',
            'MANAGER','GENERAL_MANAGER','OPS_MANAGER','ADMIN','ADMINISTRATOR'
          )
        )
    );
$fn$;
REVOKE ALL ON FUNCTION public.vaiyu_can_view_hotel_analytics(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vaiyu_can_view_hotel_analytics(uuid) TO authenticated, service_role;

-- ---------- Views: plain + manager-tier scope (bodies verbatim from pg_get_viewdef) ----------
CREATE OR REPLACE VIEW public.v_owner_activity_breakdown WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT hotel_id,
    day,
    department_name,
    sum(created_count) AS created_count,
    sum(resolved_count) AS resolved_count
   FROM ( SELECT t.hotel_id,
            date(t.created_at) AS day,
            sd.name AS department_name,
            count(*) AS created_count,
            0 AS resolved_count
           FROM tickets t
             JOIN services s ON s.id = t.service_id
             JOIN departments sd ON sd.id = s.department_id
          WHERE t.created_at >= (CURRENT_DATE - '30 days'::interval)
          GROUP BY t.hotel_id, (date(t.created_at)), sd.name
        UNION ALL
         SELECT t.hotel_id,
            date(t.completed_at) AS day,
            sd.name AS department_name,
            0 AS created_count,
            count(*) AS resolved_count
           FROM tickets t
             JOIN services s ON s.id = t.service_id
             JOIN departments sd ON sd.id = s.department_id
          WHERE t.status = 'COMPLETED'::text AND t.completed_at >= (CURRENT_DATE - '30 days'::interval)
          GROUP BY t.hotel_id, (date(t.completed_at)), sd.name) raw
  GROUP BY hotel_id, day, department_name
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_at_risk_breakdown WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM ticket_events te
              WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text AND NOT (EXISTS ( SELECT 1
                       FROM ticket_events unblock
                      WHERE unblock.ticket_id = t.id AND unblock.event_type = 'UNBLOCKED'::text AND unblock.created_at > te.created_at)))) THEN 'Blocked'::text
            WHEN t.current_assignee_id IS NULL THEN 'Unassigned'::text
            ELSE 'Time Critical'::text
        END AS risk_category,
    count(DISTINCT t.id) AS risk_count
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.current_remaining_seconds <= 1800
  GROUP BY t.hotel_id, (
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM ticket_events te
              WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text AND NOT (EXISTS ( SELECT 1
                       FROM ticket_events unblock
                      WHERE unblock.ticket_id = t.id AND unblock.event_type = 'UNBLOCKED'::text AND unblock.created_at > te.created_at)))) THEN 'Blocked'::text
            WHEN t.current_assignee_id IS NULL THEN 'Unassigned'::text
            ELSE 'Time Critical'::text
        END)
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_block_reason_analysis WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
    date(te.created_at) AS day,
    te.reason_code,
    count(*) AS block_count
   FROM ticket_events te
     JOIN tickets t ON t.id = te.ticket_id
  WHERE te.event_type = 'BLOCKED'::text AND te.created_at >= (CURRENT_DATE - '30 days'::interval)
  GROUP BY t.hotel_id, (date(te.created_at)), te.reason_code
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_checkin_trend_daily WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT hotel_id,
    date(scheduled_checkin_at) AS day,
    count(*) AS checkin_count
   FROM stays
  WHERE scheduled_checkin_at IS NOT NULL
  GROUP BY hotel_id, (date(scheduled_checkin_at))
  ORDER BY (date(scheduled_checkin_at)) DESC
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

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
  GROUP BY t.hotel_id
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_occupancy_stats WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT r.hotel_id,
    count(*) AS total_rooms,
    count(*) FILTER (WHERE r.status = 'occupied'::room_operational_status) AS occupied_rooms,
        CASE
            WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE r.status = 'occupied'::room_operational_status)::numeric / count(*)::numeric * 100::numeric, 2)
            ELSE 0::numeric
        END AS occupancy_percent,
    COALESCE(ct.check_ins_today, 0::bigint) AS check_ins_today,
    COALESCE(cy.check_ins_yesterday, 0::bigint) AS check_ins_yesterday
   FROM rooms r
     LEFT JOIN ( SELECT stays.hotel_id,
            count(*) AS check_ins_today
           FROM stays
          WHERE stays.scheduled_checkin_at::date = CURRENT_DATE
          GROUP BY stays.hotel_id) ct ON ct.hotel_id = r.hotel_id
     LEFT JOIN ( SELECT stays.hotel_id,
            count(*) AS check_ins_yesterday
           FROM stays
          WHERE stays.scheduled_checkin_at::date = (CURRENT_DATE - '1 day'::interval)
          GROUP BY stays.hotel_id) cy ON cy.hotel_id = r.hotel_id
  WHERE r.is_out_of_order = false OR r.is_out_of_order IS NULL
  GROUP BY r.hotel_id, ct.check_ins_today, cy.check_ins_yesterday
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_sla_breach_breakdown WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
    date(t.completed_at) AS day,
    COALESCE(br.label, 'Other'::text) AS reason_label,
    te.reason_code,
    count(DISTINCT t.id) AS breached_count
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id AND ss.breached = true
     JOIN LATERAL ( SELECT te_1.reason_code
           FROM ticket_events te_1
          WHERE te_1.ticket_id = t.id AND te_1.event_type = 'BLOCKED'::text
          ORDER BY te_1.created_at DESC
         LIMIT 1) te ON true
     LEFT JOIN block_reasons br ON br.code = te.reason_code
  WHERE t.completed_at >= (CURRENT_DATE - '30 days'::interval) AND NOT (EXISTS ( SELECT 1
           FROM ticket_events ex
          WHERE ex.ticket_id = t.id AND ex.event_type = 'SLA_EXCEPTION_GRANTED'::text))
  GROUP BY t.hotel_id, (date(t.completed_at)), te.reason_code, br.label
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_sla_exception_breakdown WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
    te.reason_code,
    COALESCE(br.label, te.reason_code) AS reason_label,
    count(*) AS exception_count,
    round(100.0 * count(*)::numeric / NULLIF(sum(count(*)) OVER (PARTITION BY t.hotel_id), 0::numeric), 2) AS exception_percent
   FROM ticket_events te
     JOIN tickets t ON t.id = te.ticket_id
     LEFT JOIN block_reasons br ON br.code = te.reason_code
  WHERE te.event_type = 'SLA_EXCEPTION_GRANTED'::text
  GROUP BY t.hotel_id, te.reason_code, br.label
  ORDER BY (count(*)) DESC
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_sla_impact_waterfall WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT t.hotel_id,
    date(t.completed_at) AS day,
    sd.name AS department_name,
    count(*) AS breached_count
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN services s ON s.id = t.service_id
     JOIN departments sd ON sd.id = s.department_id
  WHERE t.status = 'COMPLETED'::text AND ss.breached = true AND t.completed_at >= (CURRENT_DATE - '30 days'::interval) AND NOT (EXISTS ( SELECT 1
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))
  GROUP BY t.hotel_id, (date(t.completed_at)), sd.name
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_sla_trend_daily WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 WITH daily AS (
         SELECT tickets.hotel_id,
            generate_series(CURRENT_DATE - '29 days'::interval, CURRENT_DATE::timestamp without time zone, '1 day'::interval)::date AS day
           FROM tickets
          GROUP BY tickets.hotel_id
        )
 SELECT d.hotel_id,
    d.day,
    count(t.id) FILTER (WHERE ss.breached = false AND NOT (EXISTS ( SELECT 1
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS completed_within_sla,
    count(t.id) FILTER (WHERE ss.breached = true) AS breached_sla,
    count(t.id) FILTER (WHERE (EXISTS ( SELECT 1
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS sla_exempted
   FROM daily d
     LEFT JOIN tickets t ON t.hotel_id = d.hotel_id AND date(t.completed_at) = d.day
     LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  GROUP BY d.hotel_id, d.day
  ORDER BY d.day DESC
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_staff_performance WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 SELECT hm.hotel_id,
    date(t.completed_at) AS day,
    hm.id AS staff_id,
    p.full_name,
    count(*) FILTER (WHERE t.status = 'COMPLETED'::text) AS completed_tasks,
    count(*) FILTER (WHERE t.status = 'COMPLETED'::text AND ss.breached = false) AS completed_within_sla
   FROM tickets t
     JOIN hotel_members hm ON hm.id = t.current_assignee_id
     JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  WHERE t.completed_at >= (CURRENT_DATE - '30 days'::interval)
  GROUP BY hm.hotel_id, (date(t.completed_at)), hm.id, p.full_name
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);

CREATE OR REPLACE VIEW public.v_owner_ticket_activity WITH (security_invoker = false) AS
SELECT _scoped.* FROM (
 WITH daily AS (
         SELECT tickets.hotel_id,
            generate_series(CURRENT_DATE - '29 days'::interval, CURRENT_DATE::timestamp without time zone, '1 day'::interval)::date AS day
           FROM tickets
          GROUP BY tickets.hotel_id
        ), events AS (
         SELECT tickets.hotel_id,
            date(tickets.created_at) AS day,
            1 AS created_count,
            0 AS resolved_count
           FROM tickets
          WHERE tickets.created_at >= (CURRENT_DATE - '30 days'::interval)
        UNION ALL
         SELECT tickets.hotel_id,
            date(tickets.completed_at) AS day,
            0 AS created_count,
            1 AS resolved_count
           FROM tickets
          WHERE tickets.status = 'COMPLETED'::text AND tickets.completed_at >= (CURRENT_DATE - '30 days'::interval)
        )
 SELECT d.hotel_id,
    d.day,
    COALESCE(sum(e.created_count), 0::bigint) AS created_count,
    COALESCE(sum(e.resolved_count), 0::bigint) AS resolved_count
   FROM daily d
     LEFT JOIN events e ON e.hotel_id = d.hotel_id AND e.day = d.day
  GROUP BY d.hotel_id, d.day
  ORDER BY d.day DESC
) _scoped
WHERE public.vaiyu_can_view_hotel_analytics(_scoped.hotel_id);


-- ---------- Re-assert grants: no anon, no PUBLIC (defense-in-depth) ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_owner_activity_breakdown','v_owner_at_risk_breakdown','v_owner_block_reason_analysis',
    'v_owner_checkin_trend_daily','v_owner_kpi_summary','v_owner_occupancy_stats',
    'v_owner_sla_breach_breakdown','v_owner_sla_exception_breakdown','v_owner_sla_impact_waterfall',
    'v_owner_sla_trend_daily','v_owner_staff_performance','v_owner_ticket_activity'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
