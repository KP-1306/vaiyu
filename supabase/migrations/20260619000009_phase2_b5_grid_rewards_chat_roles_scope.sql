-- ============================================================
-- VAiyu: Phase 2 B5 — authenticated scoping, grid/rewards/chat/roles
-- ============================================================
-- Final Phase-2 batch. Anon already revoked (Phase 1); still PLAIN -> authenticated
-- cross-tenant. Plain + explicit filter (sub-ms, no slowdown), per audience:
--   grid_* (energy dashboards, owner)      -> manager-tier vaiyu_can_view_hotel_analytics
--   v_chat_threads (staff WA chat)         -> member-tier vaiyu_is_hotel_member
--   v_user_roles (hotel role data, unused) -> member-tier vaiyu_is_hotel_member
--   rewards_overview (user wallet)         -> rc_user_id = auth.uid()  (user-scoped)
--   reward_vouchers_with_hotels (wallet)   -> user_id   = auth.uid()  (user-scoped)
-- Bodies verbatim + filter -> output-identical for the authorized caller.
-- ============================================================

CREATE OR REPLACE VIEW public.grid_device_energy_daily WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT device_id,
    hotel_id,
    zone,
    device_type,
    day,
    sum(energy_kwh) AS energy_kwh,
    sum(hours) AS hours_covered,
    avg(sample_kw) AS avg_kw,
    min(reading_at) AS first_sample_at,
    max(effective_next_at) AS last_sample_at
   FROM grid_device_energy_samples
  GROUP BY device_id, hotel_id, zone, device_type, day
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.grid_device_energy_samples WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH ordered AS (
         SELECT r.id,
            r.device_id,
            d.hotel_id,
            d.zone,
            d.device_type,
            date_trunc('day'::text, r.reading_at) AS day,
            r.reading_at,
            lead(r.reading_at) OVER (PARTITION BY r.device_id ORDER BY r.reading_at) AS next_at,
            COALESCE(r.power_kw, d.power_kw, d.capacity_kw, 0::numeric) AS sample_kw,
            r.source
           FROM grid_readings r
             JOIN grid_devices d ON d.id = r.device_id
        ), with_interval AS (
         SELECT ordered.id,
            ordered.device_id,
            ordered.hotel_id,
            ordered.zone,
            ordered.device_type,
            ordered.day,
            ordered.reading_at,
            ordered.next_at,
            ordered.sample_kw,
            ordered.source,
            COALESCE(ordered.next_at, ordered.reading_at + '00:15:00'::interval) AS effective_next_at
           FROM ordered
        )
 SELECT device_id,
    hotel_id,
    zone,
    device_type,
    day::date AS day,
    reading_at,
    effective_next_at,
    EXTRACT(epoch FROM effective_next_at - reading_at) / 3600.0 AS hours,
    sample_kw,
    sample_kw * (EXTRACT(epoch FROM effective_next_at - reading_at) / 3600.0) AS energy_kwh,
    source
   FROM with_interval
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.grid_device_waste_daily WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH classified AS (
         SELECT s.device_id,
            s.hotel_id,
            s.zone,
            s.device_type,
            s.day,
            s.reading_at,
            s.effective_next_at,
            s.hours,
            s.sample_kw,
            s.energy_kwh,
            s.source,
                CASE
                    WHEN EXTRACT(hour FROM s.reading_at) >= 0::numeric AND EXTRACT(hour FROM s.reading_at) <= 5::numeric THEN 'night'::text
                    WHEN EXTRACT(hour FROM s.reading_at) >= 18::numeric AND EXTRACT(hour FROM s.reading_at) <= 21::numeric THEN 'peak_evening'::text
                    ELSE 'day'::text
                END AS period
           FROM grid_device_energy_samples s
        ), agg AS (
         SELECT classified.device_id,
            classified.hotel_id,
            classified.zone,
            classified.device_type,
            classified.day,
            sum(classified.energy_kwh) AS total_kwh,
            sum(classified.energy_kwh) FILTER (WHERE classified.period = 'night'::text) AS night_kwh,
            sum(classified.energy_kwh) FILTER (WHERE classified.period = 'peak_evening'::text) AS peak_kwh
           FROM classified
          GROUP BY classified.device_id, classified.hotel_id, classified.zone, classified.device_type, classified.day
        )
 SELECT device_id,
    hotel_id,
    zone,
    device_type,
    day,
    total_kwh,
    night_kwh,
    peak_kwh,
        CASE
            WHEN total_kwh IS NULL OR total_kwh <= 0::numeric THEN 0::numeric
            ELSE LEAST(100::numeric, round(COALESCE(night_kwh, 0::numeric) / total_kwh * 100.0))
        END AS waste_score
   FROM agg
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.grid_silent_killers_top5 WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH ranked AS (
         SELECT grid_device_waste_daily.device_id,
            grid_device_waste_daily.hotel_id,
            grid_device_waste_daily.zone,
            grid_device_waste_daily.device_type,
            grid_device_waste_daily.day,
            grid_device_waste_daily.total_kwh,
            grid_device_waste_daily.night_kwh,
            grid_device_waste_daily.peak_kwh,
            grid_device_waste_daily.waste_score,
            rank() OVER (PARTITION BY grid_device_waste_daily.hotel_id, grid_device_waste_daily.day ORDER BY grid_device_waste_daily.waste_score DESC, grid_device_waste_daily.total_kwh DESC) AS r
           FROM grid_device_waste_daily
        )
 SELECT device_id,
    hotel_id,
    zone,
    device_type,
    day,
    total_kwh,
    night_kwh,
    peak_kwh,
    waste_score,
    r AS rank_within_hotel
   FROM ranked
  WHERE r <= 5
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.grid_zone_energy_daily WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT hotel_id,
    COALESCE(zone, 'Unassigned'::text) AS zone,
    day,
    sum(energy_kwh) AS energy_kwh,
    sum(hours_covered) AS hours_covered
   FROM grid_device_energy_daily
  GROUP BY hotel_id, (COALESCE(zone, 'Unassigned'::text)), day
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.reward_vouchers_with_hotels WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT v.id,
    v.code,
    v.user_id,
    v.hotel_id,
    h.name AS hotel_name,
    v.amount_paise,
    v.status,
    v.expires_at,
    v.created_at
   FROM reward_vouchers v
     LEFT JOIN hotels h ON h.id = v.hotel_id
) _s
WHERE _s.user_id = auth.uid();

CREATE OR REPLACE VIEW public.rewards_overview WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH vouchers_reserved AS (
         SELECT reward_vouchers.user_id,
            reward_vouchers.hotel_id,
            sum(reward_vouchers.amount_paise) AS reserved_paise
           FROM reward_vouchers
          WHERE reward_vouchers.status = ANY (ARRAY['active'::text, 'redeemed'::text])
          GROUP BY reward_vouchers.user_id, reward_vouchers.hotel_id
        ), credits AS (
         SELECT reward_credits.user_id,
            reward_credits.hotel_id,
            sum(
                CASE
                    WHEN reward_credits.status = 'confirmed'::text THEN reward_credits.amount_paise
                    ELSE 0
                END) AS confirmed_paise,
            sum(
                CASE
                    WHEN reward_credits.status = 'pending'::text THEN reward_credits.amount_paise
                    ELSE 0
                END) AS pending_paise
           FROM reward_credits
          GROUP BY reward_credits.user_id, reward_credits.hotel_id
        )
 SELECT c.user_id AS rc_user_id,
    h.id AS hotel_id,
    h.name AS hotel_name,
    h.city,
    GREATEST(c.confirmed_paise - COALESCE(v.reserved_paise, 0::bigint), 0::bigint) AS available_paise,
    c.pending_paise
   FROM credits c
     JOIN hotels h ON h.id = c.hotel_id
     LEFT JOIN vouchers_reserved v ON v.user_id = c.user_id AND v.hotel_id = c.hotel_id
) _s
WHERE _s.rc_user_id = auth.uid();

CREATE OR REPLACE VIEW public.v_chat_threads WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT id,
    hotel_id,
    guest_phone,
    guest_name,
    last_booking_id,
    last_message_at,
    last_inbound_at,
    last_outbound_at,
    unread_count,
    assigned_to,
    state,
    state_expires_at,
    last_inbound_at IS NOT NULL AND last_inbound_at > (now() - '24:00:00'::interval) AS within_24h_window,
    GREATEST(0, EXTRACT(epoch FROM last_inbound_at + '24:00:00'::interval - now())::integer) AS window_seconds_remaining,
    created_at,
    updated_at
   FROM wa_chat_threads t
  WHERE vaiyu_is_hotel_member(hotel_id)
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_user_roles WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT user_id,
    role,
    hotel_id
   FROM user_profiles u
) _s
WHERE public.vaiyu_is_hotel_member(_s.hotel_id);


DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['grid_device_energy_daily','grid_device_energy_samples','grid_device_waste_daily','grid_silent_killers_top5','grid_zone_energy_daily','rewards_overview','reward_vouchers_with_hotels','v_chat_threads','v_user_roles']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
