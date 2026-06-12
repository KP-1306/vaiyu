-- get_guest_id_proof_for_checkin: also return the document's verification status.
--
-- The arrivals Guest Details drawer wants to show staff whether a guest's ID is
-- Verified / Pending / Rejected. verification_status is an operational flag, not
-- PII — it is NOT the hash, the raw number, or an image path — so surfacing it
-- does not weaken the 20260612000003 hardening. Purely ADDITIVE: every existing
-- key (type, number, storage_key, front_image, back_image) is preserved with the
-- same values, so the walk-in reuse path (WalkInPayment) is unaffected. The
-- authorization gate, audit log, and no-churn NULL image rule are unchanged.

CREATE OR REPLACE FUNCTION public.get_guest_id_proof_for_checkin(
  p_guest_id uuid,
  p_hotel_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_doc    record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_guest_id IS NULL OR p_hotel_id IS NULL THEN
    RAISE EXCEPTION 'guest_id and hotel_id are required' USING ERRCODE = '22023';
  END IF;

  -- Authorize: caller must be active staff at the requesting hotel.
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_members hm
    WHERE hm.user_id  = v_caller
      AND hm.hotel_id = p_hotel_id
      AND hm.is_active = true
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Latest active doc for this (global, mobile-keyed) guest.
  SELECT document_type, document_number_masked, storage_key, verification_status
    INTO v_doc
  FROM public.guest_id_documents
  WHERE guest_id = p_guest_id
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Best-effort PII-access audit; never block the read on a logging failure.
  BEGIN
    INSERT INTO public.va_audit_logs (action, actor, hotel_id, entity, entity_id, meta)
    VALUES (
      'guest_id.metadata_view',
      v_caller::text,
      p_hotel_id,
      'guest',
      p_guest_id,
      jsonb_build_object(
        'document_type', v_doc.document_type::text,
        'context',       'walkin_checkin'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Surface only the minimum needed. No hash, no raw image paths.
  -- verification_status added (operational flag, not PII). front_image/back_image
  -- deliberately NULL (no-churn reuse — see 20260612000003 header).
  RETURN jsonb_build_object(
    'type',         v_doc.document_type::text,
    'number',       v_doc.document_number_masked,
    'storage_key',  v_doc.storage_key,
    'verification', v_doc.verification_status::text,
    'front_image',  NULL,
    'back_image',   NULL
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.get_guest_id_proof_for_checkin(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_guest_id_proof_for_checkin(uuid, uuid) TO authenticated;
