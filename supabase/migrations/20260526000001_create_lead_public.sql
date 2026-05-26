-- Public lead capture RPC (Day 11)
--
-- Lets anonymous (anon role) requests create a lead for a hotel's website
-- enquiry form. Unlike create_lead, this RPC has no auth.uid() membership
-- check — it runs as SECURITY DEFINER, accepts only public-friendly sources,
-- and validates the hotel exists.
--
-- Soft duplicate detection mirrors internal create_lead — returns
-- `possible_duplicate: true` when a similar lead exists in the last 30 days,
-- but does NOT block creation. Operators see the flag in the lead list.
--
-- Error codes intentionally generic for the public surface:
--   INVALID_REQUEST  — unknown hotel, bad source, malformed input (avoid
--                      leaking which hotel UUIDs exist via probing)
--   INVALID_NAME / INVALID_CONTACT / INVALID_DATES / INVALID_PARTY — same
--                      validation codes as create_lead, but the Edge Function
--                      wrapper maps them to user-friendly text before
--                      returning to the public client.

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
  p_notes           text DEFAULT NULL
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
BEGIN
  -- Constrain to public-friendly sources. Internal sources require the
  -- authenticated create_lead path.
  IF p_source NOT IN ('WEBSITE', 'OTHER') THEN
    RAISE EXCEPTION 'INVALID_REQUEST'
      USING DETAIL = 'source_not_allowed';
  END IF;

  -- Verify hotel exists. Use generic error to avoid UUID-probing leak.
  IF NOT EXISTS (SELECT 1 FROM public.hotels WHERE id = p_hotel_id) THEN
    RAISE EXCEPTION 'INVALID_REQUEST'
      USING DETAIL = 'hotel_unknown';
  END IF;

  -- Per-row validations — same as create_lead (user-friendly codes).
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

  INSERT INTO public.leads (
    hotel_id, source,
    contact_name, contact_phone, contact_phone_normalized, contact_email,
    requested_check_in, requested_check_out,
    party_adults, party_children, room_count,
    latest_note_preview,
    created_by  -- NULL since anonymous
  ) VALUES (
    p_hotel_id, p_source,
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

  -- Soft duplicate detection — mirrors internal create_lead. Non-blocking;
  -- operators see the flag and decide whether to merge / dedupe.
  IF v_phone_norm IS NOT NULL THEN
    SELECT id, status, created_at
      INTO v_dup_lead
      FROM public.leads
     WHERE hotel_id = p_hotel_id
       AND contact_phone_normalized = v_phone_norm
       AND id <> v_lead_id
       AND deleted_at IS NULL
       AND created_at > now() - interval '30 days'
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'possible_duplicate', v_dup_lead.id IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lead_public TO anon, authenticated;

COMMENT ON FUNCTION public.create_lead_public IS
  'Day 11: public-form lead capture. SECURITY DEFINER, anon-callable. Source constrained to WEBSITE/OTHER. Generic INVALID_REQUEST to avoid hotel UUID probing leak. Soft duplicate detection via possible_duplicate flag.';
