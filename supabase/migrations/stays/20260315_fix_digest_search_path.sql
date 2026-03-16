-- ============================================================
-- FIX: digest() search_path issue
-- ============================================================

-- Ensure pgcrypto exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Search functions
ALTER FUNCTION public.search_booking(text, uuid, integer)
SET search_path = public, extensions;

-- 2. Precheckin
ALTER FUNCTION public.validate_precheckin_token(text, uuid, boolean)
SET search_path = public, extensions;

ALTER FUNCTION public.submit_precheckin(text, jsonb)
SET search_path = public, extensions;

-- 3. Checkin RPCs
ALTER FUNCTION public.process_checkin(uuid, jsonb, uuid, uuid)
SET search_path = public, extensions;

ALTER FUNCTION public.process_checkin_v2(uuid, jsonb, jsonb, uuid)
SET search_path = public, extensions;

ALTER FUNCTION public.create_walkin_v2(uuid, jsonb, jsonb, date, date, integer, integer, uuid)
SET search_path = public, extensions;


-- ============================================================
-- Document number hashing trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_document_number_hash()
RETURNS trigger AS $$
BEGIN
  IF NEW.document_number_masked IS NOT NULL THEN
    NEW.document_number_hash :=
      encode(
        extensions.digest(lower(NEW.document_number_masked)::text, 'sha256'),
        'hex'
      );
  ELSE
    NEW.document_number_hash := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_set_document_number_hash ON public.guest_id_documents;

CREATE TRIGGER trg_set_document_number_hash
BEFORE INSERT OR UPDATE OF document_number_masked
ON public.guest_id_documents
FOR EACH ROW
EXECUTE FUNCTION public.set_document_number_hash();
