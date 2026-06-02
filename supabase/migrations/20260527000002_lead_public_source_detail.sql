-- supabase/migrations/20260527000002_lead_public_source_detail.sql
--
-- Add `p_source_detail` argument to `create_lead_public` so the public form
-- (and other anon entry points) can attribute the lead to a specific
-- referrer — most importantly an Experience Package landing page.
--
-- The argument is optional; existing callers continue to work unchanged.
-- We DROP the old signature explicitly because PG does not let CREATE OR
-- REPLACE change the argument list.

DROP FUNCTION IF EXISTS public.create_lead_public(
  uuid, public.lead_source, text, text, text, date, date, integer, integer, integer, text
);

CREATE OR REPLACE FUNCTION public.create_lead_public(
  p_hotel_id        uuid,
  p_source          public.lead_source,
  p_contact_name    text,
  p_contact_phone   text DEFAULT NULL,
  p_contact_email   text DEFAULT NULL,
  p_check_in        date DEFAULT NULL,
  p_check_out       date DEFAULT NULL,
  p_party_adults    integer DEFAULT 1,
  p_party_children  integer DEFAULT 0,
  p_room_count      integer DEFAULT 1,
  p_notes           text DEFAULT NULL,
  p_source_detail   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead_id    uuid;
  v_phone_norm text;
  v_dup_lead   record;
  v_clean_detail text;
BEGIN
  IF p_source NOT IN ('WEBSITE', 'OTHER') THEN
    RAISE EXCEPTION 'INVALID_REQUEST'
      USING DETAIL = 'source_not_allowed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.hotels WHERE id = p_hotel_id) THEN
    RAISE EXCEPTION 'INVALID_REQUEST'
      USING DETAIL = 'hotel_unknown';
  END IF;

  IF p_contact_name IS NULL OR btrim(p_contact_name) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_contact_phone IS NULL AND p_contact_email IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONTACT';
  END IF;
  IF p_check_in IS NOT NULL AND p_check_out IS NOT NULL AND p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'INVALID_DATES';
  END IF;
  IF p_party_adults < 0 OR p_party_children < 0 OR p_room_count < 1 THEN
    RAISE EXCEPTION 'INVALID_PARTY';
  END IF;

  v_phone_norm := public._normalize_phone(p_contact_phone);

  -- Sanitise source_detail: max 200 chars; empty → NULL
  v_clean_detail := NULLIF(LEFT(btrim(COALESCE(p_source_detail, '')), 200), '');

  INSERT INTO public.leads (
    hotel_id, source, source_detail,
    contact_name, contact_phone, contact_phone_normalized, contact_email,
    requested_check_in, requested_check_out,
    party_adults, party_children, room_count,
    latest_note_preview,
    created_by
  ) VALUES (
    p_hotel_id, p_source, v_clean_detail,
    btrim(p_contact_name), p_contact_phone, v_phone_norm, p_contact_email,
    p_check_in, p_check_out,
    p_party_adults, p_party_children, p_room_count,
    LEFT(p_notes, 200),
    NULL
  )
  RETURNING id INTO v_lead_id;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    v_lead_id, p_hotel_id, 'CREATED',
    jsonb_build_object(
      'source', p_source::text,
      'source_detail', v_clean_detail,
      'actor_role', 'PUBLIC',
      'by_user_name', 'public form',
      'has_phone', p_contact_phone IS NOT NULL,
      'has_email', p_contact_email IS NOT NULL
    ),
    NULL
  );

  IF p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      v_lead_id, p_hotel_id, 'NOTE_ADDED',
      jsonb_build_object('text', p_notes, 'by_user_name', 'public form'),
      NULL
    );
  END IF;

  -- Duplicate detection (mirrors create_lead semantics)
  SELECT id, status, EXTRACT(DAY FROM (now() - created_at))::integer AS days_ago
  INTO v_dup_lead
  FROM public.leads
  WHERE hotel_id = p_hotel_id
    AND id <> v_lead_id
    AND deleted_at IS NULL
    AND (
      (contact_phone_normalized IS NOT NULL AND contact_phone_normalized = v_phone_norm)
      OR (contact_email IS NOT NULL AND lower(contact_email) = lower(COALESCE(p_contact_email, '')))
    )
    AND created_at > now() - interval '7 days'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'possible_duplicate', v_dup_lead.id IS NOT NULL,
    'duplicate_warning', CASE
      WHEN v_dup_lead.id IS NOT NULL THEN
        jsonb_build_object(
          'recent_lead_id', v_dup_lead.id,
          'recent_status', v_dup_lead.status,
          'days_ago', v_dup_lead.days_ago
        )
      ELSE NULL
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lead_public(
  uuid, public.lead_source, text, text, text, date, date, integer, integer, integer, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.create_lead_public(
  uuid, public.lead_source, text, text, text, date, date, integer, integer, integer, text, text
) IS 'Public lead-capture RPC with optional source_detail attribution (e.g. Package: Honeymoon Escape).';
