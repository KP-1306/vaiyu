-- guest_id_documents — Phase 2 hardening: gate metadata reads behind a
-- SECURITY DEFINER RPC and remove ALL direct client SELECT.
--
-- Builds on 20260612000002 (which closed the USING(true) leak). After that fix,
-- WalkInPayment still did a direct `select('*')` on the table — which hands the
-- staff browser the full row, including `document_number_hash` (a SHA-256 of a
-- 12-digit Aadhaar — brute-forceable offline → recovers the FULL number), plus
-- raw storage paths and verification internals. There is no plaintext number
-- column (only document_number_masked + the hash), so the hash is the real
-- exposure.
--
-- This migration:
--   1. Adds get_guest_id_proof_for_checkin(p_guest_id, p_hotel_id): SECURITY
--      DEFINER, returns ONLY the masked number + type + storage_key (never the
--      hash, raw image paths, or verification internals). Authorized to active
--      staff of the *requesting* hotel (tighter than the any-hotel table policy
--      it replaces). Logs each access to va_audit_logs (the shared audit table;
--      identity_document_views is NOT-NULL-constrained to an image side/hotel
--      and doesn't fit a metadata read).
--   2. Drops staff_view_documents — with WalkInPayment rerouted to the RPC, no
--      client does a direct SELECT anymore. Guest self-view policies remain (a
--      guest can still read only their own row directly; unused by current
--      clients but harmless and correct). The image bytes stay behind the
--      get-document-url Edge Function. service_role/SECURITY DEFINER paths are
--      unaffected (they bypass RLS).
--
-- IMPORTANT — front_image/back_image are intentionally NULL in the result.
-- upsert_guest_v2 only touches the doc when front_image_path != '' and, when it
-- does, it DEACTIVATES the existing active doc and inserts a fresh one (losing
-- hashes/verification). For a returning guest who does not recapture, the global
-- doc must be left untouched. Returning the real paths here would silently churn
-- the doc on every walk-in. Only storage_key is surfaced (folder reuse on a
-- genuine recapture). This preserves today's exact walk-in behavior.

-- ─── 1. Gated metadata RPC ──────────────────────────────────────────────────
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
  SELECT document_type, document_number_masked, storage_key
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

  -- Surface only the minimum needed by the walk-in flow. No hash, no raw image
  -- paths, no verification internals. front_image/back_image deliberately NULL
  -- (see header note on no-churn reuse).
  RETURN jsonb_build_object(
    'type',        v_doc.document_type::text,
    'number',      v_doc.document_number_masked,
    'storage_key', v_doc.storage_key,
    'front_image', NULL,
    'back_image',  NULL
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.get_guest_id_proof_for_checkin(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_guest_id_proof_for_checkin(uuid, uuid) TO authenticated;

-- ─── 2. Remove the last direct client SELECT path for staff ─────────────────
DROP POLICY IF EXISTS "staff_view_documents" ON public.guest_id_documents;
