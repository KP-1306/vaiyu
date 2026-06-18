-- ============================================================
-- VAiyu: Seal the v_ops_* board/drawer family leak
-- ============================================================
-- FOUND 2026-06-19 while fixing /ops/analytics: of the 20 v_ops_* views, 8 were
-- PLAIN views with NO scoping at all + anon-granted. Confirmed live on prod with
-- the anon key:
--   v_ops_board_tickets                -> 60 ticket rows to an anonymous caller
--   v_ops_sla_exceptions_by_department -> 18 rows
-- The other 6 returned 0 only because no matching rows exist right now — they
-- have no auth/hotel filter either, so they leak (anon AND authenticated
-- cross-tenant) the moment data exists. These power the ops board (lib/api.ts)
-- and the At-Risk / Agent-Risk / Blocked-Tickets drawers. Same class as the
-- arrival-view leak.
--
-- FIX: plain + explicit MEMBER-tier scope (vaiyu_is_hotel_member) — these are
-- front-line staff operational screens (the ops board/drawers), so any active
-- member of the hotel may see their own hotel's data; never another hotel's,
-- never anon. (The /ops/analytics manager dashboard views stay manager-tier in
-- 20260619000001.) Filter injected INSIDE each WHERE (before GROUP/ORDER/LIMIT)
-- to preserve semantics; bodies otherwise verbatim from pg_get_viewdef.
--
-- Also revokes the leftover anon grant on the 5 unused security_invoker v_ops_*
-- views (not a leak — RLS denies anon — but removed for consistency / defense).
-- ============================================================

CREATE OR REPLACE VIEW public.v_ops_agent_risk_details WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    t.id AS ticket_id,
    "substring"(t.id::text, 1, 8) AS display_id,
    t.title,
    t.status,
    d.name AS department_name,
    p.full_name AS agent_name,
    p.profile_photo_url AS assignee_avatar,
    (sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric AS remaining_seconds,
    sp.target_minutes * 60 AS target_seconds
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN sla_policies sp ON sp.id = ss.sla_policy_id
     JOIN hotel_members hm ON hm.id = t.current_assignee_id
     JOIN profiles p ON p.id = hm.user_id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.breached = false AND ((sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric) <= 3600::numeric
    AND public.vaiyu_is_hotel_member(t.hotel_id);

CREATE OR REPLACE VIEW public.v_ops_at_risk_details WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    t.id AS ticket_id,
    "substring"(t.id::text, 1, 8) AS display_id,
    t.title,
    t.status,
    d.name AS department_name,
    COALESCE(p.full_name, 'Unassigned'::text) AS assignee_name,
    p.profile_photo_url AS assignee_avatar,
    (sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric AS remaining_seconds,
    sp.target_minutes * 60 AS target_seconds
   FROM tickets t
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     JOIN sla_policies sp ON sp.id = ss.sla_policy_id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     LEFT JOIN sla_risk_policies srp ON srp.department_id = d.id AND srp.hotel_id = t.hotel_id AND srp.is_active = true
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
  WHERE (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text])) AND ss.breached = false AND ss.sla_started_at IS NOT NULL AND ((sp.target_minutes * 60)::numeric - EXTRACT(epoch FROM now() - ss.sla_started_at) + ss.total_paused_seconds::numeric) <= (LEAST(srp.max_risk_minutes::numeric, GREATEST(srp.min_risk_minutes::numeric, (sp.target_minutes * srp.risk_percent)::numeric / 100.0)) * 60::numeric)
    AND public.vaiyu_is_hotel_member(t.hotel_id);

CREATE OR REPLACE VIEW public.v_ops_blocked_tickets_detail WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    t.id AS ticket_id,
    "substring"(t.id::text, 1, 8) AS display_id,
    t.title,
    d.name AS department_name,
    p.full_name AS assignee_name,
    p.profile_photo_url AS assignee_avatar,
    br.label AS block_reason,
    ss.sla_paused_at,
    GREATEST(EXTRACT(epoch FROM now() - ss.sla_paused_at), 0::numeric) AS blocked_seconds
   FROM tickets t
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN LATERAL ( SELECT te.reason_code
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text
          ORDER BY te.created_at DESC
         LIMIT 1) blk ON true
     LEFT JOIN block_reasons br ON br.code = blk.reason_code
  WHERE t.status = 'BLOCKED'::text AND ss.sla_paused_at IS NOT NULL AND (now() - ss.sla_paused_at) > '02:00:00'::interval AND t.completed_at IS NULL AND t.cancelled_at IS NULL
    AND public.vaiyu_is_hotel_member(t.hotel_id)
  ORDER BY (GREATEST(EXTRACT(epoch FROM now() - ss.sla_paused_at), 0::numeric)) DESC;

CREATE OR REPLACE VIEW public.v_ops_board_tickets WITH (security_invoker = false) AS
 SELECT t.id,
    t.hotel_id,
    t.service_id,
    s.department_id AS service_department_id,
    t.room_id,
    t.zone_id,
    s.label AS service_label,
    s.key AS service_key,
    t.title AS legacy_title,
    t.description,
    t.status,
    NULL::text AS priority,
    t.current_assignee_id AS assignee_id,
    COALESCE(p.full_name, 'Unassigned'::text) AS assignee_name,
    t.created_by_type,
    t.created_by_id,
    t.created_at,
    t.updated_at,
    t.completed_at,
    sp.target_minutes AS sla_minutes,
    ss.sla_started_at + ((sp.target_minutes || ' minutes'::text)::interval) AS sla_deadline,
        CASE
            WHEN ss.current_remaining_seconds IS NOT NULL THEN ss.current_remaining_seconds / 60
            ELSE NULL::integer
        END AS mins_remaining,
    COALESCE(LEAST(srp.max_risk_minutes::numeric, GREATEST(srp.min_risk_minutes::numeric, (sp.target_minutes * srp.risk_percent)::numeric / 100.0)), LEAST(30::numeric, sp.target_minutes::numeric * 0.25)) AS risk_threshold_minutes,
    (pending_event_action.event_type IS NOT NULL OR pending_block_action.event_type IS NOT NULL) AND (t.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])) AS needs_supervisor_action,
    COALESCE(pending_event_action.event_type, pending_block_action.event_type) AS supervisor_request_type,
    COALESCE(pending_event_action.reason_code, pending_block_action.reason_code) AS supervisor_reason_code,
    COALESCE(pending_event_action.created_at, pending_block_action.created_at) AS supervisor_requested_at,
    t.reason_code AS primary_reason_code,
    r.number AS room_number,
    d.name AS department_name,
        CASE
            WHEN r.number IS NOT NULL THEN concat('Room ', r.number)
            WHEN z.name IS NOT NULL THEN z.name
            ELSE 'Unknown Location'::text
        END AS location_label,
    sla_exempted.is_exempted AS sla_exception_granted,
        CASE
            WHEN sla_exempted.is_exempted THEN 'EXEMPTED'::text
            WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'::text
            WHEN ss.breached = true THEN 'BREACHED'::text
            WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'::text
            ELSE 'RUNNING'::text
        END AS sla_state
   FROM tickets t
     LEFT JOIN services s ON s.id = t.service_id
     LEFT JOIN rooms r ON r.id = t.room_id
     LEFT JOIN hotel_zones z ON z.id = t.zone_id
     LEFT JOIN departments d ON d.id = s.department_id
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN sla_policies sp ON sp.department_id = s.department_id AND sp.is_active = true
     LEFT JOIN sla_risk_policies srp ON srp.department_id = s.department_id AND srp.hotel_id = t.hotel_id AND srp.is_active = true
     LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     LEFT JOIN LATERAL ( SELECT te.event_type,
            te.reason_code,
            te.created_at
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND (te.event_type = ANY (ARRAY['SUPERVISOR_REQUESTED'::text, 'SLA_EXCEPTION_REQUESTED'::text])) AND NOT (EXISTS ( SELECT 1
                   FROM ticket_events res
                  WHERE res.ticket_id = t.id AND res.created_at > te.created_at AND (res.event_type = ANY (ARRAY['SUPERVISOR_APPROVED'::text, 'SUPERVISOR_REJECTED'::text, 'SLA_EXCEPTION_GRANTED'::text, 'SLA_EXCEPTION_REJECTED'::text, 'SUPERVISOR_REQUEST_CANCELLED'::text]))))
          ORDER BY te.created_at DESC
         LIMIT 1) pending_event_action ON true
     LEFT JOIN LATERAL ( SELECT te.event_type,
            te.reason_code,
            te.created_at
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text AND te.reason_code = 'supervisor_approval'::text AND NOT (EXISTS ( SELECT 1
                   FROM ticket_events res
                  WHERE res.ticket_id = t.id AND res.created_at > te.created_at AND ((res.event_type = ANY (ARRAY['SUPERVISOR_APPROVED'::text, 'SUPERVISOR_REJECTED'::text])) OR res.event_type = 'UNBLOCKED'::text AND res.reason_code = 'supervisor_request_cancelled'::text)))
          ORDER BY te.created_at DESC
         LIMIT 1) pending_block_action ON true
     LEFT JOIN LATERAL ( SELECT (EXISTS ( SELECT 1
                   FROM ticket_events te
                  WHERE te.ticket_id = t.id AND te.event_type = 'SLA_EXCEPTION_GRANTED'::text)) AS is_exempted) sla_exempted ON true
  WHERE public.vaiyu_is_hotel_member(t.hotel_id);

CREATE OR REPLACE VIEW public.v_ops_sla_breaches_by_dept WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    d.name AS department_name,
    count(*) FILTER (WHERE br.category = 'guest_constraint'::text) AS count_guest,
    count(*) FILTER (WHERE br.category = 'dependency'::text) AS count_dependency,
    count(*) FILTER (WHERE br.category = 'inventory'::text) AS count_inventory,
    count(*) FILTER (WHERE br.category = 'approval'::text) AS count_approval,
    count(*) FILTER (WHERE br.category IS NULL OR br.category = 'other'::text) AS count_other
   FROM tickets t
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     LEFT JOIN LATERAL ( SELECT te.reason_code
           FROM ticket_events te
          WHERE te.ticket_id = t.id AND te.event_type = 'BLOCKED'::text
          ORDER BY te.created_at DESC
         LIMIT 1) latest_block ON true
     LEFT JOIN block_reasons br ON br.code = latest_block.reason_code
  WHERE t.status = 'COMPLETED'::text AND ss.breached = true AND t.completed_at >= (CURRENT_DATE - '30 days'::interval)
    AND public.vaiyu_is_hotel_member(t.hotel_id)
  GROUP BY t.hotel_id, d.name
  ORDER BY (count(*)) DESC
 LIMIT 5;

CREATE OR REPLACE VIEW public.v_ops_sla_exception_decisions_by_reason WITH (security_invoker = false) AS
 WITH exception_requests AS (
         SELECT te.ticket_id,
            te.reason_code,
            min(te.created_at) AS requested_at
           FROM ticket_events te
          WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'::text
          GROUP BY te.ticket_id, te.reason_code
        ), decision_events AS (
         SELECT te.ticket_id,
            max(te.created_at) FILTER (WHERE te.event_type = ANY (ARRAY['SLA_EXCEPTION_GRANTED'::text, 'SLA_EXCEPTION_REJECTED'::text])) AS decided_at
           FROM ticket_events te
          GROUP BY te.ticket_id
        )
 SELECT t.hotel_id,
    d.name AS department_name,
    COALESCE(ser.label, 'Other'::text) AS reason_label,
    ser.category AS reason_category,
    count(DISTINCT er.ticket_id) AS requested_count,
    count(DISTINCT er.ticket_id) FILTER (WHERE (EXISTS ( SELECT 1
           FROM ticket_events te2
          WHERE te2.ticket_id = er.ticket_id AND te2.event_type = 'SLA_EXCEPTION_GRANTED'::text))) AS granted_count,
    count(DISTINCT er.ticket_id) FILTER (WHERE (EXISTS ( SELECT 1
           FROM ticket_events te2
          WHERE te2.ticket_id = er.ticket_id AND te2.event_type = 'SLA_EXCEPTION_REJECTED'::text))) AS rejected_count,
    count(DISTINCT er.ticket_id) FILTER (WHERE de.decided_at IS NULL) AS pending_count
   FROM exception_requests er
     JOIN tickets t ON t.id = er.ticket_id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     LEFT JOIN sla_exception_reasons ser ON ser.code = er.reason_code AND ser.is_active = true
     LEFT JOIN decision_events de ON de.ticket_id = er.ticket_id
  WHERE er.requested_at >= (CURRENT_DATE - '30 days'::interval)
    AND public.vaiyu_is_hotel_member(t.hotel_id)
  GROUP BY t.hotel_id, d.name, (COALESCE(ser.label, 'Other'::text)), ser.category;

CREATE OR REPLACE VIEW public.v_ops_sla_exception_details WITH (security_invoker = false) AS
 SELECT t.hotel_id,
    t.id AS ticket_id,
    "substring"(t.id::text, 1, 8) AS display_id,
    t.title,
    t.status,
    d.name AS department_name,
    p.full_name AS assignee_name,
    p.profile_photo_url AS assignee_avatar,
    COALESCE(ser.label, 'Other'::text) AS block_reason,
    ser.category AS exception_category,
    te.created_at AS exception_occurred_at,
    0::numeric AS blocked_seconds
   FROM ticket_events te
     JOIN tickets t ON t.id = te.ticket_id
     JOIN services s ON s.id = t.service_id
     JOIN departments d ON d.id = s.department_id
     LEFT JOIN sla_exception_reasons ser ON ser.code = te.reason_code
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
  WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'::text AND te.created_at >= (CURRENT_DATE - '30 days'::interval)
    AND public.vaiyu_is_hotel_member(t.hotel_id);

CREATE OR REPLACE VIEW public.v_ops_sla_exceptions_by_department WITH (security_invoker = false) AS
 WITH exception_requests AS (
         SELECT DISTINCT ON (te.ticket_id) te.ticket_id,
            te.reason_code,
            te.created_at AS requested_at
           FROM ticket_events te
          WHERE te.event_type = 'SLA_EXCEPTION_REQUESTED'::text AND te.created_at >= (CURRENT_DATE - '30 days'::interval)
          ORDER BY te.ticket_id, te.created_at
        )
 SELECT d.hotel_id,
    d.id AS department_id,
    d.name AS department_name,
    count(er.ticket_id) FILTER (WHERE ser.category = 'GUEST_DEPENDENCY'::text) AS guest_count,
    count(er.ticket_id) FILTER (WHERE ser.category = 'INFRASTRUCTURE'::text) AS infra_count,
    count(er.ticket_id) FILTER (WHERE ser.category = 'POLICY'::text) AS policy_count,
    count(er.ticket_id) FILTER (WHERE ser.category = 'EXTERNAL_DEPENDENCY'::text) AS external_count,
    count(er.ticket_id) FILTER (WHERE ser.category = 'MANAGEMENT'::text) AS approval_count,
    count(er.ticket_id) FILTER (WHERE ser.category IS NULL) AS other_count,
    count(er.ticket_id) AS total_exception_requests
   FROM departments d
     LEFT JOIN services s ON s.department_id = d.id
     LEFT JOIN tickets t ON t.service_id = s.id
     LEFT JOIN exception_requests er ON er.ticket_id = t.id
     LEFT JOIN sla_exception_reasons ser ON ser.code = er.reason_code AND ser.is_active = true
  WHERE public.vaiyu_is_hotel_member(d.hotel_id)
  GROUP BY d.hotel_id, d.id, d.name
  ORDER BY (count(er.ticket_id)) DESC;

-- ---------- Lock down grants on the 8 sealed views + 5 unused SI views ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    -- 8 now plain + member-tier scoped
    'v_ops_agent_risk_details','v_ops_at_risk_details','v_ops_blocked_tickets_detail',
    'v_ops_board_tickets','v_ops_sla_breaches_by_dept','v_ops_sla_exception_decisions_by_reason',
    'v_ops_sla_exception_details','v_ops_sla_exceptions_by_department',
    -- 5 unused security_invoker views: drop the stray anon grant (defense/consistency)
    'v_ops_backlog_trend','v_ops_created_resolved_30d','v_ops_exception_reasons_30d',
    'v_ops_kpi_current','v_ops_sla_breach_reasons'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
