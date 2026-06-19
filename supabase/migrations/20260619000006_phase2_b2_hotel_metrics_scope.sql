-- ============================================================
-- VAiyu: Phase 2 B2 — authenticated cross-tenant scoping, hotel growth/metrics
-- ============================================================
-- 11 owner growth/observability views (asset_status, gbp/ota readiness, kpis_today,
-- review_metrics, visibility_score, visible_assets, whatsapp_health, cron_health,
-- seasonal_windows). Anon already revoked (Phase 1); still PLAIN -> authenticated
-- cross-tenant. Wrap each (verbatim body) in manager-tier vaiyu_can_view_hotel_analytics
-- (owner growth tooling; none read on guest/public routes). Plain = sub-ms planning,
-- no UI slowdown. Output-identical for authorized viewers; anon stays revoked.
-- ============================================================

CREATE OR REPLACE VIEW public.v_hotel_asset_status WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT r.code AS requirement_code,
    r.category,
    r.priority,
    r.storage_zone,
    r.display_name_en,
    r.display_name_hi,
    r.why_it_matters_en,
    r.why_it_matters_hi,
    r.recommended_action_en,
    r.recommended_action_hi,
    r.allow_multiple_files,
    r.sort_order,
        CASE r.priority
            WHEN 'CRITICAL'::asset_priority THEN 0
            WHEN 'HIGH'::asset_priority THEN 1
            WHEN 'MEDIUM'::asset_priority THEN 2
            WHEN 'LOW'::asset_priority THEN 3
            ELSE NULL::integer
        END AS priority_rank,
        CASE r.category
            WHEN 'VERIFICATION_PROOF'::asset_category THEN 0
            WHEN 'TRUST_ESSENTIALS'::asset_category THEN 1
            WHEN 'OPERATIONAL'::asset_category THEN 2
            WHEN 'EXPERIENCE'::asset_category THEN 3
            ELSE NULL::integer
        END AS category_rank,
    h.id AS hotel_id,
    ha.id AS hotel_asset_id,
    COALESCE(ha.status::text, 'MISSING'::text) AS status,
    ha.collected_via,
    ha.owner_notes,
    ha.internal_notes,
    ha.rejection_reason,
    ha.reviewed_at,
    ha.review_actor_name,
    ha.updated_at AS asset_updated_at,
    COALESCE(fc.file_count, 0) AS file_count,
    fc.last_file_at
   FROM asset_requirements r
     CROSS JOIN hotels h
     LEFT JOIN hotel_assets ha ON ha.hotel_id = h.id AND ha.requirement_code = r.code
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS file_count,
            max(hotel_asset_files.created_at) AS last_file_at
           FROM hotel_asset_files
          WHERE hotel_asset_files.hotel_asset_id = ha.id) fc ON true
  WHERE r.is_active = true AND vaiyu_is_hotel_member(h.id)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_gbp_readiness WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH member_hotels AS (
         SELECT h.id AS hotel_id,
            h.slug,
            h.name,
            h.address,
            h.city,
            h.state,
            h.country,
            h.postal_code,
            h.latitude,
            h.longitude,
            h.phone,
            h.review_policy_url,
            h.description,
            h.amenities
           FROM hotels h
          WHERE vaiyu_is_hotel_member(h.id)
        ), self_attested_net_new AS (
         SELECT mh.hotel_id,
            c.item_key,
                CASE
                    WHEN ga.state = 'MANAGER_VERIFIED'::gbp_attestation_state AND ga.manager_verified_at >= (now() - '90 days'::interval) THEN true
                    WHEN ga.state = 'MANAGER_VERIFIED'::gbp_attestation_state THEN false
                    WHEN ga.state = 'SELF_ATTESTED'::gbp_attestation_state THEN true
                    ELSE false
                END AS satisfied,
            COALESCE(ga.manager_verified_at, ga.attested_at) AS most_recent_at
           FROM member_hotels mh
             CROSS JOIN _gbp_catalog() c(catalog_version, item_key, category, kind, linked_visibility_signal_key, display_order)
             LEFT JOIN gbp_checklist_attestations ga ON ga.hotel_id = mh.hotel_id AND ga.item_key = c.item_key
          WHERE c.kind = 'SELF_ATTESTED'::gbp_item_kind
        ), linked_self_attested AS (
         SELECT mh.hotel_id,
            c.item_key,
                CASE
                    WHEN va.state = 'MANAGER_VERIFIED'::visibility_attestation_state AND va.manager_verified_at >= (now() - '90 days'::interval) THEN true
                    WHEN va.state = 'MANAGER_VERIFIED'::visibility_attestation_state THEN false
                    WHEN va.state = 'SELF_ATTESTED'::visibility_attestation_state THEN true
                    ELSE false
                END AS satisfied,
            COALESCE(va.manager_verified_at, va.attested_at) AS most_recent_at
           FROM member_hotels mh
             CROSS JOIN _gbp_catalog() c(catalog_version, item_key, category, kind, linked_visibility_signal_key, display_order)
             LEFT JOIN hotel_visibility_attestations va ON va.hotel_id = mh.hotel_id AND va.signal_key = c.linked_visibility_signal_key
          WHERE c.kind = 'LINKED_VISIBILITY'::gbp_item_kind AND (c.linked_visibility_signal_key = ANY (ARRAY['gmb_claimed'::text, 'gmb_verified'::text, 'gmb_category_set'::text, 'off_platform_response'::text]))
        ), linked_auto_derived AS (
         SELECT mh.hotel_id,
            c.item_key,
                CASE c.linked_visibility_signal_key
                    WHEN 'address_complete'::text THEN COALESCE(length(btrim(mh.address)), 0) > 0 AND COALESCE(length(btrim(mh.city)), 0) > 0 AND COALESCE(length(btrim(mh.state)), 0) > 0 AND COALESCE(length(btrim(mh.country)), 0) > 0 AND COALESCE(length(btrim(mh.postal_code)), 0) > 0
                    WHEN 'map_pin_set'::text THEN mh.latitude IS NOT NULL AND mh.longitude IS NOT NULL
                    WHEN 'phone_present'::text THEN COALESCE(length(btrim(mh.phone)), 0) > 0
                    WHEN 'review_link_set'::text THEN COALESCE(length(btrim(mh.review_policy_url)), 0) > 0
                    WHEN 'package_live'::text THEN (EXISTS ( SELECT 1
                       FROM packages p
                      WHERE p.hotel_id = mh.hotel_id AND p.status = 'ACTIVE'::package_status AND p.deleted_at IS NULL))
                    ELSE false
                END AS satisfied,
            now() AS most_recent_at
           FROM member_hotels mh
             CROSS JOIN _gbp_catalog() c(catalog_version, item_key, category, kind, linked_visibility_signal_key, display_order)
          WHERE c.kind = 'LINKED_VISIBILITY'::gbp_item_kind AND (c.linked_visibility_signal_key = ANY (ARRAY['address_complete'::text, 'map_pin_set'::text, 'phone_present'::text, 'review_link_set'::text, 'package_live'::text]))
        ), auto_derived_net_new AS (
         SELECT mh.hotel_id,
            c.item_key,
                CASE c.item_key
                    WHEN 'description_present'::text THEN COALESCE(length(btrim(mh.description)), 0) >= 30
                    WHEN 'amenities_visible_on_gbp'::text THEN COALESCE(array_length(mh.amenities, 1), 0) >= 3
                    ELSE false
                END AS satisfied,
            now() AS most_recent_at
           FROM member_hotels mh
             CROSS JOIN _gbp_catalog() c(catalog_version, item_key, category, kind, linked_visibility_signal_key, display_order)
          WHERE c.kind = 'AUTO_DERIVED'::gbp_item_kind
        ), all_items AS (
         SELECT self_attested_net_new.hotel_id,
            self_attested_net_new.item_key,
            self_attested_net_new.satisfied,
            self_attested_net_new.most_recent_at
           FROM self_attested_net_new
        UNION ALL
         SELECT linked_self_attested.hotel_id,
            linked_self_attested.item_key,
            linked_self_attested.satisfied,
            linked_self_attested.most_recent_at
           FROM linked_self_attested
        UNION ALL
         SELECT linked_auto_derived.hotel_id,
            linked_auto_derived.item_key,
            linked_auto_derived.satisfied,
            linked_auto_derived.most_recent_at
           FROM linked_auto_derived
        UNION ALL
         SELECT auto_derived_net_new.hotel_id,
            auto_derived_net_new.item_key,
            auto_derived_net_new.satisfied,
            auto_derived_net_new.most_recent_at
           FROM auto_derived_net_new
        )
 SELECT hotel_id,
    ( SELECT member_hotels.slug
           FROM member_hotels
          WHERE member_hotels.hotel_id = ai.hotel_id) AS hotel_slug,
    ( SELECT member_hotels.name
           FROM member_hotels
          WHERE member_hotels.hotel_id = ai.hotel_id) AS hotel_name,
    count(*) AS total_count,
    count(*) FILTER (WHERE satisfied) AS satisfied_count,
    round(100.0 * count(*) FILTER (WHERE satisfied)::numeric / NULLIF(count(*), 0)::numeric, 1) AS overall_score,
    max(most_recent_at) AS most_recent_attestation_at,
    count(*) FILTER (WHERE satisfied)::numeric >= ceil(count(*)::numeric * 0.70) AS meets_ready_threshold
   FROM all_items ai
  GROUP BY hotel_id
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_kpis_today WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH p AS (
         SELECT (now() AT TIME ZONE 'Asia/Kolkata'::text)::date AS local_today,
            (now() AT TIME ZONE 'Asia/Kolkata'::text) AS local_now
        )
 SELECT h.id AS hotel_id,
    p.local_today AS d,
    ( SELECT count(*) AS count
           FROM rooms r
          WHERE r.hotel_id = h.id) AS total_rooms,
    COALESCE(( SELECT count(*) AS count
           FROM stays s
          WHERE s.hotel_id = h.id AND (s.scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata'::text)::date = p.local_today), 0::bigint) AS arrivals,
    COALESCE(( SELECT count(*) AS count
           FROM stays s
          WHERE s.hotel_id = h.id AND (s.scheduled_checkout_at AT TIME ZONE 'Asia/Kolkata'::text)::date = p.local_today), 0::bigint) AS departures,
    COALESCE(( SELECT count(*) AS count
           FROM stays s
          WHERE s.hotel_id = h.id AND (s.scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata'::text) <= p.local_now AND (s.scheduled_checkout_at AT TIME ZONE 'Asia/Kolkata'::text) > p.local_now), 0::bigint) AS inhouse,
    COALESCE(( SELECT sum(n.revenue) AS sum
           FROM nightly_revenue n
          WHERE n.hotel_id = h.id AND n.d = p.local_today), 0::numeric) AS room_revenue_today,
    COALESCE(( SELECT count(*) AS count
           FROM stays s
          WHERE s.hotel_id = h.id AND (s.scheduled_checkin_at AT TIME ZONE 'Asia/Kolkata'::text) <= p.local_now AND (s.scheduled_checkout_at AT TIME ZONE 'Asia/Kolkata'::text) > p.local_now), 0::bigint) AS occupied_rooms_today
   FROM hotels h
     CROSS JOIN p
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_ota_readiness WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH member_hotels AS (
         SELECT h.id AS hotel_id,
            h.state,
            h.slug,
            h.name
           FROM hotels h
          WHERE vaiyu_is_hotel_member(h.id)
        ), hotel_settings AS (
         SELECT mh.hotel_id,
            mh.state,
            mh.slug,
            mh.name,
            COALESCE(s.active_otas, ARRAY['MMT'::ota_platform, 'GOIBIBO'::ota_platform, 'BOOKING_COM'::ota_platform, 'AGODA'::ota_platform, 'AIRBNB'::ota_platform, 'EXPEDIA'::ota_platform, 'YATRA'::ota_platform, 'TRIPADVISOR'::ota_platform]) AS active_otas,
            COALESCE(s.show_mountain_checks_override, mh.state = ANY (_ota_mountain_states())) AS effective_mountain,
            s.wizard_completed_at,
            s.hotel_id IS NOT NULL AS settings_exists
           FROM member_hotels mh
             LEFT JOIN hotel_ota_optimizer_settings s ON s.hotel_id = mh.hotel_id
        ), active_grid AS (
         SELECT hs.hotel_id,
            hs.slug,
            hs.name,
            hs.wizard_completed_at,
            hs.effective_mountain,
            unnest(hs.active_otas) AS ota,
            c.category,
            c.item_key,
            c.weight,
            c.is_mountain_only,
            c.not_applicable_otas
           FROM hotel_settings hs
             CROSS JOIN _ota_catalog() c(catalog_version, category, item_key, weight, is_mountain_only, not_applicable_otas, display_order)
        ), applicable AS (
         SELECT ag.hotel_id,
            ag.slug,
            ag.name,
            ag.wizard_completed_at,
            ag.effective_mountain,
            ag.ota,
            ag.category,
            ag.item_key,
            ag.weight,
            ag.is_mountain_only,
            ag.not_applicable_otas
           FROM active_grid ag
          WHERE (NOT ag.is_mountain_only OR ag.effective_mountain = true) AND NOT (ag.ota = ANY (ag.not_applicable_otas))
        ), scored AS (
         SELECT a.hotel_id,
            a.slug,
            a.name,
            a.ota,
            a.category,
            a.item_key,
            a.weight,
            a.wizard_completed_at,
            a.effective_mountain,
                CASE
                    WHEN s.id IS NULL THEN 'UNKNOWN'::ota_readiness_status
                    WHEN s.status = 'NOT_APPLICABLE'::ota_readiness_status THEN 'NOT_APPLICABLE'::ota_readiness_status
                    WHEN s.reviewed_at < (now() - '120 days'::interval) THEN 'UNKNOWN'::ota_readiness_status
                    ELSE s.status
                END AS effective_status,
            s.reviewed_at,
            s.note,
            s.id IS NOT NULL AND s.reviewed_at < (now() - '90 days'::interval) AND s.reviewed_at >= (now() - '120 days'::interval) AS is_stale
           FROM applicable a
             LEFT JOIN hotel_ota_readiness_state s ON s.hotel_id = a.hotel_id AND s.ota = a.ota AND s.category = a.category AND s.item_key = a.item_key
        ), contributions AS (
         SELECT scored.hotel_id,
            scored.slug,
            scored.name,
            scored.ota,
            scored.category,
            scored.item_key,
            scored.weight,
            scored.wizard_completed_at,
            scored.effective_mountain,
            scored.effective_status,
            scored.reviewed_at,
            scored.note,
            scored.is_stale,
                CASE scored.effective_status
                    WHEN 'COMPLETE'::ota_readiness_status THEN scored.weight
                    WHEN 'PARTIAL'::ota_readiness_status THEN scored.weight * 0.5
                    WHEN 'NOT_APPLICABLE'::ota_readiness_status THEN NULL::numeric
                    ELSE 0::numeric
                END AS earned,
                CASE scored.effective_status
                    WHEN 'NOT_APPLICABLE'::ota_readiness_status THEN NULL::numeric
                    ELSE scored.weight
                END AS possible
           FROM scored
        )
 SELECT hotel_id,
    slug AS hotel_slug,
    name AS hotel_name,
    ota,
    wizard_completed_at,
    effective_mountain,
    COALESCE(round(100.0 * sum(earned) / NULLIF(sum(possible), 0::numeric), 1), 0::numeric) AS ota_score,
        CASE
            WHEN sum(possible) IS NULL OR sum(possible) = 0::numeric THEN 'CRITICAL'::ota_readiness_band
            WHEN (100.0 * sum(earned) / sum(possible)) >= 80::numeric THEN 'PREMIUM'::ota_readiness_band
            WHEN (100.0 * sum(earned) / sum(possible)) >= 50::numeric THEN 'MODERATE'::ota_readiness_band
            ELSE 'CRITICAL'::ota_readiness_band
        END AS band,
    min(reviewed_at) AS oldest_review_at,
    count(*) FILTER (WHERE effective_status = 'COMPLETE'::ota_readiness_status) AS complete_count,
    count(*) FILTER (WHERE effective_status = 'PARTIAL'::ota_readiness_status) AS partial_count,
    count(*) FILTER (WHERE effective_status = 'MISSING'::ota_readiness_status) AS missing_count,
    count(*) FILTER (WHERE effective_status = 'UNKNOWN'::ota_readiness_status) AS unknown_count,
    count(*) FILTER (WHERE effective_status = 'NOT_APPLICABLE'::ota_readiness_status) AS na_count,
    count(*) FILTER (WHERE is_stale) AS stale_count,
    count(*) AS total_count
   FROM contributions
  GROUP BY hotel_id, slug, name, ota, wizard_completed_at, effective_mountain
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_ota_readiness_summary WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT hotel_id,
    hotel_slug,
    hotel_name,
    wizard_completed_at,
    effective_mountain,
    count(*) AS active_ota_count,
    round(avg(ota_score), 1) AS overall_score,
        CASE
            WHEN avg(ota_score) >= 80::numeric THEN 'PREMIUM'::ota_readiness_band
            WHEN avg(ota_score) >= 50::numeric THEN 'MODERATE'::ota_readiness_band
            ELSE 'CRITICAL'::ota_readiness_band
        END AS overall_band,
    min(oldest_review_at) AS oldest_review_at,
    sum(missing_count + unknown_count) AS total_gap_count,
    sum(stale_count) AS total_stale_count
   FROM v_hotel_ota_readiness
  GROUP BY hotel_id, hotel_slug, hotel_name, wizard_completed_at, effective_mountain
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_review_metrics WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT gr.hotel_id,
    count(DISTINCT gr.id) AS total_reviews,
    round(avg(gr.overall_rating), 2) AS average_rating,
    count(DISTINCT gr.id) FILTER (WHERE gr.overall_rating >= 4) AS positive_reviews,
    count(DISTINCT gr.id) FILTER (WHERE gr.overall_rating <= 2) AS negative_reviews,
    count(DISTINCT f.review_id) FILTER (WHERE f.status = ANY (ARRAY['open'::text, 'in_progress'::text])) AS active_escalations,
    max(gr.created_at) AS last_review_at
   FROM guest_reviews gr
     LEFT JOIN review_flags f ON gr.id = f.review_id
  GROUP BY gr.hotel_id
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_visibility_score WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT id AS hotel_id,
    slug AS hotel_slug,
    name AS hotel_name,
    _compute_visibility_score(id) AS breakdown
   FROM hotels h
  WHERE vaiyu_is_hotel_member(id)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_visible_assets WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT ha.hotel_id,
    r.code AS requirement_code,
    r.category,
    r.storage_zone,
    ha.status,
    f.id AS file_id,
    f.bucket,
    f.storage_path,
    f.mime_type,
    f.alt_text,
    f.sort_order,
    f.created_at AS file_created_at
   FROM hotel_assets ha
     JOIN asset_requirements r ON r.code = ha.requirement_code
     JOIN hotel_asset_files f ON f.hotel_asset_id = ha.id
  WHERE (ha.status = ANY (ARRAY['COLLECTED'::asset_status, 'APPROVED'::asset_status])) AND r.is_active = true AND vaiyu_is_hotel_member(ha.hotel_id)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_hotel_whatsapp_health WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT id AS hotel_id,
    slug AS hotel_slug,
    whatsapp_enabled,
    whatsapp_provider,
    whatsapp_daily_cap,
    wa_template_sends_today(id) AS sent_today,
    ( SELECT count(*) AS count
           FROM notification_queue nq
          WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'::text AND nq.created_at >= (now() - '7 days'::interval)) AS queued_7d,
    ( SELECT count(*) AS count
           FROM notification_queue nq
          WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'::text AND nq.status = 'sent'::text AND nq.created_at >= (now() - '7 days'::interval)) AS sent_7d,
    ( SELECT count(*) AS count
           FROM notification_queue nq
          WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'::text AND nq.status = 'failed'::text AND nq.created_at >= (now() - '7 days'::interval)) AS failed_7d,
    ( SELECT count(*) AS count
           FROM notification_queue nq
          WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'::text AND nq.delivered_at IS NOT NULL AND nq.created_at >= (now() - '7 days'::interval)) AS delivered_7d,
    ( SELECT count(*) AS count
           FROM notification_queue nq
          WHERE nq.hotel_id = h.id AND nq.channel = 'whatsapp'::text AND nq.read_at IS NOT NULL AND nq.created_at >= (now() - '7 days'::interval)) AS read_7d
   FROM hotels h
  WHERE vaiyu_is_hotel_member(id)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_visibility_cron_health WITH (security_invoker = false) AS
SELECT _s.* FROM (
 SELECT id AS hotel_id,
    slug AS hotel_slug,
    ( SELECT max(s.taken_at) AS max
           FROM visibility_score_snapshots s
          WHERE s.hotel_id_at_snapshot = h.id AND s.triggered_by = 'CRON'::visibility_snapshot_trigger) AS last_cron_snapshot_at,
        CASE
            WHEN created_at >= (now() - '14 days'::interval) THEN true
            ELSE (EXISTS ( SELECT 1
               FROM visibility_score_snapshots s
              WHERE s.hotel_id_at_snapshot = h.id AND s.triggered_by = 'CRON'::visibility_snapshot_trigger AND s.taken_at >= (now() - '9 days'::interval)))
        END AS healthy
   FROM hotels h
  WHERE vaiyu_is_hotel_member(id)
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);

CREATE OR REPLACE VIEW public.v_visible_seasonal_windows WITH (security_invoker = false) AS
SELECT _s.* FROM (
 WITH active_windows AS (
         SELECT w.code,
            w.category,
            w.display_name_en,
            w.display_name_hi,
            w.why_it_matters_en,
            w.why_it_matters_hi,
            w.recommended_action_en,
            w.recommended_action_hi,
            w.target_guest_segment_en,
            w.target_guest_segment_hi,
            w.suggested_package_idea_en,
            w.suggested_package_idea_hi,
            w.start_month,
            w.start_day,
            w.end_month,
            w.end_day,
            w.region_state_codes,
            w.priority,
            w.prep_checklist_seed,
            w.connected_module_suggestion,
            w.is_approximate,
            w.date_disclaimer_en,
            w.date_disclaimer_hi,
            w.display_order,
            w.is_active,
            w.created_at,
            w.updated_at,
            _seasonal_window_next_occurrence(w.start_month, w.start_day, w.end_month, w.end_day, now()) AS occurrence
           FROM seasonal_calendar_windows w
          WHERE w.is_active = true
        ), joined AS (
         SELECT h.id AS hotel_id,
            h.slug AS hotel_slug,
            h.state AS hotel_state,
            aw.code,
            aw.category,
            aw.display_name_en,
            aw.display_name_hi,
            aw.why_it_matters_en,
            aw.why_it_matters_hi,
            aw.recommended_action_en,
            aw.recommended_action_hi,
            aw.target_guest_segment_en,
            aw.target_guest_segment_hi,
            aw.suggested_package_idea_en,
            aw.suggested_package_idea_hi,
            aw.start_month,
            aw.start_day,
            aw.end_month,
            aw.end_day,
            aw.region_state_codes,
            aw.priority,
            aw.prep_checklist_seed,
            aw.connected_module_suggestion,
            aw.is_approximate,
            aw.date_disclaimer_en,
            aw.date_disclaimer_hi,
            aw.display_order,
            aw.is_active,
            aw.created_at,
            aw.updated_at,
            aw.occurrence,
            EXTRACT(year FROM lower(aw.occurrence))::integer AS season_year
           FROM hotels h
             CROSS JOIN active_windows aw
          WHERE vaiyu_is_hotel_member(h.id)
        )
 SELECT j.hotel_id,
    j.hotel_slug,
    j.hotel_state,
    j.code AS window_code,
    j.category,
    j.display_name_en,
    j.display_name_hi,
    j.why_it_matters_en,
    j.why_it_matters_hi,
    j.recommended_action_en,
    j.recommended_action_hi,
    j.target_guest_segment_en,
    j.target_guest_segment_hi,
    j.suggested_package_idea_en,
    j.suggested_package_idea_hi,
    j.start_month,
    j.start_day,
    j.end_month,
    j.end_day,
    j.region_state_codes,
    j.priority,
    j.prep_checklist_seed,
    j.connected_module_suggestion,
    j.is_approximate,
    j.date_disclaimer_en,
    j.date_disclaimer_hi,
    j.display_order,
    j.season_year,
    lower(j.occurrence) AS next_start_ts,
    upper(j.occurrence) AS next_end_ts,
    GREATEST(0, (EXTRACT(epoch FROM lower(j.occurrence) - now()) / 86400::numeric)::integer) AS days_to_start,
        CASE
            WHEN cardinality(j.region_state_codes) = 0 THEN true
            WHEN j.hotel_state IS NULL OR btrim(j.hotel_state) = ''::text THEN true
            WHEN _seasonal_normalize_state(j.hotel_state) = ANY (j.region_state_codes) THEN true
            ELSE false
        END AS is_regional_match,
    s.id AS state_id,
    COALESCE(s.review_status, 'PLANNING'::seasonal_review_status) AS review_status,
    COALESCE(s.ticked_keys, '{}'::text[]) AS ticked_keys,
    s.owner_notes,
    s.internal_notes,
    s.urgency_override,
    s.urgency_override_reason,
    s.dismissed_reason,
    COALESCE(s.is_permanently_hidden, false) AS is_permanently_hidden,
    s.permanently_hidden_reason,
    s.marked_ready_at,
    s.marked_ready_by,
    COALESCE(s.urgency_override, _seasonal_window_urgency(lower(j.occurrence), upper(j.occurrence), now())) AS computed_urgency,
    COALESCE(jsonb_array_length(j.prep_checklist_seed), 0) AS checklist_total,
    COALESCE(( SELECT count(*)::integer AS count
           FROM jsonb_array_elements(j.prep_checklist_seed) item(value)
          WHERE (item.value ->> 'key'::text) = ANY (COALESCE(s.ticked_keys, '{}'::text[]))), 0) AS checklist_done,
    s.created_at AS state_created_at,
    s.updated_at AS state_updated_at,
    s.updated_by AS state_updated_by
   FROM joined j
     LEFT JOIN hotel_seasonal_window_states s ON s.hotel_id = j.hotel_id AND s.window_code = j.code AND s.season_year = j.season_year
) _s
WHERE public.vaiyu_can_view_hotel_analytics(_s.hotel_id);


DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['v_hotel_asset_status','v_hotel_gbp_readiness','v_hotel_kpis_today','v_hotel_ota_readiness','v_hotel_ota_readiness_summary','v_hotel_review_metrics','v_hotel_visibility_score','v_hotel_visible_assets','v_hotel_whatsapp_health','v_visibility_cron_health','v_visible_seasonal_windows']
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v);
  END LOOP;
END $$;
