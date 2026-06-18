-- ============================================================
-- VAiyu: Ops Manager Analytics (/ops/analytics) — kill the cold-cache 500s
-- ============================================================
-- FOUND 2026-06-19 (reproduced live on prod): the Ops Manager dashboard fires
-- ~11 view queries concurrently; 6 of the 7 v_ops_* widget views returned
-- HTTP 500 on load. Root cause: those views were still security_invoker, which
-- forces the planner to expand the tickets/stays RLS tree into every plan
-- (measured 90-180ms planning WARM, seconds COLD). Under the page's concurrent
-- fan-out on the small prod instance, cold planning + contention exceeds the 8s
-- statement timeout -> 500. (Same disease already fixed on the v_owner_* views;
-- it was never applied to the v_ops_* family.)
--
-- FIX (same proven recipe as 20260617000004 / 20260618000001):
--   * Make all 7 v_ops_* views PLAIN (security_invoker off => no RLS plan
--     expansion => planning collapses to sub-ms => no concurrency timeout).
--   * Re-impose tenant scoping EXPLICITLY with the existing manager-tier helper
--     public.vaiyu_can_view_hotel_analytics(hotel_id) (this IS the ops *manager*
--     dashboard). The predicate is injected INSIDE each view's WHERE (before any
--     GROUP BY / ORDER BY / LIMIT) so semantics are preserved exactly — a wrapper
--     would break the inner LIMIT (open_breaches LIMIT 20, agent_risk LIMIT 5:
--     Postgres can't push the hotel filter past a LIMIT, so it would take
--     "top-N across all hotels" then filter, dropping the caller's rows).
--   * REVOKE anon/PUBLIC (they were anon-granted; security_invoker made that
--     harmless, but plain views must not rely on that — the explicit filter +
--     no-anon is the guarantee).
--
-- v_ops_ticket_backlog_30d additionally gets a SARGABLE rewrite: the old join
-- `t.created_at::date <= d.day AND (... completed_at::date > d.day)` matched the
-- ENTIRE history for each of 30 days (O(all-tickets x 30)). The rewrite pre-filters
-- to tickets that were open at some point in the window (open OR completed within
-- the window) — tickets completed before the window contribute 0 to every window
-- day, so this is output-identical — using the (hotel_id, completed_at) index.
--
-- Security equivalence (proven, same model as the owner views): a non-admin
-- manager sees ONLY their own hotel; non-managers see nothing; platform admins
-- see all (and this fixes a latent gap where admins got broken widgets for
-- non-member hotels). anon denied. Bodies are verbatim from pg_get_viewdef with
-- ONLY the membership predicate added, so widget values are unchanged.
-- ============================================================

CREATE OR REPLACE VIEW public.v_ops_at_risk_departments WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    d.name AS department_name,
    count(*) AS at_risk_count,
    min(GREATEST((sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric, 0::numeric)) AS worst_remaining_seconds
   FROM tickets t
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN sla_policies sp ON sp.id = ss.sla_policy_id
     LEFT JOIN sla_risk_policies srp ON srp.department_id = d.id AND srp.hotel_id = t.hotel_id AND srp.is_active = true
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.breached = false AND ss.sla_started_at IS NOT NULL AND ((sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric) <= (LEAST(srp.max_risk_minutes::numeric, GREATEST(srp.min_risk_minutes::numeric, (sp.target_minutes * srp.risk_percent)::numeric / 100.0)) * 60::numeric)
    AND public.vaiyu_can_view_hotel_analytics(t.hotel_id)
  GROUP BY t.hotel_id, d.name
  ORDER BY (count(*)) DESC;

CREATE OR REPLACE VIEW public.v_ops_open_breaches WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    t.id AS ticket_id,
    "substring"(t.id::text, 1, 8) AS display_id,
    d.name AS department_name,
    p.full_name AS assignee_name,
    p.profile_photo_url AS assignee_avatar,
    COALESCE(br.label, 'Direct SLA Breach'::text) AS breach_context,
    round(EXTRACT(epoch FROM now() - ss.breached_at) / 3600::numeric, 1) AS hours_overdue
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN LATERAL ( SELECT te.reason_code
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text
          ORDER BY te.created_at DESC
         LIMIT 1) blk ON true
     LEFT JOIN block_reasons br ON br.code = blk.reason_code
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.breached = true
    AND public.vaiyu_can_view_hotel_analytics(t.hotel_id)
  ORDER BY (round(EXTRACT(epoch FROM now() - ss.breached_at) / 3600::numeric, 1)) DESC
 LIMIT 20;

CREATE OR REPLACE VIEW public.v_ops_agent_risk WITH (security_invoker = false) AS
 SELECT hm.hotel_id,
    p.full_name AS agent_name,
    p.profile_photo_url AS avatar_url,
    d.name AS department_name,
    count(*) AS at_risk_count
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN sla_policies sp ON sp.id = ss.sla_policy_id
     JOIN hotel_members hm ON hm.id = t.current_assignee_id
     JOIN profiles p ON p.id = hm.user_id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.breached = false AND ((sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric) <= 3600::numeric
    AND public.vaiyu_can_view_hotel_analytics(hm.hotel_id)
  GROUP BY hm.hotel_id, p.full_name, p.profile_photo_url, d.name
  ORDER BY (count(*)) DESC
 LIMIT 5;

CREATE OR REPLACE VIEW public.v_ops_blocked_stagnation_risk WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    d.name AS department_name,
    count(*) AS blocked_count,
    max(GREATEST(EXTRACT(epoch FROM now() - ss.sla_paused_at) / 3600::numeric, 0::numeric)) AS max_hours_blocked
   FROM tickets t
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
  WHERE t.status = 'BLOCKED'::text AND ss.sla_paused_at IS NOT NULL AND (now() - ss.sla_paused_at) > '02:00:00'::interval AND t.completed_at IS NULL AND t.cancelled_at IS NULL
    AND public.vaiyu_can_view_hotel_analytics(t.hotel_id)
  GROUP BY t.hotel_id, d.name
  ORDER BY (count(*)) DESC;

CREATE OR REPLACE VIEW public.v_ops_exceptions_30d WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    d.name AS department_name,
    count(te.id) FILTER (WHERE ser.category = 'GUEST_DEPENDENCY'::text) AS guest_count,
    count(te.id) FILTER (WHERE ser.category = 'INFRASTRUCTURE'::text) AS infra_count,
    count(te.id) FILTER (WHERE ser.category = 'POLICY'::text) AS policy_count,
    count(te.id) AS total_exception_requests
   FROM tickets t
     JOIN departments d ON d.id = t.service_department_id
     JOIN ticket_events te ON te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_REQUESTED'::text
     LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
  WHERE te.created_at >= (CURRENT_DATE - '30 days'::interval)
    AND public.vaiyu_can_view_hotel_analytics(t.hotel_id)
  GROUP BY t.hotel_id, d.name;

CREATE OR REPLACE VIEW public.v_ops_decisions_30d WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    d.name AS department_name,
    ser.category AS reason_category,
    count(DISTINCT te.id) AS requested_count,
    count(DISTINCT
        CASE
            WHEN de.event_type = 'SLA_EXCEPTION_GRANTED'::text THEN te.id
            ELSE NULL::uuid
        END) AS granted_count,
    count(DISTINCT
        CASE
            WHEN de.event_type = 'SLA_EXCEPTION_REJECTED'::text THEN te.id
            ELSE NULL::uuid
        END) AS rejected_count,
    count(DISTINCT
        CASE
            WHEN de.event_type IS NULL THEN te.id
            ELSE NULL::uuid
        END) AS pending_count
   FROM tickets t
     JOIN departments d ON d.id = t.service_department_id
     JOIN ticket_events te ON te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_REQUESTED'::text
     LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
     LEFT JOIN ticket_events de ON de.ticket_id = t.id AND (de.event_type = ANY (ARRAY['SLA_EXCEPTION_GRANTED'::text, 'SLA_EXCEPTION_REJECTED'::text])) AND de.created_at > te.created_at
  WHERE te.created_at >= (CURRENT_DATE - '30 days'::interval)
    AND public.vaiyu_can_view_hotel_analytics(t.hotel_id)
  GROUP BY t.hotel_id, d.name, ser.category;

-- Backlog: sargable rewrite (was O(all-tickets x 30 days), non-sargable ::date join)
CREATE OR REPLACE VIEW public.v_ops_ticket_backlog_30d WITH (security_invoker = false) AS
 WITH days AS (
         SELECT generate_series(CURRENT_DATE - '29 days'::interval, CURRENT_DATE::timestamp without time zone, '1 day'::interval)::date AS day
        ), relevant AS (
         -- tickets open at some point within the window: still open, OR completed
         -- on/after window start. Tickets completed before the window contribute 0
         -- to every window day, so excluding them is output-identical and prunes
         -- the bulk of history (sargable on (hotel_id, completed_at)).
         SELECT t.hotel_id, t.id, t.created_at, t.completed_at
           FROM tickets t
          WHERE t.completed_at IS NULL
             OR t.completed_at >= (CURRENT_DATE - '29 days'::interval)
        )
 SELECT h.id AS hotel_id,
    d.day,
    count(DISTINCT r.id) FILTER (
      WHERE r.created_at::date <= d.day
        AND (r.completed_at IS NULL OR r.completed_at::date > d.day)
    ) AS backlog_count
   FROM hotels h
     CROSS JOIN days d
     LEFT JOIN relevant r ON r.hotel_id = h.id
  WHERE public.vaiyu_can_view_hotel_analytics(h.id)
  GROUP BY h.id, d.day
  ORDER BY d.day DESC;

-- Lock down grants: no anon, no PUBLIC
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_ops_at_risk_departments','v_ops_open_breaches','v_ops_agent_risk',
    'v_ops_blocked_stagnation_risk','v_ops_exceptions_30d','v_ops_decisions_30d',
    'v_ops_ticket_backlog_30d'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
