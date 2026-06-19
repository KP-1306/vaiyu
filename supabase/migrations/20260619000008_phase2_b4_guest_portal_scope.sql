-- ============================================================
-- VAiyu: Phase 2 B4 — authenticated cross-GUEST scoping, guest-portal views
-- ============================================================
-- Guest-portal views scope by GUEST (current_guest_id), not hotel membership.
-- The outer v_guest_home_dashboard / v_guest_stay_hero already carry the guest
-- filter (left unchanged). These 7 were unscoped (the *_base views leaked 59 rows
-- to anon in Phase 0; the others were empty-but-unscoped). Anon already revoked
-- (Phase 1); add the SAME proven guest predicate the outer views use, so a
-- logged-in guest sees only their own stays (+ co-guests via stay_guests), never
-- another guest's. Plain = sub-ms planning, no UI slowdown. Bodies verbatim +
-- filter -> output-identical for the owning guest. A non-guest (no guest_user_map
-- row) gets current_guest_id() = NULL -> zero rows.
-- ============================================================

CREATE OR REPLACE VIEW public.user_recent_stays WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT stay_id AS id,
    guest_id,
    hotel_id,
    booking_code,
    is_vip,
    is_active,
    stay_status AS status,
    lifecycle_phase,
    lifecycle_phase AS stay_phase,
    hero_title,
    hotel_name,
    hotel_slug,
    hotel_city,
    hotel_phone,
    hotel_whatsapp,
    hotel_email,
    room_id,
    room_number,
    room_type,
    scheduled_checkin_at AS check_in,
    scheduled_checkout_at AS check_out,
    actual_checkin_at,
    actual_checkout_at,
    display_checkin_at,
    display_checkout_at,
    checkin_label,
    checkout_label,
    can_checkin,
    can_request_service,
    can_express_checkout,
    can_order_food,
    can_view_bill,
    can_download_invoice,
    can_book_again,
    can_modify_booking,
    can_cancel_booking,
    badge_variant,
    badge_text,
    NULL::numeric AS bill_total,
    created_at,
    updated_at,
    adults_total,
    children_total
   FROM v_guest_stay_hero
) _s
WHERE _s.guest_id = public.current_guest_id();

CREATE OR REPLACE VIEW public.user_stay_detail WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT s.id AS stay_id,
    s.guest_id AS user_id,
    s.hotel_id,
    s.scheduled_checkin_at AS checkin_at,
    s.scheduled_checkout_at AS checkout_at,
    s.actual_checkin_at,
    s.actual_checkout_at,
    s.status,
    s.source,
    s.booking_code,
    r.number AS room_number,
    h.name AS hotel_name,
    h.slug
   FROM stays s
     JOIN hotels h ON h.id = s.hotel_id
     JOIN rooms r ON r.id = s.room_id
  WHERE s.guest_id = current_guest_id() OR (EXISTS ( SELECT 1
           FROM stay_guests sg
          WHERE sg.stay_id = s.id AND sg.guest_id = current_guest_id()))
) _s
WHERE _s.user_id = auth.uid();

CREATE OR REPLACE VIEW public.user_stays_overview WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT s.id AS stay_id,
    s.scheduled_checkin_at AS checkin_at,
    s.scheduled_checkout_at AS checkout_at,
    s.status::text AS status,
    h.id AS hotel_id,
    h.name AS hotel_name,
    h.slug,
    NULL::text AS cover_image_url,
    NULL::integer AS guest_rating,
    NULL::text AS guest_comment_preview,
    0 AS earned_paise
   FROM stays s
     JOIN hotels h ON h.id = s.hotel_id
  WHERE s.guest_id = auth.uid()
  ORDER BY s.scheduled_checkin_at DESC NULLS LAST
) _s
WHERE EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = _s.stay_id AND sg.guest_id = public.current_guest_id());

CREATE OR REPLACE VIEW public.v_guest_active_bookings WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT b.id AS booking_id,
    b.hotel_id,
    b.code AS booking_code,
    b.status AS booking_status,
    h.name AS hotel_name,
    h.slug AS hotel_slug,
    h.city AS hotel_city,
    h.phone AS hotel_phone,
    h.wa_display_number AS hotel_whatsapp,
    h.email AS hotel_email,
    NULL::uuid AS primary_stay_id,
    COALESCE(rs.room_numbers, 'Unassigned'::text) AS room_numbers_display,
    COALESCE(rs.room_ids, '{}'::uuid[]) AS room_ids,
    COALESCE(rs.room_types, '{}'::text[]) AS room_types,
    COALESCE(rs.room_count, 0::bigint) AS room_count,
    '[]'::jsonb AS rooms_detail,
    'arriving'::stay_status AS status,
    b.scheduled_checkin_at AS checkin_min,
    b.scheduled_checkin_at AS checkin_max,
    b.scheduled_checkout_at AS checkout_min,
    b.scheduled_checkout_at AS checkout_max,
    false AS has_mixed_schedule,
    COALESCE(ceil(EXTRACT(epoch FROM b.scheduled_checkout_at - b.scheduled_checkin_at) / 86400::numeric), 0::numeric) AS total_nights,
    b.scheduled_checkin_at AS check_in,
    b.scheduled_checkout_at AS check_out,
    COALESCE(ps.total_amount, 0::numeric) AS total_amount,
    COALESCE(ps.paid_amount, 0::numeric) AS paid_amount,
    COALESCE(ps.total_amount, 0::numeric) - COALESCE(ps.paid_amount, 0::numeric) AS outstanding_balance,
    b.guest_id,
    b.updated_at AS last_updated,
    pt.token AS precheckin_token,
    pt.expires_at AS precheckin_expires_at,
    pt.used_at AS precheckin_used_at,
    b.expected_arrival_at
   FROM bookings b
     JOIN hotels h ON h.id = b.hotel_id
     LEFT JOIN LATERAL ( SELECT string_agg(r.number, ', '::text ORDER BY r.number) AS room_numbers,
            array_agg(DISTINCT r.id) AS room_ids,
            array_agg(DISTINCT rt.name) AS room_types,
            count(DISTINCT r.id) AS room_count
           FROM booking_rooms br
             JOIN rooms r ON r.id = br.room_id
             LEFT JOIN room_types rt ON rt.id = r.room_type_id
          WHERE br.booking_id = b.id) rs ON true
     LEFT JOIN LATERAL ( SELECT pt_1.token,
            pt_1.expires_at,
            pt_1.used_at
           FROM precheckin_tokens pt_1
          WHERE pt_1.booking_id = b.id
          ORDER BY pt_1.created_at DESC
         LIMIT 1) pt ON true
     LEFT JOIN LATERAL ( SELECT ps_1.total_amount,
            ps_1.paid_amount
           FROM v_arrival_payment_state ps_1
          WHERE ps_1.booking_id = b.id
         LIMIT 1) ps ON true
  WHERE (b.status = ANY (ARRAY['CONFIRMED'::text, 'PRE_CHECKED_IN'::text, 'PARTIALLY_CHECKED_IN'::text])) AND b.guest_id = current_guest_id() AND NOT (EXISTS ( SELECT 1
           FROM stays s
          WHERE s.booking_id = b.id))
UNION ALL
 SELECT s.booking_id,
    s.hotel_id,
    b.code AS booking_code,
    b.status AS booking_status,
    h.name AS hotel_name,
    h.slug AS hotel_slug,
    h.city AS hotel_city,
    h.phone AS hotel_phone,
    h.wa_display_number AS hotel_whatsapp,
    h.email AS hotel_email,
    COALESCE((array_agg(s.id ORDER BY s.created_at) FILTER (WHERE s.status = 'inhouse'::stay_status))[1], (array_agg(s.id ORDER BY s.created_at))[1]) AS primary_stay_id,
    string_agg(DISTINCT r.number, ', '::text ORDER BY r.number) AS room_numbers_display,
    array_agg(DISTINCT r.id) AS room_ids,
    array_remove(array_agg(DISTINCT rt.name), NULL::text) AS room_types,
    count(DISTINCT s.id) AS room_count,
    COALESCE(rooms.rooms_detail, '[]'::jsonb) AS rooms_detail,
    'inhouse'::stay_status AS status,
    min(s.scheduled_checkin_at) AS checkin_min,
    max(s.scheduled_checkin_at) AS checkin_max,
    min(s.scheduled_checkout_at) AS checkout_min,
    max(s.scheduled_checkout_at) AS checkout_max,
    min(s.scheduled_checkin_at) <> max(s.scheduled_checkin_at) OR min(s.scheduled_checkout_at) <> max(s.scheduled_checkout_at) AS has_mixed_schedule,
    COALESCE(ceil(EXTRACT(epoch FROM max(s.scheduled_checkout_at) - min(s.scheduled_checkin_at)) / 86400::numeric), 0::numeric) AS total_nights,
    min(s.scheduled_checkin_at) AS check_in,
    max(s.scheduled_checkout_at) AS check_out,
    COALESCE(ps.total_amount, 0::numeric) AS total_amount,
    COALESCE(ps.paid_amount, 0::numeric) AS paid_amount,
    COALESCE(ps.total_amount, 0::numeric) - COALESCE(ps.paid_amount, 0::numeric) AS outstanding_balance,
    s.guest_id,
    max(s.updated_at) AS last_updated,
    max(pt.token) AS precheckin_token,
    max(pt.expires_at) AS precheckin_expires_at,
    max(pt.used_at) AS precheckin_used_at,
    NULL::timestamp with time zone AS expected_arrival_at
   FROM stays s
     JOIN bookings b ON b.id = s.booking_id
     JOIN hotels h ON h.id = s.hotel_id
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN room_types rt ON rt.id = r.room_type_id
     LEFT JOIN LATERAL ( SELECT pt_1.token,
            pt_1.expires_at,
            pt_1.used_at
           FROM precheckin_tokens pt_1
          WHERE pt_1.booking_id = s.booking_id
          ORDER BY pt_1.created_at DESC
         LIMIT 1) pt ON true
     LEFT JOIN LATERAL ( SELECT ps_1.total_amount,
            ps_1.paid_amount
           FROM v_arrival_payment_state ps_1
          WHERE ps_1.booking_id = s.booking_id
         LIMIT 1) ps ON true
     LEFT JOIN ( SELECT t.booking_id,
            t.guest_id,
            jsonb_agg(t.room_obj ORDER BY t.room_number) AS rooms_detail
           FROM ( SELECT DISTINCT s2.booking_id,
                    s2.guest_id,
                    r2.number AS room_number,
                    jsonb_build_object('id', s2.id, 'room_id', r2.id, 'number', r2.number, 'status', s2.status, 'type', rt2.name, 'check_in', s2.scheduled_checkin_at, 'check_out', s2.scheduled_checkout_at) AS room_obj
                   FROM stays s2
                     JOIN rooms r2 ON r2.id = s2.room_id
                     LEFT JOIN room_types rt2 ON rt2.id = r2.room_type_id
                  WHERE s2.status = 'inhouse'::stay_status) t
          GROUP BY t.booking_id, t.guest_id) rooms ON rooms.booking_id = s.booking_id AND rooms.guest_id = s.guest_id
  WHERE s.status = 'inhouse'::stay_status AND s.guest_id = current_guest_id()
  GROUP BY s.booking_id, s.hotel_id, b.code, b.status, h.id, h.name, h.slug, h.city, h.phone, h.wa_display_number, h.email, s.guest_id, ps.total_amount, ps.paid_amount, rooms.rooms_detail
) _s
WHERE _s.guest_id = public.current_guest_id();

CREATE OR REPLACE VIEW public.v_guest_home_dashboard_base WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT vh.stay_id,
    vh.guest_id,
    vh.hotel_id,
    vh.booking_code,
    vh.hotel_name,
    vh.hotel_city,
    vh.hotel_slug,
    vh.hotel_phone,
    vh.hotel_whatsapp,
    vh.hotel_email,
    vh.room_id,
    vh.room_number,
    vh.room_type,
    vh.stay_status,
    vh.lifecycle_phase,
    vh.display_checkin_at,
    vh.display_checkout_at,
    vh.checkin_label,
    vh.checkout_label,
    vh.hero_title,
    vh.badge_variant,
    vh.badge_text,
    vh.can_checkin,
    vh.can_request_service,
    vh.can_express_checkout,
    vh.can_order_food,
    vh.can_view_bill,
    vh.can_download_invoice,
    COALESCE(svc.active_count, 0) > 0 AS has_active_service_request,
    COALESCE(svc.active_count, 0) AS active_service_count,
    vh.can_view_bill AS has_bill,
    NULL::numeric AS bill_total,
    NULL::integer AS reward_points,
    NULL::text AS reward_tier,
    vh.is_vip,
    vh.is_active,
    vh.created_at,
    vh.updated_at
   FROM v_guest_stay_hero_base vh
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS active_count
           FROM tickets t
          WHERE t.stay_id = vh.stay_id AND (t.status = ANY (ARRAY['NEW'::text, 'IN_PROGRESS'::text]))) svc ON true
) _s
WHERE _s.guest_id = public.current_guest_id() OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = _s.stay_id AND sg.guest_id = public.current_guest_id());

CREATE OR REPLACE VIEW public.v_guest_stay_display WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT s.id,
    s.guest_id,
    s.hotel_id,
    s.room_id,
    s.booking_code,
    s.status::text AS status,
    s.is_vip,
    s.scheduled_checkin_at,
    s.scheduled_checkout_at,
    s.actual_checkin_at,
    s.actual_checkout_at,
    COALESCE(s.actual_checkin_at, s.scheduled_checkin_at) AS display_checkin_at,
        CASE
            WHEN s.status = 'checked_out'::stay_status THEN COALESCE(s.actual_checkout_at, s.scheduled_checkout_at)
            ELSE s.scheduled_checkout_at
        END AS display_checkout_at,
        CASE
            WHEN s.status = 'inhouse'::stay_status AND s.actual_checkin_at IS NOT NULL THEN 'Checked-in'::text
            ELSE 'Check-in'::text
        END AS checkin_label,
        CASE
            WHEN s.status = 'inhouse'::stay_status THEN 'Checkout'::text
            ELSE 'Check-out'::text
        END AS checkout_label,
    h.name AS hotel_name,
    h.slug AS hotel_slug,
    h.city AS hotel_city,
    r.number AS room_number,
    s.created_at,
    s.updated_at
   FROM stays s
     JOIN hotels h ON h.id = s.hotel_id
     JOIN rooms r ON r.id = s.room_id
  WHERE s.guest_id = auth.uid()
) _s
WHERE _s.guest_id = public.current_guest_id();

CREATE OR REPLACE VIEW public.v_guest_stay_hero_base WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT s.id AS stay_id,
    s.guest_id,
    s.hotel_id,
    s.booking_code,
    s.is_vip,
    s.is_active,
    h.name AS hotel_name,
    h.slug AS hotel_slug,
    h.city AS hotel_city,
    h.phone AS hotel_phone,
    h.wa_display_number AS hotel_whatsapp,
    h.email AS hotel_email,
    r.id AS room_id,
    r.number AS room_number,
    rt.name AS room_type,
    s.status AS stay_status,
        CASE
            WHEN s.status = 'arriving'::stay_status THEN 'UPCOMING'::text
            WHEN s.status = 'inhouse'::stay_status THEN 'ACTIVE'::text
            WHEN s.status = 'checked_out'::stay_status THEN 'COMPLETED'::text
            WHEN s.status = 'cancelled'::stay_status THEN 'CANCELLED'::text
            WHEN s.status = 'no_show'::stay_status THEN 'NO_SHOW'::text
            ELSE 'OTHER'::text
        END AS lifecycle_phase,
        CASE
            WHEN s.status = 'arriving'::stay_status THEN 'Your upcoming stay at '::text || h.name
            WHEN s.status = 'inhouse'::stay_status THEN 'Your stay at '::text || h.name
            WHEN s.status = 'checked_out'::stay_status THEN 'Your recent stay at '::text || h.name
            WHEN s.status = 'cancelled'::stay_status THEN 'Cancelled stay at '::text || h.name
            ELSE 'Stay at '::text || h.name
        END AS hero_title,
    s.scheduled_checkin_at,
    s.scheduled_checkout_at,
    s.actual_checkin_at,
    s.actual_checkout_at,
    COALESCE(s.actual_checkin_at, s.scheduled_checkin_at) AS display_checkin_at,
        CASE
            WHEN s.status = 'checked_out'::stay_status THEN COALESCE(s.actual_checkout_at, s.scheduled_checkout_at)
            ELSE s.scheduled_checkout_at
        END AS display_checkout_at,
        CASE
            WHEN s.status = 'inhouse'::stay_status AND s.actual_checkin_at IS NOT NULL THEN 'Checked-in'::text
            ELSE 'Check-in'::text
        END AS checkin_label,
        CASE
            WHEN s.status = 'inhouse'::stay_status THEN 'Checkout'::text
            ELSE 'Check-out'::text
        END AS checkout_label,
    s.status = 'arriving'::stay_status AS can_checkin,
    s.status = 'inhouse'::stay_status AS can_request_service,
    s.status = 'inhouse'::stay_status AS can_express_checkout,
    s.status = 'inhouse'::stay_status AS can_order_food,
    s.status = ANY (ARRAY['inhouse'::stay_status, 'checked_out'::stay_status]) AS can_view_bill,
    s.status = 'checked_out'::stay_status AS can_download_invoice,
    s.status = 'checked_out'::stay_status AS can_book_again,
    s.status = 'arriving'::stay_status AS can_modify_booking,
    s.status = 'arriving'::stay_status AS can_cancel_booking,
        CASE
            WHEN s.status = 'inhouse'::stay_status THEN 'success'::text
            WHEN s.status = 'arriving'::stay_status THEN 'warning'::text
            WHEN s.status = 'checked_out'::stay_status THEN 'neutral'::text
            WHEN s.status = 'cancelled'::stay_status THEN 'error'::text
            WHEN s.status = 'no_show'::stay_status THEN 'error'::text
            ELSE 'neutral'::text
        END AS badge_variant,
        CASE
            WHEN s.status = 'inhouse'::stay_status THEN '✓ Checked-in'::text
            WHEN s.status = 'arriving'::stay_status THEN 'Upcoming'::text
            WHEN s.status = 'checked_out'::stay_status THEN '✓ Completed'::text
            WHEN s.status = 'cancelled'::stay_status THEN 'Cancelled'::text
            WHEN s.status = 'no_show'::stay_status THEN 'No Show'::text
            ELSE NULL::text
        END AS badge_text,
    s.created_at,
    s.updated_at,
    bk.adults_total,
    bk.children_total
   FROM stays s
     JOIN hotels h ON h.id = s.hotel_id
     JOIN rooms r ON r.id = s.room_id
     LEFT JOIN room_types rt ON rt.id = r.room_type_id
     LEFT JOIN bookings bk ON bk.id = s.booking_id
) _s
WHERE _s.guest_id = public.current_guest_id() OR EXISTS (SELECT 1 FROM public.stay_guests sg WHERE sg.stay_id = _s.stay_id AND sg.guest_id = public.current_guest_id());


DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['v_guest_home_dashboard_base','v_guest_stay_hero_base','v_guest_active_bookings','v_guest_stay_display','user_recent_stays','user_stay_detail','user_stays_overview']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
