-- Google Business Checklist v0 — Growth Hub module under Visibility Score
--
-- INTERNAL readiness checklist for owners to track Google Business Profile
-- readiness across 7 categories × 30 items. Feeds Visibility Score via a
-- single new signal `gbp_checklist_ready` (added in v3 migration).
--
-- This is NOT:
--   • A Google API integration (zero fetch calls)
--   • A scraping tool
--   • A ranking engine
--   • An AI feature
--   • A public-publishing surface
--
-- One table:
--   • gbp_checklist_attestations — per-hotel per-(net-new)-item attestation
--                                  row; for LINKED_VISIBILITY items, state is
--                                  sourced from hotel_visibility_attestations
--                                  (single source of truth, no dual-write).
--
-- Three enums:
--   • gbp_attestation_state — UNCLAIMED / SELF_ATTESTED / MANAGER_VERIFIED
--   • gbp_category          — 7 GBP-relevant categories
--   • gbp_item_kind         — SELF_ATTESTED / AUTO_DERIVED / LINKED_VISIBILITY
--
-- Catalog: 30 items via _gbp_catalog() SQL function (IMMUTABLE).
--   - 19 SELF_ATTESTED (stored in gbp_checklist_attestations)
--   - 2 AUTO_DERIVED (description, amenities — derived from hotels columns)
--   - 9 LINKED_VISIBILITY (state pulled from hotel_visibility_attestations
--     for SELF_ATTESTED Visibility signals; or derived for AUTO_DERIVED
--     Visibility signals — same rules as _compute_visibility_score)
--
-- Manager-verify expiry: 90 days (matches Visibility Score discipline).
-- Bridge to Visibility Score: _gbp_signal_for_visibility(p_hotel_id) returns
-- true when overall_score >= 70 (21+ of 30 items satisfied).
--
-- Per CLAUDE.md:
--   • Multi-tenancy: vaiyu_is_hotel_member RLS + RPC-level recheck
--   • Audit: writes go to va_audit_logs (entity='gbp_checklist_attestation')
--   • Writes via SECURITY DEFINER RPCs only — direct INSERT/UPDATE/DELETE revoked
--   • No phase 2, no deferred items

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.gbp_attestation_state AS ENUM (
    'UNCLAIMED',
    'SELF_ATTESTED',
    'MANAGER_VERIFIED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gbp_category AS ENUM (
    'BUSINESS_PROFILE',
    'LOCATION_ACCURACY',
    'CONTACT_READINESS',
    'CONTENT_READINESS',
    'TRUST_SIGNALS',
    'EXPERIENCE_READINESS',
    'VERIFICATION_READINESS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gbp_item_kind AS ENUM (
    'SELF_ATTESTED',
    'AUTO_DERIVED',
    'LINKED_VISIBILITY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Catalog (authoritative source for items + linkage) ─────────────────────
-- IMMUTABLE so it can be inlined by the planner. Returns one row per
-- GBP checklist item. TS mirror in web/src/config/gbpChecklist.ts; vitest
-- parity test asserts SQL ↔ TS catalog match.

CREATE OR REPLACE FUNCTION public._gbp_catalog()
RETURNS TABLE (
  catalog_version              int,
  item_key                     text,
  category                     public.gbp_category,
  kind                         public.gbp_item_kind,
  linked_visibility_signal_key text,
  display_order                int
)
LANGUAGE sql IMMUTABLE
AS $$
  WITH rows(item_key, category, kind, linked_visibility_signal_key, display_order) AS (
    VALUES
      -- ─── BUSINESS_PROFILE (4 items) ────────────────────────────────────
      ('profile_claimed',                'BUSINESS_PROFILE'::public.gbp_category, 'LINKED_VISIBILITY'::public.gbp_item_kind, 'gmb_claimed',       10),
      ('profile_verified',               'BUSINESS_PROFILE', 'LINKED_VISIBILITY', 'gmb_verified',         11),
      ('primary_category_set',           'BUSINESS_PROFILE', 'LINKED_VISIBILITY', 'gmb_category_set',     12),
      ('secondary_categories_set',       'BUSINESS_PROFILE', 'SELF_ATTESTED',     NULL,                   13),

      -- ─── LOCATION_ACCURACY (4 items) ───────────────────────────────────
      ('address_complete',               'LOCATION_ACCURACY', 'LINKED_VISIBILITY', 'address_complete',    20),
      ('address_matches_business',       'LOCATION_ACCURACY', 'SELF_ATTESTED',     NULL,                  21),
      ('map_pin_accurate',               'LOCATION_ACCURACY', 'LINKED_VISIBILITY', 'map_pin_set',         22),
      ('service_area_accurate',          'LOCATION_ACCURACY', 'SELF_ATTESTED',     NULL,                  23),

      -- ─── CONTACT_READINESS (4 items) ───────────────────────────────────
      ('phone_present',                  'CONTACT_READINESS', 'LINKED_VISIBILITY', 'phone_present',       30),
      ('whatsapp_visible_on_gbp',        'CONTACT_READINESS', 'SELF_ATTESTED',     NULL,                  31),
      ('website_visible_on_gbp',         'CONTACT_READINESS', 'SELF_ATTESTED',     NULL,                  32),
      ('enquiry_page_visible_on_gbp',    'CONTACT_READINESS', 'SELF_ATTESTED',     NULL,                  33),

      -- ─── CONTENT_READINESS (6 items) ───────────────────────────────────
      ('description_present',            'CONTENT_READINESS', 'AUTO_DERIVED',      NULL,                  40),
      ('exterior_photos_on_gbp',         'CONTENT_READINESS', 'SELF_ATTESTED',     NULL,                  41),
      ('room_photos_on_gbp',             'CONTENT_READINESS', 'SELF_ATTESTED',     NULL,                  42),
      ('bathroom_photos_on_gbp',         'CONTENT_READINESS', 'SELF_ATTESTED',     NULL,                  43),
      ('dining_photos_on_gbp',           'CONTENT_READINESS', 'SELF_ATTESTED',     NULL,                  44),
      ('common_area_photos_on_gbp',      'CONTENT_READINESS', 'SELF_ATTESTED',     NULL,                  45),

      -- ─── TRUST_SIGNALS (5 items) ───────────────────────────────────────
      ('review_link_available',          'TRUST_SIGNALS',     'LINKED_VISIBILITY', 'review_link_set',     50),
      ('review_process_defined',         'TRUST_SIGNALS',     'SELF_ATTESTED',     NULL,                  51),
      ('review_response_discipline',     'TRUST_SIGNALS',     'LINKED_VISIBILITY', 'off_platform_response', 52),
      ('policies_visible_on_gbp',        'TRUST_SIGNALS',     'SELF_ATTESTED',     NULL,                  53),
      ('amenities_visible_on_gbp',       'TRUST_SIGNALS',     'AUTO_DERIVED',      NULL,                  54),

      -- ─── EXPERIENCE_READINESS (3 items) ────────────────────────────────
      ('packages_available',             'EXPERIENCE_READINESS', 'LINKED_VISIBILITY', 'package_live',     60),
      ('local_attractions_listed',       'EXPERIENCE_READINESS', 'SELF_ATTESTED',     NULL,               61),
      ('seasonal_experiences_documented','EXPERIENCE_READINESS', 'SELF_ATTESTED',     NULL,               62),

      -- ─── VERIFICATION_READINESS (4 items) ──────────────────────────────
      ('signboard_photo_ready',          'VERIFICATION_READINESS', 'SELF_ATTESTED', NULL,                 70),
      ('business_proof_ready',           'VERIFICATION_READINESS', 'SELF_ATTESTED', NULL,                 71),
      ('invoice_template_ready',         'VERIFICATION_READINESS', 'SELF_ATTESTED', NULL,                 72),
      ('letterhead_ready',               'VERIFICATION_READINESS', 'SELF_ATTESTED', NULL,                 73)
  )
  SELECT 1::int AS catalog_version, * FROM rows;
$$;
COMMENT ON FUNCTION public._gbp_catalog() IS
  'Authoritative GBP Checklist catalog. 30 items across 7 categories. LINKED_VISIBILITY items reference an existing Visibility signal_key (single source of truth — state is read from hotel_visibility_attestations or derived per the Visibility rule). SELF_ATTESTED items are stored in gbp_checklist_attestations. AUTO_DERIVED items evaluate per-item rules at read time. TS mirror in web/src/config/gbpChecklist.ts + vitest parity test enforces no silent drift.';

-- ─── Helper: catalog item existence check ───────────────────────────────────

CREATE OR REPLACE FUNCTION public._gbp_catalog_has_item(p_item_key text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public._gbp_catalog() c WHERE c.item_key = p_item_key);
$$;
COMMENT ON FUNCTION public._gbp_catalog_has_item(text) IS
  'Returns true iff item_key is in the current catalog. Called by every state-write RPC to reject orphaned writes since we do not have a catalog table to FK against.';

-- ─── Helper: kind of an item (used by RPCs to reject mutations to AUTO_DERIVED/LINKED_VISIBILITY)

CREATE OR REPLACE FUNCTION public._gbp_catalog_item_kind(p_item_key text)
RETURNS public.gbp_item_kind
LANGUAGE sql STABLE
AS $$
  SELECT c.kind FROM public._gbp_catalog() c WHERE c.item_key = p_item_key;
$$;
COMMENT ON FUNCTION public._gbp_catalog_item_kind(text) IS
  'Returns the kind of a catalog item. RPCs reject writes for AUTO_DERIVED and LINKED_VISIBILITY items — those are read-only in the GBP module.';

-- ─── Table: gbp_checklist_attestations ──────────────────────────────────────
-- Per-hotel per-SELF_ATTESTED-item row. Same shape as
-- hotel_visibility_attestations for ergonomic parity (mirrors states, manager
-- bookkeeping, 90-day expiry).

CREATE TABLE IF NOT EXISTS public.gbp_checklist_attestations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                    uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,

  item_key                    text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 64),
  attestation_schema_version  int  NOT NULL DEFAULT 1 CHECK (attestation_schema_version >= 1),

  state                       public.gbp_attestation_state NOT NULL DEFAULT 'UNCLAIMED',

  evidence_url                text CHECK (evidence_url IS NULL OR length(evidence_url) <= 2048),

  attested_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attested_at                 timestamptz,

  manager_verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_verified_at         timestamptz,
  manager_note                text CHECK (manager_note IS NULL OR length(manager_note) <= 1000),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gbp_checklist_attestations_uq UNIQUE (hotel_id, item_key),

  CONSTRAINT gbp_attestation_state_consistent CHECK (
    CASE state
      WHEN 'UNCLAIMED'        THEN attested_at IS NULL AND manager_verified_at IS NULL
      WHEN 'SELF_ATTESTED'    THEN attested_at IS NOT NULL
      WHEN 'MANAGER_VERIFIED' THEN attested_at IS NOT NULL
                                AND manager_verified_at IS NOT NULL
                                AND manager_verified_by IS NOT NULL
    END
  )
);
COMMENT ON TABLE public.gbp_checklist_attestations IS
  'Per-hotel per-SELF_ATTESTED-item attestation row for the GBP Checklist. Only items where _gbp_catalog().kind = SELF_ATTESTED have rows here. LINKED_VISIBILITY items source their state from hotel_visibility_attestations. AUTO_DERIVED items are evaluated at read time.';

CREATE INDEX IF NOT EXISTS idx_gbp_attestations_hotel
  ON public.gbp_checklist_attestations(hotel_id);
CREATE INDEX IF NOT EXISTS idx_gbp_attestations_state
  ON public.gbp_checklist_attestations(hotel_id, state);

DROP TRIGGER IF EXISTS trg_gbp_attestations_updated_at
  ON public.gbp_checklist_attestations;
CREATE TRIGGER trg_gbp_attestations_updated_at
  BEFORE UPDATE ON public.gbp_checklist_attestations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── View: v_hotel_gbp_readiness (per-hotel overall) ────────────────────────
-- Computes per-hotel overall readiness across all 30 items. Aggregates four
-- sources: SELF_ATTESTED net-new (gbp_checklist_attestations), LINKED_VISIBILITY
-- with SELF_ATTESTED-kind Visibility signal (hotel_visibility_attestations),
-- LINKED_VISIBILITY with AUTO_DERIVED-kind Visibility signal (hotels columns),
-- and AUTO_DERIVED net-new (hotels.description, hotels.amenities).
--
-- Defense-in-depth: WHERE vaiyu_is_hotel_member(h.id) explicitly enforced.

DROP VIEW IF EXISTS public.v_hotel_gbp_readiness CASCADE;
CREATE VIEW public.v_hotel_gbp_readiness WITH (security_invoker = on) AS
WITH member_hotels AS (
  SELECT h.id AS hotel_id, h.slug, h.name,
         h.address, h.city, h.state, h.country, h.postal_code,
         h.latitude, h.longitude, h.phone, h.review_policy_url,
         h.description, h.amenities
  FROM public.hotels h
  WHERE public.vaiyu_is_hotel_member(h.id)
),
self_attested_net_new AS (
  -- Net-new SELF_ATTESTED items (19) — read from gbp_checklist_attestations
  SELECT mh.hotel_id, c.item_key,
         CASE
           WHEN ga.state = 'MANAGER_VERIFIED'
             AND ga.manager_verified_at >= now() - INTERVAL '90 days' THEN true
           WHEN ga.state = 'MANAGER_VERIFIED' THEN false  -- expired
           WHEN ga.state = 'SELF_ATTESTED' THEN true
           ELSE false
         END AS satisfied,
         COALESCE(ga.manager_verified_at, ga.attested_at) AS most_recent_at
    FROM member_hotels mh
    CROSS JOIN public._gbp_catalog() c
    LEFT JOIN public.gbp_checklist_attestations ga
      ON ga.hotel_id = mh.hotel_id AND ga.item_key = c.item_key
   WHERE c.kind = 'SELF_ATTESTED'
),
linked_self_attested AS (
  -- LINKED_VISIBILITY items where the linked Visibility signal is SELF_ATTESTED-kind.
  -- The 4 signals: gmb_claimed, gmb_verified, gmb_category_set, off_platform_response.
  SELECT mh.hotel_id, c.item_key,
         CASE
           WHEN va.state = 'MANAGER_VERIFIED'
             AND va.manager_verified_at >= now() - INTERVAL '90 days' THEN true
           WHEN va.state = 'MANAGER_VERIFIED' THEN false  -- expired
           WHEN va.state = 'SELF_ATTESTED' THEN true
           ELSE false
         END AS satisfied,
         COALESCE(va.manager_verified_at, va.attested_at) AS most_recent_at
    FROM member_hotels mh
    CROSS JOIN public._gbp_catalog() c
    LEFT JOIN public.hotel_visibility_attestations va
      ON va.hotel_id = mh.hotel_id AND va.signal_key = c.linked_visibility_signal_key
   WHERE c.kind = 'LINKED_VISIBILITY'
     AND c.linked_visibility_signal_key IN ('gmb_claimed','gmb_verified','gmb_category_set','off_platform_response')
),
linked_auto_derived AS (
  -- LINKED_VISIBILITY items where the linked Visibility signal is AUTO_DERIVED.
  -- 5 signals: address_complete, map_pin_set, phone_present, review_link_set, package_live.
  -- We re-evaluate the same rule the Visibility compute uses.
  SELECT mh.hotel_id, c.item_key,
         CASE c.linked_visibility_signal_key
           WHEN 'address_complete' THEN
             (COALESCE(length(btrim(mh.address)), 0) > 0
              AND COALESCE(length(btrim(mh.city)), 0) > 0
              AND COALESCE(length(btrim(mh.state)), 0) > 0
              AND COALESCE(length(btrim(mh.country)), 0) > 0
              AND COALESCE(length(btrim(mh.postal_code)), 0) > 0)
           WHEN 'map_pin_set' THEN
             (mh.latitude IS NOT NULL AND mh.longitude IS NOT NULL)
           WHEN 'phone_present' THEN
             COALESCE(length(btrim(mh.phone)), 0) > 0
           WHEN 'review_link_set' THEN
             COALESCE(length(btrim(mh.review_policy_url)), 0) > 0
           WHEN 'package_live' THEN
             EXISTS (SELECT 1 FROM public.packages p
                      WHERE p.hotel_id = mh.hotel_id
                        AND p.status = 'ACTIVE'
                        AND p.deleted_at IS NULL)
           ELSE false
         END AS satisfied,
         now() AS most_recent_at  -- AUTO_DERIVED has no manual stamp; assume fresh
    FROM member_hotels mh
    CROSS JOIN public._gbp_catalog() c
   WHERE c.kind = 'LINKED_VISIBILITY'
     AND c.linked_visibility_signal_key IN ('address_complete','map_pin_set','phone_present','review_link_set','package_live')
),
auto_derived_net_new AS (
  -- AUTO_DERIVED net-new items (2): description_present, amenities_visible_on_gbp
  SELECT mh.hotel_id, c.item_key,
         CASE c.item_key
           WHEN 'description_present' THEN
             COALESCE(length(btrim(mh.description)), 0) >= 30  -- ≥30 chars (avoids one-word descriptions)
           WHEN 'amenities_visible_on_gbp' THEN
             COALESCE(array_length(mh.amenities, 1), 0) >= 3
           ELSE false
         END AS satisfied,
         now() AS most_recent_at
    FROM member_hotels mh
    CROSS JOIN public._gbp_catalog() c
   WHERE c.kind = 'AUTO_DERIVED'
),
all_items AS (
  SELECT * FROM self_attested_net_new
  UNION ALL SELECT * FROM linked_self_attested
  UNION ALL SELECT * FROM linked_auto_derived
  UNION ALL SELECT * FROM auto_derived_net_new
)
SELECT
  ai.hotel_id,
  (SELECT slug FROM member_hotels WHERE hotel_id = ai.hotel_id) AS hotel_slug,
  (SELECT name FROM member_hotels WHERE hotel_id = ai.hotel_id) AS hotel_name,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE ai.satisfied) AS satisfied_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ai.satisfied) / NULLIF(COUNT(*), 0), 1) AS overall_score,
  MAX(ai.most_recent_at) AS most_recent_attestation_at,
  COUNT(*) FILTER (WHERE ai.satisfied) >= CEIL(COUNT(*) * 0.70) AS meets_ready_threshold
FROM all_items ai
GROUP BY ai.hotel_id;
COMMENT ON VIEW public.v_hotel_gbp_readiness IS
  'Per-hotel GBP Checklist readiness summary. meets_ready_threshold = true when ≥70% of 30 items are satisfied. Used by the bridge function _gbp_signal_for_visibility to feed Visibility Score.';

-- ─── Bridge: _gbp_signal_for_visibility(hotel_id) ───────────────────────────
-- Called by _compute_visibility_score (in v3 migration). Returns true when
-- the hotel's GBP readiness meets the ≥70% threshold. SECURITY DEFINER so
-- it works inside Visibility's SECURITY DEFINER context.

CREATE OR REPLACE FUNCTION public._gbp_signal_for_visibility(p_hotel_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_satisfied int;
  v_total     int;
BEGIN
  -- Inline the same satisfaction logic as v_hotel_gbp_readiness but
  -- single-hotel and without the membership filter (caller is Visibility
  -- compute which has already gated by hotel_id).
  WITH all_items AS (
    -- SELF_ATTESTED net-new
    SELECT
      CASE
        WHEN ga.state = 'MANAGER_VERIFIED'
          AND ga.manager_verified_at >= now() - INTERVAL '90 days' THEN true
        WHEN ga.state = 'MANAGER_VERIFIED' THEN false
        WHEN ga.state = 'SELF_ATTESTED' THEN true
        ELSE false
      END AS satisfied
    FROM public._gbp_catalog() c
    LEFT JOIN public.gbp_checklist_attestations ga
      ON ga.hotel_id = p_hotel_id AND ga.item_key = c.item_key
    WHERE c.kind = 'SELF_ATTESTED'

    UNION ALL

    -- LINKED_VISIBILITY SELF_ATTESTED-kind
    SELECT
      CASE
        WHEN va.state = 'MANAGER_VERIFIED'
          AND va.manager_verified_at >= now() - INTERVAL '90 days' THEN true
        WHEN va.state = 'MANAGER_VERIFIED' THEN false
        WHEN va.state = 'SELF_ATTESTED' THEN true
        ELSE false
      END AS satisfied
    FROM public._gbp_catalog() c
    LEFT JOIN public.hotel_visibility_attestations va
      ON va.hotel_id = p_hotel_id AND va.signal_key = c.linked_visibility_signal_key
    WHERE c.kind = 'LINKED_VISIBILITY'
      AND c.linked_visibility_signal_key IN ('gmb_claimed','gmb_verified','gmb_category_set','off_platform_response')

    UNION ALL

    -- LINKED_VISIBILITY AUTO_DERIVED-kind
    SELECT
      CASE c.linked_visibility_signal_key
        WHEN 'address_complete' THEN
          (COALESCE(length(btrim(h.address)), 0) > 0
           AND COALESCE(length(btrim(h.city)), 0) > 0
           AND COALESCE(length(btrim(h.state)), 0) > 0
           AND COALESCE(length(btrim(h.country)), 0) > 0
           AND COALESCE(length(btrim(h.postal_code)), 0) > 0)
        WHEN 'map_pin_set' THEN
          (h.latitude IS NOT NULL AND h.longitude IS NOT NULL)
        WHEN 'phone_present' THEN
          COALESCE(length(btrim(h.phone)), 0) > 0
        WHEN 'review_link_set' THEN
          COALESCE(length(btrim(h.review_policy_url)), 0) > 0
        WHEN 'package_live' THEN
          EXISTS (SELECT 1 FROM public.packages p
                   WHERE p.hotel_id = p_hotel_id
                     AND p.status = 'ACTIVE'
                     AND p.deleted_at IS NULL)
        ELSE false
      END AS satisfied
    FROM public._gbp_catalog() c
    CROSS JOIN public.hotels h
    WHERE h.id = p_hotel_id
      AND c.kind = 'LINKED_VISIBILITY'
      AND c.linked_visibility_signal_key IN ('address_complete','map_pin_set','phone_present','review_link_set','package_live')

    UNION ALL

    -- AUTO_DERIVED net-new
    SELECT
      CASE c.item_key
        WHEN 'description_present' THEN
          COALESCE(length(btrim(h.description)), 0) >= 30
        WHEN 'amenities_visible_on_gbp' THEN
          COALESCE(array_length(h.amenities, 1), 0) >= 3
        ELSE false
      END AS satisfied
    FROM public._gbp_catalog() c
    CROSS JOIN public.hotels h
    WHERE h.id = p_hotel_id
      AND c.kind = 'AUTO_DERIVED'
  )
  SELECT COUNT(*) FILTER (WHERE satisfied), COUNT(*)
    INTO v_satisfied, v_total
    FROM all_items;

  IF v_total = 0 THEN RETURN false; END IF;
  RETURN v_satisfied >= CEIL(v_total * 0.70);
END;
$$;
COMMENT ON FUNCTION public._gbp_signal_for_visibility(uuid) IS
  'Bridge for Visibility Score signal gbp_checklist_ready. Returns true when the hotel''s GBP Checklist satisfies ≥70% of 30 items. SECURITY DEFINER because called from _compute_visibility_score with the caller''s RLS context — does not cross-tenant leak (filter is by p_hotel_id only).';

-- ─── RPC: set_gbp_attestation (any member) ──────────────────────────────────
-- Owner self-attest path. Allowed transitions: UNCLAIMED ⇄ SELF_ATTESTED.
-- Manager verification uses a separate RPC. Only SELF_ATTESTED-kind catalog
-- items can be set here (AUTO_DERIVED and LINKED_VISIBILITY are read-only).

CREATE OR REPLACE FUNCTION public.set_gbp_attestation(
  p_hotel_id     uuid,
  p_item_key     text,
  p_state        text,
  p_evidence_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_new_state public.gbp_attestation_state;
  v_kind      public.gbp_item_kind;
  v_id        uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  BEGIN
    v_new_state := p_state::public.gbp_attestation_state;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END;

  IF v_new_state = 'MANAGER_VERIFIED' THEN
    RAISE EXCEPTION 'USE_MANAGER_VERIFY_RPC';
  END IF;

  IF length(p_item_key) = 0 OR length(p_item_key) > 64 THEN
    RAISE EXCEPTION 'INVALID_ITEM_KEY';
  END IF;

  IF NOT public._gbp_catalog_has_item(p_item_key) THEN
    RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
  END IF;

  v_kind := public._gbp_catalog_item_kind(p_item_key);
  IF v_kind <> 'SELF_ATTESTED' THEN
    RAISE EXCEPTION 'ITEM_NOT_SELF_ATTESTABLE';
  END IF;

  IF p_evidence_url IS NOT NULL AND length(p_evidence_url) > 2048 THEN
    RAISE EXCEPTION 'EVIDENCE_URL_TOO_LONG';
  END IF;

  IF v_new_state = 'UNCLAIMED' THEN
    INSERT INTO public.gbp_checklist_attestations(
      hotel_id, item_key, state, evidence_url,
      attested_by, attested_at, manager_verified_by, manager_verified_at, manager_note
    ) VALUES (
      p_hotel_id, p_item_key, 'UNCLAIMED', NULL,
      NULL, NULL, NULL, NULL, NULL
    )
    ON CONFLICT (hotel_id, item_key) DO UPDATE SET
      state               = 'UNCLAIMED',
      evidence_url        = NULL,
      attested_by         = NULL,
      attested_at         = NULL,
      manager_verified_by = NULL,
      manager_verified_at = NULL,
      manager_note        = NULL
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.gbp_checklist_attestations(
      hotel_id, item_key, state, evidence_url, attested_by, attested_at
    ) VALUES (
      p_hotel_id, p_item_key, 'SELF_ATTESTED', NULLIF(btrim(p_evidence_url), ''),
      auth.uid(), now()
    )
    ON CONFLICT (hotel_id, item_key) DO UPDATE SET
      state               = 'SELF_ATTESTED',
      evidence_url        = NULLIF(btrim(EXCLUDED.evidence_url), ''),
      attested_by         = auth.uid(),
      attested_at         = now(),
      -- Re-attest by owner clears any prior manager verification
      manager_verified_by = NULL,
      manager_verified_at = NULL,
      manager_note        = NULL
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'gbp_attestation_set',
    COALESCE(auth.uid()::text, 'system'),
    p_hotel_id,
    'gbp_checklist_attestation',
    v_id,
    jsonb_build_object(
      'item_key', p_item_key,
      'new_state', v_new_state,
      'evidence_url_present', p_evidence_url IS NOT NULL AND length(btrim(p_evidence_url)) > 0
    )
  );

  RETURN jsonb_build_object('id', v_id, 'state', v_new_state::text);
END;
$$;
COMMENT ON FUNCTION public.set_gbp_attestation(uuid, text, text, text) IS
  'Owner-callable attestation setter for SELF_ATTESTED items. Allowed transitions: UNCLAIMED ⇄ SELF_ATTESTED. Re-attestation clears prior manager verification. Rejects writes to AUTO_DERIVED and LINKED_VISIBILITY items.';

-- ─── RPC: manager_verify_gbp_attestation ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.manager_verify_gbp_attestation(
  p_hotel_id  uuid,
  p_item_key  text,
  p_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.gbp_checklist_attestations;
  v_kind     public.gbp_item_kind;
  v_id       uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MANAGER';
  END IF;

  IF NOT public._gbp_catalog_has_item(p_item_key) THEN
    RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
  END IF;

  v_kind := public._gbp_catalog_item_kind(p_item_key);
  IF v_kind <> 'SELF_ATTESTED' THEN
    RAISE EXCEPTION 'ITEM_NOT_SELF_ATTESTABLE';
  END IF;

  IF p_note IS NOT NULL AND length(p_note) > 1000 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  SELECT * INTO v_existing
    FROM public.gbp_checklist_attestations
   WHERE hotel_id = p_hotel_id AND item_key = p_item_key
   FOR UPDATE;

  IF NOT FOUND OR v_existing.state = 'UNCLAIMED' THEN
    RAISE EXCEPTION 'NOTHING_TO_VERIFY';
  END IF;

  UPDATE public.gbp_checklist_attestations
     SET state               = 'MANAGER_VERIFIED',
         manager_verified_by = auth.uid(),
         manager_verified_at = now(),
         manager_note        = NULLIF(btrim(p_note), '')
   WHERE hotel_id = p_hotel_id AND item_key = p_item_key
  RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'gbp_attestation_verified',
    auth.uid()::text,
    p_hotel_id,
    'gbp_checklist_attestation',
    v_id,
    jsonb_build_object('item_key', p_item_key, 'note_present', p_note IS NOT NULL AND length(btrim(p_note)) > 0)
  );

  RETURN jsonb_build_object('id', v_id, 'state', 'MANAGER_VERIFIED');
END;
$$;
COMMENT ON FUNCTION public.manager_verify_gbp_attestation(uuid, text, text) IS
  'Manager-callable. Promotes SELF_ATTESTED to MANAGER_VERIFIED. Requires the item to be SELF_ATTESTED first (NOTHING_TO_VERIFY otherwise).';

-- ─── RPC: manager_unverify_gbp_attestation ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.manager_unverify_gbp_attestation(
  p_hotel_id uuid,
  p_item_key text,
  p_reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing public.gbp_checklist_attestations;
  v_kind     public.gbp_item_kind;
  v_is_admin boolean;
  v_id       uuid;
BEGIN
  IF NOT public.vaiyu_is_hotel_finance_manager(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_A_MANAGER';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  IF length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'REASON_TOO_LONG';
  END IF;

  IF NOT public._gbp_catalog_has_item(p_item_key) THEN
    RAISE EXCEPTION 'ITEM_KEY_NOT_IN_CATALOG';
  END IF;

  v_kind := public._gbp_catalog_item_kind(p_item_key);
  IF v_kind <> 'SELF_ATTESTED' THEN
    RAISE EXCEPTION 'ITEM_NOT_SELF_ATTESTABLE';
  END IF;

  SELECT * INTO v_existing
    FROM public.gbp_checklist_attestations
   WHERE hotel_id = p_hotel_id AND item_key = p_item_key
   FOR UPDATE;

  IF NOT FOUND OR v_existing.state <> 'MANAGER_VERIFIED' THEN
    RAISE EXCEPTION 'NOTHING_TO_UNVERIFY';
  END IF;

  -- Only the verifying manager OR platform_admin can unverify
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  ) INTO v_is_admin;

  IF v_existing.manager_verified_by IS NOT NULL
    AND v_existing.manager_verified_by <> auth.uid()
    AND NOT v_is_admin THEN
    RAISE EXCEPTION 'ATTESTATION_LOCKED';
  END IF;

  UPDATE public.gbp_checklist_attestations
     SET state               = 'SELF_ATTESTED',
         manager_verified_by = NULL,
         manager_verified_at = NULL,
         manager_note        = NULL
   WHERE hotel_id = p_hotel_id AND item_key = p_item_key
  RETURNING id INTO v_id;

  INSERT INTO public.va_audit_logs(action, actor, hotel_id, entity, entity_id, meta)
  VALUES (
    'gbp_attestation_unverified',
    auth.uid()::text,
    p_hotel_id,
    'gbp_checklist_attestation',
    v_id,
    jsonb_build_object('item_key', p_item_key, 'reason', p_reason)
  );

  RETURN jsonb_build_object('id', v_id, 'state', 'SELF_ATTESTED');
END;
$$;
COMMENT ON FUNCTION public.manager_unverify_gbp_attestation(uuid, text, text) IS
  'Manager-callable. Demotes MANAGER_VERIFIED back to SELF_ATTESTED. Only the verifying manager OR platform_admin can unverify (ATTESTATION_LOCKED for others). Reason is required.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.gbp_checklist_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gbp_attestations_select_members ON public.gbp_checklist_attestations;
CREATE POLICY gbp_attestations_select_members
  ON public.gbp_checklist_attestations
  FOR SELECT
  TO authenticated
  USING (public.vaiyu_is_hotel_member(hotel_id));

REVOKE INSERT, UPDATE, DELETE ON public.gbp_checklist_attestations FROM authenticated;

-- ─── Grants ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public._gbp_catalog()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public._gbp_catalog_has_item(text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public._gbp_catalog_item_kind(text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public._gbp_signal_for_visibility(uuid)            TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_gbp_attestation(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_verify_gbp_attestation(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_unverify_gbp_attestation(uuid, text, text) TO authenticated;

GRANT SELECT ON public.v_hotel_gbp_readiness TO authenticated;

-- ─── End of GBP Checklist v0 migration ──────────────────────────────────────
