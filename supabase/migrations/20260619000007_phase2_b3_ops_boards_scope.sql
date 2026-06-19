-- ============================================================
-- VAiyu: Phase 2 B3 — authenticated cross-tenant scoping, ops/staff boards
-- ============================================================
-- 9 staff operational views (ops counts/heatmap, housekeeping board, kitchen/runner
-- queues, staff runner tickets, active checkins, live order ETA, food orders). Anon
-- already revoked (Phase 1); still PLAIN -> authenticated cross-tenant. Wrap each
-- (verbatim body) in MEMBER-tier vaiyu_is_hotel_member(hotel_id) — these are
-- front-line staff tools, so any active member of the hotel sees their hotel's data.
-- Plain = sub-ms planning, no UI slowdown. All inner LIMITs are LATERAL (per-row),
-- so wrapping is semantics-safe. Output-identical for members; anon stays revoked.
-- ============================================================

CREATE OR REPLACE VIEW public.live_orders_eta_v WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT o.hotel_id,
    o.id AS order_id,
    o.created_at,
    o.status::text AS status,
    o.price,
    NULL::text AS assigned_staff,
    GREATEST(0::numeric, t.target_minutes::numeric - EXTRACT(epoch FROM now() - o.created_at) / 60::numeric)::integer AS eta_min_left,
    (EXTRACT(epoch FROM now() - o.created_at) / 60::numeric) > t.target_minutes::numeric AS sla_breached
   FROM orders o
     JOIN sla_targets t ON t.hotel_id = o.hotel_id AND t.key = 'order_delivery_min'::text
  WHERE o.status = ANY (ARRAY['open'::order_status, 'preparing'::order_status])
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.ops_daily_counts WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT d.hotel_id,
    date(t.created_at) AS day,
    count(*) AS total_tickets,
    count(*) FILTER (WHERE t.status = 'COMPLETED'::text) AS completed
   FROM tickets t
     JOIN departments d ON d.id = t.service_department_id
  GROUP BY d.hotel_id, (date(t.created_at))
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.ops_ticket_heatmap WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT d.hotel_id,
    d.code AS department_code,
    count(*) AS ticket_count
   FROM tickets t
     JOIN departments d ON d.id = t.service_department_id
  GROUP BY d.hotel_id, d.code
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_active_checkins WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT hotel_id,
    count(*) AS active_sessions
   FROM checkin_sessions
  WHERE status = 'active'::checkin_session_status
  GROUP BY hotel_id
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_housekeeping_operational_board WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT r.id AS room_id,
    r.hotel_id,
    r.number AS room_number,
    r.floor,
    r.housekeeping_status,
    r.is_out_of_order,
    rt.id AS room_type_id,
    rt.name AS room_type_name,
    ht.id AS task_id,
    ht.status AS task_status,
    ht.assigned_to AS task_assigned_to,
    ht.started_at AS task_started_at,
    ht.eta AS task_eta,
    ht.priority_score AS task_priority_score,
    COALESCE(p.full_name, 'Unassigned'::text) AS assigned_staff_name,
    ap.arrival_needed_in_minutes,
    ap.arrival_urgency,
    ap.booking_id AS arrival_booking_id,
    ap.booking_code AS arrival_booking_code,
    ap.guest_name AS arrival_guest_name,
    ap.scheduled_checkin_at AS arrival_checkin_at,
        CASE
            WHEN ap.arrival_needed_in_minutes IS NOT NULL AND (r.housekeeping_status <> ALL (ARRAY['clean'::housekeeping_status_enum, 'inspected'::housekeeping_status_enum])) THEN true
            ELSE false
        END AS arrival_blocked,
    r.updated_at AS room_updated_at,
    last_ht.completed_at AS last_task_completed_at,
    last_ht.started_at AS last_task_started_at,
    last_p.full_name AS last_cleaner_name
   FROM rooms r
     LEFT JOIN room_types rt ON rt.id = r.room_type_id
     LEFT JOIN LATERAL ( SELECT ht2.id,
            ht2.room_id,
            ht2.status,
            ht2.estimated_completion_at,
            ht2.assigned_to,
            ht2.created_at,
            ht2.hotel_id,
            ht2.started_at,
            ht2.completed_at,
            ht2.eta,
            ht2.priority_score
           FROM housekeeping_tasks ht2
          WHERE ht2.room_id = r.id AND (ht2.status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'inspection_pending'::text]))
          ORDER BY ht2.created_at DESC
         LIMIT 1) ht ON true
     LEFT JOIN hotel_members hm ON hm.id = ht.assigned_to
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN LATERAL ( SELECT ht_comp.completed_at,
            ht_comp.started_at,
            ht_comp.assigned_to
           FROM housekeeping_tasks ht_comp
          WHERE ht_comp.room_id = r.id AND ht_comp.status = 'completed'::text
          ORDER BY ht_comp.completed_at DESC
         LIMIT 1) last_ht ON true
     LEFT JOIN hotel_members last_hm ON last_hm.id = last_ht.assigned_to
     LEFT JOIN profiles last_p ON last_p.id = last_hm.user_id
     LEFT JOIN LATERAL ( SELECT ap2.room_id,
            ap2.booking_id,
            ap2.booking_code,
            ap2.guest_name,
            ap2.scheduled_checkin_at,
            ap2.arrival_needed_in_minutes,
            ap2.arrival_urgency
           FROM v_arrival_priority ap2
          WHERE ap2.room_id = r.id
          ORDER BY ap2.arrival_needed_in_minutes
         LIMIT 1) ap ON true
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_kitchen_queue WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT fo.id AS order_id,
    fo.display_id,
    fo.hotel_id,
    fo.room_id,
    r.number AS room_number,
    fo.status,
    fo.special_instructions,
    fo.created_at,
    fo.updated_at,
    sla.sla_started_at,
    sla.sla_target_at,
        CASE
            WHEN sla.sla_started_at IS NULL THEN NULL::numeric
            ELSE EXTRACT(epoch FROM sla.sla_target_at::timestamp with time zone - now()) / 60::numeric
        END AS sla_minutes_remaining,
    ka.hotel_member_id AS assigned_kitchen_staff,
    items.total_items,
    items.total_amount,
    items.items
   FROM food_orders fo
     LEFT JOIN rooms r ON r.id = fo.room_id
     LEFT JOIN food_order_sla_state sla ON sla.food_order_id = fo.id
     LEFT JOIN food_order_assignments ka ON ka.food_order_id = fo.id AND ka.role = 'KITCHEN'::text AND ka.unassigned_at IS NULL
     LEFT JOIN LATERAL ( SELECT count(*) AS total_items,
            sum(food_order_items.total_price) AS total_amount,
            COALESCE(jsonb_agg(jsonb_build_object('id', food_order_items.id, 'name', food_order_items.item_name, 'quantity', food_order_items.quantity, 'modifiers', food_order_items.modifiers)) FILTER (WHERE food_order_items.id IS NOT NULL), '[]'::jsonb) AS items
           FROM food_order_items
          WHERE food_order_items.food_order_id = fo.id) items ON true
  WHERE fo.status = ANY (ARRAY['CREATED'::text, 'ACCEPTED'::text, 'PREPARING'::text])
  GROUP BY fo.id, fo.display_id, fo.hotel_id, fo.room_id, r.number, fo.status, fo.special_instructions, fo.created_at, fo.updated_at, sla.sla_started_at, sla.sla_target_at, ka.hotel_member_id, items.total_items, items.total_amount, items.items
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_my_food_orders WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT fo.id AS order_id,
    fo.display_id,
    fo.hotel_id,
    fo.status,
    fo.created_at,
    fo.updated_at,
    fo.room_id,
    r.number AS room_number,
    fa.hotel_member_id,
    fa.role,
    fa.assigned_at,
    sla.sla_target_at,
    EXTRACT(epoch FROM sla.sla_target_at::timestamp with time zone - now()) / 60::numeric AS sla_minutes_remaining,
    items.total_items,
    items.total_amount,
    items.items
   FROM food_order_assignments fa
     JOIN food_orders fo ON fo.id = fa.food_order_id
     LEFT JOIN rooms r ON r.id = fo.room_id
     LEFT JOIN food_order_sla_state sla ON sla.food_order_id = fo.id
     LEFT JOIN LATERAL ( SELECT count(*) AS total_items,
            sum(food_order_items.total_price) AS total_amount,
            COALESCE(jsonb_agg(jsonb_build_object('id', food_order_items.id, 'name', food_order_items.item_name, 'quantity', food_order_items.quantity, 'modifiers', food_order_items.modifiers)) FILTER (WHERE food_order_items.id IS NOT NULL), '[]'::jsonb) AS items
           FROM food_order_items
          WHERE food_order_items.food_order_id = fo.id) items ON true
  WHERE fa.unassigned_at IS NULL AND (fa.role = 'KITCHEN'::text AND (fo.status = ANY (ARRAY['ACCEPTED'::text, 'PREPARING'::text])) OR fa.role = 'RUNNER'::text AND (fo.status = ANY (ARRAY['READY'::text, 'DELIVERED'::text])))
  GROUP BY fo.id, fo.display_id, fo.status, fo.special_instructions, fo.created_at, fo.updated_at, fo.room_id, r.number, fa.hotel_member_id, fa.role, fa.assigned_at, sla.sla_target_at, items.total_items, items.total_amount, items.items
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_runner_queue WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT fo.id AS order_id,
    fo.display_id,
    fo.hotel_id,
    fo.room_id,
    r.number AS room_number,
    fo.status,
    fo.created_at,
    fo.updated_at,
    sla.sla_target_at,
    EXTRACT(epoch FROM sla.sla_target_at::timestamp with time zone - now()) / 60::numeric AS sla_minutes_remaining,
    ra.hotel_member_id AS assigned_runner,
    COALESCE(p.full_name, 'Unassigned'::text) AS assigned_runner_name,
    items.total_items,
    items.total_amount,
    items.items
   FROM food_orders fo
     LEFT JOIN rooms r ON r.id = fo.room_id
     JOIN food_order_sla_state sla ON sla.food_order_id = fo.id
     LEFT JOIN food_order_assignments ra ON ra.food_order_id = fo.id AND ra.role = 'RUNNER'::text AND ra.unassigned_at IS NULL
     LEFT JOIN hotel_members hm ON hm.id = ra.hotel_member_id
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN LATERAL ( SELECT count(*) AS total_items,
            sum(food_order_items.total_price) AS total_amount,
            COALESCE(jsonb_agg(jsonb_build_object('id', food_order_items.id, 'name', food_order_items.item_name, 'quantity', food_order_items.quantity, 'modifiers', food_order_items.modifiers)) FILTER (WHERE food_order_items.id IS NOT NULL), '[]'::jsonb) AS items
           FROM food_order_items
          WHERE food_order_items.food_order_id = fo.id) items ON true
  WHERE fo.status = 'READY'::text
  GROUP BY fo.id, fo.display_id, fo.hotel_id, fo.room_id, r.number, fo.status, fo.created_at, fo.updated_at, sla.sla_target_at, ra.hotel_member_id, p.full_name, items.total_items, items.total_amount, items.items
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_staff_runner_tickets WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT t.id AS ticket_id,
    t.display_id,
        CASE
            WHEN r.number IS NOT NULL THEN concat('Room ', r.number)
            ELSE z.name
        END AS location_label,
    r.number AS room_number,
    r.floor AS room_floor,
    z.id AS zone_id,
    z.name AS zone_name,
    t.hotel_id,
    t.title,
    t.description,
    t.status,
    t.reason_code,
    d.name AS department_name,
    t.created_at,
    t.current_assignee_id AS assigned_staff_id,
    hm.user_id AS assigned_user_id,
    COALESCE(p.full_name, 'Auto-queue'::text) AS assigned_to_name,
    sp.target_minutes AS sla_target_minutes,
    ss.sla_started_at,
    ss.breached AS sla_breached,
        CASE
            WHEN ss.sla_started_at IS NULL THEN NULL::integer
            ELSE GREATEST(sp.target_minutes * 60 - (EXTRACT(epoch FROM clock_timestamp() - ss.sla_started_at)::integer - COALESCE(ss.total_paused_seconds, 0) -
            CASE
                WHEN ss.sla_paused_at IS NOT NULL THEN EXTRACT(epoch FROM clock_timestamp() - ss.sla_paused_at)::integer
                ELSE 0
            END), 0)
        END AS sla_remaining_seconds,
        CASE
            WHEN ss.sla_started_at IS NULL THEN 'NOT_STARTED'::text
            WHEN ss.breached = true THEN 'BREACHED'::text
            WHEN ss.sla_paused_at IS NOT NULL THEN 'PAUSED'::text
            ELSE 'RUNNING'::text
        END AS sla_state,
        CASE
            WHEN ss.sla_started_at IS NULL THEN 'Not started'::text
            WHEN ss.breached = true THEN 'SLA breached'::text
            WHEN ss.sla_paused_at IS NOT NULL THEN 'SLA paused'::text
            ELSE concat(ceil(GREATEST(sp.target_minutes * 60 - (EXTRACT(epoch FROM clock_timestamp() - ss.sla_started_at)::integer - COALESCE(ss.total_paused_seconds, 0) -
            CASE
                WHEN ss.sla_paused_at IS NOT NULL THEN EXTRACT(epoch FROM clock_timestamp() - ss.sla_paused_at)::integer
                ELSE 0
            END), 0)::numeric / 60.0), ' min remaining')
        END AS sla_label,
        CASE
            WHEN t.status = 'IN_PROGRESS'::text AND ss.sla_paused_at IS NULL AND ss.sla_started_at IS NOT NULL THEN EXTRACT(epoch FROM clock_timestamp() - ss.sla_started_at)::integer - COALESCE(ss.total_paused_seconds, 0)
            ELSE NULL::integer
        END AS active_work_seconds,
        CASE
            WHEN ss.sla_paused_at IS NOT NULL THEN EXTRACT(epoch FROM clock_timestamp() - ss.sla_paused_at)::integer
            ELSE NULL::integer
        END AS blocked_seconds,
    t.created_by_type AS requested_by,
        CASE
            WHEN t.status = 'NEW'::text THEN 'START'::text
            WHEN t.status = 'IN_PROGRESS'::text THEN 'COMPLETE_OR_BLOCK'::text
            WHEN t.status = 'BLOCKED'::text THEN 'UNBLOCK'::text
            ELSE 'NONE'::text
        END AS allowed_actions
   FROM tickets t
     LEFT JOIN departments d ON d.id = t.service_department_id
     LEFT JOIN rooms r ON r.id = t.room_id
     LEFT JOIN hotel_zones z ON z.id = t.zone_id
     LEFT JOIN hotel_members hm ON hm.id = t.current_assignee_id
     LEFT JOIN profiles p ON p.id = hm.user_id
     LEFT JOIN ticket_sla_state ss ON ss.ticket_id = t.id
     LEFT JOIN sla_policies sp ON sp.department_id = t.service_department_id AND sp.is_active = true
  WHERE t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text, 'BLOCKED'::text])
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);


DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['ops_daily_counts','ops_ticket_heatmap','v_housekeeping_operational_board','v_kitchen_queue','v_runner_queue','v_staff_runner_tickets','v_active_checkins','live_orders_eta_v','v_my_food_orders']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
