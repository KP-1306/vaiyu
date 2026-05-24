-- ============================================================
-- VAiyu – Fix upsert_guest_v2: TWO bugs in baseline
-- ============================================================
-- Bug 1: INSERT lists `mobile_normalized` as a target column, but
-- it is a GENERATED column. Postgres rejects:
--   ERROR: cannot insert a non-DEFAULT value into column "mobile_normalized"
--
-- Bug 2: `ON CONFLICT (mobile) WHERE mobile IS NOT NULL` references
-- a non-existent unique constraint. The actual unique index in this
-- schema is `uq_global_guest_mobile ON guests(mobile_normalized)
-- WHERE mobile_normalized IS NOT NULL AND mobile_normalized <> ''`.
-- Postgres rejects:
--   ERROR: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Together these break ANY new-guest walk-in. Existing guests work
-- because they hit the earlier UPDATE branch (lookup-by-mobile_normalized
-- before INSERT) and never reach the buggy INSERT.
--
-- Fix:
--   • Drop `mobile_normalized` from INSERT column list — generated
--     column computes itself.
--   • Change ON CONFLICT to target `(mobile_normalized)` with the same
--     WHERE clause as the unique index.
--
-- Local-only by intent — apply via psql, do not push to prod until
-- reviewed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_guest_v2(
  p_guest_details jsonb,
  p_hotel_id uuid DEFAULT NULL::uuid
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
    v_guest_id UUID;
    v_mobile TEXT;
    v_email TEXT;
    v_mobile_norm TEXT;
    v_doc_type public.guest_document_type;
    v_full_name TEXT;
BEGIN
    -- 1. Normalize Inputs
    v_full_name := NULLIF(trim(COALESCE(p_guest_details->>'full_name', p_guest_details->>'guest_name')), '');
    v_mobile := NULLIF(regexp_replace(COALESCE(p_guest_details->>'mobile', p_guest_details->>'phone'), '[^0-9]', '', 'g'), '');
    v_email := NULLIF(lower(trim(p_guest_details->>'email')), '');
    v_mobile_norm := v_mobile; -- Used for lookup only, not insert

    -- Mobile validation guard
    IF v_mobile_norm IS NOT NULL AND length(v_mobile_norm) < 6 THEN
      RAISE EXCEPTION 'A valid mobile number (min 6 digits) is required';
    END IF;

    -- 2. Lookup existing guest (Global)
    -- Priority 1: mobile_normalized
    IF v_mobile_norm IS NOT NULL AND v_mobile_norm != '' THEN
        SELECT id INTO v_guest_id FROM public.guests WHERE mobile_normalized = v_mobile_norm ORDER BY created_at LIMIT 1;
    END IF;

    -- Priority 2: email
    IF v_guest_id IS NULL AND v_email IS NOT NULL AND v_email != '' THEN
        SELECT id INTO v_guest_id FROM public.guests WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;
    END IF;

    -- 3. Upsert Logic
    IF v_guest_id IS NOT NULL THEN
        UPDATE public.guests
        SET
            full_name = COALESCE(NULLIF(v_full_name, ''), full_name),
            email = COALESCE(NULLIF(v_email, ''), email),
            mobile = COALESCE(NULLIF(v_mobile, ''), mobile),
            nationality = COALESCE(NULLIF(trim(p_guest_details->>'nationality'), ''), nationality),
            address = COALESCE(NULLIF(trim(p_guest_details->>'address'), ''), address),
            updated_at = now()
        WHERE id = v_guest_id;
    ELSE
        -- FIX 1: removed `mobile_normalized` from column list — generated.
        -- FIX 2: ON CONFLICT now targets the actual unique index
        --        uq_global_guest_mobile (mobile_normalized) WHERE mobile_normalized IS NOT NULL AND mobile_normalized <> ''
        INSERT INTO public.guests (
            full_name,
            mobile,
            email,
            nationality,
            address
        )
        VALUES (
            COALESCE(v_full_name, 'Guest'),
            v_mobile,
            v_email,
            NULLIF(trim(p_guest_details->>'nationality'), ''),
            NULLIF(trim(p_guest_details->>'address'), '')
        )
        ON CONFLICT (mobile_normalized)
          WHERE mobile_normalized IS NOT NULL AND mobile_normalized <> ''
        DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = COALESCE(EXCLUDED.email, guests.email),
            updated_at = now()
        RETURNING id INTO v_guest_id;
    END IF;

    -- 4. Hardened Identity Documents (Privacy & Concurrency Aware)
    IF coalesce(p_guest_details->>'front_image_path', '') != '' THEN
        v_doc_type := COALESCE((p_guest_details->>'id_type')::guest_document_type, 'other');
        BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM public.guest_id_documents
              WHERE guest_id = v_guest_id
                AND document_type = v_doc_type
                AND front_hash = p_guest_details->>'front_hash'
                AND is_active = true
            ) THEN
                UPDATE public.guest_id_documents
                SET is_active = false
                WHERE id IN (
                    SELECT id
                    FROM public.guest_id_documents
                    WHERE guest_id = v_guest_id
                      AND document_type = v_doc_type
                      AND is_active = true
                    FOR UPDATE
                );

                INSERT INTO public.guest_id_documents (
                    guest_id,
                    document_type,
                    document_number_masked,
                    front_image_url,
                    back_image_url,
                    storage_key,
                    front_hash,
                    back_hash,
                    issuing_country,
                    verification_status,
                    is_active
                )
                VALUES (
                    v_guest_id,
                    v_doc_type,
                    CASE
                        WHEN length(p_guest_details->>'id_number') > 4
                        THEN repeat('X', length(p_guest_details->>'id_number') - 4) || right(p_guest_details->>'id_number', 4)
                        ELSE p_guest_details->>'id_number'
                    END,
                    p_guest_details->>'front_image_path',
                    p_guest_details->>'back_image_path',
                    NULLIF(p_guest_details->>'storage_key', '')::UUID,
                    p_guest_details->>'front_hash',
                    p_guest_details->>'back_hash',
                    p_guest_details->>'issuing_country',
                    'pending',
                    true
                );
            END IF;
        END;
    END IF;

    RETURN v_guest_id;
END;
$function$;
